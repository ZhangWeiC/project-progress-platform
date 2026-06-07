import Database from 'better-sqlite3';
import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv();

const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'server/data'));
mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');


function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

export type TargetType = 'task' | 'subtask';

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS department (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_department_id TEXT,
      feishu_department_id TEXT,
      feishu_open_department_id TEXT,
      leader_user_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_feishu_sync_at TEXT
    );

    CREATE TABLE IF NOT EXISTS employee (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department_id TEXT,
      role TEXT NOT NULL,
      permission_level TEXT NOT NULL DEFAULT 'viewer',
      feishu_open_id TEXT,
      feishu_union_id TEXT,
      feishu_user_id TEXT,
      email TEXT,
      mobile TEXT,
      avatar_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_feishu_sync_at TEXT,
      FOREIGN KEY (department_id) REFERENCES department(id)
    );

    CREATE TABLE IF NOT EXISTS employee_department (
      employee_id TEXT NOT NULL,
      department_id TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'feishu',
      last_feishu_sync_at TEXT,
      PRIMARY KEY (employee_id, department_id),
      FOREIGN KEY (employee_id) REFERENCES employee(id),
      FOREIGN KEY (department_id) REFERENCES department(id)
    );

    CREATE TABLE IF NOT EXISTS user_credential (
      employee_id TEXT PRIMARY KEY,
      login_name TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (employee_id) REFERENCES employee(id)
    );

    CREATE TABLE IF NOT EXISTS auth_session (
      token_hash TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employee(id)
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

    CREATE TABLE IF NOT EXISTS production_plan (
      id TEXT PRIMARY KEY,
      department_id TEXT NOT NULL,
      plan_month TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      source_sheet TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (department_id) REFERENCES department(id)
    );

    CREATE TABLE IF NOT EXISTS production_plan_item (
      id TEXT PRIMARY KEY,
      production_plan_id TEXT NOT NULL,
      project_case_id TEXT,
      case_item_id TEXT,
      case_task_id TEXT,
      task_type TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      planned_start_date TEXT NOT NULL,
      planned_end_date TEXT NOT NULL,
      assigned_team_id TEXT,
      progress REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'planned',
      remark TEXT,
      source_row INTEGER,
      FOREIGN KEY (production_plan_id) REFERENCES production_plan(id),
      FOREIGN KEY (project_case_id) REFERENCES project_case(id),
      FOREIGN KEY (case_item_id) REFERENCES case_item(id),
      FOREIGN KEY (case_task_id) REFERENCES case_task(id),
      FOREIGN KEY (assigned_team_id) REFERENCES team(id)
    );

    CREATE INDEX IF NOT EXISTS idx_item_case ON case_item(project_case_id);
    CREATE INDEX IF NOT EXISTS idx_task_case ON case_task(project_case_id);
    CREATE INDEX IF NOT EXISTS idx_task_item ON case_task(case_item_id);
    CREATE INDEX IF NOT EXISTS idx_subtask_task ON case_subtask(case_task_id);
    CREATE INDEX IF NOT EXISTS idx_work_log_task ON work_log_entry(case_task_id);
    CREATE INDEX IF NOT EXISTS idx_exception_task ON exception_record(case_task_id);
    CREATE INDEX IF NOT EXISTS idx_auth_session_employee ON auth_session(employee_id);
    CREATE INDEX IF NOT EXISTS idx_employee_department_department ON employee_department(department_id);
    CREATE INDEX IF NOT EXISTS idx_production_plan_department_month ON production_plan(department_id, plan_month);
    CREATE INDEX IF NOT EXISTS idx_production_plan_item_plan ON production_plan_item(production_plan_id);
    CREATE INDEX IF NOT EXISTS idx_production_plan_item_case ON production_plan_item(project_case_id, case_item_id);
  `);

  migratePermissionModel();
  migrateFeishuIdentityColumns();
  seedDatabase();
  seedCredentials();
  migrateWorkflowModel();
  seedProductionPlans();
}

function migratePermissionModel() {
  const employeeColumns = db.prepare('PRAGMA table_info(employee)').all() as Array<{ name: string }>;
  const addedPermissionLevel = !employeeColumns.some((column) => column.name === 'permission_level');
  if (addedPermissionLevel) {
    db.prepare("ALTER TABLE employee ADD COLUMN permission_level TEXT NOT NULL DEFAULT 'viewer'").run();
    db.prepare("UPDATE employee SET permission_level = 'manager' WHERE role IN ('admin', 'business_owner')").run();
    db.prepare("UPDATE employee SET permission_level = 'editor' WHERE role IN ('design_owner', 'material_owner', 'quality_owner', 'team_leader')").run();
  }
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

function migrateFeishuIdentityColumns() {
  addColumnIfMissing('department', 'parent_department_id', 'TEXT');
  addColumnIfMissing('department', 'feishu_department_id', 'TEXT');
  addColumnIfMissing('department', 'feishu_open_department_id', 'TEXT');
  addColumnIfMissing('department', 'leader_user_id', 'TEXT');
  addColumnIfMissing('department', 'status', "TEXT NOT NULL DEFAULT 'active'");
  addColumnIfMissing('department', 'last_feishu_sync_at', 'TEXT');

  addColumnIfMissing('employee', 'feishu_open_id', 'TEXT');
  addColumnIfMissing('employee', 'feishu_union_id', 'TEXT');
  addColumnIfMissing('employee', 'feishu_user_id', 'TEXT');
  addColumnIfMissing('employee', 'email', 'TEXT');
  addColumnIfMissing('employee', 'mobile', 'TEXT');
  addColumnIfMissing('employee', 'avatar_url', 'TEXT');
  addColumnIfMissing('employee', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('employee', 'last_feishu_sync_at', 'TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_employee_feishu_open_id ON employee(feishu_open_id);
    CREATE INDEX IF NOT EXISTS idx_employee_feishu_union_id ON employee(feishu_union_id);
    CREATE INDEX IF NOT EXISTS idx_employee_feishu_user_id ON employee(feishu_user_id);
    CREATE INDEX IF NOT EXISTS idx_department_feishu_open_id ON department(feishu_open_department_id);
  `);
}

