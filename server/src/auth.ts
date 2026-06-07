import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, nowIso } from './db.js';
import type { CurrentUser } from './services.js';

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

type CredentialRecord = {
  employee_id: string;
  password_salt: string;
  password_hash: string;
  enabled: number;
  name: string;
  role: string;
  permission_level: string;
};

export function login(loginName: string, password: string) {
  const credential = db
    .prepare(
      `SELECT c.employee_id, c.password_salt, c.password_hash, c.enabled, e.name, e.role, e.permission_level
       FROM user_credential c
       JOIN employee e ON e.id = c.employee_id
       WHERE lower(c.login_name) = lower(?) OR e.name = ?`
    )
    .get(loginName.trim(), loginName.trim()) as CredentialRecord | undefined;

  if (!credential || !credential.enabled || !verifyPassword(password, credential.password_salt, credential.password_hash)) {
    const err = new Error('账号或密码错误');
    err.name = 'AUTH_INVALID';
    throw err;
  }

  return createSession({
    id: credential.employee_id,
    name: credential.name,
    role: credential.role,
    permission_level: credential.permission_level
  });
}

export function logout(authorization: unknown) {
  const token = bearerToken(authorization);
  if (token) db.prepare('DELETE FROM auth_session WHERE token_hash = ?').run(hashToken(token));
  return { ok: true };
}

export function authenticate(authorization: unknown): CurrentUser {
  const token = bearerToken(authorization);
  if (!token) {
    const err = new Error('请先登录');
    err.name = 'AUTH_REQUIRED';
    throw err;
  }

  const user = db
    .prepare(
      `SELECT e.id, e.name, e.role, e.permission_level
       FROM auth_session s
       JOIN employee e ON e.id = s.employee_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND COALESCE(e.is_active, 1) = 1`
    )
    .get(hashToken(token), nowIso()) as CurrentUser | undefined;
  if (!user) {
    const err = new Error('登录已失效，请重新登录');
    err.name = 'AUTH_REQUIRED';
    throw err;
  }
  return user;
}

export function createSession(user: CurrentUser) {
  db.prepare('DELETE FROM auth_session WHERE expires_at <= ?').run(nowIso());
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  db.prepare(
    `INSERT INTO auth_session (token_hash, employee_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(hashToken(token), user.id, nowIso(), expiresAt);

  return {
    token,
    expires_at: expiresAt,
    user
  };
}

function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function bearerToken(authorization: unknown) {
  if (typeof authorization !== 'string') return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
