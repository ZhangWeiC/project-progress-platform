import { apiGet, apiPatch, apiPost } from './api';
import type { ExceptionRecord, LookupResponse, MatrixResponse, ProjectCase, TaskDetails, WorkbenchResponse, WorkbenchTask, WorkLogEntry } from '../types';

export const fetchCases = () => apiGet<ProjectCase[]>('/api/cases');

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
