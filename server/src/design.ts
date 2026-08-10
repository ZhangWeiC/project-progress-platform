import { db, makeId, nowIso } from './db.js';
import { canManageProjects, recalculateTask, type CurrentUser } from './services.js';

export type DesignWorkRecordInput = {
  employee_id?: string;
  project_case_id?: string | null;
  work_type_id?: string | null;
  association_scope?: 'none' | 'project' | 'items';
  case_item_ids?: string[];
  start_date: string;
  end_date: string;
  work_days?: number | null;
  work_content?: string;
  sync_progress?: boolean;
  progress?: number;
};

type ProjectRow = {
  id: string;
  name: string;
  design_owner_id: string | null;
};

type WorkTypeRow = {
  id: string;
  code: string;
  name: string;
  enabled: number;
};

type StoredRecord = {
  id: string;
  employee_id: string;
  input_by: string;
  source: string;
};

export function getDesignLookups(user: CurrentUser) {
  const employees = listDesignEmployees();
  const projects = db.prepare(
    `SELECT id, name, design_owner_id
     FROM project_case
     WHERE status != 'deleted'
     ORDER BY associated_month DESC, month_sort_order ASC, name`
  ).all() as ProjectRow[];
  const projectItems = db.prepare(
    `SELECT id, project_case_id, name
     FROM case_item
     WHERE status != 'deleted'
     ORDER BY project_case_id, source_row, id`
  ).all() as Array<{ id: string; project_case_id: string; name: string }>;
  const itemsByProject = new Map<string, Array<{ id: string; name: string }>>();
  for (const item of projectItems) {
    itemsByProject.set(item.project_case_id, [...(itemsByProject.get(item.project_case_id) ?? []), { id: item.id, name: item.name }]);
  }

  return {
    current_user: {
      ...user,
      is_design_employee: isDesignEmployee(user.id),
      can_manage_records: canManageProjects(user) || leadsDepartment(user.id, '设计')
    },
    employees,
    work_types: listDesignWorkTypes(false),
    projects: projects.map((project) => ({
      ...project,
      items: itemsByProject.get(project.id) ?? []
    }))
  };
}

export function getDesignTimeline(user: CurrentUser, startDate: string, endDate: string, employeeId?: string) {
  assertDateRange(startDate, endDate, 366);
  const employees = listDesignEmployees();
  const params: unknown[] = [endDate, startDate];
  let employeeFilter = '';
  if (employeeId) {
    employeeFilter = ' AND r.employee_id = ?';
    params.push(employeeId);
  }
  const records = db.prepare(
    `SELECT r.*, e.name as employee_name, pc.name as project_case_name, wt.name as work_type_name
     FROM design_work_record r
     JOIN employee e ON e.id = r.employee_id
     LEFT JOIN project_case pc ON pc.id = r.project_case_id
     LEFT JOIN design_work_type wt ON wt.id = r.work_type_id
     WHERE r.record_status = 'active'
       AND r.start_date <= ?
       AND r.end_date >= ?
       ${employeeFilter}
     ORDER BY r.employee_id, r.start_date, r.end_date, r.created_at, r.id`
  ).all(...params) as Array<Record<string, unknown> & { id: string; employee_id: string; input_by: string; source: string }>;
  const targetQuery = db.prepare(
    `SELECT ci.id, ci.name
     FROM design_work_record_target t
     JOIN case_item ci ON ci.id = t.case_item_id
     WHERE t.record_id = ?
     ORDER BY ci.source_row, ci.id`
  );
  const canManageRecords = canManageProjects(user) || leadsDepartment(user.id, '设计');
  return {
    start_date: startDate,
    end_date: endDate,
    employees: employeeId ? employees.filter((employee) => employee.id === employeeId) : employees,
    records: records.map((record) => ({
      ...record,
      work_days: record.work_days === null ? null : Number(record.work_days),
      case_items: targetQuery.all(record.id),
      editable: canManageRecords || record.input_by === user.id || record.employee_id === user.id,
      deletable: canManageRecords || record.input_by === user.id || record.employee_id === user.id
    }))
  };
}