function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
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
    { id: 'user-admin', name: '管理员', department_id: 'dept-business', role: 'admin', permission_level: 'manager' },
    { id: 'user-zhang', name: '张剑华', department_id: 'dept-business', role: 'business_owner', permission_level: 'manager' },
    { id: 'user-wei-li', name: '魏立', department_id: 'dept-design', role: 'design_owner', permission_level: 'editor' },
    { id: 'user-rao', name: '饶家忠', department_id: 'dept-design', role: 'design_owner', permission_level: 'editor' },
    { id: 'user-wei-zong', name: '魏总', department_id: 'dept-material', role: 'material_owner', permission_level: 'editor' },
    { id: 'user-wang', name: '王世金', department_id: 'dept-production', role: 'team_leader', permission_level: 'editor' },
    { id: 'user-team2', name: '二组班组长', department_id: 'dept-production', role: 'team_leader', permission_level: 'editor' },
    { id: 'user-li', name: '李嘉俊', department_id: 'dept-quality', role: 'quality_owner', permission_level: 'editor' },
    { id: 'user-zhangsan', name: '张三', department_id: 'dept-production', role: 'worker', permission_level: 'viewer' }
  ]);

  insertMany('team', [
    { id: 'team-1', name: '一组', leader_id: 'user-wang' },
    { id: 'team-2', name: '二组', leader_id: 'user-team2' }
  ]);

  insertMany('case_template', [
    { id: 'tpl-steel-v1', name: '钢结构项目模板', version: 'v1', status: 'active', is_default: 1, description: '从项目进度总表抽象出的默认模板' }
  ]);

  insertMany('task_template', [
    { id: 'tt-design', case_template_id: 'tpl-steel-v1', name: '设计', task_type: 'design', sort_order: 10, generation_scope: 'case', default_owner_department_id: 'dept-design', progress_rule: 'average', required: 1, skippable: 0 },
    { id: 'tt-material', case_template_id: 'tpl-steel-v1', name: '材料入库', task_type: 'material', sort_order: 20, generation_scope: 'item', default_owner_department_id: 'dept-material', progress_rule: 'average', required: 1, skippable: 0 },
    { id: 'tt-cutting', case_template_id: 'tpl-steel-v1', name: '下料', task_type: 'cutting', sort_order: 30, generation_scope: 'item', default_owner_department_id: 'dept-production', progress_rule: 'average', required: 1, skippable: 0 },
    { id: 'tt-production', case_template_id: 'tpl-steel-v1', name: '装焊', task_type: 'production', sort_order: 40, generation_scope: 'item', default_owner_department_id: 'dept-production', progress_rule: 'average', required: 1, skippable: 0 },
    { id: 'tt-painting', case_template_id: 'tpl-steel-v1', name: '喷涂', task_type: 'painting', sort_order: 50, generation_scope: 'item', default_owner_department_id: 'dept-production', progress_rule: 'average', required: 1, skippable: 0 },
    { id: 'tt-inspection', case_template_id: 'tpl-steel-v1', name: '验收', task_type: 'inspection', sort_order: 60, generation_scope: 'item', default_owner_department_id: 'dept-quality', progress_rule: 'average', required: 1, skippable: 0 },
    { id: 'tt-delivery', case_template_id: 'tpl-steel-v1', name: '发货', task_type: 'delivery', sort_order: 70, generation_scope: 'item', default_owner_department_id: 'dept-delivery', progress_rule: 'average', required: 1, skippable: 0 }
  ]);

  insertMany('subtask_template', [
    { id: 'st-drawing-review', task_template_id: 'tt-design', name: '图纸定审', sort_order: 10, progress_rule: 'manual', required: 1, skippable: 0 },
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
    { id: 'st-painting', task_template_id: 'tt-painting', name: '喷涂作业', sort_order: 10, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-self-check', task_template_id: 'tt-inspection', name: '自检', sort_order: 10, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-mutual-check', task_template_id: 'tt-inspection', name: '互检', sort_order: 20, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-special-check', task_template_id: 'tt-inspection', name: '专检', sort_order: 30, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-delivery-plan', task_template_id: 'tt-delivery', name: '发货计划', sort_order: 10, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-delivery-execute', task_template_id: 'tt-delivery', name: '发货执行', sort_order: 20, progress_rule: 'manual', required: 1, skippable: 0 }
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

function seedCredentials() {
  const credentials = [
    { employeeId: 'user-admin', loginName: 'admin' },
    { employeeId: 'user-zhang', loginName: 'zhangjianhua' },
    { employeeId: 'user-team2', loginName: 'team2' },
    { employeeId: 'user-rao', loginName: 'raojiazhong' },
    { employeeId: 'user-li', loginName: 'lijiajun' }
  ];
  const existingCredentials = db.prepare(
    'SELECT employee_id, password_salt, password_hash FROM user_credential'
  ).all() as Array<{ employee_id: string; password_salt: string; password_hash: string }>;
  const hasDefaultPassword = existingCredentials.length === 0 || existingCredentials.some((credential) => {
    const currentHash = scryptSync('123456', credential.password_salt, 64);
    return currentHash.equals(Buffer.from(credential.password_hash, 'hex'));
  });
  const initialPassword = process.env.INITIAL_USER_PASSWORD?.trim();

  if (process.env.NODE_ENV === 'production' && hasDefaultPassword && (!initialPassword || initialPassword.length < 12)) {
    throw new Error('生产环境检测到默认账号密码，请设置至少 12 位的 INITIAL_USER_PASSWORD');
  }

  const seedPassword = initialPassword || '123456';
  const insert = db.prepare(
    `INSERT OR IGNORE INTO user_credential
     (employee_id, login_name, password_salt, password_hash, enabled)
     VALUES (?, ?, ?, ?, 1)`
  );
  for (const credential of credentials) {
    const salt = randomBytes(16).toString('hex');
    const passwordHash = scryptSync(seedPassword, salt, 64).toString('hex');
    insert.run(credential.employeeId, credential.loginName, salt, passwordHash);
  }

  if (initialPassword && existingCredentials.length > 0) {
    const update = db.prepare(
      'UPDATE user_credential SET password_salt = ?, password_hash = ? WHERE employee_id = ?'
    );
    for (const credential of existingCredentials) {
      const defaultHash = scryptSync('123456', credential.password_salt, 64);
      if (!defaultHash.equals(Buffer.from(credential.password_hash, 'hex'))) continue;
      const salt = randomBytes(16).toString('hex');
      update.run(salt, scryptSync(initialPassword, salt, 64).toString('hex'), credential.employee_id);
    }
  }
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
    { id: 'TASK-CASE-001-design', project_case_id: 'CASE-202604-001', case_item_id: null, task_template_id: 'tt-design', name: '设计', task_type: 'design', owner_department_id: 'dept-design', assignee_id: 'user-wei-li', team_id: null, status: 'completed', progress: 100, is_delayed: 0, is_applicable: 1, include_in_progress: 1, source_row: 9, source_column: 'E', raw_import_value: '魏立', remark: '' },
    { id: 'TASK-CASE-002-design', project_case_id: 'CASE-202604-002', case_item_id: null, task_template_id: 'tt-design', name: '设计', task_type: 'design', owner_department_id: 'dept-design', assignee_id: 'user-rao', team_id: null, status: 'completed', progress: 100, is_delayed: 0, is_applicable: 1, include_in_progress: 1, source_row: 19, source_column: 'E', raw_import_value: '饶家忠', remark: '' }
  ]);

  insertMany('case_subtask', [
    { id: 'SUB-CASE-202604-001-st-drawing-review', case_task_id: 'TASK-CASE-001-design', subtask_template_id: 'st-drawing-review', parent_subtask_id: null, name: '图纸定审', sort_order: 10, assignee_id: 'user-wei-li', team_id: null, status: 'completed', progress: 100, planned_quantity: null, completed_quantity: null, quantity_unit: null, recorded_weight: null, recorded_piece_count: null, is_applicable: 1, include_in_progress: 1, source_column: 'F', raw_import_value: '1', remark: '' },
    { id: 'SUB-CASE-202604-002-st-drawing-review', case_task_id: 'TASK-CASE-002-design', subtask_template_id: 'st-drawing-review', parent_subtask_id: null, name: '图纸定审', sort_order: 10, assignee_id: 'user-rao', team_id: null, status: 'completed', progress: 100, planned_quantity: null, completed_quantity: null, quantity_unit: null, recorded_weight: null, recorded_piece_count: null, is_applicable: 1, include_in_progress: 1, source_column: 'F', raw_import_value: '1', remark: '' }
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

function seedProductionPlans() {
  const existing = db.prepare('SELECT COUNT(*) as count FROM production_plan').get() as { count: number };
  if (existing.count > 0) return;

  const project = (db
    .prepare("SELECT id FROM project_case WHERE lower(name) LIKE '%mic%' ORDER BY source_seq, id LIMIT 1")
    .get() as { id: string } | undefined) ??
    (db.prepare('SELECT id FROM project_case ORDER BY source_seq, id LIMIT 1').get() as { id: string } | undefined);
  const projectCaseId = project?.id ?? null;
  const caseItem = projectCaseId
    ? ((db
        .prepare("SELECT id FROM case_item WHERE project_case_id = ? AND (lower(name) LIKE '%m1%' OR source_row IS NOT NULL) ORDER BY source_row, id LIMIT 1")
        .get(projectCaseId) as { id: string } | undefined) ??
      (db.prepare('SELECT id FROM case_item WHERE project_case_id = ? ORDER BY source_row, id LIMIT 1').get(projectCaseId) as { id: string } | undefined))
    : undefined;
  const caseItemId = caseItem?.id ?? null;
  const productionTask = projectCaseId && caseItemId
    ? db
        .prepare("SELECT id FROM case_task WHERE project_case_id = ? AND case_item_id = ? AND task_type = 'production' LIMIT 1")
        .get(projectCaseId, caseItemId) as { id: string } | undefined
    : undefined;
  const deliveryTask = projectCaseId && caseItemId
    ? db
        .prepare("SELECT id FROM case_task WHERE project_case_id = ? AND case_item_id = ? AND task_type = 'delivery' LIMIT 1")
        .get(projectCaseId, caseItemId) as { id: string } | undefined
    : undefined;

  insertMany('production_plan', [
    {
      id: 'PP-202604-production',
      department_id: 'dept-production',
      plan_month: '2026-04',
      name: '生产部 2026年04月排产',
      status: 'published',
      start_date: '2026-04-01',
      end_date: '2026-04-30',
      source_sheet: 'MIC项目M1和M1H生产计划表',
      created_at: new Date().toISOString()
    }
  ]);

  const taskRows = [
    ['底模1+2拼装完毕', '2026-04-10', '2026-04-30', 'production'],
    ['外侧模1装焊完毕', '2026-04-10', '2026-04-30', 'production'],
    ['外侧模2装焊完毕', '2026-04-10', '2026-04-15', 'production'],
    ['外侧模3装焊完毕', '2026-04-10', '2026-04-15', 'production'],
    ['外侧模4装焊完毕', '2026-04-10', '2026-04-15', 'production'],
    ['外模所有支架装焊完毕', '2026-04-10', '2026-04-15', 'production'],
    ['外模总拼装及出铁孔嵌补板补料配齐', '2026-04-10', '2026-04-15', 'production'],
    ['内顶模装焊完毕', '2026-04-10', '2026-04-15', 'production'],
    ['内侧模1装焊完毕', '2026-04-10', '2026-04-15', 'production'],
    ['内侧模2装焊完毕', '2026-04-10', '2026-04-15', 'production'],
    ['内侧模3装焊完毕', '2026-04-10', '2026-04-15', 'production'],
    ['内侧模4装焊完毕', '2026-04-10', '2026-04-15', 'production'],
    ['内模顶、底模块拼装焊接完毕', '2026-04-10', '2026-04-15', 'production'],
    ['内模所有构件总拼装完毕', '2026-04-10', '2026-04-15', 'production'],
    ['内外模总装后顶部预埋装焊完毕', '2026-04-10', '2026-04-15', 'production'],
    ['整体验收出货', '2026-04-10', '2026-04-20', 'delivery']
  ] as Array<[string, string, string, string]>;

  insertMany('production_plan_item', taskRows.map((row, index) => ({
    id: `PPI-202604-${String(index + 1).padStart(2, '0')}`,
    production_plan_id: 'PP-202604-production',
    project_case_id: projectCaseId,
    case_item_id: caseItemId,
    case_task_id: row[3] === 'delivery' ? deliveryTask?.id ?? null : productionTask?.id ?? null,
    task_type: row[3],
    name: row[0],
    sort_order: index + 1,
    planned_start_date: row[1],
    planned_end_date: row[2],
    assigned_team_id: 'team-2',
    progress: 0,
    status: 'planned',
    remark: '',
    source_row: 6 + index * 3
  })));
}

function migrateWorkflowModel() {
  insertMany('task_template', [
    { id: 'tt-painting', case_template_id: 'tpl-steel-v1', name: '喷涂', task_type: 'painting', sort_order: 50, generation_scope: 'item', default_owner_department_id: 'dept-production', progress_rule: 'average', required: 1, skippable: 0 }
  ]);
  insertMany('subtask_template', [
    { id: 'st-drawing-review', task_template_id: 'tt-design', name: '图纸定审', sort_order: 10, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-delivery-plan', task_template_id: 'tt-delivery', name: '发货计划', sort_order: 10, progress_rule: 'manual', required: 1, skippable: 0 },
    { id: 'st-delivery-execute', task_template_id: 'tt-delivery', name: '发货执行', sort_order: 20, progress_rule: 'manual', required: 1, skippable: 0 }
  ]);

  const tx = db.transaction(() => {
    db.prepare("UPDATE task_template SET name = '设计', task_type = 'design', sort_order = 10, generation_scope = 'case', progress_rule = 'average' WHERE id = 'tt-design'").run();
    db.prepare("UPDATE subtask_template SET name = '图纸定审', sort_order = 10 WHERE id = 'st-drawing-review'").run();
    db.prepare("UPDATE task_template SET sort_order = 20 WHERE id = 'tt-material'").run();
    db.prepare("UPDATE task_template SET name = '下料', sort_order = 30 WHERE id = 'tt-cutting'").run();
    db.prepare("UPDATE task_template SET name = '装焊', sort_order = 40 WHERE id = 'tt-production'").run();
    db.prepare("UPDATE task_template SET name = '喷涂', task_type = 'painting', sort_order = 50, generation_scope = 'item', progress_rule = 'average' WHERE id = 'tt-painting'").run();
    db.prepare("UPDATE task_template SET sort_order = 60 WHERE id = 'tt-inspection'").run();
    db.prepare("UPDATE task_template SET sort_order = 70, progress_rule = 'average' WHERE id = 'tt-delivery'").run();
    db.prepare("UPDATE subtask_template SET task_template_id = 'tt-painting', name = '喷涂作业', sort_order = 10, required = 1, skippable = 0 WHERE id = 'st-painting'").run();

    migrateDesignTasks();
    migratePaintingTasks();
    migrateDeliveryTasks();
    purgeDesignConfirmData();
    recalculateImportedProgress();

    db.prepare("DELETE FROM task_template WHERE id = 'tt-drawing' AND NOT EXISTS (SELECT 1 FROM case_task WHERE task_template_id = 'tt-drawing')").run();
  });
  tx();
}

function migrateDesignTasks() {
  const projects = db.prepare('SELECT id, design_owner_id FROM project_case').all() as Array<{ id: string; design_owner_id: string | null }>;
  for (const project of projects) {
    let designTask = db
      .prepare("SELECT * FROM case_task WHERE project_case_id = ? AND case_item_id IS NULL AND task_type = 'design' LIMIT 1")
      .get(project.id) as { id: string; progress: number; assignee_id: string | null } | undefined;
    const drawingTask = db
      .prepare("SELECT * FROM case_task WHERE project_case_id = ? AND case_item_id IS NULL AND task_type = 'drawing_review' LIMIT 1")
      .get(project.id) as { id: string; progress: number } | undefined;
    const existingDrawingSubtask = db
      .prepare(
        `SELECT s.progress
         FROM case_subtask s
         JOIN case_task t ON t.id = s.case_task_id
         WHERE t.project_case_id = ? AND t.case_item_id IS NULL
           AND s.subtask_template_id = 'st-drawing-review'
         LIMIT 1`
      )
      .get(project.id) as { progress: number } | undefined;

    if (!designTask) {
      const taskId = `TASK-${project.id}-design`;
      db.prepare(
        `INSERT INTO case_task
         (id, project_case_id, case_item_id, task_template_id, name, task_type, owner_department_id, assignee_id, team_id, status, progress, is_delayed, is_applicable, include_in_progress, source_row, source_column, raw_import_value, remark)
         VALUES (?, ?, null, 'tt-design', '设计', 'design', 'dept-design', ?, null, 'not_started', 0, 0, 1, 1, null, 'E', '', '')`
      ).run(taskId, project.id, project.design_owner_id);
      designTask = { id: taskId, progress: 0, assignee_id: project.design_owner_id };
    }

    const drawingProgress = existingDrawingSubtask?.progress ?? drawingTask?.progress ?? 0;
    upsertMigratedSubtask({
      id: `SUB-${project.id}-st-drawing-review`,
      taskId: designTask.id,
      templateId: 'st-drawing-review',
      name: '图纸定审',
      sortOrder: 10,
      assigneeId: designTask.assignee_id ?? project.design_owner_id,
      progress: drawingProgress,
      sourceColumn: 'F',
      rawValue: ''
    });

    if (drawingTask && drawingTask.id !== designTask.id) {
      db.prepare('UPDATE work_log_entry SET case_task_id = ? WHERE case_task_id = ?').run(designTask.id, drawingTask.id);
      db.prepare('UPDATE exception_record SET case_task_id = ? WHERE case_task_id = ?').run(designTask.id, drawingTask.id);
      db.prepare("UPDATE progress_log SET target_id = ? WHERE target_type = 'task' AND target_id = ?").run(designTask.id, drawingTask.id);
      db.prepare('UPDATE case_subtask SET case_task_id = ? WHERE case_task_id = ?').run(designTask.id, drawingTask.id);
      db.prepare('DELETE FROM case_task WHERE id = ?').run(drawingTask.id);
    }

    updateTaskProgress(designTask.id, drawingProgress);
    db.prepare(
      `UPDATE case_task
       SET task_template_id = 'tt-design', name = '设计', task_type = 'design',
           owner_department_id = 'dept-design', assignee_id = ?
       WHERE id = ?`
    ).run(project.design_owner_id, designTask.id);
  }
}

function purgeDesignConfirmData() {
  const deprecatedSubtasks = db
    .prepare(
      `SELECT s.id, s.case_task_id, review.id as review_subtask_id
       FROM case_subtask s
       LEFT JOIN case_subtask review
         ON review.case_task_id = s.case_task_id
        AND review.subtask_template_id = 'st-drawing-review'
       WHERE s.subtask_template_id = 'st-design-confirm'
          OR s.name = '设计深化'`
    )
    .all() as Array<{ id: string; case_task_id: string; review_subtask_id: string | null }>;

  for (const subtask of deprecatedSubtasks) {
    db.prepare('UPDATE case_subtask SET parent_subtask_id = NULL WHERE parent_subtask_id = ?').run(subtask.id);
    if (subtask.review_subtask_id) {
      db.prepare('UPDATE work_log_entry SET case_subtask_id = ? WHERE case_subtask_id = ?').run(subtask.review_subtask_id, subtask.id);
      db.prepare('UPDATE exception_record SET case_subtask_id = ? WHERE case_subtask_id = ?').run(subtask.review_subtask_id, subtask.id);
      db.prepare("UPDATE progress_log SET target_id = ? WHERE target_type = 'subtask' AND target_id = ?").run(subtask.review_subtask_id, subtask.id);
    } else {
      db.prepare('UPDATE work_log_entry SET case_subtask_id = NULL WHERE case_subtask_id = ?').run(subtask.id);
      db.prepare('UPDATE exception_record SET case_subtask_id = NULL WHERE case_subtask_id = ?').run(subtask.id);
      db.prepare("DELETE FROM progress_log WHERE target_type = 'subtask' AND target_id = ?").run(subtask.id);
    }
    db.prepare('DELETE FROM case_subtask WHERE id = ?').run(subtask.id);
  }

  db.prepare("DELETE FROM subtask_template WHERE id = 'st-design-confirm' OR name = '设计深化'").run();
}

function migratePaintingTasks() {
  const items = db.prepare('SELECT id, project_case_id FROM case_item').all() as Array<{ id: string; project_case_id: string }>;
  for (const item of items) {
    const productionTask = db
      .prepare("SELECT * FROM case_task WHERE case_item_id = ? AND task_type = 'production' LIMIT 1")
      .get(item.id) as { id: string; assignee_id: string | null; team_id: string | null } | undefined;
    let paintingTask = db
      .prepare("SELECT * FROM case_task WHERE case_item_id = ? AND task_type = 'painting' LIMIT 1")
      .get(item.id) as { id: string } | undefined;
    const paintingSubtask = db
      .prepare(
        `SELECT s.id, s.progress
         FROM case_subtask s
         JOIN case_task t ON t.id = s.case_task_id
         WHERE t.case_item_id = ? AND s.subtask_template_id = 'st-painting'
         LIMIT 1`
      )
      .get(item.id) as { id: string; progress: number } | undefined;

    if (!paintingTask) {
      const taskId = `TASK-${item.id}-painting`;
      db.prepare(
        `INSERT INTO case_task
         (id, project_case_id, case_item_id, task_template_id, name, task_type, owner_department_id, assignee_id, team_id, status, progress, is_delayed, is_applicable, include_in_progress, source_row, source_column, raw_import_value, remark)
         VALUES (?, ?, ?, 'tt-painting', '喷涂', 'painting', 'dept-production', ?, ?, 'not_started', 0, 0, 1, 1, null, 'Y', '', '')`
      ).run(taskId, item.project_case_id, item.id, productionTask?.assignee_id ?? null, productionTask?.team_id ?? null);
      paintingTask = { id: taskId };
    }

    const progress = paintingSubtask?.progress ?? 0;
    if (paintingSubtask) {
      db.prepare('UPDATE work_log_entry SET case_task_id = ? WHERE case_subtask_id = ?').run(paintingTask.id, paintingSubtask.id);
      db.prepare('UPDATE exception_record SET case_task_id = ? WHERE case_subtask_id = ?').run(paintingTask.id, paintingSubtask.id);
      db.prepare(
        `UPDATE case_subtask
         SET case_task_id = ?, name = '喷涂作业', sort_order = 10,
             assignee_id = ?, team_id = ?
         WHERE id = ?`
      ).run(paintingTask.id, productionTask?.assignee_id ?? null, productionTask?.team_id ?? null, paintingSubtask.id);
    } else {
      upsertMigratedSubtask({
        id: `SUB-${item.id}-st-painting`,
        taskId: paintingTask.id,
        templateId: 'st-painting',
        name: '喷涂作业',
        sortOrder: 10,
        assigneeId: productionTask?.assignee_id ?? null,
        teamId: productionTask?.team_id ?? null,
        progress,
        sourceColumn: 'Y',
        rawValue: ''
      });
    }
    updateTaskProgress(paintingTask.id, progress);

    if (productionTask) {
      const productionProgress = db
        .prepare('SELECT progress FROM case_subtask WHERE case_task_id = ? AND is_applicable = 1 AND include_in_progress = 1')
        .all(productionTask.id) as Array<{ progress: number }>;
      updateTaskProgress(productionTask.id, averageProgress(productionProgress.map((row) => row.progress)));
      db.prepare("UPDATE case_task SET name = '装焊', task_template_id = 'tt-production' WHERE id = ?").run(productionTask.id);
    }
  }
}

function migrateDeliveryTasks() {
  const items = db.prepare('SELECT id, project_case_id, delivery_date, delivery_status FROM case_item').all() as Array<{
    id: string;
    project_case_id: string;
    delivery_date: string | null;
    delivery_status: string | null;
  }>;
  for (const item of items) {
    let deliveryTask = db
      .prepare("SELECT id FROM case_task WHERE case_item_id = ? AND task_type = 'delivery' LIMIT 1")
      .get(item.id) as { id: string } | undefined;
    if (!deliveryTask) {
      const taskId = `TASK-${item.id}-delivery`;
      db.prepare(
        `INSERT INTO case_task
         (id, project_case_id, case_item_id, task_template_id, name, task_type, owner_department_id, assignee_id, team_id, status, progress, is_delayed, is_applicable, include_in_progress, source_row, source_column, raw_import_value, remark)
         VALUES (?, ?, ?, 'tt-delivery', '发货', 'delivery', 'dept-delivery', null, null, 'not_started', 0, 0, 1, 1, null, 'AE', '', '')`
      ).run(taskId, item.project_case_id, item.id);
      deliveryTask = { id: taskId };
    }

    const planProgress = item.delivery_date ? 100 : 0;
    const executeProgress = migratedDeliveryProgress(item.delivery_status ?? '');
    const existingPlan = db
      .prepare("SELECT progress FROM case_subtask WHERE case_task_id = ? AND subtask_template_id = 'st-delivery-plan'")
      .get(deliveryTask.id) as { progress: number } | undefined;
    const existingExecute = db
      .prepare("SELECT progress FROM case_subtask WHERE case_task_id = ? AND subtask_template_id = 'st-delivery-execute'")
      .get(deliveryTask.id) as { progress: number } | undefined;
    const effectivePlanProgress = existingPlan?.progress ?? planProgress;
    const effectiveExecuteProgress = existingExecute?.progress ?? executeProgress;
    upsertMigratedSubtask({
      id: `SUB-${item.id}-st-delivery-plan`,
      taskId: deliveryTask.id,
      templateId: 'st-delivery-plan',
      name: '发货计划',
      sortOrder: 10,
      progress: effectivePlanProgress,
      sourceColumn: 'AD',
      rawValue: item.delivery_date ?? ''
    });
    upsertMigratedSubtask({
      id: `SUB-${item.id}-st-delivery-execute`,
      taskId: deliveryTask.id,
      templateId: 'st-delivery-execute',
      name: '发货执行',
      sortOrder: 20,
      progress: effectiveExecuteProgress,
      sourceColumn: 'AE',
      rawValue: item.delivery_status ?? ''
    });
    updateTaskProgress(deliveryTask.id, averageProgress([effectivePlanProgress, effectiveExecuteProgress]));
  }
}

function upsertMigratedSubtask(input: {
  id: string;
  taskId: string;
  templateId: string;
  name: string;
  sortOrder: number;
  assigneeId?: string | null;
  teamId?: string | null;
  progress: number;
  sourceColumn: string;
  rawValue: string;
}) {
  const status = progressStatus(input.progress);
  db.prepare(
    `INSERT INTO case_subtask
     (id, case_task_id, subtask_template_id, parent_subtask_id, name, sort_order, assignee_id, team_id, status, progress, is_applicable, include_in_progress, source_column, raw_import_value, remark)
     VALUES (@id, @task_id, @template_id, null, @name, @sort_order, @assignee_id, @team_id, @status, @progress, 1, 1, @source_column, @raw_value, '')
     ON CONFLICT(id) DO UPDATE SET
       case_task_id = excluded.case_task_id,
       subtask_template_id = excluded.subtask_template_id,
       name = excluded.name,
       sort_order = excluded.sort_order,
       assignee_id = excluded.assignee_id,
       team_id = excluded.team_id,
       status = excluded.status,
       progress = excluded.progress,
       source_column = excluded.source_column,
       raw_import_value = excluded.raw_import_value`
  ).run({
    id: input.id,
    task_id: input.taskId,
    template_id: input.templateId,
    name: input.name,
    sort_order: input.sortOrder,
    assignee_id: input.assigneeId ?? null,
    team_id: input.teamId ?? null,
    status,
    progress: input.progress,
    source_column: input.sourceColumn,
    raw_value: input.rawValue
  });
}

function recalculateImportedProgress() {
  const items = db.prepare('SELECT id FROM case_item').all() as Array<{ id: string }>;
  for (const item of items) {
    const taskRows = db
      .prepare('SELECT progress FROM case_task WHERE case_item_id = ? AND is_applicable = 1 AND include_in_progress = 1')
      .all(item.id) as Array<{ progress: number }>;
    const progress = averageProgress(taskRows.map((row) => row.progress));
    db.prepare('UPDATE case_item SET progress = ?, status = ? WHERE id = ?').run(progress, progressStatus(progress), item.id);
  }

  const projects = db.prepare('SELECT id FROM project_case').all() as Array<{ id: string }>;
  for (const project of projects) {
    const caseTaskRows = db
      .prepare('SELECT progress FROM case_task WHERE project_case_id = ? AND case_item_id IS NULL AND is_applicable = 1 AND include_in_progress = 1')
      .all(project.id) as Array<{ progress: number }>;
    const itemRows = db.prepare('SELECT id FROM case_item WHERE project_case_id = ?').all(project.id) as Array<{ id: string }>;
    const rowProgress = itemRows.map((item) => {
      const itemTaskRows = db
        .prepare('SELECT progress FROM case_task WHERE case_item_id = ? AND is_applicable = 1 AND include_in_progress = 1')
        .all(item.id) as Array<{ progress: number }>;
      return averageProgress([...caseTaskRows, ...itemTaskRows].map((row) => row.progress));
    });
    const progress = rowProgress.length > 0 ? averageProgress(rowProgress) : averageProgress(caseTaskRows.map((row) => row.progress));
    db.prepare('UPDATE project_case SET total_progress = ?, status = ? WHERE id = ?').run(progress, progressStatus(progress), project.id);
  }
}

function updateTaskProgress(taskId: string, progress: number) {
  db.prepare('UPDATE case_task SET progress = ?, status = ? WHERE id = ?').run(progress, progressStatus(progress), taskId);
}

function averageProgress(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function progressStatus(progress: number) {
  return progress >= 100 ? 'completed' : progress > 0 ? 'in_progress' : 'not_started';
}

function migratedDeliveryProgress(status: string) {
  if (!status) return 0;
  if (status.includes('部分') || /已发\s*\d/.test(status)) return 50;
  if (status.includes('已出货') || status.includes('已完成') || status.includes('已发')) return 100;
  return 0;
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}
