import { clearAuthSession, getAuthSession } from './auth';

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: authHeaders()
  });
  return parseResponse<T>(response, path);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders()
    },
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response, path);
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: authHeaders(),
    body: formData
  });
  return parseResponse<T>(response, path);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...authHeaders()
    },
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response, path);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'DELETE',
    headers: authHeaders()
  });
  return parseResponse<T>(response, path);
}

function authHeaders(): Record<string, string> {
  const token = getAuthSession()?.token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function parseResponse<T>(response: Response, path: string): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    clearAuthSession();
    const redirect = `${window.location.pathname}${window.location.search}`;
    if (!path.startsWith('/api/auth/')) {
      window.location.assign(`/login?redirect=${encodeURIComponent(redirect)}`);
    }
  }
  if (!response.ok) {
    throw new Error(payload?.message ?? '请求失败');
  }
  return payload as T;
}