export function createDesignWorkRecord(user: CurrentUser, input: DesignWorkRecordInput) {
  const normalized = normalizeWorkRecordInput(user, input);
  const recordId = makeId('DWR');
  const createdAt = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO design_work_record
       (id, employee_id, input_by, project_case_id, work_type_id, association_scope, start_date, end_date,
        work_days, work_content, source, record_status, created_at, updated_at)
       VALUES (@id, @employee_id, @input_by, @project_case_id, @work_type_id, @association_scope, @start_date, @end_date,
        @work_days, @work_content, 'manual', 'active', @created_at, @updated_at)`
    ).run({ id: recordId, input_by: user.id, created_at: createdAt, updated_at: createdAt, ...normalized });
    replaceRecordTargets(recordId, normalized.case_item_ids);
    if (input.sync_progress) {
      syncDesignProgress(user, normalized.project_case_id, normalized.case_item_ids, input.progress);
    }
  });
  tx();
  return { id: recordId };
}

export function updateDesignWorkRecord(user: CurrentUser, recordId: string, input: DesignWorkRecordInput) {
  const existing = getEditableRecord(user, recordId);
  const normalized = normalizeWorkRecordInput(user, input, existing);
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE design_work_record
       SET employee_id = @employee_id, project_case_id = @project_case_id, work_type_id = @work_type_id,
           association_scope = @association_scope, start_date = @start_date, end_date = @end_date,
           work_days = @work_days, work_content = @work_content, updated_at = @updated_at
       WHERE id = @id`
    ).run({ id: recordId, updated_at: nowIso(), ...normalized });
    replaceRecordTargets(recordId, normalized.case_item_ids);
    if (input.sync_progress) {
      syncDesignProgress(user, normalized.project_case_id, normalized.case_item_ids, input.progress);
    }
  });
  tx();
  return { id: recordId };
}

export function deleteDesignWorkRecord(user: CurrentUser, recordId: string) {
  getEditableRecord(user, recordId);
  db.prepare("UPDATE design_work_record SET record_status = 'deleted', updated_at = ? WHERE id = ?").run(nowIso(), recordId);
  return { ok: true };
}

export function listDesignWorkTypes(includeDisabled: boolean) {
  return db.prepare(
    `SELECT id, code, name, sort_order, enabled, created_at, updated_at
     FROM design_work_type
     ${includeDisabled ? '' : 'WHERE enabled = 1'}
     ORDER BY sort_order, created_at, id`
  ).all();
}

