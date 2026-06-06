import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { db, makeId, nowIso } from './db.js';

type ImportIssue = {
  source_sheet: string;
  source_row: number;
  source_column: string;
  field_name: string;
  raw_value: string;
  issue_type: string;
  suggestion: string;
};

type ParsedProgress = {
  value: number | null;
  raw: string;
};

type ParsedSubtask = {
  templateId: string;
  name: string;
  sourceColumn: string;
  progress: number | null;
  raw: string;
};

type ParsedItemTask = {
  templateId: string;
  taskType: string;
  name: string;
  ownerDepartmentId: string;
  assigneeName?: string;
  teamName?: string;
  subtasks: ParsedSubtask[];
};

type ParsedItem = {
  sourceRow: number;
  name: string;
  quantity: number | null;
  quantityUnit: string | null;
  pieceCount: number | null;
  progress: number;
  deliveryDate: string;
  deliveryStatus: string;
  tasks: ParsedItemTask[];
};

type ParsedProject = {
  sourceSeq: number;
  sourceRow: number;
  name: string;
  estimatedWeight: number | null;
  businessOwnerName: string;
  designOwnerName: string;
  drawingReviewProgress: number | null;
  deliveryDate: string;
  deliveryStatus: string;
  totalProgress: number;
  items: ParsedItem[];
};

type ImportPayload = {
  fileName: string;
  sourceSheet: string;
  projects: ParsedProject[];
  previewRows: Array<{
    source_row: number;
    project_name: string;
    item_name: string;
    item_progress: number;
    delivery_date: string;
    delivery_status: string;
  }>;
};

type ImportTaskRecord = {
  id: string;
  file_name: string;
  status: string;
  source_sheet: string;
  total_rows: number;
  parsed_cases: number;
  parsed_items: number;
  issue_count: number;
  payload_json: string;
  issues_json: string;
  created_by: string;
  created_at: string;
  confirmed_at: string | null;
};

const MAIN_SHEET_NAME = '总表';

const progressColumns = {
  platePurchase: { col: 9, letter: 'I', field: '板材请购' },
  plateIn: { col: 10, letter: 'J', field: '板材入库' },
  profilePurchase: { col: 11, letter: 'K', field: '型材请购' },
  profileIn: { col: 12, letter: 'L', field: '型材入库' },
  partsIn: { col: 13, letter: 'M', field: '零配件入库' },
  plateCut: { col: 15, letter: 'O', field: '板材套料切割' },
  plateMachine: { col: 16, letter: 'P', field: '板材机加工' },
  profileCut: { col: 17, letter: 'Q', field: '型材套料切割' },
  profileMachine: { col: 18, letter: 'R', field: '型材机加工' },
  assembly: { col: 21, letter: 'U', field: '单片体拼装' },
  welding: { col: 22, letter: 'V', field: '单片体焊接' },
  cleaning: { col: 23, letter: 'W', field: '单片体清磨' },
  preassembly: { col: 24, letter: 'X', field: '预拼装、校正' },
  painting: { col: 25, letter: 'Y', field: '喷涂' },
  selfCheck: { col: 27, letter: 'AA', field: '自检' },
  mutualCheck: { col: 28, letter: 'AB', field: '互检' },
  specialCheck: { col: 29, letter: 'AC', field: '专检' }
};

export async function createExcelImport(buffer: Buffer, fileName: string, userId: string) {
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  const worksheet = workbook.getWorksheet(MAIN_SHEET_NAME) ?? workbook.worksheets[0];
  if (!worksheet) {
    const err = new Error('Excel 中没有可解析的工作表');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }

  const issues: ImportIssue[] = [];
  const payload = parseMainSheet(worksheet, fileName, issues);
  const id = makeId('IMPORT');
  db.prepare(
    `INSERT INTO import_task
     (id, file_name, status, source_sheet, total_rows, parsed_cases, parsed_items, issue_count, payload_json, issues_json, created_by, created_at, confirmed_at)
     VALUES (@id, @file_name, @status, @source_sheet, @total_rows, @parsed_cases, @parsed_items, @issue_count, @payload_json, @issues_json, @created_by, @created_at, null)`
  ).run({
    id,
    file_name: fileName,
    status: 'preview_ready',
    source_sheet: payload.sourceSheet,
    total_rows: payload.previewRows.length,
    parsed_cases: payload.projects.length,
    parsed_items: payload.previewRows.length,
    issue_count: issues.length,
    payload_json: JSON.stringify(payload),
    issues_json: JSON.stringify(issues),
    created_by: userId,
    created_at: nowIso()
  });

  return getImportPreview(id);
}

