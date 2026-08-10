import { apiDelete, apiGet, apiPatch, apiPost } from './api';

export type DesignEmployee = { id: string; name: string };
export type DesignWorkType = {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  enabled: number;
  created_at?: string;
  updated_at?: string;
};
export type DesignProject = {
  id: string;
  name: string;
  design_owner_id?: string | null;
  items: Array<{ id: string; name: string }>;
};
export type DesignWorkLookups = {
  current_user: {
    id: string;
    name: string;
    permission_level: string;
    is_design_employee: boolean;
    can_manage_records: boolean;
  };
  employees: DesignEmployee[];
  work_types: DesignWorkType[];
  projects: DesignProject[];
};
export type DesignWorkRecord = {
  id: string;
  employee_id: string;
  employee_name: string;
  project_case_id?: string | null;
  project_case_name?: string | null;
  work_type_id?: string | null;
  work_type_name?: string | null;
  association_scope: 'none' | 'project' | 'items';
  start_date: string;
  end_date: string;
  work_days?: number | null;
  work_content: string;
  source: 'manual' | 'excel_import';
  case_items: Array<{ id: string; name: string }>;
  editable: boolean;
  deletable: boolean;
};
export type DesignTimelineResponse = {
  start_date: string;
  end_date: string;
  employees: DesignEmployee[];
  records: DesignWorkRecord[];
};
export type DesignWorkPayload = {
  employee_id?: string;
  project_case_id?: string | null;
  work_type_id?: string | null;
  association_scope: 'none' | 'project' | 'items';
  case_item_ids?: string[];
  start_date: string;
  end_date: string;
  work_days?: number | null;
  work_content?: string;
  sync_progress?: boolean;
  progress?: number;
};

export const fetchDesignWorkLookups = () => apiGet<DesignWorkLookups>('/api/design-work/lookups');

export function fetchDesignTimeline(startDate: string, endDate: string, employeeId?: string) {
  const search = new URLSearchParams({ start_date: startDate, end_date: endDate });
  if (employeeId) search.set('employee_id', employeeId);
  return apiGet<DesignTimelineResponse>(`/api/design-work/timeline?${search.toString()}`);
}

export const createDesignWorkRecord = (payload: DesignWorkPayload) =>
  apiPost<{ id: string }>('/api/design-work/records', payload);

export const updateDesignWorkRecord = (id: string, payload: DesignWorkPayload) =>
  apiPatch<{ id: string }>(`/api/design-work/records/${encodeURIComponent(id)}`, payload);

export const deleteDesignWorkRecord = (id: string) =>
  apiDelete<{ ok: boolean }>(`/api/design-work/records/${encodeURIComponent(id)}`);

export const fetchDesignWorkTypes = () => apiGet<DesignWorkType[]>('/api/admin/design-work-types');
export const createDesignWorkType = (payload: { name: string; sort_order?: number; enabled?: boolean }) =>
  apiPost<{ id: string }>('/api/admin/design-work-types', payload);
export const updateDesignWorkType = (id: string, payload: { name?: string; sort_order?: number; enabled?: boolean }) =>
  apiPatch<{ id: string }>(`/api/admin/design-work-types/${encodeURIComponent(id)}`, payload);
