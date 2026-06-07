import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, makeId, nowIso } from './db.js';
import { createSession } from './auth.js';
import type { CurrentUser } from './services.js';

const FEISHU_API_BASE = process.env.FEISHU_API_BASE ?? 'https://open.feishu.cn/open-apis';
const FEISHU_AUTHORIZE_URL = process.env.FEISHU_AUTHORIZE_URL ?? 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
const FEISHU_DEFAULT_ROLE = process.env.FEISHU_DEFAULT_ROLE ?? 'worker';
const FEISHU_ROOT_DEPARTMENT_ID = process.env.FEISHU_ROOT_DEPARTMENT_ID ?? '0';
const FEISHU_OAUTH_SCOPE = process.env.FEISHU_OAUTH_SCOPE ?? 'auth:user.id:read user_profile';

let tenantTokenCache: { token: string; expiresAt: number } | null = null;

type FeishuApiResponse<T> = {
  code?: number;
  msg?: string;
  data?: T;
} & T;

type FeishuDepartment = {
  department_id?: string;
  open_department_id?: string;
  name?: string;
  i18n_name?: { zh_cn?: string; en_us?: string };
  parent_department_id?: string;
  leader_user_id?: string;
  status?: string | { is_deleted?: boolean };
};

type FeishuUser = {
  open_id?: string;
  union_id?: string;
  user_id?: string;
  name?: string;
  en_name?: string;
  nickname?: string;
  email?: string;
  enterprise_email?: string;
  mobile?: string;
  avatar_url?: string;
  avatar?: { avatar_72?: string; avatar_240?: string; avatar_origin?: string };
  department_ids?: string[];
  departments?: string[];
  status?: { is_resigned?: boolean; is_activated?: boolean; is_exited?: boolean };
  orders?: Array<{ department_id?: string; is_primary_dept?: boolean }>;
};

type PageResponse<T> = {
  items?: T[];
  has_more?: boolean;
  page_token?: string;
};

type SyncStats = {
  departments_created: number;
  departments_updated: number;
  employees_created: number;
  employees_updated: number;
  employees_deactivated: number;
  started_at: string;
  finished_at: string;
};

type LocalEmployee = {
  id: string;
  name: string;
  role: string;
  permission_level: string;
  department_id: string | null;
};

type FeishuOAuthUser = {
  open_id?: string;
  union_id?: string;
  user_id?: string;
  name?: string;
  email?: string;
  enterprise_email?: string;
  mobile?: string;
  avatar_url?: string;
  avatar_thumb?: string;
  avatar_middle?: string;
  avatar_big?: string;
  avatar?: { avatar_72?: string; avatar_240?: string; avatar_origin?: string };
};

export function getFeishuStatus() {
  const configured = Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.FEISHU_REDIRECT_URI);
  const lastSyncedAt = db.prepare('SELECT MAX(last_feishu_sync_at) as value FROM employee').get() as { value: string | null };
  const linkedEmployees = db.prepare('SELECT COUNT(*) as count FROM employee WHERE feishu_open_id IS NOT NULL OR feishu_union_id IS NOT NULL OR feishu_user_id IS NOT NULL').get() as { count: number };
  const linkedDepartments = db.prepare('SELECT COUNT(*) as count FROM department WHERE feishu_open_department_id IS NOT NULL OR feishu_department_id IS NOT NULL').get() as { count: number };
  return {
    configured,
    redirect_uri: process.env.FEISHU_REDIRECT_URI ?? '',
    root_department_id: FEISHU_ROOT_DEPARTMENT_ID,
    linked_employees: linkedEmployees.count,
    linked_departments: linkedDepartments.count,
    last_synced_at: lastSyncedAt.value
  };
}