export function getImportPreview(importId: string) {
  const record = getImportRecord(importId);
  const payload = JSON.parse(record.payload_json) as ImportPayload;
  const issues = JSON.parse(record.issues_json) as ImportIssue[];
  return {
    id: record.id,
    file_name: record.file_name,
    status: record.status,
    source_sheet: record.source_sheet,
    total_rows: record.total_rows,
    parsed_cases: record.parsed_cases,
    parsed_items: record.parsed_items,
    issue_count: record.issue_count,
    preview_rows: payload.previewRows,
    issues
  };
}

export function confirmExcelImport(importId: string, userId: string) {
  const record = getImportRecord(importId);
  if (record.status === 'confirmed') {
    return {
      ok: true,
      imported_cases: record.parsed_cases,
      imported_items: record.parsed_items
    };
  }
  const payload = JSON.parse(record.payload_json) as ImportPayload;

  const tx = db.transaction(() => {
    for (const project of payload.projects) {
      importProject(project, payload.sourceSheet);
    }
    db.prepare('UPDATE import_task SET status = ?, confirmed_at = ? WHERE id = ?').run('confirmed', nowIso(), importId);
  });
  tx();

  return {
    ok: true,
    confirmed_by: userId,
    imported_cases: payload.projects.length,
    imported_items: payload.previewRows.length
  };
}

function getImportRecord(importId: string) {
  const record = db.prepare('SELECT * FROM import_task WHERE id = ?').get(importId) as ImportTaskRecord | undefined;
  if (!record) {
    const err = new Error('导入任务不存在');
    err.name = 'NOT_FOUND';
    throw err;
  }
  return record;
}

function parseMainSheet(worksheet: ExcelJS.Worksheet, fileName: string, issues: ImportIssue[]): ImportPayload {
  const projects = new Map<string, ParsedProject>();
  const previewRows: ImportPayload['previewRows'] = [];

  for (let rowNumber = 7; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const sourceSeq = numberValue(row.getCell(1).value);
    const projectName = cellText(row.getCell(2).value).trim();
    const itemName = cellText(row.getCell(7).value).trim();
    if (!sourceSeq || !projectName || !itemName) continue;

    const projectKey = `${sourceSeq}:${projectName}`;
    let project = projects.get(projectKey);
    if (!project) {
      project = {
        sourceSeq,
        sourceRow: rowNumber,
        name: projectName,
        estimatedWeight: numberValue(row.getCell(3).value),
        businessOwnerName: cellText(row.getCell(4).value).trim(),
        designOwnerName: cellText(row.getCell(5).value).trim(),
        drawingReviewProgress: parseProgress(row.getCell(6).value, rowNumber, 'F', '图纸定审', worksheet.name, issues).value,
        deliveryDate: normalizeDate(row.getCell(30).value),
        deliveryStatus: cellText(row.getCell(31).value).trim(),
        totalProgress: 0,
        items: []
      };
      projects.set(projectKey, project);
    }

    const item = parseItem(row, rowNumber, worksheet.name, issues);
    project.items.push(item);
    previewRows.push({
      source_row: rowNumber,
      project_name: projectName,
      item_name: item.name,
      item_progress: item.progress,
      delivery_date: item.deliveryDate,
      delivery_status: item.deliveryStatus
    });
  }

  for (const project of projects.values()) {
    const designProgress = average([project.designOwnerName ? 100 : 0, project.drawingReviewProgress ?? 0]);
    project.totalProgress = average(
      project.items.map((item) => average([designProgress, ...item.tasks.map(taskProgress)]))
    );
  }

  return {
    fileName,
    sourceSheet: worksheet.name,
    projects: Array.from(projects.values()),
    previewRows
  };
}

