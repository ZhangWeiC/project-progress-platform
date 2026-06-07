import { apiGet } from './api';
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
