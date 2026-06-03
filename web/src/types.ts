export type MatrixColumn = {
  key: string;
  title: string;
  group?: string;
  frozen?: boolean;
  taskType?: string;
};

export type MatrixCell = {
  value: string | number | null;
  status?: string;
  editable?: boolean;
  targetType?: 'task' | 'subtask';
  targetId?: string;
  taskId?: string;
};

export type MatrixRow = {
  project_case_id: string;
  case_item_id: string;
  item_progress: number;
  cells: Record<string, MatrixCell>;
  open_exception_count: number;
};

export type MatrixResponse = {
  projectCase: ProjectCase;
  columns: MatrixColumn[];
  rows: MatrixRow[];
};

export type ProjectCase = {
  id: string;
  name: string;
  status: string;
  total_progress: number;
  business_owner_name?: string;
  design_owner_name?: string;
  delivery_status?: string;
  open_exception_count?: number;
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
  employees: Array<{ id: string; name: string; role: string; department_id?: string }>;
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
