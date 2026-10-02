import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';

async function runIsolated(tempRoot: string) {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local isolated PGlite is required.');
  if (!path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test directory.');
  process.chdir(tempRoot);
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'local-platform-audit-secret-at-least-32-characters';
  process.env.AUTH_CODE_SECRET = 'local-platform-audit-code-secret-at-least-32-characters';

  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken } = await import('../server/auth');
  const { membershipRepository, userRepository } = await import('../server/repositories');
  const db = await getDb();
  const migration = fs.readFileSync(path.join(tempRoot, 'server/database/migrations/20261003_allow_platform_audit_event.sql'), 'utf8');
  await db.query(migration);
  await db.query(migration);

  const schoolId = `audit-school-${crypto.randomUUID()}`;
  await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)',
    [schoolId, 'Audit Test School', `AU${crypto.randomBytes(5).toString('hex')}`.toUpperCase(), 'Ankara', 'Çankaya']);
  async function fixture(role: 'admin' | 'parent' | 'teacher' | 'security') {
    const user = await userRepository.create({ phone: `+905${crypto.randomInt(100000000, 999999999)}`, firstName: role.toUpperCase(), lastName: 'AUDIT TEST' });
    await membershipRepository.createOrActivate({ schoolId, userId: user.id, role });
    const stored = await userRepository.getById(user.id);
    assert(stored);
    return { user, token: createToken({ userId: user.id, phone: user.phone, auth_version: stored.authVersion }) };
  }
  const platform = await fixture('admin');
  const schoolAdmin = await fixture('admin');
  const parent = await fixture('parent');
  const teacher = await fixture('teacher');
  const security = await fixture('security');
  process.env.PLATFORM_ADMIN_USER_IDS = platform.user.id;

  const schoolAuditId = `audit-school-${crypto.randomUUID()}`;
  await db.query(
    `INSERT INTO audit_logs(id,school_id,timestamp,action,actor_name,details,audit_scope)
     VALUES($1,$4,$5,'fixture.school_operation','Local Test','School fixture','SCHOOL'),
       ($2,$4,$5,'fixture.platform_created','Platform Test','Platform fixture','PLATFORM'),
       ($3,$4,$5,'fixture.platform_updated','Platform Test','Platform fixture','PLATFORM')`,
    [schoolAuditId, `audit-platform-first-${crypto.randomUUID()}`, `audit-platform-second-${crypto.randomUUID()}`, schoolId, new Date().toISOString()],
  );
  const teacherProfileId = `audit-teacher-${crypto.randomUUID()}`;
  const appointmentId = `audit-appointment-${crypto.randomUUID()}`;
  await db.query(
    `INSERT INTO teacher_profiles(id,school_id,first_name,last_name,branch) VALUES($1,$2,'AUDIT','TEACHER','TEST')`,
    [teacherProfileId, schoolId],
  );
  await db.query(
    `INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,parent_phone,
       student_name,class_name,date,start_time,end_time,status,entry_code)
     VALUES($1,$2,$3,'AUDIT TEACHER','TEST',$4,'PARENT AUDIT TEST',$5,'AUDIT STUDENT','1-A','2099-01-01','09:00','09:15','pending','123456')`,
    [appointmentId, schoolId, teacherProfileId, parent.user.id, parent.user.phone],
  );
  const schoolAuditCountBefore = (await db.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM audit_logs WHERE audit_scope='SCHOOL'",
  )).rows[0].count;
  const requestId = `audit-request-${crypto.randomUUID()}`;
  const messageId = `audit-message-${crypto.randomUUID()}`;
  await db.query(
    `INSERT INTO platform_requests(id,idempotency_key,school_id,created_by_user_id,source,request_type,school_name_snapshot,contact_name_snapshot,email_snapshot,message)
     VALUES($1,$2,$3,$4,'SCHOOL_ADMIN','SUPPORT','Audit Test School','School Admin','local@example.test','Local support')`,
    [requestId, crypto.randomUUID(), schoolId, schoolAdmin.user.id],
  );
  await db.query(
    `INSERT INTO platform_request_messages(id,request_id,sender_user_id,sender_kind,sender_name_snapshot,message,idempotency_key)
     VALUES($1,$2,$3,'SCHOOL_ADMIN','School Admin','Local reply',$4)`,
    [messageId, requestId, schoolAdmin.user.id, crypto.randomUUID()],
  );

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  async function request(method: string, token?: string, body?: object) {
    const response = await fetch(baseUrl + '/platform/audit-logs', {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  try {
    assert.equal((await request('GET', platform.token)).status, 200);
    assert.equal((await request('DELETE', platform.token)).status, 400);
    assert.equal((await request('DELETE', platform.token, { confirmation: 'temizle' })).status, 400);
    for (const actor of [schoolAdmin, parent, teacher, security]) {
      assert.equal((await request('GET', actor.token)).status, 403);
      assert.equal((await request('DELETE', actor.token, { confirmation: 'TEMİZLE' })).status, 403);
    }
    assert.equal((await request('DELETE', undefined, { confirmation: 'TEMİZLE' })).status, 401);
    const cleared = await request('DELETE', platform.token, { confirmation: 'TEMİZLE', userId: schoolAdmin.user.id });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.deletedCount, 2);
    const logs = await db.query<{ id: string; school_id: string | null; action: string; details: string; audit_scope: string }>(
      'SELECT id,school_id,action,details,audit_scope FROM audit_logs ORDER BY audit_scope,id');
    assert.equal(logs.rows.length, schoolAuditCountBefore + 1);
    const schoolLog = logs.rows.find((row) => row.id === schoolAuditId);
    assert.equal(schoolLog?.audit_scope, 'SCHOOL');
    assert.equal(schoolLog?.action, 'fixture.school_operation');
    const clearLog = logs.rows.find((row) => row.action === 'platform.audit_logs_cleared');
    assert(clearLog);
    assert.equal(clearLog.school_id, null);
    assert.equal(clearLog.audit_scope, 'PLATFORM');
    const details = JSON.parse(clearLog.details) as { deletedCount: number; actorUserId: string };
    assert.equal(details.deletedCount, 2);
    assert.equal(details.actorUserId, platform.user.id);
    assert.equal(((await request('GET', platform.token)).body.logs as unknown[]).length, schoolAuditCountBefore + 1);
    assert.equal((await db.query('SELECT id FROM schools WHERE id=$1', [schoolId])).rows.length, 1);
    assert.equal((await db.query('SELECT id FROM users WHERE id=$1', [schoolAdmin.user.id])).rows.length, 1);
    assert.equal((await db.query('SELECT id FROM appointments WHERE id=$1', [appointmentId])).rows.length, 1);
    assert.equal((await db.query('SELECT id FROM platform_requests WHERE id=$1', [requestId])).rows.length, 1);
    assert.equal((await db.query('SELECT id FROM platform_request_messages WHERE id=$1', [messageId])).rows.length, 1);
    const repeated = await request('DELETE', platform.token, { confirmation: 'TEMİZLE' });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.deletedCount, 1);
    const repeatedLogs = await db.query<{ audit_scope: string; action: string }>('SELECT audit_scope,action FROM audit_logs ORDER BY audit_scope');
    assert.equal(repeatedLogs.rows.length, schoolAuditCountBefore + 1);
    assert.equal(repeatedLogs.rows.filter((row) => row.audit_scope === 'SCHOOL').length, schoolAuditCountBefore);
    assert.equal(repeatedLogs.rows.filter((row) => row.audit_scope === 'PLATFORM' && row.action === 'platform.audit_logs_cleared').length, 1);
    console.log('Platform audit scope, school-history preservation, authorization, hard delete and repeat-clear tests PASS.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function run() {
  if (process.argv[2] === '--child') return runIsolated(process.argv[3]);
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local isolated PGlite is required.');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'veli-platform-audit-'));
  const repoRoot = process.cwd();
  try {
    const databaseDir = path.join(tempRoot, 'server/database');
    fs.mkdirSync(databaseDir, { recursive: true });
    fs.copyFileSync(path.join(repoRoot, 'server/database/supabase_schema.sql'), path.join(databaseDir, 'supabase_schema.sql'));
    fs.cpSync(path.join(repoRoot, 'server/database/migrations'), path.join(databaseDir, 'migrations'), { recursive: true });
    const child = spawnSync(process.execPath, ['--import', 'tsx', path.join(repoRoot, 'scripts/test-platform-audit-clear.ts'), '--child', tempRoot],
      { cwd: repoRoot, encoding: 'utf8', timeout: 120000 });
    if (child.stdout) process.stdout.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);
    assert.equal(child.status, 0, 'Isolated audit test process failed.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((cause: unknown) => {
  console.error('Platform audit clear tests FAILED. No credentials or response bodies are logged.');
  if (cause instanceof Error) console.error(cause.message);
  process.exitCode = 1;
});
