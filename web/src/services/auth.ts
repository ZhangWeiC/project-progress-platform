export type AuthUser = {
  id: string;
  name: string;
  role: string;
};

export type AuthSession = {
  token: string;
  expires_at: string;
  user: AuthUser;
};

const AUTH_SESSION_KEY = 'projectProgressAuth';

export function getAuthSession(): AuthSession | null {
  const raw = localStorage.getItem(AUTH_SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as AuthSession;
    if (!session.token || !session.user || new Date(session.expires_at).getTime() <= Date.now()) {
      clearAuthSession();
      return null;
    }
    return session;
  } catch {
    clearAuthSession();
    return null;
  }
}

export function setAuthSession(session: AuthSession) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  localStorage.removeItem('currentUserId');
}

export function clearAuthSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
}

export async function loginRequest(loginName: string, password: string) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login_name: loginName, password })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? '登录失败');
  const session = payload as AuthSession;
  setAuthSession(session);
  return session;
}

export async function getFeishuAuthorizeUrl(redirect: string) {
  const response = await fetch(`/api/auth/feishu/authorize-url?redirect=${encodeURIComponent(redirect)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? '无法发起飞书登录');
  return payload as { authorization_url: string };
}

export async function feishuCallbackRequest(code: string, state: string) {
  const response = await fetch('/api/auth/feishu/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, state })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? '飞书登录失败');
  const session = payload as AuthSession & { redirect?: string };
  setAuthSession(session);
  return session;
}

export async function logoutRequest() {
  const session = getAuthSession();
  if (session) {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}` }
    }).catch(() => undefined);
  }
  clearAuthSession();
}
