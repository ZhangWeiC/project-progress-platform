import { apiGet, apiPatch, apiPost } from './api';
import type { ExceptionRecord, LookupResponse, MatrixResponse, ProjectCase, TaskDetails, WorkLogEntry } from '../types';

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
  apiGet<{
    user: { id: string; name: string; role: string };
    counts: { tasks: number; exceptions: number; overdue: number };
    tasks: Array<Record<string, unknown>>;
    exceptions: Array<Record<string, unknown>>;
  }>('/api/me/workbench');

export const fetchMyTasks = () => apiGet<Array<Record<string, unknown>>>('/api/me/tasks');

export const fetchMyExceptions = () => apiGet<ExceptionRecord[]>('/api/me/exceptions');