function parseItem(row: ExcelJS.Row, rowNumber: number, sheetName: string, issues: ImportIssue[]): ParsedItem {
  const itemName = cellText(row.getCell(7).value).trim();
  const quantity = parseQuantity(itemName);

  const materialTask = task('tt-material', 'material', '材料入库', 'dept-material', cellText(row.getCell(8).value), undefined, [
    subtask('st-plate-purchase', '板材请购', progressColumns.platePurchase),
    subtask('st-plate-in', '板材入库', progressColumns.plateIn),
    subtask('st-profile-purchase', '型材请购', progressColumns.profilePurchase),
    subtask('st-profile-in', '型材入库', progressColumns.profileIn),
    subtask('st-parts-in', '零配件入库', progressColumns.partsIn)
  ]);
  const cuttingTask = task('tt-cutting', 'cutting', '下料加工', 'dept-production', cellText(row.getCell(14).value), undefined, [
    subtask('st-plate-cut', '板材套料切割', progressColumns.plateCut),
    subtask('st-plate-machine', '板材机加工', progressColumns.plateMachine),
    subtask('st-profile-cut', '型材套料切割', progressColumns.profileCut),
    subtask('st-profile-machine', '型材机加工', progressColumns.profileMachine)
  ]);
  const productionTeamName = cellText(row.getCell(20).value);
  const productionTask = task('tt-production', 'production', '装焊', 'dept-production', '', productionTeamName, [
    subtask('st-assembly', '单片体拼装', progressColumns.assembly),
    subtask('st-welding', '单片体焊接', progressColumns.welding),
    subtask('st-cleaning', '单片体清磨', progressColumns.cleaning),
    subtask('st-preassembly', '预拼装、校正', progressColumns.preassembly)
  ]);
  const paintingTask = task('tt-painting', 'painting', '喷涂', 'dept-production', '', productionTeamName, [
    subtask('st-painting', '喷涂作业', progressColumns.painting)
  ]);
  const inspectionTask = task('tt-inspection', 'inspection', '验收', 'dept-quality', cellText(row.getCell(26).value), undefined, [
    subtask('st-self-check', '自检', progressColumns.selfCheck),
    subtask('st-mutual-check', '互检', progressColumns.mutualCheck),
    subtask('st-special-check', '专检', progressColumns.specialCheck)
  ]);

  const deliveryDate = normalizeDate(row.getCell(30).value);
  const deliveryStatus = cellText(row.getCell(31).value).trim();
  const deliveryTask = task('tt-delivery', 'delivery', '发货', 'dept-delivery', '', undefined, [
    manualSubtask('st-delivery-plan', '发货计划', 'AD', deliveryDate ? 100 : 0, deliveryDate),
    manualSubtask('st-delivery-execute', '发货执行', 'AE', deliveryExecutionProgress(deliveryStatus), deliveryStatus)
  ]);
  const tasks = [materialTask, cuttingTask, productionTask, paintingTask, inspectionTask, deliveryTask];
  const progress = average(tasks.map(taskProgress));

  return {
    sourceRow: rowNumber,
    name: itemName,
    quantity: quantity.value,
    quantityUnit: quantity.unit,
    pieceCount: quantity.unit === '件' ? quantity.value : null,
    progress,
    deliveryDate,
    deliveryStatus,
    tasks
  };

  function subtask(templateId: string, name: string, column: { col: number; letter: string; field: string }): ParsedSubtask {
    const parsed = parseProgress(row.getCell(column.col).value, rowNumber, column.letter, column.field, sheetName, issues);
    return {
      templateId,
      name,
      sourceColumn: column.letter,
      progress: parsed.value,
      raw: parsed.raw
    };
  }

  function manualSubtask(templateId: string, name: string, sourceColumn: string, progress: number, raw: string): ParsedSubtask {
    return { templateId, name, sourceColumn, progress, raw };
  }
}

