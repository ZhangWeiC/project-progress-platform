import { apiDelete, apiGet, apiPatch, apiPost } from './api';
import type { ProductionPlanBoardResponse } from '../types';

export type ProductionPlanBoardFilters = {
  department_id?: string;
  month?: string;
  project_case_id?: string;
  team_id?: string;
};

export const fetchProductionPlanBoard = (filters: ProductionPlanBoardFilters) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return apiGet<ProductionPlanBoardResponse>(`/api/production-plans/board${query ? `?${query}` : ''}`);
};

export type ProductionPlanItemPayload = {
  department_id?: string;
  month?: string;
  case_task_id?: string;
  name?: string;
  planned_start_date?: string;
  planned_end_date?: string;
  assigned_team_id?: string | null;
  progress?: number;
  status?: string;
  remark?: string;
};

export const createProductionPlanItem = (payload: ProductionPlanItemPayload & { case_task_id: string; planned_start_date: string; planned_end_date: string }) =>
  apiPost<{ ok: boolean }>('/api/production-plans/items', payload);

export const updateProductionPlanItem = (itemId: string, payload: ProductionPlanItemPayload) =>
  apiPatch<{ ok: boolean }>(`/api/production-plans/items/${itemId}`, payload);

export const deleteProductionPlanItem = (itemId: string) =>
  apiDelete<{ ok: boolean }>(`/api/production-plans/items/${itemId}`);
