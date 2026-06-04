import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'server/data');
mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export type TargetType = 'task' | 'subtask';

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS department (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employee (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department_id TEXT,
      role TEXT NOT NULL,
      FOREIGN KEY (department_id) REFERENCES department(id)
    );

    CREATE TABLE IF NOT EXISTS team (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      leader_id TEXT,
      FOREIGN KEY (leader_id) REFERENCES employee(id)
    );

    CREATE TABLE IF NOT EXISTS project_case (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT NOT NULL,
      category TEXT,
      customer_name TEXT,
      business_owner_id TEXT,
      design_owner_id TEXT,
      estimated_weight REAL,
      weight_unit TEXT DEFAULT 'T',
      status TEXT NOT NULL DEFAULT 'in_progress',
      total_progress REAL NOT NULL DEFAULT 0,
      delivery_date TEXT,
      delivery_status TEXT,
      source_sheet TEXT,
      source_row INTEGER,
      source_seq INTEGER,
      FOREIGN KEY (business_owner_id) REFERENCES employee(id),
      FOREIGN KEY (design_owner_id) REFERENCES employee(id)
    );

    CREATE TABLE IF NOT EXISTS case_item (
      id TEXT PRIMARY KEY,
      project_case_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      quantity REAL,
      quantity_unit TEXT,
      piece_count REAL,
      weight REAL,
      weight_unit TEXT DEFAULT 'T',
      status TEXT NOT NULL DEFAULT 'in_progress',
      progress REAL NOT NULL DEFAULT 0,
      delivery_date TEXT,
      delivery_status TEXT,
      source_row INTEGER,
      FOREIGN KEY (project_case_id) REFERENCES project_case(id)
    );

    CREATE TABLE IF NOT EXISTS case_template (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS task_template (
      id TEXT PRIMARY KEY,
      case_template_id TEXT NOT NULL,
      name TEXT NOT NULL,
      task_type TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      generation_scope TEXT NOT NULL,
      default_owner_department_id TEXT,
      progress_rule TEXT NOT NULL DEFAULT 'average',
      required INTEGER NOT NULL DEFAULT 1,
      skippable INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (case_template_id) REFERENCES case_template(id),
      FOREIGN KEY (default_owner_department_id) REFERENCES department(id)
    );

    CREATE TABLE IF NOT EXISTS subtask_template (
      id TEXT PRIMARY KEY,
      task_template_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      progress_rule TEXT NOT NULL DEFAULT 'manual',
      required INTEGER NOT NULL DEFAULT 1,
      skippable INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (task_template_id) REFERENCES task_template(id)
    );

    CREATE TABLE IF NOT EXISTS case_task (
      id TEXT PRIMARY KEY,
      project_case_id TEXT NOT NULL,
      case_item_id TEXT,
      task_template_id TEXT,
      name TEXT NOT NULL,
      task_type TEXT NOT NULL,
      owner_department_id TEXT,
      assignee_id TEXT,
      team_id TEXT,
      status TEXT NOT NULL DEFAULT 'not_started',
      progress REAL NOT NULL DEFAULT 0,
      planned_start_at TEXT,
      planned_finish_at TEXT,
      actual_start_at TEXT,
      actual_finish_at TEXT,
      is_delayed INTEGER NOT NULL DEFAULT 0,
      is_applicable INTEGER NOT NULL DEFAULT 1,
      include_in_progress INTEGER NOT NULL DEFAULT 1,
      source_row INTEGER,
      source_column TEXT,
      raw_import_value TEXT,
      remark TEXT,
      FOREIGN KEY (project_case_id) REFERENCES project_case(id),
      FOREIGN KEY (case_item_id) REFERENCES case_item(id),
      FOREIGN KEY (task_template_id) REFERENCES task_template(id),
      FOREIGN KEY (owner_department_id) REFERENCES department(id),
      FOREIGN KEY (assignee_id) REFERENCES employee(id),
      FOREIGN KEY (team_id) REFERENCES team(id)
    );

    CREATE TABLE IF NOT EXISTS case_subtask (
      id TEXT PRIMARY KEY,
      case_task_id TEXT NOT NULL,
      subtask_template_id TEXT,
      parent_subtask_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      assignee_id TEXT,
      team_id TEXT,
      status TEXT NOT NULL DEFAULT 'not_started',
      progress REAL NOT NULL DEFAULT 0,
      planned_quantity REAL,
      completed_quantity REAL,
      quantity_unit TEXT,
      recorded_weight REAL,
      recorded_piece_count REAL,
      is_applicable INTEGER NOT NULL DEFAULT 1,
      include_in_progress INTEGER NOT NULL DEFAULT 1,
      source_column TEXT,
      raw_import_value TEXT,
      remark TEXT,
      FOREIGN KEY (case_task_id) REFERENCES case_task(id),
      FOREIGN KEY (subtask_template_id) REFERENCES subtask_template(id),
      FOREIGN KEY (parent_subtask_id) REFERENCES case_subtask(id),
      FOREIGN KEY (assignee_id) REFERENCES employee(id),
      FOREIGN KEY (team_id) REFERENCES team(id)
    );

    CREATE TABLE IF NOT EXISTS project_case_member (
      id TEXT PRIMARY KEY,
      project_case_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_in_case TEXT NOT NULL,
      source TEXT NOT NULL,
      FOREIGN KEY (project_case_id) REFERENCES project_case(id),
      FOREIGN KEY (user_id) REFERENCES employee(id)
    );

    CREATE TABLE IF NOT EXISTS progress_log (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      before_status TEXT,
      after_status TEXT,
      before_progress REAL,
      after_progress REAL,
      source TEXT NOT NULL,
      reason TEXT,
      remark TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_log_entry (
      id TEXT PRIMARY KEY,
      project_case_id TEXT NOT NULL,
      case_item_id TEXT,
      case_task_id TEXT NOT NULL,
      case_subtask_id TEXT,
      actual_employee_id TEXT NOT NULL,
      input_by TEXT NOT NULL,
      team_id TEXT,
      work_date TEXT NOT NULL,
      hours REAL NOT NULL,
      work_content TEXT NOT NULL,
      output_note TEXT,
      quantity REAL,
      piece_count REAL,
      weight REAL,
      unit TEXT,
      record_status TEXT NOT NULL DEFAULT 'submitted',
      FOREIGN KEY (project_case_id) REFERENCES project_case(id),
      FOREIGN KEY (case_item_id) REFERENCES case_item(id),
      FOREIGN KEY (case_task_id) REFERENCES case_task(id),
      FOREIGN KEY (case_subtask_id) REFERENCES case_subtask(id),
      FOREIGN KEY (actual_employee_id) REFERENCES employee(id),
      FOREIGN KEY (input_by) REFERENCES employee(id),
      FOREIGN KEY (team_id) REFERENCES team(id)
    );

    CREATE TABLE IF NOT EXISTS exception_record (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      level TEXT NOT NULL,
      project_case_id TEXT NOT NULL,
      case_item_id TEXT,
      case_task_id TEXT,
      case_subtask_id TEXT,
      created_by TEXT NOT NULL,
      created_department_id TEXT,
      responsible_department_id TEXT,
      current_handler_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      description TEXT NOT NULL,
      expected_resolved_at TEXT,
      resolved_at TEXT,
      resolution TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_case_id) REFERENCES project_case(id),
      FOREIGN KEY (case_item_id) REFERENCES case_item(id),
      FOREIGN KEY (case_task_id) REFERENCES case_task(id),
      FOREIGN KEY (case_subtask_id) REFERENCES case_subtask(id),
      FOREIGN KEY (created_by) REFERENCES employee(id),
      FOREIGN KEY (current_handler_id) REFERENCES employee(id)
    );

    CREATE TABLE IF NOT EXISTS exception_comment (
      id TEXT PRIMARY KEY,
      exception_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (exception_id) REFERENCES exception_record(id),
      FOREIGN KEY (author_id) REFERENCES employee(id)
    );

    CREATE TABLE IF NOT EXISTS import_task (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      status TEXT NOT NULL,
      source_sheet TEXT,
      total_rows INTEGER NOT NULL DEFAULT 0,
      parsed_cases INTEGER NOT NULL DEFAULT 0,
      parsed_items INTEGER NOT NULL DEFAULT 0,
      issue_count INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      issues_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      confirmed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_item_case ON case_item(project_case_id);
    CREATE INDEX IF NOT EXISTS idx_task_case ON case_task(project_case_id);
    CREATE INDEX IF NOT EXISTS idx_task_item ON case_task(case_item_id);
    CREATE INDEX IF NOT EXISTS idx_subtask_task ON case_subtask(case_task_id);
    CREATE INDEX IF NOT EXISTS idx_work_log_task ON work_log_entry(case_task_id);
    CREATE INDEX IF NOT EXISTS idx_exception_task ON exception_record(case_task_id);
  `);

  seedDatabase();
}

function insertMany(table: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  const keys = Object.keys(rows[0]);
  const placeholders = keys.map((key) => `@${key}`).join(', ');
  const stmt = db.prepare(`INSERT OR IGNORE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`);
  const tx = db.transaction((items: Array<Record<string, unknown>>) => {
    for (const item of items) stmt.run(item);
  });
  tx(rows);
}

function seedDatabase() {
  const existing = db.prepare('SELECT COUNT(*) as count FROM project_case').get() as { count: number };
  if (existing.count > 0) return;

  insertMany('department', [
    { id: 'dept-business', name: '业务部' },
    { id: 'dept-design', name: '设计部' },
    { id: 'dept-material', name: '材料仓储' },
    { id: 'dept-production', name: '生产部' },
    { id: 'dept-quality', name: '质检部' },
    { id: 'dept-delivery', name: '发货组' }
  ]);

  insertMany('employee', [
    { id: 'user-admin', name: '管理员', department_id: 'dept-business', role: 'admin' },
    { id: 'user-zhang', name: '张剑华', department_id: 'dept-business', role: 'business_owner' },
    { id: 'user-wei-li', name: '魏立', department_id: 'dept-design', role: 'design_owner' },
    { id: 'user-rao', name: '饶家忠', department_id: 'dept-design', role: 'design_owner' },
    { id: 'user-wei-zong', name: '魏总', department_id: 'dept-material', role: 'material_owner' },
    { id: 'user-wang', name: '王世金', department_id: 'dept-production', role: 'team_leader' },
    { id: 'user-team2', name: '二组班组长', department_id: 'dept-production', role: 'team_leader' },
    { id: 'user-li', name: '李嘉俊', department_id: 'dept-quality', role: 'quality_owner' },
    { id: 'user-zhangsan', name: '张三', department_id: 'dept-production', role: 'worker' }
  ]);

  insertMany('team', [
    { id: 'team-1', name: '一组', leader_id: 'user-wang' },
    { id: 'team-2', name: '二组', leader_id: 'user-team2' }
  ]);

  insertMany('case_template', [
    { id: 'tpl-steel-v1', name: '钢结构项目模板', version: 'v1', status: 'active', is_default: 1, description: '从项目进度总表抽象出的默认模板' }
  ]);

  insertMany('task_template', [
    { id: 'tt-design', case_template_id: 'tpl-steel-v1', name: '设计确认', task_type: 'design', sort_order: 10, generation_scope: 'case', default_owner_department_id: 'dept-design', progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'tt-drawing', case_template_id: 'tpl-steel-v1', name: '图纸定审', task_type: 'drawing_review', sort_order: 20, generation_scope: 'case', default_owner_department_id: 'dept-design', progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'tt-material', case_template_id: 'tpl-steel-v1', name: '材料入库', task_type: 'material', sort_order: 30, generation_scope: 'item', default_owner_department_id: 'dept-material', progress_rule: 'average', required: 1, skippable: 0 },
    { id: 'tt-cutting', case_template_id: 'tpl-steel-v1', name: '下料加工', task_type: 'cutting', sort_order: 40, generation_scope: 'item', default_owner_department_id: 'dept-production', progress_rule: 'average', required: 1, skippable: 0 },
    { id: 'tt-production', case_template_id: 'tpl-steel-v1', name: '装焊生产', task_type: 'production', sort_order: 50, generation_scope: 'item', default_owner_department_id: 'dept-production', progress_rule: 'average', required: 1, skippable: 0 },
    { id: 'tt-inspection', case_template_id: 'tpl-steel-v1', name: '验收', task_type: 'inspection', sort_order: 60, generation_scope: 'item', default_owner_department_id: 'dept-quality', progress_rule: 'average', required: 1, skippable: 0 },
    { id: 'tt-delivery', case_template_id: 'tpl-steel-v1', name: '发货', task_type: 'delivery', sort_order: 70, generation_scope: 'item', default_owner_department_id: 'dept-delivery', progress_rule: 'manual', required: 1, skippable: 0 }
  ]);

  insertMany('subtask_template', [
    { id: 'st-plate-purchase', task_template_id: 'tt-material', name: '板材请购', sort_order: 10, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-plate-in', task_template_id: 'tt-material', name: '板材入库', sort_order: 20, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-profile-purchase', task_template_id: 'tt-material', name: '型材请购', sort_order: 30, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-profile-in', task_template_id: 'tt-material', name: '型材入库', sort_order: 40, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-parts-in', task_template_id: 'tt-material', name: '零配件入库', sort_order: 50, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-plate-cut', task_template_id: 'tt-cutting', name: '板材套料切割', sort_order: 10, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-plate-machine', task_template_id: 'tt-cutting', name: '板材机加工', sort_order: 20, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-profile-cut', task_template_id: 'tt-cutting', name: '型材套料切割', sort_order: 30, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-profile-machine', task_template_id: 'tt-cutting', name: '型材机加工', sort_order: 40, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-assembly', task_template_id: 'tt-production', name: '单片体拼装', sort_order: 10, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-welding', task_template_id: 'tt-production', name: '单片体焊接', sort_order: 20, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-cleaning', task_template_id: 'tt-production', name: '单片体清磨', sort_order: 30, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-preassembly', task_template_id: 'tt-production', name: '预拼装、校正', sort_order: 40, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-painting', task_template_id: 'tt-production', name: '喷涂', sort_order: 50, progress_rule: 'manual', required: 0, skippable: 1 },
    { id: 'st-self-check', task_template_id: 'tt-inspection', name: '自检', sort_order: 10, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-mutual-check', task_template_id: 'tt-inspection', name: '互检', sort_order: 20, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-special-check', task_template_id: 'tt-inspection', name: '专检', sort_order: 30, progress_rule: 'manual', required: 1, skippable: 0 }
  ]);

  insertMany('project_case', [
    { id: 'CASE-202604-001', code: 'P-001', name: '惠增一标20M小箱梁中梁旧模板改造', category: '旧模板改造', customer_name: '', business_owner_id: 'user-zhang', design_owner_id: 'user-wei-li', estimated_weight: 15, weight_unit: 'T', status: 'completed', total_progress: 100, delivery_date: '2026-04-09', delivery_status: '已出货', source_sheet: '总表', source_row: 9, source_seq: 1 },
    { id: 'CASE-202604-002', code: 'P-002', name: '狮子洋通道工程3标护栏模板', category: '护栏模板', customer_name: '', business_owner_id: 'user-zhang', design_owner_id: 'user-rao', estimated_weight: 20, weight_unit: 'T', status: 'in_progress', total_progress: 86, delivery_date: '2026-04-23', delivery_status: '部分待确认', source_sheet: '总表', source_row: 19, source_seq: 2 }
  ]);

  insertMany('case_item', [
    { id: 'ITEM-001-01', project_case_id: 'CASE-202604-001', name: '主体拼模', category: '', quantity: null, quantity_unit: null, piece_count: null, weight: null, weight_unit: 'T', status: 'completed', progress: 100, delivery_date: '2026-04-09', delivery_status: '已出货', source_row: 9 },
    { id: 'ITEM-001-02', project_case_id: 'CASE-202604-001', name: '正交横隔堵4件', category: '', quantity: 4, quantity_unit: '件', piece_count: 4, weight: null, weight_unit: 'T', status: 'completed', progress: 100, delivery_date: '2026-04-09', delivery_status: '已出货', source_row: 10 },
    { id: 'ITEM-002-01', project_case_id: 'CASE-202604-002', name: 'M1*15件', category: '', quantity: 15, quantity_unit: '件', piece_count: 15, weight: null, weight_unit: 'T', status: 'completed', progress: 100, delivery_date: '2026-04-23', delivery_status: '已完成', source_row: 19 },
    { id: 'ITEM-002-02', project_case_id: 'CASE-202604-002', name: 'M2*15件', category: '', quantity: 15, quantity_unit: '件', piece_count: 15, weight: null, weight_unit: 'T', status: 'completed', progress: 100, delivery_date: null, delivery_status: '', source_row: 20 },
    { id: 'ITEM-002-05', project_case_id: 'CASE-202604-002', name: 'M9*30件', category: '', quantity: 30, quantity_unit: '件', piece_count: 30, weight: null, weight_unit: 'T', status: 'in_progress', progress: 92, delivery_date: null, delivery_status: '', source_row: 23 },
    { id: 'ITEM-002-06', project_case_id: 'CASE-202604-002', name: 'M10*15件', category: '', quantity: 15, quantity_unit: '件', piece_count: 15, weight: null, weight_unit: 'T', status: 'in_progress', progress: 83, delivery_date: null, delivery_status: '', source_row: 24 },
    { id: 'ITEM-002-09', project_case_id: 'CASE-202604-002', name: '配件', category: '', quantity: null, quantity_unit: null, piece_count: null, weight: null, weight_unit: 'T', status: 'in_progress', progress: 90, delivery_date: null, delivery_status: '', source_row: 29 }
  ]);

  seedTasksForCases();
  seedLogsAndExceptions();
}

function seedTasksForCases() {
  const itemRows = db.prepare('SELECT * FROM case_item').all() as Array<{ id: string; project_case_id: string; name: string; progress: number }>;
  const taskTemplates = db.prepare("SELECT * FROM task_template WHERE generation_scope = 'item' ORDER BY sort_order").all() as Array<{ id: string; name: string; task_type: string; default_owner_department_id: string }>;
  const subtaskTemplates = db.prepare('SELECT * FROM subtask_template WHERE task_template_id = ? ORDER BY sort_order');

  const taskRows: Array<Record<string, unknown>> = [];
  const subtaskRows: Array<Record<string, unknown>> = [];

  for (const item of itemRows) {
    for (const template of taskTemplates) {
      const taskId = `TASK-${item.id}-${template.task_type}`;
      const progress = taskProgressFor(item.id, template.task_type);
      const assignee = assigneeFor(template.task_type);
      const team = teamFor(template.task_type, item.id);
      taskRows.push({
        id: taskId,
        project_case_id: item.project_case_id,
        case_item_id: item.id,
        task_template_id: template.id,
        name: template.name,
        task_type: template.task_type,
        owner_department_id: template.default_owner_department_id,
        assignee_id: assignee,
        team_id: team,
        status: progress >= 100 ? 'completed' : progress > 0 ? 'in_progress' : 'not_started',
        progress,
        is_delayed: 0,
        is_applicable: 1,
        include_in_progress: 1,
        source_row: null,
        source_column: null,
        raw_import_value: null,
        remark: ''
      });

      const subtasks = subtaskTemplates.all(template.id) as Array<{ id: string; name: string; sort_order: number }>;
      for (const subtask of subtasks) {
        const subProgress = subtaskProgressFor(item.id, template.task_type, subtask.name);
        subtaskRows.push({
          id: `SUB-${item.id}-${subtask.id}`,
          case_task_id: taskId,
          subtask_template_id: subtask.id,
          parent_subtask_id: null,
          name: subtask.name,
          sort_order: subtask.sort_order,
          assignee_id: assignee,
          team_id: team,
          status: subProgress >= 100 ? 'completed' : subProgress > 0 ? 'in_progress' : 'not_started',
          progress: subProgress,
          planned_quantity: item.name.includes('M9') ? 30 : null,
          completed_quantity: item.name.includes('M9') && subtask.name === '预拼装、校正' ? 22.5 : null,
          quantity_unit: item.name.includes('M9') ? '件' : null,
          recorded_weight: null,
          recorded_piece_count: null,
          is_applicable: 1,
          include_in_progress: 1,
          source_column: null,
          raw_import_value: String(subProgress / 100),
          remark: ''
        });
      }
    }
  }

  insertMany('case_task', taskRows);
  insertMany('case_subtask', subtaskRows);

  insertMany('case_task', [
    { id: 'TASK-CASE-001-design', project_case_id: 'CASE-202604-001', case_item_id: null, task_template_id: 'tt-design', name: '设计确认', task_type: 'design', owner_department_id: 'dept-design', assignee_id: 'user-wei-li', team_id: null, status: 'completed', progress: 100, is_delayed: 0, is_applicable: 1, include_in_progress: 1, source_row: 9, source_column: 'E', raw_import_value: '魏立', remark: '' },
    { id: 'TASK-CASE-001-drawing', project_case_id: 'CASE-202604-001', case_item_id: null, task_template_id: 'tt-drawing', name: '图纸定审', task_type: 'drawing_review', owner_department_id: 'dept-design', assignee_id: 'user-wei-li', team_id: null, status: 'completed', progress: 100, is_delayed: 0, is_applicable: 1, include_in_progress: 1, source_row: 9, source_column: 'F', raw_import_value: '1', remark: '' },
    { id: 'TASK-CASE-002-design', project_case_id: 'CASE-202604-002', case_item_id: null, task_template_id: 'tt-design', name: '设计确认', task_type: 'design', owner_department_id: 'dept-design', assignee_id: 'user-rao', team_id: null, status: 'completed', progress: 100, is_delayed: 0, is_applicable: 1, include_in_progress: 1, source_row: 19, source_column: 'E', raw_import_value: '饶家忠', remark: '' },
    { id: 'TASK-CASE-002-drawing', project_case_id: 'CASE-202604-002', case_item_id: null, task_template_id: 'tt-drawing', name: '图纸定审', task_type: 'drawing_review', owner_department_id: 'dept-design', assignee_id: 'user-rao', team_id: null, status: 'completed', progress: 100, is_delayed: 0, is_applicable: 1, include_in_progress: 1, source_row: 19, source_column: 'F', raw_import_value: '1', remark: '' }
  ]);

  const memberRows = [
    { id: 'MEM-1', project_case_id: 'CASE-202604-001', user_id: 'user-zhang', role_in_case: 'business_owner', source: 'case' },
    { id: 'MEM-2', project_case_id: 'CASE-202604-001', user_id: 'user-wei-li', role_in_case: 'design_owner', source: 'case' },
    { id: 'MEM-3', project_case_id: 'CASE-202604-001', user_id: 'user-wei-zong', role_in_case: 'material_owner', source: 'task' },
    { id: 'MEM-4', project_case_id: 'CASE-202604-001', user_id: 'user-wang', role_in_case: 'team_leader', source: 'task' },
    { id: 'MEM-5', project_case_id: 'CASE-202604-001', user_id: 'user-li', role_in_case: 'quality_owner', source: 'task' },
    { id: 'MEM-6', project_case_id: 'CASE-202604-002', user_id: 'user-zhang', role_in_case: 'business_owner', source: 'case' },
    { id: 'MEM-7', project_case_id: 'CASE-202604-002', user_id: 'user-rao', role_in_case: 'design_owner', source: 'case' },
    { id: 'MEM-8', project_case_id: 'CASE-202604-002', user_id: 'user-wei-zong', role_in_case: 'material_owner', source: 'task' },
    { id: 'MEM-9', project_case_id: 'CASE-202604-002', user_id: 'user-team2', role_in_case: 'team_leader', source: 'task' },
    { id: 'MEM-10', project_case_id: 'CASE-202604-002', user_id: 'user-li', role_in_case: 'quality_owner', source: 'task' },
    { id: 'MEM-ADMIN-1', project_case_id: 'CASE-202604-001', user_id: 'user-admin', role_in_case: 'admin', source: 'system' },
    { id: 'MEM-ADMIN-2', project_case_id: 'CASE-202604-002', user_id: 'user-admin', role_in_case: 'admin', source: 'system' }
  ];
  insertMany('project_case_member', memberRows);
}

function taskProgressFor(itemId: string, taskType: string) {
  if (taskType === 'material' || taskType === 'cutting' || taskType === 'inspection') return 100;
  if (taskType === 'delivery') return itemId.startsWith('ITEM-001') ? 100 : 30;
  if (itemId === 'ITEM-002-05' && taskType === 'production') return 95;
  if (itemId === 'ITEM-002-06' && taskType === 'production') return 80;
  if (itemId === 'ITEM-002-09' && taskType === 'production') return 90;
  return 100;
}

function subtaskProgressFor(itemId: string, taskType: string, name: string) {
  if (itemId === 'ITEM-002-05' && taskType === 'production' && name === '预拼装、校正') return 75;
  if (itemId === 'ITEM-002-06' && taskType === 'production' && name === '预拼装、校正') return 0;
  if (itemId === 'ITEM-002-09' && taskType === 'production' && name === '预拼装、校正') return 80;
  if (taskType === 'delivery') return itemId.startsWith('ITEM-001') ? 100 : 30;
  return taskProgressFor(itemId, taskType);
}

function assigneeFor(taskType: string) {
  if (taskType === 'material') return 'user-wei-zong';
  if (taskType === 'cutting') return 'user-wang';
  if (taskType === 'production') return 'user-team2';
  if (taskType === 'inspection') return 'user-li';
  return null;
}

function teamFor(taskType: string, itemId: string) {
  if (taskType === 'production') return itemId.startsWith('ITEM-002') ? 'team-2' : 'team-1';
  if (taskType === 'cutting') return 'team-1';
  return null;
}

function seedLogsAndExceptions() {
  insertMany('work_log_entry', [
    {
      id: 'WL-20260415-001',
      project_case_id: 'CASE-202604-002',
      case_item_id: 'ITEM-002-05',
      case_task_id: 'TASK-ITEM-002-05-production',
      case_subtask_id: 'SUB-ITEM-002-05-st-preassembly',
      actual_employee_id: 'user-zhangsan',
      input_by: 'user-team2',
      team_id: 'team-2',
      work_date: '2026-04-15',
      hours: 8,
      work_content: 'M9 模板预拼装、校正',
      output_note: '完成 3 件校正',
      quantity: 3,
      piece_count: 3,
      weight: null,
      unit: '件',
      record_status: 'submitted'
    }
  ]);

  insertMany('exception_record', [
    {
      id: 'EX-20260416-001',
      title: 'M9 预拼装尺寸需设计部确认',
      type: 'drawing_confirmation',
      level: 'medium',
      project_case_id: 'CASE-202604-002',
      case_item_id: 'ITEM-002-05',
      case_task_id: 'TASK-ITEM-002-05-production',
      case_subtask_id: 'SUB-ITEM-002-05-st-preassembly',
      created_by: 'user-team2',
      created_department_id: 'dept-production',
      responsible_department_id: 'dept-design',
      current_handler_id: 'user-rao',
      status: 'open',
      description: '预拼装校正时发现局部尺寸与现场装配要求不一致，需要设计部确认是否按现图继续生产。',
      expected_resolved_at: '2026-04-17',
      resolved_at: null,
      resolution: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ]);
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}