export function getFeishuContactsByDepartment() {
  const departments = db.prepare(
    `SELECT d.id, d.name, d.parent_department_id, d.feishu_open_department_id, d.status,
            COUNT(ed.employee_id) as employee_count
     FROM department d
     LEFT JOIN employee_department ed ON ed.department_id = d.id
     WHERE d.status IS NULL OR d.status != 'deleted'
     GROUP BY d.id
     ORDER BY d.name`
  ).all() as Array<{ id: string; name: string; parent_department_id: string | null; feishu_open_department_id: string | null; status: string | null; employee_count: number }>;

  const employees = db.prepare(
    `SELECT e.id, e.name, e.role, e.department_id, e.feishu_open_id, e.is_active,
            ed.department_id as group_department_id, ed.is_primary
     FROM employee e
     LEFT JOIN employee_department ed ON ed.employee_id = e.id
     WHERE COALESCE(e.is_active, 1) = 1
     ORDER BY e.name`
  ).all() as Array<{ id: string; name: string; role: string; department_id: string | null; feishu_open_id: string | null; is_active: number; group_department_id: string | null; is_primary: number | null }>;

  const departmentRows = departments.map((department) => ({
    ...department,
    employees: employees.filter((employee) => (employee.group_department_id ?? employee.department_id) === department.id)
  }));
  const assignedIds = new Set(departmentRows.flatMap((department) => department.employees.map((employee) => employee.id)));
  const unassigned = employees.filter((employee) => !assignedIds.has(employee.id));
  return {
    departments: departmentRows,
    unassigned
  };
}

export function buildFeishuAuthorizeUrl(redirectPath: string) {
  const config = requireFeishuConfig();
  const state = signState({ redirect: safeRedirectPath(redirectPath), ts: Date.now() });
  const url = new URL(FEISHU_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.redirectUri);
  if (FEISHU_OAUTH_SCOPE.trim()) url.searchParams.set('scope', FEISHU_OAUTH_SCOPE.trim());
  url.searchParams.set('state', state);
  return { authorization_url: url.toString() };
}

export async function loginWithFeishuCode(code: string, state: string) {
  const parsedState = verifyState(state);
  const tokenInfo = await exchangeCodeForUserAccessToken(code);
  const userInfo = await fetchFeishuUserInfo(tokenInfo.access_token).catch(() => tokenInfo.user);
  const employee = upsertEmployeeFromFeishu(userInfo);
  if (!employee) {
    const err = new Error('无法识别飞书用户信息');
    err.name = 'AUTH_INVALID';
    throw err;
  }
  return {
    ...createSession({ id: employee.id, name: employee.name, role: employee.role, permission_level: employee.permission_level }),
    redirect: safeRedirectPath(parsedState.redirect)
  };
}

export async function syncFeishuContacts(currentUser: CurrentUser): Promise<SyncStats> {
  if (currentUser.role !== 'admin') {
    const err = new Error('仅管理员可同步飞书通讯录');
    err.name = 'PERMISSION_DENIED';
    throw err;
  }

  requireFeishuConfig();
  const startedAt = nowIso();
  const token = await getTenantAccessToken();
  const departments = await fetchAllDepartments(token);
  const stats: SyncStats = {
    departments_created: 0,
    departments_updated: 0,
    employees_created: 0,
    employees_updated: 0,
    employees_deactivated: 0,
    started_at: startedAt,
    finished_at: startedAt
  };
  const departmentIdMap = new Map<string, string>();

  for (const department of departments) {
    const result = upsertDepartment(department, startedAt);
    departmentIdMap.set(feishuDepartmentKey(department), result.id);
    if (result.created) stats.departments_created += 1;
    else stats.departments_updated += 1;
  }

  const seenEmployeeIds = new Set<string>();
  const syncDepartmentIds = departments.length > 0 ? departments.map(feishuDepartmentKey) : [FEISHU_ROOT_DEPARTMENT_ID];
  for (const departmentId of syncDepartmentIds) {
    const users = await fetchDepartmentUsers(token, departmentId);
    for (const user of users) {
      const result = upsertEmployeeFromContact(
        user,
        departmentIdMap.get(preferredDepartmentKey(user, departmentId)) ?? departmentIdMap.get(departmentId),
        startedAt
      );
      syncEmployeeDepartments(result.id, user, departmentIdMap, startedAt);
      if (seenEmployeeIds.has(result.id)) continue;
      seenEmployeeIds.add(result.id);
      if (result.created) stats.employees_created += 1;
      else stats.employees_updated += 1;
    }
  }

  if (seenEmployeeIds.size > 0) {
    const linkedEmployees = db.prepare(
      'SELECT id FROM employee WHERE feishu_open_id IS NOT NULL OR feishu_union_id IS NOT NULL OR feishu_user_id IS NOT NULL'
    ).all() as Array<{ id: string }>;
    const deactivate = db.prepare('UPDATE employee SET is_active = 0, last_feishu_sync_at = ? WHERE id = ?');
    for (const employee of linkedEmployees) {
      if (seenEmployeeIds.has(employee.id)) continue;
      deactivate.run(startedAt, employee.id);
      stats.employees_deactivated += 1;
    }
  }

  stats.finished_at = nowIso();
  return stats;
}