function task(templateId: string, taskType: string, name: string, ownerDepartmentId: string, assigneeName: string, teamName: string | undefined, subtasks: ParsedSubtask[]): ParsedItemTask {
  return {
    templateId,
    taskType,
    name,
    ownerDepartmentId,
    assigneeName: assigneeName.trim() || undefined,
    teamName: teamName?.trim() || undefined,
    subtasks
  };
}

function importProject(project: ParsedProject, sourceSheet: string) {
  const existingProject = db
    .prepare('SELECT id FROM project_case WHERE source_sheet = ? AND source_row = ?')
    .get(sourceSheet, project.sourceRow) as { id: string } | undefined;
  const projectId = existingProject?.id ?? `CASE-IMPORT-${project.sourceRow}`;
  const businessOwnerId = ensureEmployee(project.businessOwnerName, 'dept-business', 'business_owner');
  const designOwnerId = ensureEmployee(project.designOwnerName, 'dept-design', 'design_owner');
  const status = project.totalProgress >= 100 ? 'completed' : project.totalProgress > 0 ? 'in_progress' : 'not_started';

  db.prepare(
    `INSERT INTO project_case
     (id, code, name, category, customer_name, business_owner_id, design_owner_id, estimated_weight, weight_unit, status, total_progress, delivery_date, delivery_status, source_sheet, source_row, source_seq)
     VALUES (@id, @code, @name, '', '', @business_owner_id, @design_owner_id, @estimated_weight, 'T', @status, @total_progress, @delivery_date, @delivery_status, @source_sheet, @source_row, @source_seq)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       business_owner_id = excluded.business_owner_id,
       design_owner_id = excluded.design_owner_id,
       estimated_weight = excluded.estimated_weight,
       status = excluded.status,
       total_progress = excluded.total_progress,
       delivery_date = excluded.delivery_date,
       delivery_status = excluded.delivery_status,
       source_sheet = excluded.source_sheet,
       source_row = excluded.source_row,
       source_seq = excluded.source_seq`
  ).run({
    id: projectId,
    code: `P-${String(project.sourceSeq).padStart(3, '0')}`,
    name: project.name,
    business_owner_id: businessOwnerId,
    design_owner_id: designOwnerId,
    estimated_weight: project.estimatedWeight,
    status,
    total_progress: project.totalProgress,
    delivery_date: project.deliveryDate,
    delivery_status: project.deliveryStatus,
    source_sheet: sourceSheet,
    source_row: project.sourceRow,
    source_seq: project.sourceSeq
  });

  ensureCaseMember(projectId, businessOwnerId, 'business_owner', 'import');
  ensureCaseMember(projectId, designOwnerId, 'design_owner', 'import');
  const designConfirmProgress = designOwnerId ? 100 : 0;
  const drawingReviewProgress = project.drawingReviewProgress ?? 0;
  const designTaskId = upsertCaseTask(
    projectId,
    null,
    'tt-design',
    '设计',
    'design',
    'dept-design',
    designOwnerId,
    null,
    average([designConfirmProgress, drawingReviewProgress]),
    project.sourceRow,
    null,
    ''
  );
  upsertCaseSubtask({
    id: `SUB-${projectId}-st-design-confirm`,
    taskId: designTaskId,
    templateId: 'st-design-confirm',
    name: '设计深化',
    sortOrder: 10,
    assigneeId: designOwnerId,
    teamId: null,
    progress: designConfirmProgress,
    plannedQuantity: null,
    quantityUnit: null,
    sourceColumn: 'E',
    rawValue: project.designOwnerName
  });
  upsertCaseSubtask({
    id: `SUB-${projectId}-st-drawing-review`,
    taskId: designTaskId,
    templateId: 'st-drawing-review',
    name: '图纸定审',
    sortOrder: 20,
    assigneeId: designOwnerId,
    teamId: null,
    progress: drawingReviewProgress,
    plannedQuantity: null,
    quantityUnit: null,
    sourceColumn: 'F',
    rawValue: String(project.drawingReviewProgress ?? '')
  });

  for (const item of project.items) {
    importItem(projectId, item);
  }
}

