import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { z } from 'zod';
import { db, initializeDatabase, makeId, nowIso } from './db.js';
import {
  assertCanReadCase,
  canManageProjects,
  createProjectCase,
  deleteProjectCase,
  getAllMatrix,
  getCurrentUser,
  getMatrix,
  getProjectCaseManageProfile,
  getTaskDetails,
  updateProgress,
  updateProjectCase
} from './services.js';
import { confirmExcelImport, createExcelImport, getImportPreview } from './importer.js';
import { login, logout } from './auth.js';

initializeDatabase();

const app = Fastify({ logger: true, trustProxy: true });
const corsOrigins = process.env.CORS_ORIGIN
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
await app.register(cors, { origin: corsOrigins?.length ? corsOrigins : false });
await app.register(multipart);

app.setErrorHandler((error, _request, reply) => {
  const statusCode =
    error.name === 'AUTH_REQUIRED' || error.name === 'AUTH_INVALID' ? 401 :
      error.name === 'PERMISSION_DENIED' ? 403 :
      error.name === 'NOT_FOUND' ? 404 :
        error.name === 'VALIDATION_ERROR' ? 400 :
          500;
  reply.status(statusCode).send({
    code: error.name || 'INTERNAL_ERROR',
    message: error.message,
    details: {}
  });
});

const publicApiPaths = new Set(['/api/health', '/api/auth/login', '/api/auth/logout']);

app.addHook('preHandler', async (request) => {
  const path = request.url.split('?')[0];
  if (path.startsWith('/api/') && !publicApiPaths.has(path)) {
    getCurrentUser(request.headers);
  }
});

app.get('/api/health', async () => ({ ok: true }));

app.post('/api/auth/login', async (request) => {
  const body = z.object({
    login_name: z.string().trim().min(1),
    password: z.string().min(1)
  }).parse(request.body);
  return login(body.login_name, body.password);
});

app.post('/api/auth/logout', async (request) => {
  return logout(request.headers.authorization);
});

app.get('/api/auth/me', async (request) => {
  return getCurrentUser(request.headers);
});

app.get('/api/me', async (request) => {
  return getCurrentUser(request.headers);
});

app.get('/api/cases', async (request) => {
  const user = getCurrentUser(request.headers);
  if (canManageProjects(user)) {
    return db.prepare(
      `SELECT pc.*, b.name as business_owner_name, d.name as design_owner_name,
              (SELECT COUNT(*) FROM exception_record ex WHERE ex.project_case_id = pc.id AND ex.status NOT IN ('resolved', 'closed', 'cancelled')) as open_exception_count
       FROM project_case pc
       LEFT JOIN employee b ON b.id = pc.business_owner_id
       LEFT JOIN employee d ON d.id = pc.design_owner_id
       ORDER BY pc.source_seq`
    ).all();
  }
  return db.prepare(
    `SELECT pc.*, b.name as business_owner_name, d.name as design_owner_name,
            (SELECT COUNT(*) FROM exception_record ex WHERE ex.project_case_id = pc.id AND ex.status NOT IN ('resolved', 'closed', 'cancelled')) as open_exception_count
     FROM project_case pc
     LEFT JOIN employee b ON b.id = pc.business_owner_id
     LEFT JOIN employee d ON d.id = pc.design_owner_id
     WHERE EXISTS (
       SELECT 1 FROM project_case_member m
       WHERE m.project_case_id = pc.id
         AND m.user_id = ?
     )
     ORDER BY pc.source_seq`
  ).all(user.id);
});

const projectCaseItemBody = z.object({
  id: z.string().nullable().optional(),
  name: z.string().trim().min(1)
});
const projectCaseStageOwnerBody = z.object({
  task_type: z.string().trim().min(1),
  assignee_id: z.string().nullable().optional(),
  team_id: z.string().nullable().optional()
});
const projectCaseFields = {
  code: z.string().trim().nullable().optional(),
  category: z.string().trim().nullable().optional(),
  customer_name: z.string().trim().nullable().optional(),
  business_owner_id: z.string().nullable().optional(),
  design_owner_id: z.string().nullable().optional(),
  estimated_weight: z.number().nullable().optional(),
  delivery_date: z.string().trim().nullable().optional(),
  delivery_status: z.string().trim().nullable().optional(),
  items: z.array(projectCaseItemBody).optional(),
  stage_owners: z.array(projectCaseStageOwnerBody).optional()
};
const projectCaseCreateBody = z.object({
  ...projectCaseFields,
  name: z.string().trim().min(1)
});
const projectCaseUpdateBody = z.object({
  ...projectCaseFields,
  name: z.string().trim().min(1).optional()
});

