import { db, makeId, nowIso, TargetType } from './db.js';
import { authenticate } from './auth.js';

export type CurrentUser = {
  id: string;
  role: string;
  name: string;
  permission_level: string;
};

export function getCurrentUser(headers: Record<string, unknown>): CurrentUser {
  return authenticate(headers.authorization);
}

export function assertCanReadCase(user: CurrentUser, projectCaseId: string) {
  if (canManageProjects(user)) return;
  const membership = db
    .prepare('SELECT 1 FROM project_case_member WHERE project_case_id = ? AND user_id = ?')
    .get(projectCaseId, user.id);
  if (!membership) {
    const err = new Error('当前用户不能查看该项目');
    err.name = 'PERMISSION_DENIED';
    throw err;
  }
}

export function canManageProjects(user: CurrentUser) {
  return user.role === 'admin' || user.permission_level === 'manager';
}

export function canEditProgress(user: CurrentUser) {
  return canManageProjects(user) || user.permission_level === 'editor';
}

export function assertCanManageProjects(user: CurrentUser) {
  if (canManageProjects(user)) return;
  const err = new Error('当前用户不能管理项目');
  err.name = 'PERMISSION_DENIED';
  throw err;
}

export function canEditTask(user: CurrentUser, taskId: string) {
  if (!canEditProgress(user)) return false;
  if (canManageProjects(user)) return true;
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
  if (!canEditProgress(user)) return false;
  if (canManageProjects(user)) return true;
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

export type ProjectCaseInput = {
  code?: string | null;
  name?: string;
  category?: string | null;
  customer_name?: string | null;
  business_owner_id?: string | null;
  design_owner_id?: string | null;
  estimated_weight?: number | null;
  delivery_date?: string | null;
  delivery_status?: string | null;
  items?: ProjectCaseItemInput[];
  stage_owners?: ProjectCaseStageOwnerInput[];
};

export type ProjectCaseItemInput = {
  id?: string | null;
  name: string;
};

export type ProjectCaseStageOwnerInput = {
  task_type: string;
  assignee_id?: string | null;
  team_id?: string | null;
};

export function createProjectCase(input: ProjectCaseInput, user: CurrentUser) {
  assertCanManageProjects(user);
  const name = input.name?.trim();
  if (!name) {
    const err = new Error('请输入项目名称');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }
  validateEmployee(input.business_owner_id);
  validateEmployee(input.design_owner_id);
  validateStageOwners(input.stage_owners);
  const id = makeId('CASE');
  const maxSeq = db.prepare('SELECT COALESCE(MAX(source_seq), 0) as value FROM project_case').get() as { value: number };
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO project_case
       (id, code, name, category, customer_name, business_owner_id, design_owner_id, estimated_weight, weight_unit, status, total_progress, delivery_date, delivery_status, source_sheet, source_row, source_seq)
       VALUES (@id, @code, @name, @category, @customer_name, @business_owner_id, @design_owner_id, @estimated_weight, 'T', 'in_progress', 0, @delivery_date, @delivery_status, 'manual', null, @source_seq)`
    ).run({
      id,
      code: normalizeText(input.code),
      name,
      category: normalizeText(input.category),
      customer_name: normalizeText(input.customer_name),
      business_owner_id: input.business_owner_id ?? null,
      design_owner_id: input.design_owner_id ?? null,
      estimated_weight: input.estimated_weight ?? null,
      delivery_date: normalizeText(input.delivery_date),
      delivery_status: normalizeText(input.delivery_status),
      source_seq: Number(maxSeq.value ?? 0) + 1
    });
    syncProjectOwnerMembers(id, input.business_owner_id ?? null, input.design_owner_id ?? null);
    ensureProjectTasks(id, stageOwnerInputMap(input.stage_owners), input.design_owner_id ?? null);
    syncCaseItems(id, input.items ?? [], stageOwnerInputMap(input.stage_owners));
    if (input.stage_owners) applyStageOwners(id, input.stage_owners);
    syncTaskOwnerMembers(id);
    recalculateCase(id);
  });
  tx();
  return getProjectCaseManageProfile(id, user);
}

export function updateProjectCase(projectCaseId: string, input: ProjectCaseInput, user: CurrentUser) {
  assertCanManageProjects(user);
  validateEmployee(input.business_owner_id);
  validateEmployee(input.design_owner_id);
  validateStageOwners(input.stage_owners);
  const existing = db.prepare('SELECT * FROM project_case WHERE id = ?').get(projectCaseId) as
    | (ProjectCaseInput & { id: string })
    | undefined;
  if (!existing) {
    const err = new Error('项目不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }
  const nextBusinessOwnerId = input.business_owner_id === undefined ? existing.business_owner_id ?? null : input.business_owner_id ?? null;
  const nextDesignOwnerId = input.design_owner_id === undefined ? existing.design_owner_id ?? null : input.design_owner_id ?? null;
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE project_case
       SET code = @code,
           name = @name,
           category = @category,
           customer_name = @customer_name,
           business_owner_id = @business_owner_id,
           design_owner_id = @design_owner_id,
           estimated_weight = @estimated_weight,
           delivery_date = @delivery_date,
           delivery_status = @delivery_status
       WHERE id = @id`
    ).run({
      id: projectCaseId,
      code: normalizeText(input.code === undefined ? existing.code : input.code),
      name: (input.name ?? existing.name ?? '').trim(),
      category: normalizeText(input.category === undefined ? existing.category : input.category),
      customer_name: normalizeText(input.customer_name === undefined ? existing.customer_name : input.customer_name),
      business_owner_id: nextBusinessOwnerId,
      design_owner_id: nextDesignOwnerId,
      estimated_weight: input.estimated_weight === undefined ? existing.estimated_weight ?? null : input.estimated_weight ?? null,
      delivery_date: normalizeText(input.delivery_date === undefined ? existing.delivery_date : input.delivery_date),
      delivery_status: normalizeText(input.delivery_status === undefined ? existing.delivery_status : input.delivery_status)
    });
    syncProjectOwnerMembers(projectCaseId, nextBusinessOwnerId, nextDesignOwnerId);
    ensureProjectTasks(projectCaseId, stageOwnerInputMap(input.stage_owners), nextDesignOwnerId);
    syncCaseItems(projectCaseId, input.items, input.stage_owners ? stageOwnerInputMap(input.stage_owners) : getCurrentStageOwnerMap(projectCaseId));
    if (input.stage_owners) {
      applyStageOwners(projectCaseId, input.stage_owners);
    } else {
      syncProjectOwnerAssignments(projectCaseId, nextDesignOwnerId);
    }
    syncTaskOwnerMembers(projectCaseId);
    recalculateCase(projectCaseId);
  });
  tx();
  return getProjectCaseManageProfile(projectCaseId, user);
}