function importItem(projectId: string, item: ParsedItem) {
  const existingItem = db
    .prepare('SELECT id FROM case_item WHERE project_case_id = ? AND source_row = ?')
    .get(projectId, item.sourceRow) as { id: string } | undefined;
  const itemId = existingItem?.id ?? `ITEM-IMPORT-${item.sourceRow}`;
  const itemStatus = item.progress >= 100 ? 'completed' : item.progress > 0 ? 'in_progress' : 'not_started';

  db.prepare(
    `INSERT INTO case_item
     (id, project_case_id, name, category, quantity, quantity_unit, piece_count, weight, weight_unit, status, progress, delivery_date, delivery_status, source_row)
     VALUES (@id, @project_case_id, @name, '', @quantity, @quantity_unit, @piece_count, null, 'T', @status, @progress, @delivery_date, @delivery_status, @source_row)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       quantity = excluded.quantity,
       quantity_unit = excluded.quantity_unit,
       piece_count = excluded.piece_count,
       status = excluded.status,
       progress = excluded.progress,
       delivery_date = excluded.delivery_date,
       delivery_status = excluded.delivery_status,
       source_row = excluded.source_row`
  ).run({
    id: itemId,
    project_case_id: projectId,
    name: item.name,
    quantity: item.quantity,
    quantity_unit: item.quantityUnit,
    piece_count: item.pieceCount,
    status: itemStatus,
    progress: item.progress,
    delivery_date: item.deliveryDate,
    delivery_status: item.deliveryStatus,
    source_row: item.sourceRow
  });

  for (const itemTask of item.tasks) {
    const assigneeId = ensureEmployee(itemTask.assigneeName ?? '', itemTask.ownerDepartmentId, assigneeRole(itemTask.taskType));
    const teamId = ensureTeam(itemTask.teamName ?? '');
    const progress = taskProgress(itemTask);
    const taskId = upsertCaseTask(projectId, itemId, itemTask.templateId, itemTask.name, itemTask.taskType, itemTask.ownerDepartmentId, assigneeId, teamId, progress, item.sourceRow, null, '');
    for (const itemSubtask of itemTask.subtasks) {
      const subtaskProgress = itemSubtask.progress ?? 0;
      upsertCaseSubtask({
        id: `SUB-${itemId}-${itemSubtask.templateId}`,
        taskId,
        templateId: itemSubtask.templateId,
        name: itemSubtask.name,
        sortOrder: subtaskSortOrder(itemSubtask.templateId),
        assigneeId,
        teamId,
        progress: subtaskProgress,
        plannedQuantity: item.quantity,
        quantityUnit: item.quantityUnit,
        sourceColumn: itemSubtask.sourceColumn,
        rawValue: itemSubtask.raw
      });
    }
  }
}