app.post('/api/cases', async (request) => {
  const user = getCurrentUser(request.headers);
  const body = projectCaseCreateBody.parse(request.body);
  return createProjectCase(body, user);
});

app.patch('/api/cases/:id', async (request) => {
  const user = getCurrentUser(request.headers);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const body = projectCaseUpdateBody.parse(request.body);
  return updateProjectCase(id, body, user);
});

app.delete('/api/cases/:id', async (request) => {
  const user = getCurrentUser(request.headers);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  return deleteProjectCase(id, user);
});

app.get('/api/cases/matrix', async (request) => {
  const user = getCurrentUser(request.headers);
  return getAllMatrix(user);
});

app.get('/api/cases/:id/manage-profile', async (request) => {
  const user = getCurrentUser(request.headers);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  return getProjectCaseManageProfile(id, user);
});

app.get('/api/cases/:id', async (request) => {
  const user = getCurrentUser(request.headers);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  assertCanReadCase(user, id);
  const projectCase = db.prepare(
    `SELECT pc.*, b.name as business_owner_name, d.name as design_owner_name
     FROM project_case pc
     LEFT JOIN employee b ON b.id = pc.business_owner_id
     LEFT JOIN employee d ON d.id = pc.design_owner_id
     WHERE pc.id = ?`
  ).get(id);
  if (!projectCase) {
    const err = new Error('项目不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }
  return projectCase;
});

app.get('/api/cases/:id/items', async (request) => {
  const user = getCurrentUser(request.headers);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  assertCanReadCase(user, id);
  return db.prepare('SELECT * FROM case_item WHERE project_case_id = ? ORDER BY source_row, id').all(id);
});

app.get('/api/cases/:id/matrix', async (request) => {
  const user = getCurrentUser(request.headers);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  return getMatrix(id, user);
});

app.get('/api/tasks/:id', async (request) => {
  const user = getCurrentUser(request.headers);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const task = db.prepare('SELECT project_case_id FROM case_task WHERE id = ?').get(id) as { project_case_id: string } | undefined;
  if (!task) {
    const err = new Error('任务不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }
  assertCanReadCase(user, task.project_case_id);
  return getTaskDetails(id, user);
});

const progressBody = z.object({
  progress: z.number().min(0).max(100),
  reason: z.string().optional()
});

app.patch('/api/tasks/:id/progress', async (request) => {
  const user = getCurrentUser(request.headers);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const body = progressBody.parse(request.body);
  return updateProgress('task', id, body.progress, user, body.reason);
});

app.patch('/api/subtasks/:id/progress', async (request) => {
  const user = getCurrentUser(request.headers);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const body = progressBody.parse(request.body);
  return updateProgress('subtask', id, body.progress, user, body.reason);
});

app.get('/api/work-logs', async (request) => {
  const user = getCurrentUser(request.headers);
  const query = z.object({
    project_case_id: z.string().optional(),
    case_task_id: z.string().optional()
  }).parse(request.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.project_case_id) {
    assertCanReadCase(user, query.project_case_id);
    where.push('wl.project_case_id = ?');
    params.push(query.project_case_id);
  }
  if (query.case_task_id) {
    where.push('wl.case_task_id = ?');
    params.push(query.case_task_id);
  }
  if (!canManageProjects(user)) {
    where.push('wl.project_case_id IN (SELECT project_case_id FROM project_case_member WHERE user_id = ?)');
    params.push(user.id);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(
    `SELECT wl.*, pc.name as case_name, ci.name as item_name, t.name as task_name, s.name as subtask_name,
            emp.name as actual_employee_name, input.name as input_by_name, team.name as team_name
     FROM work_log_entry wl
     JOIN project_case pc ON pc.id = wl.project_case_id
     LEFT JOIN case_item ci ON ci.id = wl.case_item_id
     JOIN case_task t ON t.id = wl.case_task_id
     LEFT JOIN case_subtask s ON s.id = wl.case_subtask_id
     LEFT JOIN employee emp ON emp.id = wl.actual_employee_id
     LEFT JOIN employee input ON input.id = wl.input_by
     LEFT JOIN team ON team.id = wl.team_id
     ${whereSql}
     ORDER BY wl.work_date DESC`
  ).all(...params);
});

const workLogBody = z.object({
  project_case_id: z.string(),
  case_item_id: z.string().nullable().optional(),
  case_task_id: z.string(),
  case_subtask_id: z.string().nullable().optional(),
  actual_employee_id: z.string(),
  team_id: z.string().nullable().optional(),
  work_date: z.string(),
  hours: z.number().positive(),
  work_content: z.string().min(1),
  output_note: z.string().optional(),
  quantity: z.number().nullable().optional(),
  piece_count: z.number().nullable().optional(),
  weight: z.number().nullable().optional(),
  unit: z.string().optional()
});

app.post('/api/work-logs', async (request) => {
  const user = getCurrentUser(request.headers);
  const body = workLogBody.parse(request.body);
  const task = db.prepare('SELECT project_case_id, case_item_id, team_id FROM case_task WHERE id = ?').get(body.case_task_id) as
    | { project_case_id: string; case_item_id: string | null; team_id: string | null }
    | undefined;
  if (!task) {
    const err = new Error('任务不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }
  assertCanReadCase(user, task.project_case_id);
  db.prepare(
    `INSERT INTO work_log_entry
     (id, project_case_id, case_item_id, case_task_id, case_subtask_id, actual_employee_id, input_by, team_id, work_date, hours, work_content, output_note, quantity, piece_count, weight, unit, record_status)
     VALUES (@id, @project_case_id, @case_item_id, @case_task_id, @case_subtask_id, @actual_employee_id, @input_by, @team_id, @work_date, @hours, @work_content, @output_note, @quantity, @piece_count, @weight, @unit, 'submitted')`
  ).run({
    id: makeId('WL'),
    ...body,
    project_case_id: task.project_case_id,
    case_item_id: body.case_item_id ?? task.case_item_id ?? null,
    case_subtask_id: body.case_subtask_id ?? null,
    input_by: user.id,
    team_id: body.team_id ?? task.team_id,
    output_note: body.output_note ?? '',
    quantity: body.quantity ?? null,
    piece_count: body.piece_count ?? null,
    weight: body.weight ?? null,
    unit: body.unit ?? ''
  });
  return { ok: true };
});

app.get('/api/exceptions', async (request) => {
  const user = getCurrentUser(request.headers);
  const query = z.object({
    project_case_id: z.string().optional(),
    status: z.string().optional()
  }).parse(request.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.project_case_id) {
    assertCanReadCase(user, query.project_case_id);
    where.push('ex.project_case_id = ?');
    params.push(query.project_case_id);
  }
  if (query.status) {
    where.push('ex.status = ?');
    params.push(query.status);
  }
  if (!canManageProjects(user)) {
    where.push('ex.project_case_id IN (SELECT project_case_id FROM project_case_member WHERE user_id = ?)');
    params.push(user.id);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(
    `SELECT ex.*, pc.name as case_name, ci.name as item_name, t.name as task_name, s.name as subtask_name,
            handler.name as current_handler_name, dept.name as responsible_department_name
     FROM exception_record ex
     JOIN project_case pc ON pc.id = ex.project_case_id
     LEFT JOIN case_item ci ON ci.id = ex.case_item_id
     LEFT JOIN case_task t ON t.id = ex.case_task_id
     LEFT JOIN case_subtask s ON s.id = ex.case_subtask_id
     LEFT JOIN employee handler ON handler.id = ex.current_handler_id
     LEFT JOIN department dept ON dept.id = ex.responsible_department_id
     ${whereSql}
     ORDER BY ex.updated_at DESC`
  ).all(...params);
});

const exceptionBody = z.object({
  title: z.string().min(1),
  type: z.string().default('other'),
  level: z.string().default('medium'),
  project_case_id: z.string(),
  case_item_id: z.string().nullable().optional(),
  case_task_id: z.string().nullable().optional(),
  case_subtask_id: z.string().nullable().optional(),
  responsible_department_id: z.string().nullable().optional(),
  current_handler_id: z.string().nullable().optional(),
  description: z.string().min(1),
  expected_resolved_at: z.string().nullable().optional()
});

app.post('/api/exceptions', async (request) => {
  const user = getCurrentUser(request.headers);
  const body = exceptionBody.parse(request.body);
  const task = body.case_task_id
    ? (db.prepare('SELECT project_case_id, case_item_id FROM case_task WHERE id = ?').get(body.case_task_id) as { project_case_id: string; case_item_id: string | null } | undefined)
    : undefined;
  const projectCaseId = task?.project_case_id ?? body.project_case_id;
  assertCanReadCase(user, projectCaseId);
  const employee = db.prepare('SELECT department_id FROM employee WHERE id = ?').get(user.id) as { department_id: string | null } | undefined;
  const id = makeId('EX');
  db.prepare(
    `INSERT INTO exception_record
     (id, title, type, level, project_case_id, case_item_id, case_task_id, case_subtask_id, created_by, created_department_id, responsible_department_id, current_handler_id, status, description, expected_resolved_at, resolved_at, resolution, created_at, updated_at)
     VALUES (@id, @title, @type, @level, @project_case_id, @case_item_id, @case_task_id, @case_subtask_id, @created_by, @created_department_id, @responsible_department_id, @current_handler_id, 'open', @description, @expected_resolved_at, null, null, @created_at, @updated_at)`
  ).run({
    id,
    ...body,
    project_case_id: projectCaseId,
    case_item_id: body.case_item_id ?? task?.case_item_id ?? null,
    case_task_id: body.case_task_id ?? null,
    case_subtask_id: body.case_subtask_id ?? null,
    responsible_department_id: body.responsible_department_id ?? null,
    current_handler_id: body.current_handler_id ?? null,
    expected_resolved_at: body.expected_resolved_at ?? null,
    created_by: user.id,
    created_department_id: employee?.department_id ?? null,
    created_at: nowIso(),
    updated_at: nowIso()
  });
  return { id };
});

app.patch('/api/exceptions/:id', async (request) => {
  const user = getCurrentUser(request.headers);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const body = z.object({
    status: z.string().optional(),
    current_handler_id: z.string().nullable().optional(),
    resolution: z.string().nullable().optional()
  }).parse(request.body);
  const current = db.prepare('SELECT * FROM exception_record WHERE id = ?').get(id) as { id: string; project_case_id: string } | undefined;
  if (!current) {
    const err = new Error('异常不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }
  assertCanReadCase(user, current.project_case_id);
  db.prepare(
    `UPDATE exception_record
     SET status = COALESCE(@status, status),
         current_handler_id = COALESCE(@current_handler_id, current_handler_id),
         resolution = COALESCE(@resolution, resolution),
         resolved_at = CASE WHEN @status IN ('resolved', 'closed') THEN @resolved_at ELSE resolved_at END,
         updated_at = @updated_at
     WHERE id = @id`
  ).run({
    id,
    status: body.status ?? null,
    current_handler_id: body.current_handler_id ?? null,
    resolution: body.resolution ?? null,
    resolved_at: nowIso(),
    updated_at: nowIso()
  });
  return { ok: true };
});

app.get('/api/me/workbench', async (request) => {
  const user = getCurrentUser(request.headers);
  const tasks = getMyTasks(user);
  const exceptions = getMyExceptions(user);
  return {
    user,
    counts: {
      tasks: tasks.length,
      exceptions: exceptions.length,
      overdue: tasks.filter((task) => task.is_delayed).length
    },
    tasks: tasks.slice(0, 5),
    exceptions: exceptions.slice(0, 5)
  };
});

app.get('/api/me/tasks', async (request) => {
  const user = getCurrentUser(request.headers);
  return getMyTasks(user);
});

app.get('/api/me/exceptions', async (request) => {
  const user = getCurrentUser(request.headers);
  return getMyExceptions(user);
});

app.get('/api/lookups', async () => {
  return {
    employees: db.prepare('SELECT * FROM employee ORDER BY name').all(),
    departments: db.prepare('SELECT * FROM department ORDER BY name').all(),
    teams: db.prepare('SELECT * FROM team ORDER BY name').all()
  };
});

app.get('/api/views', async () => {
  return [
    {
      id: 'default-matrix',
      name: '项目进度总览',
      view_type: 'matrix',
      frozen_columns: ['case_name', 'case_item_name', 'business_owner_name', 'design_owner_name']
    }
  ];
});

app.get('/api/workflow-template', async () => {
  const template = db.prepare("SELECT * FROM case_template WHERE status = 'active' ORDER BY is_default DESC LIMIT 1").get() as
    | { id: string; name: string; version: string; status: string; description: string | null }
    | undefined;
  if (!template) {
    const err = new Error('未配置启用中的项目流程模板');
    err.name = 'NOT_FOUND';
    throw err;
  }
  const stages = db
    .prepare(
      `SELECT tt.*, d.name as owner_department_name
       FROM task_template tt
       LEFT JOIN department d ON d.id = tt.default_owner_department_id
       WHERE tt.case_template_id = ?
       ORDER BY tt.sort_order`
    )
    .all(template.id) as Array<Record<string, unknown> & { id: string }>;
  const subtasks = db
    .prepare("SELECT * FROM subtask_template WHERE task_template_id = ? AND id != 'st-design-confirm' ORDER BY sort_order");
  return {
    ...template,
    stages: stages.map((stage) => ({
      ...stage,
      subprocesses: subtasks.all(stage.id)
    }))
  };
});

app.post('/api/import-tasks', async (request) => {
  const user = getCurrentUser(request.headers);
  const file = await request.file();
  if (!file) {
    const err = new Error('请选择要导入的 Excel 文件');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }
  const buffer = await file.toBuffer();
  return createExcelImport(buffer, file.filename, user.id);
});

app.get('/api/import-tasks/:id/preview', async (request) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  return getImportPreview(id);
});

app.post('/api/import-tasks/:id/confirm', async (request) => {
  const user = getCurrentUser(request.headers);
  const { id } = z.object({ id: z.string() }).parse(request.params);
  return confirmExcelImport(id, user.id);
});

type WorkbenchTask = {
  is_delayed: number | boolean | null;
} & Record<string, unknown>;

type WorkbenchException = Record<string, unknown>;

function getMyTasks(user: { id: string; name: string; role: string; permission_level: string }): WorkbenchTask[] {
  if (canManageProjects(user)) {
    return db.prepare(
      `SELECT t.*, pc.name as case_name, ci.name as item_name, team.name as team_name,
              (SELECT COUNT(*) FROM exception_record ex WHERE ex.case_task_id = t.id AND ex.status NOT IN ('resolved', 'closed', 'cancelled')) as open_exception_count
       FROM case_task t
       JOIN project_case pc ON pc.id = t.project_case_id
       LEFT JOIN case_item ci ON ci.id = t.case_item_id
       LEFT JOIN team ON team.id = t.team_id
       ORDER BY t.status = 'completed', t.project_case_id, t.case_item_id`
    ).all() as WorkbenchTask[];
  }
  return db.prepare(
    `SELECT t.*, pc.name as case_name, ci.name as item_name, team.name as team_name,
            (SELECT COUNT(*) FROM exception_record ex WHERE ex.case_task_id = t.id AND ex.status NOT IN ('resolved', 'closed', 'cancelled')) as open_exception_count
     FROM case_task t
     JOIN project_case pc ON pc.id = t.project_case_id
     LEFT JOIN case_item ci ON ci.id = t.case_item_id
     LEFT JOIN team ON team.id = t.team_id
     LEFT JOIN team owned_team ON owned_team.id = t.team_id
     WHERE t.assignee_id = ? OR owned_team.leader_id = ?
     ORDER BY t.status = 'completed', t.project_case_id, t.case_item_id`
  ).all(user.id, user.id) as WorkbenchTask[];
}

function getMyExceptions(user: { id: string; name: string; role: string; permission_level: string }): WorkbenchException[] {
  if (canManageProjects(user)) {
    return db.prepare(
      `SELECT ex.*, pc.name as case_name, ci.name as item_name, t.name as task_name, s.name as subtask_name,
              dept.name as responsible_department_name
       FROM exception_record ex
       JOIN project_case pc ON pc.id = ex.project_case_id
       LEFT JOIN case_item ci ON ci.id = ex.case_item_id
       LEFT JOIN case_task t ON t.id = ex.case_task_id
       LEFT JOIN case_subtask s ON s.id = ex.case_subtask_id
       LEFT JOIN department dept ON dept.id = ex.responsible_department_id
       WHERE ex.status NOT IN ('resolved', 'closed', 'cancelled')
       ORDER BY ex.updated_at DESC`
    ).all() as WorkbenchException[];
  }
  return db.prepare(
    `SELECT ex.*, pc.name as case_name, ci.name as item_name, t.name as task_name, s.name as subtask_name,
            dept.name as responsible_department_name
     FROM exception_record ex
     JOIN project_case pc ON pc.id = ex.project_case_id
     LEFT JOIN case_item ci ON ci.id = ex.case_item_id
     LEFT JOIN case_task t ON t.id = ex.case_task_id
     LEFT JOIN case_subtask s ON s.id = ex.case_subtask_id
     LEFT JOIN department dept ON dept.id = ex.responsible_department_id
     WHERE ex.current_handler_id = ? AND ex.status NOT IN ('resolved', 'closed', 'cancelled')
     ORDER BY ex.updated_at DESC`
  ).all(user.id) as WorkbenchException[];
}

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