export function createDesignWorkType(user: CurrentUser, input: { name: string; sort_order?: number; enabled?: boolean }) {
  assertManager(user);
  const name = input.name.trim();
  if (!name) validationError('请输入工作类型名称');
  const id = makeId('DWT');
  const createdAt = nowIso();
  try {
    db.prepare(
      `INSERT INTO design_work_type (id, code, name, sort_order, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, `custom_${id.toLowerCase()}`, name, input.sort_order ?? 100, input.enabled === false ? 0 : 1, createdAt, createdAt);
  } catch (error) {
    if (String(error).includes('UNIQUE')) validationError('工作类型名称已存在');
    throw error;
  }
  return { id };
}

export function updateDesignWorkType(user: CurrentUser, id: string, input: { name?: string; sort_order?: number; enabled?: boolean }) {
  assertManager(user);
  const existing = db.prepare('SELECT id, name, sort_order, enabled FROM design_work_type WHERE id = ?').get(id) as
    | { id: string; name: string; sort_order: number; enabled: number }
    | undefined;
  if (!existing) notFound('工作类型不存在');
  const name = input.name === undefined ? existing!.name : input.name.trim();
  if (!name) validationError('请输入工作类型名称');
  try {
    db.prepare(
      `UPDATE design_work_type SET name = ?, sort_order = ?, enabled = ?, updated_at = ? WHERE id = ?`
    ).run(name, input.sort_order ?? existing!.sort_order, input.enabled === undefined ? existing!.enabled : input.enabled ? 1 : 0, nowIso(), id);
  } catch (error) {
    if (String(error).includes('UNIQUE')) validationError('工作类型名称已存在');
    throw error;
  }
  return { id };
}

function normalizeWorkRecordInput(user: CurrentUser, input: DesignWorkRecordInput, existing?: StoredRecord) {
  const employeeId = input.employee_id ?? user.id;
  if (!isDesignEmployee(employeeId)) validationError('工作记录人员必须属于设计部');
  const canManageRecords = canManageProjects(user) || leadsDepartment(user.id, '设计');
  if (employeeId !== user.id && !canManageRecords) permissionDenied('只能录入自己的设计工作');
  if (existing && existing.employee_id !== user.id && !canManageRecords && existing.input_by !== user.id) {
    permissionDenied('不能编辑其他人员的工作记录');
  }
  assertDateRange(input.start_date, input.end_date, 366);
  const scope = input.association_scope ?? (input.project_case_id ? (input.case_item_ids?.length ? 'items' : 'project') : 'none');
  const projectId = scope === 'none' ? null : input.project_case_id ?? null;
  if (scope !== 'none' && !projectId) validationError('请选择关联项目');
  const project = projectId ? getProject(projectId) : null;
  const itemIds = project ? resolveProjectItems(project.id, input.case_item_ids, scope) : [];
  let workType: WorkTypeRow | null = null;
  if (input.work_type_id) {
    workType = db.prepare('SELECT id, code, name, enabled FROM design_work_type WHERE id = ?').get(input.work_type_id) as WorkTypeRow | undefined ?? null;
    if (!workType || !workType.enabled) validationError('所选工作类型不可用');
  }
  const isLeave = workType?.code === 'leave';
  if (!isLeave && (input.work_days === null || input.work_days === undefined)) {
    validationError('请输入人天');
  }
  if (!isLeave && (!Number.isFinite(input.work_days) || Number(input.work_days) <= 0 || !isOneDecimal(Number(input.work_days)))) {
    validationError('人天必须大于 0，且最多保留一位小数');
  }
  let workContent = input.work_content?.trim() ?? '';
  if (!workContent && project && workType) {
    const itemNames = scope === 'items' ? getItemNames(itemIds) : [];
    workContent = `${project.name}${itemNames.length ? `-${itemNames.join('、')}` : ''}${workType.name}`;
  }
  if (!workContent) validationError('请输入工作内容');
  if (input.sync_progress) {
    if (!project) validationError('同步设计进度时必须关联项目或子项目');
    if (!Number.isFinite(input.progress) || Number(input.progress) < 0 || Number(input.progress) > 100) validationError('设计进度必须在 0 到 100 之间');
    if (!canManageProjects(user) && project.design_owner_id !== user.id) permissionDenied('只有项目设计负责人可以同步设计进度');
  }
  return {
    employee_id: employeeId,
    project_case_id: projectId,
    work_type_id: workType?.id ?? null,
    association_scope: scope,
    start_date: input.start_date,
    end_date: input.end_date,
    work_days: isLeave ? null : input.work_days!,
    work_content: workContent,
    case_item_ids: itemIds
  };
}

function syncDesignProgress(user: CurrentUser, projectCaseId: string | null, itemIds: string[], progress?: number) {
  if (!projectCaseId || progress === undefined) return;
  const nextProgress = Number(progress);
  const placeholders = itemIds.map(() => '?').join(',');
  const tasks = db.prepare(
    `SELECT id, status, progress FROM case_task
     WHERE project_case_id = ? AND task_type = 'design' AND case_item_id IN (${placeholders})`
  ).all(projectCaseId, ...itemIds) as Array<{ id: string; status: string; progress: number }>;
  if (tasks.length !== itemIds.length) validationError('部分子项目缺少设计进度任务，无法同步');
  const changedAt = nowIso();
  for (const task of tasks) {
    const subtasks = db.prepare(
      'SELECT id, status, progress FROM case_subtask WHERE case_task_id = ? AND is_applicable = 1'
    ).all(task.id) as Array<{ id: string; status: string; progress: number }>;
    const targets = subtasks.length > 0 ? subtasks.map((row) => ({ ...row, target_type: 'subtask' })) : [{ ...task, target_type: 'task' }];
    for (const target of targets) {
      const table = target.target_type === 'task' ? 'case_task' : 'case_subtask';
      const nextStatus = progressStatus(nextProgress);
      db.prepare(`UPDATE ${table} SET progress = ?, status = ? WHERE id = ?`).run(nextProgress, nextStatus, target.id);
      db.prepare(
        `INSERT INTO progress_log
         (id, target_type, target_id, changed_by, before_status, after_status, before_progress, after_progress, source, reason, remark, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'design_work_record', '设计工作记录同步', '', ?)`
      ).run(makeId('PL'), target.target_type, target.id, user.id, target.status, nextStatus, target.progress, nextProgress, changedAt);
    }
    recalculateTask(task.id, changedAt);
  }
}

function getEditableRecord(user: CurrentUser, recordId: string) {
  const record = db.prepare(
    `SELECT id, employee_id, input_by, source
     FROM design_work_record WHERE id = ? AND record_status = 'active'`
  ).get(recordId) as StoredRecord | undefined;
  if (!record) notFound('工作记录不存在');
  const canManageRecords = canManageProjects(user) || leadsDepartment(user.id, '设计');
  if (!canManageRecords && record!.employee_id !== user.id && record!.input_by !== user.id) permissionDenied('不能编辑其他人员的工作记录');
  return record!;
}

function replaceRecordTargets(recordId: string, itemIds: string[]) {
  db.prepare('DELETE FROM design_work_record_target WHERE record_id = ?').run(recordId);
  const insert = db.prepare('INSERT INTO design_work_record_target (record_id, case_item_id) VALUES (?, ?)');
  for (const itemId of itemIds) insert.run(recordId, itemId);
}

function resolveProjectItems(projectId: string, requestedIds: string[] | undefined, scope: string) {
  const allItems = db.prepare('SELECT id FROM case_item WHERE project_case_id = ? AND status != ? ORDER BY source_row, id').all(projectId, 'deleted') as Array<{ id: string }>;
  if (allItems.length === 0) validationError('所选项目没有子项目');
  if (scope === 'project') return allItems.map((row) => row.id);
  if (scope !== 'items') validationError('项目关联范围不正确');
  const uniqueIds = [...new Set(requestedIds ?? [])];
  if (uniqueIds.length === 0) validationError('请选择至少一个子项目');
  const validIds = new Set(allItems.map((row) => row.id));
  if (uniqueIds.some((id) => !validIds.has(id))) validationError('所选子项目不属于当前项目');
  return uniqueIds;
}

function listDesignEmployees() {
  return db.prepare(
    `SELECT DISTINCT e.id, e.name
     FROM employee e
     WHERE COALESCE(e.is_active, 1) = 1
       AND COALESCE(e.locally_disabled, 0) = 0
       AND EXISTS (
         SELECT 1 FROM department d
         LEFT JOIN employee_department ed ON ed.department_id = d.id AND ed.employee_id = e.id AND COALESCE(ed.locally_removed, 0) = 0
         WHERE d.name LIKE '%设计%' AND (e.department_id = d.id OR ed.employee_id = e.id)
       )
     ORDER BY e.name`
  ).all() as Array<{ id: string; name: string }>;
}

function isDesignEmployee(employeeId: string) {
  return Boolean(db.prepare(
    `SELECT 1 FROM employee e
     WHERE e.id = ? AND COALESCE(e.is_active, 1) = 1
       AND EXISTS (
         SELECT 1 FROM department d
         LEFT JOIN employee_department ed ON ed.department_id = d.id AND ed.employee_id = e.id AND COALESCE(ed.locally_removed, 0) = 0
         WHERE d.name LIKE '%设计%' AND (e.department_id = d.id OR ed.employee_id = e.id)
       )`
  ).get(employeeId));
}

function leadsDepartment(employeeId: string, departmentKeyword: string) {
  return Boolean(db.prepare('SELECT 1 FROM department WHERE leader_user_id = ? AND name LIKE ? LIMIT 1').get(employeeId, `%${departmentKeyword}%`));
}

function getProject(projectId: string) {
  const project = db.prepare("SELECT id, name, design_owner_id FROM project_case WHERE id = ? AND status != 'deleted'").get(projectId) as ProjectRow | undefined;
  if (!project) notFound('项目不存在');
  return project!;
}

function getItemNames(itemIds: string[]) {
  if (itemIds.length === 0) return [];
  const placeholders = itemIds.map(() => '?').join(',');
  return (db.prepare(`SELECT name FROM case_item WHERE id IN (${placeholders}) ORDER BY source_row, id`).all(...itemIds) as Array<{ name: string }>).map((row) => row.name);
}

function assertDateRange(startDate: string, endDate: string, maxDays: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) validationError('日期格式不正确');
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) validationError('结束日期不能早于开始日期');
  if ((end - start) / 86_400_000 + 1 > maxDays) validationError(`日期范围不能超过 ${maxDays} 天`);
}

function isOneDecimal(value: number) {
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;
}

function progressStatus(progress: number) {
  return progress >= 100 ? 'completed' : progress > 0 ? 'in_progress' : 'not_started';
}

function assertManager(user: CurrentUser) {
  if (!canManageProjects(user)) permissionDenied('只有管理员可以配置工作类型');
}

function validationError(message: string): never {
  const error = new Error(message);
  error.name = 'VALIDATION_ERROR';
  throw error;
}

function permissionDenied(message: string): never {
  const error = new Error(message);
  error.name = 'PERMISSION_DENIED';
  throw error;
}

function notFound(message: string): never {
  const error = new Error(message);
  error.name = 'NOT_FOUND';
  throw error;
}