function upsertCaseSubtask(input: {
  id: string;
  taskId: string;
  templateId: string;
  name: string;
  sortOrder: number;
  assigneeId: string | null;
  teamId: string | null;
  progress: number;
  plannedQuantity: number | null;
  quantityUnit: string | null;
  sourceColumn: string;
  rawValue: string;
}) {
  db.prepare(
    `INSERT INTO case_subtask
     (id, case_task_id, subtask_template_id, parent_subtask_id, name, sort_order, assignee_id, team_id, status, progress, planned_quantity, completed_quantity, quantity_unit, recorded_weight, recorded_piece_count, is_applicable, include_in_progress, source_column, raw_import_value, remark)
     VALUES (@id, @case_task_id, @subtask_template_id, null, @name, @sort_order, @assignee_id, @team_id, @status, @progress, @planned_quantity, null, @quantity_unit, null, null, 1, 1, @source_column, @raw_import_value, '')
     ON CONFLICT(id) DO UPDATE SET
       case_task_id = excluded.case_task_id,
       subtask_template_id = excluded.subtask_template_id,
       name = excluded.name,
       sort_order = excluded.sort_order,
       assignee_id = excluded.assignee_id,
       team_id = excluded.team_id,
       status = excluded.status,
       progress = excluded.progress,
       planned_quantity = excluded.planned_quantity,
       quantity_unit = excluded.quantity_unit,
       source_column = excluded.source_column,
       raw_import_value = excluded.raw_import_value`
  ).run({
    id: input.id,
    case_task_id: input.taskId,
    subtask_template_id: input.templateId,
    name: input.name,
    sort_order: input.sortOrder,
    assignee_id: input.assigneeId,
    team_id: input.teamId,
    status: input.progress >= 100 ? 'completed' : input.progress > 0 ? 'in_progress' : 'not_started',
    progress: input.progress,
    planned_quantity: input.plannedQuantity,
    quantity_unit: input.quantityUnit,
    source_column: input.sourceColumn,
    raw_import_value: input.rawValue
  });
}

function upsertCaseTask(projectId: string, itemId: string | null, templateId: string, name: string, taskType: string, ownerDepartmentId: string, assigneeId: string | null, teamId: string | null, progress: number, sourceRow: number | null, sourceColumn: string | null, rawValue: string) {
  const existingCaseTask = itemId
    ? undefined
    : (db
        .prepare('SELECT id FROM case_task WHERE project_case_id = ? AND case_item_id IS NULL AND task_type = ?')
        .get(projectId, taskType) as { id: string } | undefined);
  const taskId = itemId ? `TASK-${itemId}-${taskType}` : existingCaseTask?.id ?? `TASK-${projectId}-${taskType}`;
  const status = progress >= 100 ? 'completed' : progress > 0 ? 'in_progress' : 'not_started';
  db.prepare(
    `INSERT INTO case_task
     (id, project_case_id, case_item_id, task_template_id, name, task_type, owner_department_id, assignee_id, team_id, status, progress, is_delayed, is_applicable, include_in_progress, source_row, source_column, raw_import_value, remark)
     VALUES (@id, @project_case_id, @case_item_id, @task_template_id, @name, @task_type, @owner_department_id, @assignee_id, @team_id, @status, @progress, 0, 1, 1, @source_row, @source_column, @raw_import_value, '')
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       owner_department_id = excluded.owner_department_id,
       assignee_id = excluded.assignee_id,
       team_id = excluded.team_id,
       status = excluded.status,
       progress = excluded.progress,
       source_row = excluded.source_row,
       source_column = excluded.source_column,
       raw_import_value = excluded.raw_import_value`
  ).run({
    id: taskId,
    project_case_id: projectId,
    case_item_id: itemId,
    task_template_id: templateId,
    name,
    task_type: taskType,
    owner_department_id: ownerDepartmentId,
    assignee_id: assigneeId,
    team_id: teamId,
    status,
    progress,
    source_row: sourceRow,
    source_column: sourceColumn,
    raw_import_value: rawValue
  });
  return taskId;
}

function ensureEmployee(name: string, departmentId: string, role: string) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = db.prepare('SELECT id FROM employee WHERE name = ?').get(trimmed) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = stableId('USER', trimmed);
  db.prepare('INSERT OR IGNORE INTO employee (id, name, department_id, role) VALUES (?, ?, ?, ?)').run(id, trimmed, departmentId, role);
  return id;
}

function ensureTeam(name: string) {
  const normalized = normalizeTeamName(name);
  if (!normalized) return null;
  const existing = db.prepare('SELECT id FROM team WHERE name = ?').get(normalized) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = stableId('TEAM', normalized);
  db.prepare('INSERT OR IGNORE INTO team (id, name, leader_id) VALUES (?, ?, null)').run(id, normalized);
  return id;
}