function requireFeishuConfig() {
  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  const redirectUri = process.env.FEISHU_REDIRECT_URI?.trim();
  if (!appId || !appSecret || !redirectUri) {
    const err = new Error('请先配置 FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_REDIRECT_URI');
    err.name = 'VALIDATION_ERROR';
    throw err;
  }
  return { appId, appSecret, redirectUri };
}

async function getTenantAccessToken() {
  if (tenantTokenCache && tenantTokenCache.expiresAt > Date.now() + 60_000) return tenantTokenCache.token;
  const { appId, appSecret } = requireFeishuConfig();
  const payload = await feishuRequest<{ tenant_access_token?: string; expire?: number }>('/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    body: { app_id: appId, app_secret: appSecret }
  });
  if (!payload.tenant_access_token) throwFeishuError('飞书 tenant_access_token 返回为空');
  tenantTokenCache = {
    token: payload.tenant_access_token,
    expiresAt: Date.now() + ((payload.expire ?? 7200) * 1000)
  };
  return tenantTokenCache.token;
}

async function exchangeCodeForUserAccessToken(code: string) {
  const { appId, appSecret, redirectUri } = requireFeishuConfig();
  const payload = await feishuRequest<{ access_token?: string; user?: FeishuOAuthUser }>('/authen/v2/oauth/token', {
    method: 'POST',
    body: {
      grant_type: 'authorization_code',
      client_id: appId,
      client_secret: appSecret,
      code,
      redirect_uri: redirectUri
    }
  });
  if (!payload.access_token) throwFeishuError('飞书 user_access_token 返回为空');
  return { access_token: payload.access_token, user: payload.user ?? (payload as FeishuOAuthUser) };
}

async function fetchFeishuUserInfo(accessToken: string) {
  return feishuRequest<FeishuOAuthUser>('/authen/v1/user_info', {
    method: 'GET',
    accessToken
  });
}

async function fetchAllDepartments(accessToken: string) {
  const result: FeishuDepartment[] = [];
  let pageToken = '';
  do {
    const search = new URLSearchParams({
      department_id_type: 'open_department_id',
      user_id_type: 'open_id',
      fetch_child: 'true',
      page_size: '50'
    });
    if (pageToken) search.set('page_token', pageToken);
    const page = await feishuRequest<PageResponse<FeishuDepartment>>(
      `/contact/v3/departments/${encodeURIComponent(FEISHU_ROOT_DEPARTMENT_ID)}/children?${search}`,
      { method: 'GET', accessToken }
    );
    result.push(...(page.items ?? []));
    pageToken = page.has_more ? page.page_token ?? '' : '';
  } while (pageToken);
  return result;
}

async function fetchDepartmentUsers(accessToken: string, departmentId: string) {
  const result: FeishuUser[] = [];
  let pageToken = '';
  do {
    const search = new URLSearchParams({
      department_id: departmentId,
      department_id_type: 'open_department_id',
      user_id_type: 'open_id',
      page_size: '50'
    });
    if (pageToken) search.set('page_token', pageToken);
    const page = await feishuRequest<PageResponse<FeishuUser>>(`/contact/v3/users/find_by_department?${search}`, {
      method: 'GET',
      accessToken
    });
    result.push(...(page.items ?? []));
    pageToken = page.has_more ? page.page_token ?? '' : '';
  } while (pageToken);
  return result;
}

