import type { RequestHandler } from 'express';
import { Client } from 'pg';
import { canUsePlatformAuthority, verifyToken } from './auth';
import { getPostgresConnectionOptions } from './database/tls';

interface DiagnosticConnection {
  query(sql: string, values?: string[]): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
}

async function openConnection(): Promise<DiagnosticConnection> {
  const url = process.env.DATABASE_URL;
  if (!url || !process.env.SUPABASE_DB_CA_B64?.trim()) throw new Error('Diagnostic configuration unavailable');
  // Same URL and verified TLS as the backend; no SET ROLE, local DB fallback,
  // application bootstrap, migration runner or extra warm connection pool.
  const client = new Client({
    ...getPostgresConnectionOptions(url, true),
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  client.on('error', () => { /* Never log driver errors or credentials. */ });
  try { await client.connect(); }
  catch {
    try { await client.end(); } catch { /* Sanitized by handler. */ }
    throw new Error('Diagnostic connection unavailable');
  }
  return {
    query: (sql, values) => client.query(sql, values),
    close: () => client.end(),
  };
}

// Temporary, removable diagnostic. Dependency injection is server-side test-only.
export function createDatabaseRoleDiagnostic(connect = openConnection): RequestHandler {
  let active = false;
  return async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.vary('Authorization');
    const header = req.headers.authorization;
    const payload = header?.startsWith('Bearer ') ? verifyToken(header.slice(7)) : null;
    if (!payload) { res.status(401).json({ code: 'AUTHENTICATION_REQUIRED' }); return; }
    if (!canUsePlatformAuthority({ id: payload.userId, authMethod: payload.auth_method,
      phone: '', firstName: '', lastName: '', isPhoneVerified: false })) {
      res.status(403).json({ code: 'PLATFORM_ACCESS_REQUIRED' }); return;
    }
    if (req.method !== 'GET') {
      res.set('Allow', 'GET'); res.status(405).json({ code: 'METHOD_NOT_ALLOWED' }); return;
    }
    if (active) { res.status(429).json({ code: 'DATABASE_ROLE_CHECK_BUSY' }); return; }
    active = true;
    let connection: DiagnosticConnection | undefined;
    try {
      connection = await connect();
      // Preserve account-deletion/session-invalidation checks without the shared
      // auth middleware's raw error logger or loading personal profile fields.
      const user = (await connection.query('SELECT id, auth_version FROM users WHERE id = $1', [payload.userId])).rows[0];
      if (!user || user.id !== payload.userId || Number(user.auth_version) !== payload.auth_version) {
        res.status(401).json({ code: 'SESSION_INVALID' }); return;
      }
      const rows = (await connection.query('SELECT current_user, session_user;')).rows;
      const role = rows[0];
      const validRole = (value: unknown): value is string => typeof value === 'string' && /^[^\u0000-\u001f\u007f]{1,63}$/u.test(value);
      if (rows.length !== 1 || !role || !validRole(role.current_user) || !validRole(role.session_user)) {
        throw new Error('Invalid diagnostic result');
      }
      // Explicit allowlist: never return the full DB result, errors or settings.
      res.json({ current_user: role.current_user, session_user: role.session_user });
    } catch {
      res.status(503).json({ code: 'DATABASE_ROLE_CHECK_UNAVAILABLE' });
    } finally {
      try { await connection?.close(); } catch { /* No secret-bearing logs. */ }
      active = false;
    }
  };
}