export function deleteProjectCase(projectCaseId: string, user: CurrentUser) {
  assertCanManageProjects(user);
  const existing = db.prepare('SELECT id FROM project_case WHERE id = ?').get(projectCaseId);
  if (!existing) {
    const err = new Error('项目不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM exception_comment WHERE exception_id IN (SELECT id FROM exception_record WHERE project_case_id = ?)').run(projectCaseId);
    db.prepare('DELETE FROM exception_record WHERE project_case_id = ?').run(projectCaseId);
    db.prepare('DELETE FROM work_log_entry WHERE project_case_id = ?').run(projectCaseId);
    db.prepare(
      `DELETE FROM progress_log
       WHERE (target_type = 'task' AND target_id IN (SELECT id FROM case_task WHERE project_case_id = ?))
          OR (target_type = 'subtask' AND target_id IN (
            SELECT s.id FROM case_subtask s
            JOIN case_task t ON t.id = s.case_task_id
            WHERE t.project_case_id = ?
          ))`
    ).run(projectCaseId, projectCaseId);
    db.prepare('DELETE FROM case_subtask WHERE case_task_id IN (SELECT id FROM case_task WHERE project_case_id = ?)').run(projectCaseId);
    db.prepare('DELETE FROM case_task WHERE project_case_id = ?').run(projectCaseId);
    db.prepare('DELETE FROM case_item WHERE project_case_id = ?').run(projectCaseId);
    db.prepare('DELETE FROM project_case_member WHERE project_case_id = ?').run(projectCaseId);
    db.prepare('DELETE FROM project_case WHERE id = ?').run(projectCaseId);
  });
  tx();
  return { ok: true };
}