function ensureCaseMember(projectId: string, userId: string | null, role: string, source: string) {
  if (!userId) return;
  db.prepare(
    `INSERT OR IGNORE INTO project_case_member (id, project_case_id, user_id, role_in_case, source)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`MEM-${projectId}-${userId}-${role}`, projectId, userId, role, source);
}

function parseProgress(value: ExcelJS.CellValue, sourceRow: number, sourceColumn: string, fieldName: string, sheetName: string, issues: ImportIssue[]): ParsedProgress {
  const raw = cellText(value).trim();
  if (!raw) return { value: null, raw };
  const numeric = Number(raw.replace('%', ''));
  if (!Number.isFinite(numeric)) {
    issues.push({
      source_sheet: sheetName,
      source_row: sourceRow,
      source_column: sourceColumn,
      field_name: fieldName,
      raw_value: raw,
      issue_type: '非进度数值',
      suggestion: '该字段应填写 0-1 的小数或 0-100 的百分比，当前内容会按 0% 导入'
    });
    return { value: null, raw };
  }
  if (numeric >= 0 && numeric <= 1) {
    return { value: roundProgress(numeric * 100), raw };
  }
  if (numeric > 1 && numeric <= 100) {
    issues.push({
      source_sheet: sheetName,
      source_row: sourceRow,
      source_column: sourceColumn,
      field_name: fieldName,
      raw_value: raw,
      issue_type: '进度数值需确认',
      suggestion: `将按 ${numeric}% 导入；如果原意是 ${numeric * 100}%，请先修正 Excel`
    });
    return { value: roundProgress(numeric), raw };
  }
  issues.push({
    source_sheet: sheetName,
    source_row: sourceRow,
    source_column: sourceColumn,
    field_name: fieldName,
    raw_value: raw,
    issue_type: '进度超出范围',
    suggestion: '该字段会按 100% 导入，请确认原始数据'
  });
  return { value: 100, raw };
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && value.text) return String(value.text);
    if ('result' in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((item) => item.text).join('');
    return '';
  }
  return String(value);
}

function numberValue(value: ExcelJS.CellValue): number | null {
  const text = cellText(value).trim();
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDate(value: ExcelJS.CellValue) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return cellText(value).trim();
}

function parseQuantity(text: string) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*件/);
  if (!match) return { value: null, unit: null };
  return { value: Number(match[1]), unit: '件' };
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return roundProgress(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function taskProgress(itemTask: ParsedItemTask) {
  return average(
    itemTask.subtasks
      .map((subtaskRow) => subtaskRow.progress)
      .filter((value): value is number => value !== null)
  );
}

function roundProgress(value: number) {
  return Math.round(value * 10) / 10;
}

function stableId(prefix: string, seed: string) {
  const digest = createHash('sha1').update(seed).digest('hex').slice(0, 10).toUpperCase();
  return `${prefix}-${digest}`;
}

function normalizeTeamName(name: string) {
  if (name.includes('二组')) return '二组';
  if (name.includes('一组')) return '一组';
  return name.trim();
}

function assigneeRole(taskType: string) {
  if (taskType === 'material') return 'material_owner';
  if (taskType === 'inspection') return 'quality_owner';
  return 'team_leader';
}

function deliveryExecutionProgress(deliveryStatus: string) {
  if (!deliveryStatus) return 0;
  if (deliveryStatus.includes('部分') || /已发\s*\d/.test(deliveryStatus)) return 50;
  if (deliveryStatus.includes('已出货') || deliveryStatus.includes('已完成') || deliveryStatus.includes('已发')) return 100;
  return 0;
}

function subtaskSortOrder(templateId: string) {
  const row = db.prepare('SELECT sort_order FROM subtask_template WHERE id = ?').get(templateId) as { sort_order: number } | undefined;
  return row?.sort_order ?? 0;
}
