import { apiGet } from './api';
import type { WorkSummaryReport } from '../types';

export type WorkSummaryReportFilters = {
  period?: 'week' | 'month';
  start_date?: string;
  end_date?: string;
  department_id?: string;
  team_id?: string;
  project_case_id?: string;
};

export const fetchWorkSummaryReport = (filters: WorkSummaryReportFilters) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return apiGet<WorkSummaryReport>(`/api/reports/work-summary${query ? `?${query}` : ''}`);
};
