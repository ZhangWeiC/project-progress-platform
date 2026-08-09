import { apiDelete, apiGet, apiPatch, apiPost } from './api';
import type { ExceptionRecord, LookupResponse, MatrixResponse, ProgressLogResponse, ProjectCase, ProjectMonthOrderResponse, TaskDetails, WorkflowTemplate, WorkbenchResponse, WorkbenchTask, WorkLogEntry, WorkLogPlanItem } from '../types';

export const fetchCases = () => apiGet<ProjectCase[]>('/api/cases');

export type ProjectCasePayload = {
  name: string;
  category?: string | null;
  customer_name?: string | null;
  business_owner_id?: string | null;
  business_owner_department_id?: string | null;
  design_owner_id?: string | null;
  design_owner_department_id?: string | null;
  estimated_weight?: number | null;
  delivery_date?: string | null;
  delivery_status?: string | null;
  delivery_remark?: string | null;
  associated_month?: string | null;
  items?: Array<{ id?: string | null; name: string; delivery_date?: string | null; delivery_status?: string | null; delivery_remark?: string | null }>;
  stage_owners?: Array<{ task_type: string; assignee_id?: string | null; team_id?: string | null; department_id?: string | null }>;
};

export const createProjectCase = (payload: ProjectCasePayload) =>
  apiPost<ProjectCase>('/api/cases', payload);

export const fetchProjectCaseManageProfile = (caseId: string) =>
  apiGet<ProjectCase>(`/api/cases/${caseId}/manage-profile`);

export const updateProjectCase = (caseId: string, payload: ProjectCasePayload) =>
  apiPatch<ProjectCase>(`/api/cases/${caseId}`, payload);

export const fetchProjectMonthOrder = () => apiGet<ProjectMonthOrderResponse>('/api/cases/month-order');

export const updateProjectMonthOrder = (payload: { associated_month?: string | null; project_ids: string[] }) =>
  apiPatch<{ ok: boolean; updated_count: number }>('/api/cases/month-order', payload);

export type DeliveryInfoPayload = {
  project_case_id: string;
  case_item_id?: string | null;
  delivery_date?: string | null;
  delivery_status?: string | null;
  delivery_remark?: string | null;
};

export const updateDeliveryInfo = (payload: DeliveryInfoPayload) =>
  apiPatch<{ ok: boolean; updated_count?: number }>('/api/delivery-info', payload);

export const deleteProjectCase = (caseId: string) =>
  apiDelete<{ ok: boolean }>(`/api/cases/${caseId}`);

export const deleteProjectCaseItem = (caseId: string, itemId: string) =>
  apiDelete<{ ok: boolean }>(`/api/cases/${caseId}/items/${itemId}`);

export type MatrixQueryParams = {
  page?: number;
  page_size?: number;
  keyword?: string;
  delivery_status?: string | string[];
};

export const fetchAllMatrix = (params: MatrixQueryParams = {}) => {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.page_size) search.set('page_size', String(params.page_size));
  if (params.keyword?.trim()) search.set('keyword', params.keyword.trim());
  const deliveryStatus = Array.isArray(params.delivery_status) ? params.delivery_status.join(',') : params.delivery_status;
  if (deliveryStatus) search.set('delivery_status', deliveryStatus);
  const query = search.toString();
  return apiGet<MatrixResponse>(`/api/cases/matrix${query ? `?${query}` : ''}`);
};

export const fetchCaseMatrix = (caseId: string) => apiGet<MatrixResponse>(`/api/cases/${caseId}/matrix`);

export const fetchTaskDetails = (taskId: string) => apiGet<TaskDetails>(`/api/tasks/${taskId}`);

export type ProgressLogQueryParams = {
  page?: number;
  page_size?: number;
  case_item_id?: string;
  task_type?: string;
  changed_by?: string;
  start_at?: string;
  end_at?: string;
};

function progressLogQuery(params: ProgressLogQueryParams) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const fetchProjectProgressLogs = (caseId: string, params: ProgressLogQueryParams = {}) =>
  apiGet<ProgressLogResponse>(`/api/cases/${caseId}/progress-logs${progressLogQuery(params)}`);

export const fetchTaskProgressLogs = (taskId: string, params: ProgressLogQueryParams = {}) =>
  apiGet<ProgressLogResponse>(`/api/tasks/${taskId}/progress-logs${progressLogQuery(params)}`);

export const updateSubtaskProgress = (subtaskId: string, progress: number) =>
  apiPatch<TaskDetails>(`/api/subtasks/${subtaskId}/progress`, { progress });

export const updateTaskProgress = (taskId: string, progress: number) =>
  apiPatch<TaskDetails>(`/api/tasks/${taskId}/progress`, { progress });

export const updateProjectBulkSubtaskProgress = (caseId: string, subtaskTemplateId: string, progress: number) =>
  apiPatch<{ ok: boolean; updated_count: number; progress: number }>(`/api/cases/${caseId}/bulk-subtask-progress`, {
    subtask_template_id: subtaskTemplateId,
    progress
  });

export const fetchLookups = () => apiGet<LookupResponse>('/api/lookups');

export const createWorkLog = (payload: Partial<WorkLogEntry> & Record<string, unknown>) =>
  apiPost<{ ok: boolean }>('/api/work-logs', payload);

export const fetchWorkLogs = () => apiGet<WorkLogEntry[]>('/api/work-logs');

export type WorkLogPlanItemFilters = {
  work_date?: string;
  team_id?: string;
  project_case_id?: string;
  department_id?: string;
};

export const fetchWorkLogPlanItems = (filters: WorkLogPlanItemFilters) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return apiGet<WorkLogPlanItem[]>(`/api/work-log-plan-items${query ? `?${query}` : ''}`);
};

export const fetchExceptions = () => apiGet<ExceptionRecord[]>('/api/exceptions');

export const createException = (payload: Record<string, unknown>) =>
  apiPost<{ id: string }>('/api/exceptions', payload);

export const patchException = (exceptionId: string, payload: Record<string, unknown>) =>
  apiPatch<{ ok: boolean }>(`/api/exceptions/${exceptionId}`, payload);

export const fetchWorkbench = () =>
  apiGet<WorkbenchResponse>('/api/me/workbench');

export const fetchMyTasks = () => apiGet<WorkbenchTask[]>('/api/me/tasks');

export const fetchMyExceptions = () => apiGet<ExceptionRecord[]>('/api/me/exceptions');

export const fetchWorkflowTemplate = () => apiGet<WorkflowTemplate>('/api/workflow-template');

export const updateWorkflowStageRequirement = (stageId: string, required: boolean) =>
  apiPatch<{ ok: boolean; id: string; required: boolean; skippable: boolean; updated_item_count: number }>(
    `/api/workflow-template/stages/${encodeURIComponent(stageId)}`,
    { required }
  );
