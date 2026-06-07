import { db, makeId, nowIso, TargetType } from './db.js';
import { authenticate } from './auth.js';

export type CurrentUser = {
  id: string;
  role: string;
  name: string;
};

export function getCurrentUser(headers: Record<string, unknown>): CurrentUser {
  return authenticate(headers.authorization);
}

export function assertCanReadCase(user: CurrentUser, projectCaseId: string) {
  if (user.role === 'admin') return;
  const membership = db
    .prepare('SELECT 1 FROM project_case_member WHERE project_case_id = ? AND user_id = ?')
    .get(projectCaseId, user.id);
  if (!membership) {
    const err = new Error('当前用户不能查看该项目');
    err.name = 'PERMISSION_DENIED';
    throw err;
  }
}

export function canEditTask(user: CurrentUser, taskId: string) {
  if (user.role === 'admin') return true;
  const task = db.prepare('SELECT assignee_id, team_id FROM case_task WHERE id = ?').get(taskId) as
    | { assignee_id: string | null; team_id: string | null }
    | undefined;
  if (!task) return false;
  if (task.assignee_id === user.id) return true;
  if (task.team_id) {
    const team = db.prepare('SELECT 1 FROM team WHERE id = ? AND leader_id = ?').get(task.team_id, user.id);
    if (team) return true;
  }
  return false;
}

export function canEditSubtask(user: CurrentUser, subtaskId: string) {
  if (user.role === 'admin') return true;
  const subtask = db
    .prepare(
      `SELECT s.assignee_id, s.team_id, s.case_task_id, t.assignee_id as task_assignee_id, t.team_id as task_team_id
       FROM case_subtask s
       JOIN case_task t ON t.id = s.case_task_id
       WHERE s.id = ?`
    )
    .get(subtaskId) as
    | { assignee_id: string | null; team_id: string | null; case_task_id: string; task_assignee_id: string | null; task_team_id: string | null }
    | undefined;
  if (!subtask) return false;
  if (subtask.assignee_id === user.id || subtask.task_assignee_id === user.id) return true;
  const teamId = subtask.team_id ?? subtask.task_team_id;
  if (teamId) {
    const team = db.prepare('SELECT 1 FROM team WHERE id = ? AND leader_id = ?').get(teamId, user.id);
    if (team) return true;
  }
  return false;
}

