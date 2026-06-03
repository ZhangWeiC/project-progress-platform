const DEFAULT_USER_ID = 'user-admin';

export function getCurrentUserId() {
  return localStorage.getItem('currentUserId') ?? DEFAULT_USER_ID;
}

export function setCurrentUserId(userId: string) {
  localStorage.setItem('currentUserId', userId);
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: {
      'x-user-id': getCurrentUserId()
    }
  });
  return parseResponse<T>(response);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-user-id': getCurrentUserId()
    },
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-user-id': getCurrentUserId()
    },
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message ?? '请求失败');
  }
  return payload as T;
}
