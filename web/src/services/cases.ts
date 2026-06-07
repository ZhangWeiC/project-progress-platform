import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from './api';
import type { ExceptionRecord, ImportTaskPreview, LookupResponse, MatrixResponse, ProjectCase, TaskDetails, WorkflowTemplate, WorkbenchResponse, WorkbenchTask, WorkLogEntry } from '../types';

export const fetchCases = () => apiGet<ProjectCase[]>('/api/cases');

export type ProjectCasePayload = {
  code?: string | null;
  name: string;
  category?: string | null;
  customer_name?: string | null;
  business_owner_id?: string | null;
  design_owner_id?: string | null;
  estimated_weight?: number | null;
  delivery_date?: string | null;
  delivery_status?: string | null;
  items?: Array<{ id?: string | null; name: string; delivery_date?: string | null; delivery_status?: string | null }>;
  stage_owners?: Array<{ task_type: string; assignee_id?: string | null; team_id?: string | null }>;
};

export const createProjectCase = (payload: ProjectCasePayload) =>
  apiPost<ProjectCase>('/api/cases', payload);

export const fetchProjectCaseManageProfile = (caseId: string) =>
  apiGet<ProjectCase>(`/api/cases/${caseId}/manage-profile`);

export const updateProjectCase = (caseId: string, payload: ProjectCasePayload) =>
  apiPatch<ProjectCase>(`/api/cases/${caseId}`, payload);

export type DeliveryInfoPayload = {
  project_case_id: string;
  case_item_id?: string | null;
  delivery_date?: string | null;
  delivery_status?: string | null;
};

export const updateDeliveryInfo = (payload: DeliveryInfoPayload) =>
  apiPatch<{ ok: boolean }>('/api/delivery-info', payload);

export const deleteProjectCase = (caseId: string) =>
  apiDelete<{ ok: boolean }>(`/api/cases/${caseId}`);

export const fetchAllMatrix = () => apiGet<MatrixResponse>('/api/cases/matrix');

export const fetchCaseMatrix = (caseId: string) => apiGet<MatrixResponse>(`/api/cases/${caseId}/matrix`);

export const fetchTaskDetails = (taskId: string) => apiGet<TaskDetails>(`/api/tasks/${taskId}`);

export const updateSubtaskProgress = (subtaskId: string, progress: number) =>
  apiPatch<TaskDetails>(`/api/subtasks/${subtaskId}/progress`, { progress });

export const updateTaskProgress = (taskId: string, progress: number) =>
  apiPatch<TaskDetails>(`/api/tasks/${taskId}/progress`, { progress });

export const fetchLookups = () => apiGet<LookupResponse>('/api/lookups');

export const createWorkLog = (payload: Partial<WorkLogEntry> & Record<string, unknown>) =>
  apiPost<{ ok: boolean }>('/api/work-logs', payload);

export const fetchWorkLogs = () => apiGet<WorkLogEntry[]>('/api/work-logs');

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

export const uploadImportTask = (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  return apiUpload<ImportTaskPreview>('/api/import-tasks', formData);
};

export const fetchImportPreview = (importTaskId: string) =>
  apiGet<ImportTaskPreview>(`/api/import-tasks/${importTaskId}/preview`);

export const confirmImportTask = (importTaskId: string) =>
  apiPost<{ ok: boolean; imported_cases: number; imported_items: number }>(`/api/import-tasks/${importTaskId}/confirm`, {});