export function updateProgress(targetType: TargetType, targetId: string, progress: number, user: CurrentUser, reason?: string) {
  if (progress < 0 || progress > 100) {
    const err = new Error('进度必须在 0 到 100 之间');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }

  if (targetType === 'task' && !canEditTask(user, targetId)) {
    const err = new Error('当前用户不能修改该任务进度');
    err.name = 'PERMISSION_DENIED';
    throw err;
  }
  if (targetType === 'subtask' && !canEditSubtask(user, targetId)) {
    const err = new Error('当前用户不能修改该工序进度');
    err.name = 'PERMISSION_DENIED';
    throw err;
  }

  const table = targetType === 'task' ? 'case_task' : 'case_subtask';
  const before = db.prepare(`SELECT id, status, progress FROM ${table} WHERE id = ?`).get(targetId) as
    | { id: string; status: string; progress: number }
    | undefined;
  if (!before) {
    const err = new Error('目标不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }

  const nextStatus = progress >= 100 ? 'completed' : progress > 0 ? 'in_progress' : 'not_started';

  const tx = db.transaction(() => {
    db.prepare(`UPDATE ${table} SET progress = ?, status = ? WHERE id = ?`).run(progress, nextStatus, targetId);
    db.prepare(
      `INSERT INTO progress_log
       (id, target_type, target_id, changed_by, before_status, after_status, before_progress, after_progress, source, reason, remark, created_at)
       VALUES (@id, @target_type, @target_id, @changed_by, @before_status, @after_status, @before_progress, @after_progress, @source, @reason, @remark, @created_at)`
    ).run({
      id: makeId('PL'),
      target_type: targetType,
      target_id: targetId,
      changed_by: user.id,
      before_status: before.status,
      after_status: nextStatus,
      before_progress: before.progress,
      after_progress: progress,
      source: 'manual_edit',
      reason: reason ?? '',
      remark: '',
      created_at: nowIso()
    });

    const taskId = targetType === 'task' ? targetId : (db.prepare('SELECT case_task_id FROM case_subtask WHERE id = ?').get(targetId) as { case_task_id: string }).case_task_id;
    recalculateTask(taskId);
  });
  tx();

  return getTaskDetails(targetType === 'task' ? targetId : (db.prepare('SELECT case_task_id FROM case_subtask WHERE id = ?').get(targetId) as { case_task_id: string }).case_task_id, user);
}

export function recalculateTask(taskId: string) {
  const subtasks = db
    .prepare('SELECT progress FROM case_subtask WHERE case_task_id = ? AND is_applicable = 1 AND include_in_progress = 1')
    .all(taskId) as Array<{ progress: number }>;
  if (subtasks.length > 0) {
    const avg = roundProgress(subtasks.reduce((sum, row) => sum + row.progress, 0) / subtasks.length);
    const status = avg >= 100 ? 'completed' : avg > 0 ? 'in_progress' : 'not_started';
    db.prepare('UPDATE case_task SET progress = ?, status = ? WHERE id = ?').run(avg, status, taskId);
  }

  const task = db.prepare('SELECT project_case_id, case_item_id FROM case_task WHERE id = ?').get(taskId) as { project_case_id: string; case_item_id: string | null };
  if (task.case_item_id) recalculateItem(task.case_item_id);
  recalculateCase(task.project_case_id);
}

function recalculateItem(itemId: string) {
  const tasks = db
    .prepare('SELECT progress FROM case_task WHERE case_item_id = ? AND is_applicable = 1 AND include_in_progress = 1')
    .all(itemId) as Array<{ progress: number }>;
  const avg = tasks.length > 0 ? roundProgress(tasks.reduce((sum, row) => sum + row.progress, 0) / tasks.length) : 0;
  const status = avg >= 100 ? 'completed' : avg > 0 ? 'in_progress' : 'not_started';
  db.prepare('UPDATE case_item SET progress = ?, status = ? WHERE id = ?').run(avg, status, itemId);
}

function recalculateCase(projectCaseId: string) {
  const caseTasks = db
    .prepare('SELECT progress FROM case_task WHERE project_case_id = ? AND case_item_id IS NULL AND is_applicable = 1 AND include_in_progress = 1')
    .all(projectCaseId) as Array<{ progress: number }>;
  const items = db.prepare('SELECT id FROM case_item WHERE project_case_id = ?').all(projectCaseId) as Array<{ id: string }>;
  const itemFlowProgress = items.map((item) => {
    const itemTasks = db
      .prepare('SELECT progress FROM case_task WHERE case_item_id = ? AND is_applicable = 1 AND include_in_progress = 1')
      .all(item.id) as Array<{ progress: number }>;
    const stages = [...caseTasks, ...itemTasks];
    return stages.length > 0 ? stages.reduce((sum, row) => sum + row.progress, 0) / stages.length : 0;
  });
  const avg = itemFlowProgress.length > 0
    ? roundProgress(itemFlowProgress.reduce((sum, progress) => sum + progress, 0) / itemFlowProgress.length)
    : caseTasks.length > 0
      ? roundProgress(caseTasks.reduce((sum, row) => sum + row.progress, 0) / caseTasks.length)
      : 0;
  const status = avg >= 100 ? 'completed' : avg > 0 ? 'in_progress' : 'not_started';
  db.prepare('UPDATE project_case SET total_progress = ?, status = ? WHERE id = ?').run(avg, status, projectCaseId);
}

function roundProgress(value: number) {
  return Math.round(value * 10) / 10;
}

function progressStatus(progress: number) {
  return progress >= 100 ? 'completed' : progress > 0 ? 'in_progress' : 'not_started';
}

export function getTaskDetails(taskId: string, user?: CurrentUser) {
  const task = db
    .prepare(
      `SELECT t.*, pc.name as case_name, ci.name as item_name, e.name as assignee_name, tm.name as team_name, d.name as department_name
       FROM case_task t
       JOIN project_case pc ON pc.id = t.project_case_id
       LEFT JOIN case_item ci ON ci.id = t.case_item_id
       LEFT JOIN employee e ON e.id = t.assignee_id
       LEFT JOIN team tm ON tm.id = t.team_id
       LEFT JOIN department d ON d.id = t.owner_department_id
       WHERE t.id = ?`
    )
    .get(taskId);
  if (!task) {
    const err = new Error('任务不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }
  const subtasks = db
    .prepare(
      `SELECT s.*, e.name as assignee_name, tm.name as team_name
       FROM case_subtask s
       LEFT JOIN employee e ON e.id = s.assignee_id
       LEFT JOIN team tm ON tm.id = s.team_id
       WHERE s.case_task_id = ?
       ORDER BY s.sort_order`
    )
    .all(taskId) as Array<{ id: string } & Record<string, unknown>>;
  const subtasksWithPermission = user
    ? subtasks.map((subtask) => ({ ...subtask, editable: canEditSubtask(user, subtask.id) }))
    : subtasks;
  const workLogs = db
    .prepare(
      `SELECT wl.*, emp.name as actual_employee_name, input.name as input_by_name
       FROM work_log_entry wl
       LEFT JOIN employee emp ON emp.id = wl.actual_employee_id
       LEFT JOIN employee input ON input.id = wl.input_by
       WHERE wl.case_task_id = ?
       ORDER BY wl.work_date DESC`
    )
    .all(taskId);
  const exceptions = db
    .prepare(
      `SELECT ex.*, handler.name as current_handler_name, dept.name as responsible_department_name
       FROM exception_record ex
       LEFT JOIN employee handler ON handler.id = ex.current_handler_id
       LEFT JOIN department dept ON dept.id = ex.responsible_department_id
       WHERE ex.case_task_id = ?
       ORDER BY ex.updated_at DESC`
    )
    .all(taskId);
  const progressLogs = db
    .prepare(
      `SELECT pl.*, emp.name as changed_by_name
       FROM progress_log pl
       LEFT JOIN employee emp ON emp.id = pl.changed_by
       WHERE (pl.target_type = 'task' AND pl.target_id = ?)
          OR (pl.target_type = 'subtask' AND pl.target_id IN (SELECT id FROM case_subtask WHERE case_task_id = ?))
       ORDER BY pl.created_at DESC
       LIMIT 20`
    )
    .all(taskId, taskId);
  return { task, subtasks: subtasksWithPermission, workLogs, exceptions, progressLogs };
}

type MatrixProject = {
  id: string;
  name: string;
  status: string;
  total_progress: number;
  delivery_status: string | null;
  business_owner_name: string | null;
  design_owner_name: string | null;
  open_exception_count: number;
};

type MatrixItem = {
  id: string;
  project_case_id: string;
  name: string;
  progress: number;
  status: string;
  delivery_status: string | null;
  open_exception_count: number;
};

type MatrixTemplateColumn = {
  task_type: string;
  task_name: string;
  generation_scope: string;
  subtask_template_id: string;
  subtask_name: string;
  sort_order: number;
};

type MatrixTask = {
  id: string;
  task_type: string;
  name: string;
  progress: number;
  status: string;
  assignee_name: string | null;
  team_name: string | null;
  department_name: string | null;
};

type MatrixSubtask = {
  id: string;
  case_task_id: string;
  subtask_template_id: string;
  progress: number;
  status: string;
  assignee_name: string | null;
  team_name: string | null;
};

type MatrixCell = {
  value: string | number | null;
  status?: string;
  editable?: boolean;
  targetType?: 'task' | 'subtask';
  targetId?: string;
  taskId?: string;
  ownerName?: string;
  departmentName?: string | null;
  aggregateCount?: number;
};

type MatrixRow = {
  row_id: string;
  row_type: 'project' | 'item';
  project_case_id: string;
  case_item_id: string;
  item_progress: number;
  cells: Record<string, MatrixCell>;
  open_exception_count: number;
  children?: MatrixRow[];
};

export function getAllMatrix(user: CurrentUser) {
  const projects = getVisibleMatrixProjects(user);
  const templates = getMatrixTemplateColumns();
  const columns = buildMatrixColumns(templates);
  const rows = projects.map((project) => buildProjectMatrixRow(project, templates, user));
  const itemCount = rows.reduce((sum, row) => sum + (row.children?.length ?? 0), 0);
  const openExceptionCount = rows.reduce((sum, row) => sum + row.open_exception_count, 0);
  return {
    columns,
    rows,
    summary: {
      project_count: rows.length,
      item_count: itemCount,
      open_exception_count: openExceptionCount
    }
  };
}

function getVisibleMatrixProjects(user: CurrentUser) {
  const sql = `SELECT pc.*, b.name as business_owner_name, de.name as design_owner_name,
                      (SELECT COUNT(*) FROM exception_record ex
                       WHERE ex.project_case_id = pc.id
                         AND ex.status NOT IN ('resolved', 'closed', 'cancelled')) as open_exception_count
               FROM project_case pc
               LEFT JOIN employee b ON b.id = pc.business_owner_id
               LEFT JOIN employee de ON de.id = pc.design_owner_id
               ${user.role === 'admin' ? '' : 'JOIN project_case_member m ON m.project_case_id = pc.id'}
               ${user.role === 'admin' ? '' : 'WHERE m.user_id = ?'}
               ORDER BY pc.source_seq, pc.id`;
  return (user.role === 'admin'
    ? db.prepare(sql).all()
    : db.prepare(sql).all(user.id)) as MatrixProject[];
}

function getMatrixTemplateColumns() {
  return db
    .prepare(
      `SELECT tt.task_type, tt.name as task_name, tt.generation_scope,
              st.id as subtask_template_id, st.name as subtask_name, st.sort_order
       FROM task_template tt
       JOIN subtask_template st ON st.task_template_id = tt.id
       ORDER BY tt.sort_order, st.sort_order`
    )
    .all() as MatrixTemplateColumn[];
}

function buildMatrixColumns(templates: MatrixTemplateColumn[]) {
  return [
    { key: 'case_name', title: '项目', frozen: 'left' },
    { key: 'case_item_name', title: '子项目', frozen: 'left' },
    ...templates.map((column, index) => ({
      key: `${column.task_type}.${column.subtask_template_id}`,
      title: column.subtask_name,
      group: column.task_name,
      taskType: column.task_type,
      groupIndex: index
    })),
    { key: 'delivery_status', title: '发货情况', frozen: 'right' },
    { key: 'open_exception_count', title: '异常', frozen: 'right' }
  ];
}

function buildProjectMatrixRow(project: MatrixProject, templates: MatrixTemplateColumn[], user: CurrentUser): MatrixRow {
  const items = db
    .prepare(
      `SELECT ci.*,
              (SELECT COUNT(*) FROM exception_record ex
               WHERE ex.case_item_id = ci.id
                 AND ex.status NOT IN ('resolved', 'closed', 'cancelled')) as open_exception_count
       FROM case_item ci
       WHERE ci.project_case_id = ?
       ORDER BY ci.source_row, ci.id`
    )
    .all(project.id) as MatrixItem[];
  const caseTasks = getMatrixTasks(project.id, null);
  const children = items.map((item) => buildItemMatrixRow(project, item, caseTasks, templates, user));
  const cells: Record<string, MatrixCell> = {
    case_name: {
      value: project.name,
      status: project.status,
      ownerName: compactOwners([project.business_owner_name, project.design_owner_name]),
      aggregateCount: children.length
    },
    case_item_name: {
      value: `${children.length} 个子项目`,
      status: project.status
    },
    delivery_status: { value: project.delivery_status ?? '' },
    open_exception_count: { value: project.open_exception_count }
  };

  for (const template of templates) {
    const key = `${template.task_type}.${template.subtask_template_id}`;
    const childCells = children
      .map((child) => child.cells[key])
      .filter((cell): cell is MatrixCell => Boolean(cell) && typeof cell.value === 'number');
    if (childCells.length > 0) {
      const average = roundProgress(childCells.reduce((sum, cell) => sum + Number(cell.value), 0) / childCells.length);
      cells[key] = {
        value: average,
        status: progressStatus(average),
        ownerName: compactOwners(childCells.map((cell) => cell.ownerName)),
        aggregateCount: childCells.length
      };
    }
  }

  return {
    row_id: `PROJECT-${project.id}`,
    row_type: 'project',
    project_case_id: project.id,
    case_item_id: `PROJECT-${project.id}`,
    item_progress: project.total_progress,
    cells,
    open_exception_count: project.open_exception_count,
    children
  };
}

function buildItemMatrixRow(project: MatrixProject, item: MatrixItem, caseTasks: MatrixTask[], templates: MatrixTemplateColumn[], user: CurrentUser): MatrixRow {
  const itemTasks = getMatrixTasks(project.id, item.id);
  const tasks = [...caseTasks, ...itemTasks];
  const cells: Record<string, MatrixCell> = {
    case_name: { value: '', ownerName: compactOwners([project.business_owner_name, project.design_owner_name]) },
    case_item_name: { value: item.name, status: item.status, aggregateCount: Math.round(item.progress) },
    delivery_status: { value: item.delivery_status ?? '' },
    open_exception_count: { value: item.open_exception_count }
  };

  for (const task of tasks) {
    const subtasks = getMatrixSubtasks(task.id);
    for (const subtask of subtasks) {
      const key = `${task.task_type}.${subtask.subtask_template_id}`;
      if (!templates.some((template) => `${template.task_type}.${template.subtask_template_id}` === key)) continue;
      cells[key] = {
        value: subtask.progress,
        status: subtask.status,
        editable: canEditSubtask(user, subtask.id),
        targetType: 'subtask',
        targetId: subtask.id,
        taskId: task.id,
        ownerName: ownerLabel(subtask, task),
        departmentName: task.department_name
      };
    }
  }

  return {
    row_id: item.id,
    row_type: 'item',
    project_case_id: project.id,
    case_item_id: item.id,
    item_progress: item.progress,
    cells,
    open_exception_count: item.open_exception_count
  };
}

function getMatrixTasks(projectCaseId: string, itemId: string | null) {
  const itemCondition = itemId === null ? 't.case_item_id IS NULL' : 't.case_item_id = ?';
  return db
    .prepare(
      `SELECT t.*, e.name as assignee_name, tm.name as team_name, d.name as department_name
       FROM case_task t
       LEFT JOIN employee e ON e.id = t.assignee_id
       LEFT JOIN team tm ON tm.id = t.team_id
       LEFT JOIN department d ON d.id = t.owner_department_id
       WHERE t.project_case_id = ? AND ${itemCondition}
       ORDER BY t.id`
    )
    .all(...(itemId === null ? [projectCaseId] : [projectCaseId, itemId])) as MatrixTask[];
}

function getMatrixSubtasks(taskId: string) {
  return db
    .prepare(
      `SELECT s.*, e.name as assignee_name, tm.name as team_name
       FROM case_subtask s
       LEFT JOIN employee e ON e.id = s.assignee_id
       LEFT JOIN team tm ON tm.id = s.team_id
       WHERE s.case_task_id = ?
       ORDER BY s.sort_order`
    )
    .all(taskId) as MatrixSubtask[];
}

function ownerLabel(subtask: MatrixSubtask, task: MatrixTask) {
  return subtask.assignee_name ?? subtask.team_name ?? task.assignee_name ?? task.team_name ?? task.department_name ?? '';
}

function compactOwners(values: Array<string | null | undefined>) {
  const owners = Array.from(new Set(values.filter((value): value is string => Boolean(value))));
  if (owners.length <= 2) return owners.join(' / ');
  return `${owners.slice(0, 2).join(' / ')} +${owners.length - 2}`;
}

export function getMatrix(projectCaseId: string, user: CurrentUser) {
  assertCanReadCase(user, projectCaseId);
  const projectCase = db
    .prepare(
      `SELECT pc.*, b.name as business_owner_name, de.name as design_owner_name
       FROM project_case pc
       LEFT JOIN employee b ON b.id = pc.business_owner_id
       LEFT JOIN employee de ON de.id = pc.design_owner_id
       WHERE pc.id = ?`
    )
    .get(projectCaseId) as { id: string; name: string; business_owner_name: string | null; design_owner_name: string | null } | undefined;
  if (!projectCase) {
    const err = new Error('项目不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }
  const items = db.prepare('SELECT * FROM case_item WHERE project_case_id = ? ORDER BY source_row, id').all(projectCaseId) as Array<{
    id: string;
    name: string;
    progress: number;
    delivery_status: string | null;
  }>;
  const subtaskTemplates = db
    .prepare(
      `SELECT tt.task_type, tt.name as task_name, tt.generation_scope,
              st.id as subtask_template_id, st.name as subtask_name, st.sort_order
       FROM task_template tt
       JOIN subtask_template st ON st.task_template_id = tt.id
       ORDER BY tt.sort_order, st.sort_order`
    )
    .all() as Array<{ task_type: string; task_name: string; generation_scope: string; subtask_template_id: string; subtask_name: string; sort_order: number }>;

  const columns = [
    { key: 'case_name', title: '项目名称', frozen: true },
    { key: 'case_item_name', title: '子项目', frozen: true },
    { key: 'business_owner_name', title: '业务部负责人', frozen: true },
    { key: 'design_owner_name', title: '设计部负责人', frozen: true },
    { key: 'delivery_status', title: '发货情况', frozen: true },
    { key: 'open_exception_count', title: '异常', frozen: true },
    ...subtaskTemplates.map((column) => ({
      key: `${column.task_type}.${column.subtask_template_id}`,
      title: column.subtask_name,
      group: column.task_name,
      taskType: column.task_type
    }))
  ];

  const caseTasks = db
    .prepare('SELECT * FROM case_task WHERE project_case_id = ? AND case_item_id IS NULL')
    .all(projectCaseId) as Array<{ id: string; task_type: string; name: string; progress: number }>;

  const rows = items.map((item) => {
    const itemTasks = db.prepare('SELECT * FROM case_task WHERE case_item_id = ?').all(item.id) as Array<{ id: string; task_type: string; name: string; progress: number }>;
    const tasks = [...caseTasks, ...itemTasks];
    const cells: Record<string, unknown> = {
      case_name: { value: projectCase.name },
      case_item_name: { value: item.name },
      business_owner_name: { value: projectCase.business_owner_name ?? '' },
      design_owner_name: { value: projectCase.design_owner_name ?? '' },
      delivery_status: { value: item.delivery_status ?? '' }
    };

    const openExceptionCount = db
      .prepare("SELECT COUNT(*) as count FROM exception_record WHERE case_item_id = ? AND status NOT IN ('resolved', 'closed', 'cancelled')")
      .get(item.id) as { count: number };
    cells.open_exception_count = { value: openExceptionCount.count };

    for (const task of tasks) {
      const subtasks = db.prepare('SELECT * FROM case_subtask WHERE case_task_id = ?').all(task.id) as Array<{ id: string; subtask_template_id: string; progress: number; status: string }>;
      for (const subtask of subtasks) {
        const key = `${task.task_type}.${subtask.subtask_template_id}`;
        cells[key] = {
          value: subtask.progress,
          status: subtask.status,
          editable: canEditSubtask(user, subtask.id),
          targetType: 'subtask',
          targetId: subtask.id,
          taskId: task.id
        };
      }
    }

    return {
      project_case_id: projectCaseId,
      case_item_id: item.id,
      item_progress: item.progress,
      cells,
      open_exception_count: openExceptionCount.count
    };
  });

  return { projectCase, columns, rows };
}
