import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local PGlite is required.');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'local-platform-unseen-secret-at-least-32-characters';
  process.env.AUTH_CODE_SECRET = 'local-platform-unseen-code-secret-at-least-32-characters';

  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken } = await import('../server/auth');
  const { membershipRepository, userRepository } = await import('../server/repositories');
  const db = await getDb();
  const suffix = crypto.randomUUID();
  const schoolId = `unseen-school-${suffix}`;
  const userIds: string[] = [];
  const requestIds: string[] = [];
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;

  async function request(method: string, path: string, token?: string, body?: object) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  async function fixture(role: 'admin' | 'parent' | 'teacher' | 'security') {
    const user = await userRepository.create({
      phone: `+905${crypto.randomInt(100000000, 999999999)}`,
      firstName: role.toUpperCase(), lastName: 'UNSEEN TEST',
    });
    userIds.push(user.id);
    await membershipRepository.createOrActivate({ schoolId, userId: user.id, role });
    const stored = await userRepository.getById(user.id);
    assert(stored);
    return { user, token: createToken({ userId: user.id, phone: user.phone, auth_version: stored.authVersion }) };
  }

  async function insertRequest(createdAt: string, hidden = false) {
    const id = `unseen-request-${crypto.randomUUID()}`;
    requestIds.push(id);
    await db.query(
      `INSERT INTO platform_requests(id,idempotency_key,source,request_type,school_name_snapshot,contact_name_snapshot,email_snapshot,message,status,created_at,platform_hidden_at)
       VALUES($1,$2,'PUBLIC','CONTACT',$3,'Local Test','local@example.test','Local request','NEW',$4,$5)`,
      [id, crypto.randomUUID(), `Unseen ${suffix}`, createdAt, hidden ? new Date().toISOString() : null],
    );
    return id;
  }

  try {
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)',
      [schoolId, `Unseen ${suffix}`, `UN${crypto.randomBytes(5).toString('hex')}`.toUpperCase(), 'Ankara', 'Çankaya']);
    await db.query(`INSERT INTO school_licenses(id,school_id,license_code,status,expires_at)
      VALUES($1,$2,$3,'active',NOW()+INTERVAL '90 days')`, [`unseen-license-${suffix}`, schoolId, `VR-${crypto.randomBytes(5).toString('hex').toUpperCase()}`]);
    const platformA = await fixture('admin');
    const platformB = await fixture('admin');
    const schoolAdmin = await fixture('admin');
    const parent = await fixture('parent');
    const teacher = await fixture('teacher');
    const security = await fixture('security');
    process.env.PLATFORM_ADMIN_USER_IDS = `${platformA.user.id},${platformB.user.id}`;

    await insertRequest(new Date(Date.now() - 86400000).toISOString());
    const countPath = '/platform/requests/unseen-count';
    const seenPath = '/platform/requests/mark-seen';
    assert.deepEqual((await request('GET', countPath, platformA.token)).body, { count: 0 });
    assert.deepEqual((await request('GET', countPath, platformB.token)).body, { count: 0 });
    const baseline = await db.query<{ requests_last_seen_at: Date }>(
      'SELECT requests_last_seen_at FROM platform_admin_request_views WHERE user_id=$1', [platformA.user.id]);
    const afterBaseline = new Date(baseline.rows[0].requests_last_seen_at).getTime();
    await insertRequest(new Date(afterBaseline + 1000).toISOString());
    assert.equal((await request('GET', countPath, platformA.token)).body.count, 1);
    await insertRequest(new Date(afterBaseline + 2000).toISOString());
    assert.equal((await request('GET', countPath, platformA.token)).body.count, 2);
    assert.equal((await request('GET', countPath, platformB.token)).body.count, 2);
    assert.deepEqual((await request('POST', seenPath, platformA.token, { userId: platformB.user.id })).body, { count: 0 });
    assert.equal((await request('GET', countPath, platformA.token)).body.count, 0);
    assert.equal((await request('GET', countPath, platformB.token)).body.count, 2);
    assert.equal((await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM platform_requests WHERE id=ANY($1::text[]) AND status='NEW'`, [requestIds])).rows[0].count, 3);
    await insertRequest(new Date(afterBaseline + 3000).toISOString(), true);
    assert.equal((await request('GET', countPath, platformA.token)).body.count, 0);
    assert.equal((await request('GET', countPath, platformB.token)).body.count, 2);

    for (const actor of [schoolAdmin, parent, teacher, security]) {
      assert.equal((await request('GET', countPath, actor.token)).status, 403);
      assert.equal((await request('POST', seenPath, actor.token)).status, 403);
    }
    assert.equal((await request('GET', countPath)).status, 401);
    assert.equal((await request('POST', seenPath)).status, 401);
    assert.equal((await request('GET', '/platform/requests', platformA.token)).status, 200);
    console.log('Platform unseen baseline, per-admin counts, mark-seen, hidden exclusion and authorization tests PASS.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM platform_requests WHERE id=ANY($1::text[])', [requestIds]);
    await db.query('DELETE FROM schools WHERE id=$1', [schoolId]);
    for (const userId of userIds) await db.query('DELETE FROM users WHERE id=$1', [userId]);
    delete process.env.PLATFORM_ADMIN_USER_IDS;
  }
}

run().catch((cause: unknown) => {
  console.error('Platform unseen tests FAILED. No credentials or response bodies are logged.');
  if (cause instanceof Error) console.error(cause.message);
  process.exitCode = 1;
});