function upsertDepartment(department: FeishuDepartment, syncedAt: string) {
  const openDepartmentId = department.open_department_id ?? '';
  const departmentId = department.department_id ?? '';
  const name = firstNonEmpty(department.i18n_name?.zh_cn, department.name, department.i18n_name?.en_us, departmentId, openDepartmentId);
  const existing = findDepartment(openDepartmentId, departmentId, name);
  const localId = existing?.id ?? makeFeishuLocalId('DEPT', openDepartmentId || departmentId || name);
  const parentId = department.parent_department_id ? findDepartment(department.parent_department_id, department.parent_department_id)?.id ?? null : null;
  const status = typeof department.status === 'string' ? department.status : department.status?.is_deleted ? 'deleted' : 'active';

  if (existing) {
    db.prepare(
      `UPDATE department
       SET name = ?, parent_department_id = ?, feishu_department_id = ?, feishu_open_department_id = ?, leader_user_id = ?, status = ?, last_feishu_sync_at = ?
       WHERE id = ?`
    ).run(name, parentId, departmentId || null, openDepartmentId || null, department.leader_user_id ?? null, status, syncedAt, existing.id);
    return { id: existing.id, created: false };
  }

  db.prepare(
    `INSERT INTO department (id, name, parent_department_id, feishu_department_id, feishu_open_department_id, leader_user_id, status, last_feishu_sync_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(localId, name, parentId, departmentId || null, openDepartmentId || null, department.leader_user_id ?? null, status, syncedAt);
  return { id: localId, created: true };
}

function upsertEmployeeFromContact(user: FeishuUser, departmentId: string | undefined, syncedAt: string) {
  const employee = normalizeFeishuEmployee(user);
  const existing = findEmployee(employee);
  const active = user.status?.is_resigned || user.status?.is_exited || user.status?.is_activated === false ? 0 : 1;
  return saveFeishuEmployee(employee, existing, departmentId, active, syncedAt);
}

function upsertEmployeeFromFeishu(user: FeishuOAuthUser | undefined): LocalEmployee | null {
  if (!user) return null;
  const employee = normalizeFeishuEmployee(user);
  const existing = findEmployee(employee);
  const saved = saveFeishuEmployee(employee, existing, existing?.department_id ?? undefined, 1, nowIso());
  return db.prepare('SELECT id, name, role, permission_level, department_id FROM employee WHERE id = ?').get(saved.id) as LocalEmployee | null;
}

function saveFeishuEmployee(
  employee: ReturnType<typeof normalizeFeishuEmployee>,
  existing: LocalEmployee | null,
  departmentId: string | undefined,
  active: number,
  syncedAt: string
) {
  const localId = existing?.id ?? makeFeishuLocalId('USER', employee.openId || employee.unionId || employee.userId || employee.email || employee.name);
  const role = existing?.role ?? FEISHU_DEFAULT_ROLE;
  const permissionLevel = existing?.permission_level ?? 'viewer';
  const targetDepartmentId = departmentId ?? existing?.department_id ?? null;

  if (existing) {
    db.prepare(
      `UPDATE employee
       SET name = ?, department_id = ?, role = ?, permission_level = ?, feishu_open_id = ?, feishu_union_id = ?, feishu_user_id = ?, email = ?, mobile = ?, avatar_url = ?, is_active = ?, last_feishu_sync_at = ?
       WHERE id = ?`
    ).run(
      employee.name,
      targetDepartmentId,
      role,
      permissionLevel,
      employee.openId,
      employee.unionId,
      employee.userId,
      employee.email,
      employee.mobile,
      employee.avatarUrl,
      active,
      syncedAt,
      existing.id
    );
    return { id: existing.id, created: false };
  }

  db.prepare(
    `INSERT INTO employee (id, name, department_id, role, permission_level, feishu_open_id, feishu_union_id, feishu_user_id, email, mobile, avatar_url, is_active, last_feishu_sync_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    localId,
    employee.name,
    targetDepartmentId,
    role,
    permissionLevel,
    employee.openId,
    employee.unionId,
    employee.userId,
    employee.email,
    employee.mobile,
    employee.avatarUrl,
    active,
    syncedAt
  );
  return { id: localId, created: true };
}

function normalizeFeishuEmployee(user: FeishuUser | FeishuOAuthUser) {
  const avatar = 'avatar' in user ? user.avatar : undefined;
  const name = user.name ?? ('en_name' in user ? user.en_name : undefined) ?? ('nickname' in user ? user.nickname : undefined) ?? user.email ?? user.open_id ?? user.user_id;
  if (!name) throwFeishuError('飞书用户缺少可识别姓名');
  return {
    openId: user.open_id ?? null,
    unionId: user.union_id ?? null,
    userId: user.user_id ?? null,
    name,
    email: user.email ?? user.enterprise_email ?? null,
    mobile: user.mobile ?? null,
    avatarUrl: user.avatar_url ?? ('avatar_thumb' in user ? user.avatar_thumb : undefined) ?? avatar?.avatar_72 ?? avatar?.avatar_240 ?? avatar?.avatar_origin ?? null
  };
}

function findDepartment(openDepartmentId?: string | null, departmentId?: string | null, name?: string | null) {
  if (openDepartmentId) {
    const found = db.prepare('SELECT id FROM department WHERE feishu_open_department_id = ?').get(openDepartmentId) as { id: string } | undefined;
    if (found) return found;
  }
  if (departmentId) {
    const found = db.prepare('SELECT id FROM department WHERE feishu_department_id = ? OR id = ?').get(departmentId, departmentId) as { id: string } | undefined;
    if (found) return found;
  }
  if (name) return db.prepare('SELECT id FROM department WHERE name = ?').get(name) as { id: string } | undefined;
  return null;
}

function findEmployee(employee: ReturnType<typeof normalizeFeishuEmployee>): LocalEmployee | null {
  const queries: Array<[string, string | null]> = [
    ['feishu_open_id', employee.openId],
    ['feishu_union_id', employee.unionId],
    ['feishu_user_id', employee.userId],
    ['email', employee.email]
  ];
  for (const [column, value] of queries) {
    if (!value) continue;
    const found = db.prepare(`SELECT id, name, role, permission_level, department_id FROM employee WHERE ${column} = ?`).get(value) as LocalEmployee | undefined;
    if (found) return found;
  }
  return (db.prepare('SELECT id, name, role, permission_level, department_id FROM employee WHERE name = ?').get(employee.name) as LocalEmployee | undefined) ?? null;
}

function feishuDepartmentKey(department: FeishuDepartment) {
  return department.open_department_id ?? department.department_id ?? '';
}

function preferredDepartmentKey(user: FeishuUser, fallbackDepartmentId: string) {
  const primary = user.orders?.find((item) => item.is_primary_dept && item.department_id && item.department_id !== '0')?.department_id;
  return primary ?? user.department_ids?.find((item) => item !== '0') ?? user.departments?.find((item) => item !== '0') ?? fallbackDepartmentId;
}

function syncEmployeeDepartments(employeeId: string, user: FeishuUser, departmentIdMap: Map<string, string>, syncedAt: string) {
  const keys = new Set([...(user.department_ids ?? []), ...(user.departments ?? [])].filter((item) => item && item !== '0'));
  const primary = preferredDepartmentKey(user, '');
  const deleteStmt = db.prepare("DELETE FROM employee_department WHERE employee_id = ? AND source = 'feishu'");
  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO employee_department (employee_id, department_id, is_primary, source, last_feishu_sync_at)
     VALUES (?, ?, ?, 'feishu', ?)`
  );
  const tx = db.transaction(() => {
    deleteStmt.run(employeeId);
    for (const key of keys) {
      const localDepartmentId = departmentIdMap.get(key);
      if (!localDepartmentId) continue;
      insertStmt.run(employeeId, localDepartmentId, key === primary ? 1 : 0, syncedAt);
    }
  });
  tx();
}

function firstNonEmpty(...values: Array<string | undefined | null>) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? '';
}

async function feishuRequest<T>(path: string, options: { method: 'GET' | 'POST'; body?: unknown; accessToken?: string }): Promise<T> {
  const response = await fetch(`${FEISHU_API_BASE}${path}`, {
    method: options.method,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({})) as FeishuApiResponse<T>;
  if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) {
    const err = new Error(payload.msg || `飞书接口调用失败：HTTP ${response.status}`);
    err.name = 'VALIDATION_ERROR';
    throw err;
  }
  return (payload.data ?? payload) as T;
}

function signState(payload: { redirect: string; ts: number }) {
  const config = requireFeishuConfig();
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', config.appSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyState(state: string) {
  const config = requireFeishuConfig();
  const [body, signature] = state.split('.');
  if (!body || !signature) throwInvalidState();
  const expected = createHmac('sha256', config.appSecret).update(body).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) throwInvalidState();
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { redirect?: string; ts?: number };
  if (!payload.ts || Date.now() - payload.ts > 10 * 60 * 1000) throwInvalidState();
  return { redirect: safeRedirectPath(payload.redirect ?? '/dashboard') };
}

function safeRedirectPath(value: string | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

function makeFeishuLocalId(prefix: string, source: string) {
  return `${prefix}-${source.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || makeId(prefix)}`;
}

function throwFeishuError(message: string): never {
  const err = new Error(message);
  err.name = 'VALIDATION_ERROR';
  throw err;
}

function throwInvalidState(): never {
  const err = new Error('飞书登录状态已失效，请重新发起登录');
  err.name = 'AUTH_INVALID';
  throw err;
}
