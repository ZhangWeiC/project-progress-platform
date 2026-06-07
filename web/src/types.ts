export type MatrixColumn = {
  key: string;
  title: string;
  group?: string;
  frozen?: boolean | 'left' | 'right';
  taskType?: string;
  groupIndex?: number;
};

export type MatrixCell = {
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

export type MatrixRow = {
  row_id?: string;
  row_type?: 'project' | 'item';
  project_case_id: string;
  case_item_id: string;
  item_progress: number;
  cells: Record<string, MatrixCell>;
  open_exception_count: number;
  children?: MatrixRow[];
};

export type MatrixResponse = {
  projectCase?: ProjectCase;
  columns: MatrixColumn[];
  rows: MatrixRow[];
  summary?: {
    project_count: number;
    item_count: number;
    open_exception_count: number;
  };
};

export type ProjectCase = {
  id: string;
  code?: string | null;
  name: string;
  category?: string | null;
  customer_name?: string | null;
  business_owner_id?: string | null;
  design_owner_id?: string | null;
  estimated_weight?: number | null;
  status: string;
  total_progress: number;
  business_owner_name?: string;
  design_owner_name?: string;
  delivery_date?: string | null;
  delivery_status?: string;
  open_exception_count?: number;
  items?: ProjectCaseItem[];
  stage_owners?: ProjectStageOwner[];
};

export type ProjectCaseItem = {
  id: string;
  name: string;
  progress?: number;
  status?: string;
  source_row?: number | null;
};

export type ProjectStageOwner = {
  task_type: string;
  task_name: string;
  generation_scope: 'case' | 'item';
  sort_order: number;
  owner_department_name?: string | null;
  assignee_id?: string | null;
  assignee_name?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  mixed?: boolean;
};

export type CaseTask = {
  id: string;
  project_case_id: string;
  case_item_id?: string | null;
  name: string;
  task_type: string;
  status: string;
  progress: number;
  assignee_name?: string;
  team_name?: string;
  department_name?: string;
  case_name?: string;
  item_name?: string;
  open_exception_count?: number;
};

export type CaseSubTask = {
  id: string;
  case_task_id: string;
  name: string;
  progress: number;
  status: string;
  completed_quantity?: number | null;
  planned_quantity?: number | null;
  quantity_unit?: string | null;
  assignee_name?: string;
  team_name?: string;
  editable?: boolean;
};

export type WorkLogEntry = {
  id: string;
  project_case_id: string;
  case_item_id?: string | null;
  case_task_id: string;
  case_subtask_id?: string | null;
  case_name?: string;
  item_name?: string;
  task_name?: string;
  subtask_name?: string;
  actual_employee_id: string;
  actual_employee_name?: string;
  input_by_name?: string;
  work_date: string;
  hours: number;
  work_content: string;
  output_note?: string;
  quantity?: number | null;
  unit?: string | null;
};

export type ExceptionRecord = {
  id: string;
  title: string;
  type: string;
  level: string;
  status: string;
  description: string;
  case_name?: string;
  item_name?: string;
  task_name?: string;
  subtask_name?: string;
  current_handler_name?: string;
  responsible_department_name?: string;
  updated_at?: string;
};

export type TaskDetails = {
  task: CaseTask;
  subtasks: CaseSubTask[];
  workLogs: WorkLogEntry[];
  exceptions: ExceptionRecord[];
  progressLogs: Array<{
    id: string;
    before_progress: number;
    after_progress: number;
    changed_by_name?: string;
    created_at: string;
  }>;
};

export type LookupResponse = {
  employees: Array<{ id: string; name: string; role: string; permission_level?: string; department_id?: string }>;
  departments: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; leader_id?: string }>;
};

export type WorkbenchTask = CaseTask & {
  is_delayed?: number | boolean | null;
};

export type WorkbenchResponse = {
  user: { id: string; name: string; role: string };
  counts: { tasks: number; exceptions: number; overdue: number };
  tasks: WorkbenchTask[];
  exceptions: ExceptionRecord[];
};

export type ImportIssue = {
  source_sheet: string;
  source_row: number;
  source_column: string;
  field_name: string;
  raw_value: string;
  issue_type: string;
  suggestion: string;
};

export type ImportPreviewRow = {
  source_row: number;
  project_name: string;
  item_name: string;
  item_progress: number;
  delivery_date: string;
  delivery_status: string;
};

export type ImportTaskPreview = {
  id: string;
  file_name: string;
  status: string;
  source_sheet: string;
  total_rows: number;
  parsed_cases: number;
  parsed_items: number;
  issue_count: number;
  preview_rows: ImportPreviewRow[];
  issues: ImportIssue[];
};

export type WorkflowSubprocess = {
  id: string;
  name: string;
  sort_order: number;
  progress_rule: string;
  required: number;
  skippable: number;
};

export type WorkflowStage = {
  id: string;
  name: string;
  task_type: string;
  sort_order: number;
  generation_scope: 'case' | 'item';
  owner_department_name?: string;
  progress_rule: string;
  subprocesses: WorkflowSubprocess[];
};

export type WorkflowTemplate = {
  id: string;
  name: string;
  version: string;
  status: string;
  description?: string;
  stages: WorkflowStage[];
};