export function getProjectCaseManageProfile(projectCaseId: string, user: CurrentUser) {
  assertCanManageProjects(user);
  const project = db.prepare(
    `SELECT pc.*, b.name as business_owner_name, d.name as design_owner_name
     FROM project_case pc
     LEFT JOIN employee b ON b.id = pc.business_owner_id
     LEFT JOIN employee d ON d.id = pc.design_owner_id
     WHERE pc.id = ?`
  ).get(projectCaseId) as (Record<string, unknown> & { id: string }) | undefined;
  if (!project) {
    const err = new Error('项目不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }
  const items = db
    .prepare('SELECT id, name, progress, status, source_row FROM case_item WHERE project_case_id = ? ORDER BY source_row, id')
    .all(projectCaseId);
  return {
    ...project,
    items,
    stage_owners: getProjectStageOwners(projectCaseId)
  };
}

function getProjectStageOwners(projectCaseId: string) {
  const templates = db
    .prepare(
      `SELECT tt.task_type, tt.name as task_name, tt.generation_scope, tt.sort_order,
              d.name as owner_department_name
       FROM task_template tt
       LEFT JOIN department d ON d.id = tt.default_owner_department_id
       ORDER BY tt.sort_order`
    )
    .all() as Array<{
      task_type: string;
      task_name: string;
      generation_scope: string;
      sort_order: number;
      owner_department_name: string | null;
    }>;
  const ownerRows = db.prepare(
    `SELECT DISTINCT t.assignee_id, e.name as assignee_name, t.team_id, tm.name as team_name
     FROM case_task t
     LEFT JOIN employee e ON e.id = t.assignee_id
     LEFT JOIN team tm ON tm.id = t.team_id
     WHERE t.project_case_id = ?
       AND t.task_type = ?`
  );

  return templates.map((template) => {
    const owners = ownerRows.all(projectCaseId, template.task_type) as Array<{
      assignee_id: string | null;
      assignee_name: string | null;
      team_id: string | null;
      team_name: string | null;
    }>;
    const uniqueOwners = new Map<string, typeof owners[number]>();
    for (const owner of owners) {
      uniqueOwners.set(`${owner.assignee_id ?? ''}:${owner.team_id ?? ''}`, owner);
    }
    const ownerList = Array.from(uniqueOwners.values());
    const mixed = ownerList.length > 1;
    const owner = !mixed && ownerList.length === 1 ? ownerList[0] : undefined;
    return {
      task_type: template.task_type,
      task_name: template.task_name,
      generation_scope: template.generation_scope,
      sort_order: template.sort_order,
      owner_department_name: template.owner_department_name,
      assignee_id: owner?.assignee_id ?? null,
      assignee_name: owner?.assignee_name ?? null,
      team_id: owner?.team_id ?? null,
      team_name: owner?.team_name ?? null,
      mixed
    };
  });
}

function syncProjectOwnerMembers(projectCaseId: string, businessOwnerId: string | null, designOwnerId: string | null) {
  db.prepare("DELETE FROM project_case_member WHERE project_case_id = ? AND role_in_case IN ('business_owner', 'design_owner')").run(projectCaseId);
  if (businessOwnerId) insertProjectMember(projectCaseId, businessOwnerId, 'business_owner');
  if (designOwnerId) insertProjectMember(projectCaseId, designOwnerId, 'design_owner');
}

function syncCaseItems(projectCaseId: string, items: ProjectCaseItemInput[] | undefined, stageOwners: Map<string, StageOwnerValue>) {
  if (!items) return;
  const existingItems = new Set(
    (db.prepare('SELECT id FROM case_item WHERE project_case_id = ?').all(projectCaseId) as Array<{ id: string }>).map((item) => item.id)
  );
  const maxRow = db.prepare('SELECT COALESCE(MAX(source_row), 0) as value FROM case_item WHERE project_case_id = ?').get(projectCaseId) as { value: number };
  let nextRow = Number(maxRow.value ?? 0);

  for (const item of items) {
    const name = item.name.trim();
    if (!name) continue;
    if (item.id) {
      if (!existingItems.has(item.id)) {
        const err = new Error('子项目不存在或不属于当前项目');
        err.name = 'VALIDATION_ERROR';
        throw err;
      }
      db.prepare('UPDATE case_item SET name = ? WHERE id = ?').run(name, item.id);
      ensureItemTasks(projectCaseId, item.id, stageOwners);
      continue;
    }

    const itemId = makeId('ITEM');
    nextRow += 1;
    db.prepare(
      `INSERT INTO case_item
       (id, project_case_id, name, category, quantity, quantity_unit, piece_count, weight, weight_unit, status, progress, delivery_date, delivery_status, source_row)
       VALUES (?, ?, ?, '', null, null, null, null, 'T', 'not_started', 0, null, '', ?)`
    ).run(itemId, projectCaseId, name, nextRow);
    ensureItemTasks(projectCaseId, itemId, stageOwners);
  }
}

type StageOwnerValue = {
  assignee_id: string | null;
  team_id: string | null;
};

function stageOwnerInputMap(stageOwners: ProjectCaseStageOwnerInput[] | undefined) {
  const map = new Map<string, StageOwnerValue>();
  for (const owner of stageOwners ?? []) {
    map.set(owner.task_type, {
      assignee_id: owner.assignee_id ?? null,
      team_id: owner.team_id ?? null
    });
  }
  return map;
}

function getCurrentStageOwnerMap(projectCaseId: string) {
  const map = new Map<string, StageOwnerValue>();
  for (const stage of getProjectStageOwners(projectCaseId)) {
    if (stage.mixed) continue;
    map.set(stage.task_type, {
      assignee_id: stage.assignee_id,
      team_id: stage.team_id
    });
  }
  return map;
}

function ensureProjectTasks(projectCaseId: string, stageOwners: Map<string, StageOwnerValue>, fallbackDesignOwnerId: string | null) {
  const caseTemplates = db
    .prepare("SELECT * FROM task_template WHERE generation_scope = 'case' ORDER BY sort_order")
    .all() as Array<TaskTemplateRow>;
  for (const template of caseTemplates) {
    const fallbackOwner = template.task_type === 'design'
      ? { assignee_id: fallbackDesignOwnerId, team_id: null }
      : { assignee_id: null, team_id: null };
    ensureTaskWithSubtasks(projectCaseId, null, template, stageOwners.get(template.task_type) ?? fallbackOwner);
  }

  const items = db.prepare('SELECT id FROM case_item WHERE project_case_id = ?').all(projectCaseId) as Array<{ id: string }>;
  for (const item of items) ensureItemTasks(projectCaseId, item.id, stageOwners);
}

type TaskTemplateRow = {
  id: string;
  name: string;
  task_type: string;
  default_owner_department_id: string | null;
};

function ensureItemTasks(projectCaseId: string, itemId: string, stageOwners: Map<string, StageOwnerValue>) {
  const itemTemplates = db
    .prepare("SELECT * FROM task_template WHERE generation_scope = 'item' ORDER BY sort_order")
    .all() as Array<TaskTemplateRow>;
  for (const template of itemTemplates) {
    ensureTaskWithSubtasks(projectCaseId, itemId, template, stageOwners.get(template.task_type) ?? { assignee_id: null, team_id: null });
  }
}

function ensureTaskWithSubtasks(projectCaseId: string, itemId: string | null, template: TaskTemplateRow, owner: StageOwnerValue) {
  const existingTask = itemId
    ? db.prepare('SELECT id FROM case_task WHERE project_case_id = ? AND case_item_id = ? AND task_type = ? LIMIT 1').get(projectCaseId, itemId, template.task_type) as { id: string } | undefined
    : db.prepare('SELECT id FROM case_task WHERE project_case_id = ? AND case_item_id IS NULL AND task_type = ? LIMIT 1').get(projectCaseId, template.task_type) as { id: string } | undefined;
  const taskId = existingTask?.id ?? `TASK-${itemId ?? projectCaseId}-${template.task_type}`;
  if (!existingTask) {
    db.prepare(
      `INSERT INTO case_task
       (id, project_case_id, case_item_id, task_template_id, name, task_type, owner_department_id, assignee_id, team_id, status, progress, is_delayed, is_applicable, include_in_progress, source_row, source_column, raw_import_value, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started', 0, 0, 1, 1, null, null, '', '')`
    ).run(
      taskId,
      projectCaseId,
      itemId,
      template.id,
      template.name,
      template.task_type,
      template.default_owner_department_id,
      owner.assignee_id,
      owner.team_id
    );
  }
  ensureSubtasks(taskId, itemId ?? projectCaseId, template.id, owner);
}

function ensureSubtasks(taskId: string, idPrefix: string, taskTemplateId: string, owner: StageOwnerValue) {
  const templates = db
    .prepare('SELECT id, name, sort_order FROM subtask_template WHERE task_template_id = ? ORDER BY sort_order')
    .all(taskTemplateId) as Array<{ id: string; name: string; sort_order: number }>;
  for (const template of templates) {
    const existing = db
      .prepare('SELECT id FROM case_subtask WHERE case_task_id = ? AND subtask_template_id = ? LIMIT 1')
      .get(taskId, template.id);
    if (existing) continue;
    db.prepare(
      `INSERT INTO case_subtask
       (id, case_task_id, subtask_template_id, parent_subtask_id, name, sort_order, assignee_id, team_id, status, progress, is_applicable, include_in_progress, source_column, raw_import_value, remark)
       VALUES (?, ?, ?, null, ?, ?, ?, ?, 'not_started', 0, 1, 1, null, '', '')`
    ).run(`SUB-${idPrefix}-${template.id}`, taskId, template.id, template.name, template.sort_order, owner.assignee_id, owner.team_id);
  }
}

function applyStageOwners(projectCaseId: string, stageOwners: ProjectCaseStageOwnerInput[]) {
  for (const owner of stageOwners) {
    db.prepare(
      `UPDATE case_task
       SET assignee_id = ?, team_id = ?
       WHERE project_case_id = ?
         AND task_type = ?`
    ).run(owner.assignee_id ?? null, owner.team_id ?? null, projectCaseId, owner.task_type);
    db.prepare(
      `UPDATE case_subtask
       SET assignee_id = ?, team_id = ?
       WHERE case_task_id IN (
         SELECT id FROM case_task
         WHERE project_case_id = ?
           AND task_type = ?
       )`
    ).run(owner.assignee_id ?? null, owner.team_id ?? null, projectCaseId, owner.task_type);

    if (owner.task_type === 'design') {
      db.prepare('UPDATE project_case SET design_owner_id = ? WHERE id = ?').run(owner.assignee_id ?? null, projectCaseId);
    }
  }
  syncTaskOwnerMembers(projectCaseId);
}

function syncTaskOwnerMembers(projectCaseId: string) {
  db.prepare("DELETE FROM project_case_member WHERE project_case_id = ? AND source IN ('task', 'stage_owner')").run(projectCaseId);
  const owners = db.prepare(
    `SELECT DISTINCT t.task_type, t.assignee_id, tm.leader_id as team_leader_id
     FROM case_task t
     LEFT JOIN team tm ON tm.id = t.team_id
     WHERE t.project_case_id = ?`
  ).all(projectCaseId) as Array<{ task_type: string; assignee_id: string | null; team_leader_id: string | null }>;
  for (const owner of owners) {
    if (owner.assignee_id) insertProjectMember(projectCaseId, owner.assignee_id, `${owner.task_type}_owner`, 'stage_owner');
    if (owner.team_leader_id) insertProjectMember(projectCaseId, owner.team_leader_id, `${owner.task_type}_team_leader`, 'stage_owner');
  }
}

function syncProjectOwnerAssignments(projectCaseId: string, designOwnerId: string | null) {
  db.prepare(
    `UPDATE case_task
     SET assignee_id = ?
     WHERE project_case_id = ?
       AND case_item_id IS NULL
       AND task_type = 'design'`
  ).run(designOwnerId, projectCaseId);
  db.prepare(
    `UPDATE case_subtask
     SET assignee_id = ?
     WHERE case_task_id IN (
       SELECT id FROM case_task
       WHERE project_case_id = ?
         AND case_item_id IS NULL
         AND task_type = 'design'
     )`
  ).run(designOwnerId, projectCaseId);
}

function insertProjectMember(projectCaseId: string, userId: string, roleInCase: string, source = 'case') {
  const existing = db
    .prepare('SELECT 1 FROM project_case_member WHERE project_case_id = ? AND user_id = ? AND role_in_case = ? AND source = ?')
    .get(projectCaseId, userId, roleInCase, source);
  if (existing) return;
  db.prepare(
    `INSERT INTO project_case_member (id, project_case_id, user_id, role_in_case, source)
     VALUES (?, ?, ?, ?, ?)`
  ).run(makeId('MEM'), projectCaseId, userId, roleInCase, source);
}

function validateEmployee(employeeId: string | null | undefined) {
  if (!employeeId) return;
  const employee = db.prepare('SELECT 1 FROM employee WHERE id = ?').get(employeeId);
  if (!employee) {
    const err = new Error('负责人不存在');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }
}

function validateTeam(teamId: string | null | undefined) {
  if (!teamId) return;
  const team = db.prepare('SELECT 1 FROM team WHERE id = ?').get(teamId);
  if (!team) {
    const err = new Error('班组不存在');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }
}

function validateStageOwners(stageOwners: ProjectCaseStageOwnerInput[] | undefined) {
  if (!stageOwners) return;
  const taskTypes = new Set(
    (db.prepare('SELECT task_type FROM task_template').all() as Array<{ task_type: string }>).map((row) => row.task_type)
  );
  for (const owner of stageOwners) {
    if (!taskTypes.has(owner.task_type)) {
      const err = new Error('阶段不存在');
      err.name = 'VALIDATION_ERROR';
      throw err;
    }
    if (owner.assignee_id && owner.team_id) {
      const err = new Error('同一阶段只能选择一个人员或班组负责人');
      err.name = 'VALIDATION_ERROR';
      throw err;
    }
    validateEmployee(owner.assignee_id);
    validateTeam(owner.team_id);
  }
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
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
         AND (s.subtask_template_id IS NULL OR s.subtask_template_id != 'st-design-confirm')
         AND s.name != '设计深化'
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
  delivery_date: string | null;
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
  delivery_date: string | null;
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
  ownerMerged?: boolean;
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
               ${canManageProjects(user) ? '' : `WHERE EXISTS (
                 SELECT 1 FROM project_case_member m
                 WHERE m.project_case_id = pc.id
                   AND m.user_id = ?
               )`}
               ORDER BY pc.source_seq, pc.id`;
  return (canManageProjects(user)
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
       WHERE st.id != 'st-design-confirm'
         AND tt.task_type != 'delivery'
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
    { key: 'delivery_date', title: '发货时间', group: '发货' },
    { key: 'delivery_status', title: '发货情况', group: '发货' },
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
      ownerName: businessOwnerLabel(project.business_owner_name),
      aggregateCount: children.length
    },
    case_item_name: {
      value: `${children.length} 个子项目`,
      status: project.status
    },
    delivery_date: { value: project.delivery_date ?? '' },
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
      if (hasSingleOwner(childCells)) {
        for (const cell of childCells) {
          cell.ownerMerged = true;
        }
      }
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
    case_name: { value: '', ownerName: businessOwnerLabel(project.business_owner_name) },
    case_item_name: { value: item.name, status: item.status, aggregateCount: Math.round(item.progress) },
    delivery_date: { value: item.delivery_date ?? '' },
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

function businessOwnerLabel(name: string | null | undefined) {
  return name ? `业务部负责人：${name}` : '业务部负责人';
}

function hasSingleOwner(cells: MatrixCell[]) {
  const owners = new Set(cells.map((cell) => cell.ownerName).filter(Boolean));
  return cells.length > 1 && cells.every((cell) => Boolean(cell.ownerName)) && owners.size === 1;
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
    .get(projectCaseId) as {
      id: string;
      name: string;
      delivery_date: string | null;
      delivery_status: string | null;
      business_owner_name: string | null;
      design_owner_name: string | null;
    } | undefined;
  if (!projectCase) {
    const err = new Error('项目不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }
  const items = db.prepare('SELECT * FROM case_item WHERE project_case_id = ? ORDER BY source_row, id').all(projectCaseId) as Array<{
    id: string;
    name: string;
    progress: number;
    delivery_date: string | null;
    delivery_status: string | null;
  }>;
  const subtaskTemplates = db
    .prepare(
      `SELECT tt.task_type, tt.name as task_name, tt.generation_scope,
              st.id as subtask_template_id, st.name as subtask_name, st.sort_order
       FROM task_template tt
       JOIN subtask_template st ON st.task_template_id = tt.id
       WHERE st.id != 'st-design-confirm'
         AND tt.task_type != 'delivery'
       ORDER BY tt.sort_order, st.sort_order`
    )
    .all() as Array<{ task_type: string; task_name: string; generation_scope: string; subtask_template_id: string; subtask_name: string; sort_order: number }>;

  const columns = [
    { key: 'case_name', title: '项目名称', frozen: true },
    { key: 'case_item_name', title: '子项目', frozen: true },
    { key: 'business_owner_name', title: '业务部负责人', frozen: true },
    { key: 'design_owner_name', title: '设计部负责人', frozen: true },
    { key: 'delivery_date', title: '发货时间', group: '发货' },
    { key: 'delivery_status', title: '发货情况', group: '发货' },
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
      delivery_date: { value: item.delivery_date ?? '' },
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
        if (!subtaskTemplates.some((template) => `${template.task_type}.${template.subtask_template_id}` === key)) continue;
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

export type ProductionPlanFilters = {
  department_id?: string;
  month?: string;
  start_date?: string;
  end_date?: string;
  project_case_id?: string;
  team_id?: string;
};

export type CreateProductionPlanItemInput = {
  department_id?: string;
  month?: string;
  case_task_id: string;
  name?: string;
  planned_start_date: string;
  planned_end_date: string;
  assigned_team_id?: string | null;
  progress?: number;
  remark?: string;
};

export type UpdateProductionPlanItemInput = {
  name?: string;
  planned_start_date?: string;
  planned_end_date?: string;
  assigned_team_id?: string | null;
  progress?: number;
  status?: string;
  remark?: string;
};

type ProductionPlanRow = {
  id: string;
  department_id: string;
  department_name: string;
  plan_month: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
  source_sheet: string | null;
};

type ProductionPlanItemRow = {
  id: string;
  production_plan_id: string;
  project_case_id: string | null;
  project_case_name: string | null;
  case_item_id: string | null;
  case_item_name: string | null;
  case_task_id: string | null;
  task_type: string | null;
  task_name: string | null;
  name: string;
  sort_order: number;
  planned_start_date: string;
  planned_end_date: string;
  assigned_team_id: string | null;
  assigned_team_name: string | null;
  progress: number;
  status: string;
  remark: string | null;
};

type ProductionPlanBacklogRow = {
  task_id: string;
  project_case_id: string;
  project_case_name: string;
  case_item_id: string | null;
  case_item_name: string | null;
  task_type: string;
  task_name: string;
  owner_department_id: string;
  owner_department_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  team_id: string | null;
  team_name: string | null;
  progress: number;
  status: string;
  open_exception_count: number;
};

function getSchedulableDepartments() {
  return db
    .prepare(
      `SELECT id, name
       FROM (
         SELECT d.id, d.name, MIN(tt.sort_order) as first_sort_order
         FROM department d
         JOIN task_template tt ON tt.default_owner_department_id = d.id
         WHERE d.id != 'dept-business'
         GROUP BY d.id, d.name
       )
       ORDER BY first_sort_order, name`
    )
    .all() as Array<{ id: string; name: string }>;
}

export function getProductionPlanBoard(user: CurrentUser, filters: ProductionPlanFilters) {
  const monthOptions = db
    .prepare('SELECT DISTINCT plan_month FROM production_plan ORDER BY plan_month DESC')
    .all() as Array<{ plan_month: string }>;
  const departments = getSchedulableDepartments();
  const departmentIds = departments.map((department) => department.id);
  const teams = db.prepare('SELECT id, name, leader_id FROM team ORDER BY name').all();
  const projects = db.prepare('SELECT id, name FROM project_case ORDER BY source_seq, id').all();
  if (departmentIds.length === 0) {
    const months = monthOptions.map((item) => item.plan_month);
    return {
      plan: null,
      dates: [],
      items: [],
      backlog_items: [],
      summary: { item_count: 0, linked_project_count: 0, scheduled_days: 0, completed_count: 0, backlog_count: 0 },
      filters: {
        departments,
        teams,
        projects,
        months
      }
    };
  }
  if (filters.department_id && !departmentIds.includes(filters.department_id)) {
    const err = new Error('该部门不支持生产计划');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }
  if ((filters.start_date && !filters.end_date) || (!filters.start_date && filters.end_date)) {
    const err = new Error('请选择完整的开始和结束日期');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }
  if (filters.start_date && filters.end_date) {
    validateScheduleDates(filters.start_date, filters.end_date);
  }
  const hasDateRange = Boolean(filters.start_date && filters.end_date);

  const planWhere: string[] = [];
  const planParams: unknown[] = [...departmentIds];
  planWhere.push(`pp.department_id IN (${departmentIds.map(() => '?').join(', ')})`);
  if (filters.department_id) {
    planWhere.push('pp.department_id = ?');
    planParams.push(filters.department_id);
  }
  if (hasDateRange) {
    planWhere.push('pp.start_date <= ? AND pp.end_date >= ?');
    planParams.push(filters.end_date, filters.start_date);
  } else if (filters.month) {
    planWhere.push('pp.plan_month = ?');
    planParams.push(filters.month);
  }
  const planWhereSql = planWhere.length ? `WHERE ${planWhere.join(' AND ')}` : '';
  let plan = db
    .prepare(
      `SELECT pp.*, d.name as department_name
       FROM production_plan pp
       JOIN department d ON d.id = pp.department_id
       ${planWhereSql}
       ORDER BY pp.plan_month DESC, d.name
       LIMIT 1`
    )
    .get(...planParams) as ProductionPlanRow | undefined;

  if (!plan && filters.department_id) {
    plan = ensureProductionPlan(filters.department_id, filters.start_date?.slice(0, 7) ?? filters.month ?? monthOptions[0]?.plan_month ?? nowIso().slice(0, 7));
  }

  if (!plan) {
    const months = monthOptions.map((item) => item.plan_month);
    return {
      plan: null,
      dates: [],
      items: [],
      backlog_items: [],
      summary: { item_count: 0, linked_project_count: 0, scheduled_days: 0, completed_count: 0, backlog_count: 0 },
      filters: {
        departments,
        teams,
        projects,
        months
      }
    };
  }

  const rangeStart = filters.start_date ?? plan.start_date;
  const rangeEnd = filters.end_date ?? plan.end_date;
  const itemWhere: string[] = [];
  const itemParams: unknown[] = [];
  if (hasDateRange) {
    itemWhere.push('pp.department_id = ?');
    itemParams.push(plan.department_id);
    itemWhere.push('pp.start_date <= ? AND pp.end_date >= ?');
    itemParams.push(rangeEnd, rangeStart);
  } else {
    itemWhere.push('ppi.production_plan_id = ?');
    itemParams.push(plan.id);
  }
  itemWhere.push('ppi.planned_start_date <= ? AND ppi.planned_end_date >= ?');
  itemParams.push(rangeEnd, rangeStart);
  if (filters.project_case_id) {
    itemWhere.push('ppi.project_case_id = ?');
    itemParams.push(filters.project_case_id);
  }
  if (filters.team_id) {
    itemWhere.push('ppi.assigned_team_id = ?');
    itemParams.push(filters.team_id);
  }
  if (!canManageProjects(user)) {
    const employee = db.prepare('SELECT department_id FROM employee WHERE id = ?').get(user.id) as { department_id: string | null } | undefined;
    itemWhere.push(
      `(ppi.project_case_id IN (
          SELECT project_case_id FROM project_case_member WHERE user_id = ?
        )
        OR ppi.assigned_team_id IN (
          SELECT id FROM team WHERE leader_id = ?
        )
        OR pp.department_id = ?)`
    );
    itemParams.push(user.id, user.id, employee?.department_id ?? '');
  }

  const items = db
    .prepare(
      `SELECT ppi.*, pc.name as project_case_name, ci.name as case_item_name,
              ct.name as task_name, tm.name as assigned_team_name
       FROM production_plan_item ppi
       JOIN production_plan pp ON pp.id = ppi.production_plan_id
       LEFT JOIN project_case pc ON pc.id = ppi.project_case_id
       LEFT JOIN case_item ci ON ci.id = ppi.case_item_id
       LEFT JOIN case_task ct ON ct.id = ppi.case_task_id
       LEFT JOIN team tm ON tm.id = ppi.assigned_team_id
       WHERE ${itemWhere.join(' AND ')}
       ORDER BY pp.plan_month, ppi.sort_order, ppi.id`
    )
    .all(...itemParams) as ProductionPlanItemRow[];

  const backlogItems = getProductionPlanBacklog(user, plan, filters);

  const dates = enumerateDates(rangeStart, rangeEnd);
  const linkedProjects = new Set(items.map((item) => item.project_case_id).filter(Boolean));
  const scheduledDays = items.reduce((sum, item) => sum + daysBetween(item.planned_start_date, item.planned_end_date), 0);
  const months = Array.from(new Set([plan.plan_month, ...monthOptions.map((item) => item.plan_month)]));
  return {
    plan,
    dates,
    items: items.map((item) => ({
      ...item,
      duration_days: daysBetween(item.planned_start_date, item.planned_end_date),
      effective_status: productionPlanStatus(item)
    })),
    backlog_items: backlogItems,
    summary: {
      item_count: items.length,
      linked_project_count: linkedProjects.size,
      scheduled_days: scheduledDays,
      completed_count: items.filter((item) => Number(item.progress ?? 0) >= 100 || item.status === 'completed').length,
      backlog_count: backlogItems.length
    },
    filters: {
      departments,
      teams,
      projects,
      months
    }
  };
}

export function createProductionPlanItem(user: CurrentUser, input: CreateProductionPlanItemInput) {
  const task = getSchedulableTask(input.case_task_id);
  assertCanReadCase(user, task.project_case_id);
  assertCanEditProductionPlanDepartment(user, input.department_id ?? task.owner_department_id);
  validateScheduleDates(input.planned_start_date, input.planned_end_date);

  const month = input.month ?? input.planned_start_date.slice(0, 7);
  const departmentId = input.department_id ?? task.owner_department_id;
  const plan = ensureProductionPlan(departmentId, month);
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) as max_order FROM production_plan_item WHERE production_plan_id = ?')
    .get(plan.id) as { max_order: number };
  const progress = normalizePlanProgress(input.progress ?? task.progress);
  const status = productionPlanStatusFromProgress(progress, 'planned');
  const name = input.name?.trim() || task.task_name;

  db.prepare(
    `INSERT INTO production_plan_item
     (id, production_plan_id, project_case_id, case_item_id, case_task_id, task_type, name, sort_order,
      planned_start_date, planned_end_date, assigned_team_id, progress, status, remark, source_row)
     VALUES (@id, @production_plan_id, @project_case_id, @case_item_id, @case_task_id, @task_type, @name, @sort_order,
      @planned_start_date, @planned_end_date, @assigned_team_id, @progress, @status, @remark, null)`
  ).run({
    id: makeId('PPI'),
    production_plan_id: plan.id,
    project_case_id: task.project_case_id,
    case_item_id: task.case_item_id,
    case_task_id: task.task_id,
    task_type: task.task_type,
    name,
    sort_order: maxOrder.max_order + 1,
    planned_start_date: input.planned_start_date,
    planned_end_date: input.planned_end_date,
    assigned_team_id: input.assigned_team_id ?? task.team_id ?? null,
    progress,
    status,
    remark: input.remark ?? ''
  });

  return { ok: true };
}

export function updateProductionPlanItem(user: CurrentUser, itemId: string, input: UpdateProductionPlanItemInput) {
  const current = getProductionPlanItemForEdit(itemId);
  assertCanReadCase(user, current.project_case_id);
  assertCanEditProductionPlanDepartment(user, current.department_id);
  const nextStart = input.planned_start_date ?? current.planned_start_date;
  const nextEnd = input.planned_end_date ?? current.planned_end_date;
  validateScheduleDates(nextStart, nextEnd);
  const nextProgress = input.progress === undefined ? current.progress : normalizePlanProgress(input.progress);
  const nextStatus = input.status ?? productionPlanStatusFromProgress(nextProgress, current.status);

  db.prepare(
    `UPDATE production_plan_item
     SET name = @name,
         planned_start_date = @planned_start_date,
         planned_end_date = @planned_end_date,
         assigned_team_id = @assigned_team_id,
         progress = @progress,
         status = @status,
         remark = @remark
     WHERE id = @id`
  ).run({
    id: itemId,
    name: input.name?.trim() || current.name,
    planned_start_date: nextStart,
    planned_end_date: nextEnd,
    assigned_team_id: input.assigned_team_id === undefined ? current.assigned_team_id : input.assigned_team_id,
    progress: nextProgress,
    status: nextStatus,
    remark: input.remark === undefined ? current.remark ?? '' : input.remark
  });

  return { ok: true };
}

export function deleteProductionPlanItem(user: CurrentUser, itemId: string) {
  const current = getProductionPlanItemForEdit(itemId);
  assertCanReadCase(user, current.project_case_id);
  assertCanEditProductionPlanDepartment(user, current.department_id);
  db.prepare('DELETE FROM production_plan_item WHERE id = ?').run(itemId);
  return { ok: true };
}

function getProductionPlanBacklog(user: CurrentUser, plan: ProductionPlanRow, filters: ProductionPlanFilters) {
  const hasDateRange = Boolean(filters.start_date && filters.end_date);
  const where = [
    't.owner_department_id = ?',
    "t.status != 'completed'"
  ];
  const params: unknown[] = [plan.department_id];
  if (hasDateRange) {
    where.push(
      `NOT EXISTS (
         SELECT 1 FROM production_plan_item ppi
         JOIN production_plan scheduled_plan ON scheduled_plan.id = ppi.production_plan_id
         WHERE scheduled_plan.department_id = ?
           AND scheduled_plan.start_date <= ?
           AND scheduled_plan.end_date >= ?
           AND ppi.case_task_id = t.id
       )`
    );
    params.push(plan.department_id, filters.end_date, filters.start_date);
  } else {
    where.push(
      `NOT EXISTS (
         SELECT 1 FROM production_plan_item ppi
         WHERE ppi.production_plan_id = ?
           AND ppi.case_task_id = t.id
       )`
    );
    params.push(plan.id);
  }
  if (filters.project_case_id) {
    where.push('t.project_case_id = ?');
    params.push(filters.project_case_id);
  }
  if (filters.team_id) {
    where.push('t.team_id = ?');
    params.push(filters.team_id);
  }
  if (!canManageProjects(user)) {
    const employee = db.prepare('SELECT department_id FROM employee WHERE id = ?').get(user.id) as { department_id: string | null } | undefined;
    where.push(
      `(t.project_case_id IN (
          SELECT project_case_id FROM project_case_member WHERE user_id = ?
        )
        OR t.assignee_id = ?
        OR t.team_id IN (SELECT id FROM team WHERE leader_id = ?)
        OR t.owner_department_id = ?)`
    );
    params.push(user.id, user.id, user.id, employee?.department_id ?? '');
  }

  return db
    .prepare(
      `SELECT t.id as task_id, t.project_case_id, pc.name as project_case_name,
              t.case_item_id, ci.name as case_item_name, t.task_type, t.name as task_name,
              t.owner_department_id, d.name as owner_department_name,
              t.assignee_id, emp.name as assignee_name, t.team_id, tm.name as team_name,
              t.progress, t.status,
              (SELECT COUNT(*) FROM exception_record ex
               WHERE ex.case_task_id = t.id AND ex.status NOT IN ('resolved', 'closed', 'cancelled')) as open_exception_count
       FROM case_task t
       JOIN project_case pc ON pc.id = t.project_case_id
       LEFT JOIN case_item ci ON ci.id = t.case_item_id
       LEFT JOIN department d ON d.id = t.owner_department_id
       LEFT JOIN employee emp ON emp.id = t.assignee_id
       LEFT JOIN team tm ON tm.id = t.team_id
       WHERE ${where.join(' AND ')}
       ORDER BY pc.source_seq, ci.source_row, t.owner_department_id, t.task_type
       LIMIT 120`
    )
    .all(...params) as ProductionPlanBacklogRow[];
}

function enumerateDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (current.getTime() <= end.getTime()) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

function productionPlanStatus(item: ProductionPlanItemRow) {
  if (Number(item.progress ?? 0) >= 100 || item.status === 'completed') return 'completed';
  return item.status || 'planned';
}

function getSchedulableTask(taskId: string) {
  const task = db
    .prepare(
      `SELECT t.id as task_id, t.project_case_id, pc.name as project_case_name,
              t.case_item_id, ci.name as case_item_name, t.task_type, t.name as task_name,
              t.owner_department_id, t.team_id, t.progress, t.status
       FROM case_task t
       JOIN project_case pc ON pc.id = t.project_case_id
       LEFT JOIN case_item ci ON ci.id = t.case_item_id
       WHERE t.id = ?`
    )
    .get(taskId) as
    | {
        task_id: string;
        project_case_id: string;
        project_case_name: string;
        case_item_id: string | null;
        case_item_name: string | null;
        task_type: string;
        task_name: string;
        owner_department_id: string;
        team_id: string | null;
        progress: number;
        status: string;
      }
    | undefined;
  if (!task) {
    const err = new Error('待排期任务不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }
  return task;
}

function getProductionPlanItemForEdit(itemId: string) {
  const item = db
    .prepare(
      `SELECT ppi.*, pp.department_id
       FROM production_plan_item ppi
       JOIN production_plan pp ON pp.id = ppi.production_plan_id
       WHERE ppi.id = ?`
    )
    .get(itemId) as
    | {
        id: string;
        department_id: string;
        project_case_id: string;
        case_item_id: string | null;
        case_task_id: string | null;
        name: string;
        planned_start_date: string;
        planned_end_date: string;
        assigned_team_id: string | null;
        progress: number;
        status: string;
        remark: string | null;
      }
    | undefined;
  if (!item) {
    const err = new Error('排期活动不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }
  return item;
}

function ensureProductionPlan(departmentId: string, month: string) {
  const existing = db
    .prepare(
      `SELECT pp.*, d.name as department_name
       FROM production_plan pp
       JOIN department d ON d.id = pp.department_id
       WHERE pp.department_id = ? AND pp.plan_month = ?
       LIMIT 1`
    )
    .get(departmentId, month) as ProductionPlanRow | undefined;
  if (existing) return existing;

  const department = db.prepare('SELECT id, name FROM department WHERE id = ?').get(departmentId) as { id: string; name: string } | undefined;
  if (!department) {
    const err = new Error('部门不存在');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    const err = new Error('月份格式应为 YYYY-MM');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }
  const startDate = `${month}-01`;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(start.getTime());
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  const endDate = end.toISOString().slice(0, 10);
  const id = `PP-${month.replace('-', '')}-${departmentId.replace(/^dept-/, '')}`;

  db.prepare(
    `INSERT INTO production_plan
     (id, department_id, plan_month, name, status, start_date, end_date, source_sheet, created_at)
     VALUES (@id, @department_id, @plan_month, @name, 'published', @start_date, @end_date, null, @created_at)
     ON CONFLICT(id) DO NOTHING`
  ).run({
    id,
    department_id: departmentId,
    plan_month: month,
    name: `${department.name} ${month} 排产`,
    start_date: startDate,
    end_date: endDate,
    created_at: nowIso()
  });

  return db
    .prepare(
      `SELECT pp.*, d.name as department_name
       FROM production_plan pp
       JOIN department d ON d.id = pp.department_id
       WHERE pp.id = ?`
    )
    .get(id) as ProductionPlanRow;
}

function assertCanEditProductionPlanDepartment(user: CurrentUser, departmentId: string) {
  if (canManageProjects(user)) return;
  if (user.permission_level !== 'editor') {
    const err = new Error('当前用户不能编辑生产排期');
    err.name = 'PERMISSION_DENIED';
    throw err;
  }
  const employee = db.prepare('SELECT department_id FROM employee WHERE id = ?').get(user.id) as { department_id: string | null } | undefined;
  if (employee?.department_id === departmentId) return;
  const err = new Error('当前用户不能编辑其他部门的生产排期');
  err.name = 'PERMISSION_DENIED';
  throw err;
}

function validateScheduleDates(startDate: string, endDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    const err = new Error('排期日期格式应为 YYYY-MM-DD');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }
  if (endDate < startDate) {
    const err = new Error('结束日期不能早于开始日期');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }
}

function normalizePlanProgress(progress: number) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    const err = new Error('完成度必须在 0 到 100 之间');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }
  return Math.round(progress);
}

function productionPlanStatusFromProgress(progress: number, fallback: string) {
  if (progress >= 100) return 'completed';
  if (progress > 0) return 'in_progress';
  return fallback === 'completed' ? 'planned' : fallback;
}
