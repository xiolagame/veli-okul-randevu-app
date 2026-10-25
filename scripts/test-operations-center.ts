import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import type { OperationPage, OperationSummary } from '../src/types/operations';
import { operationCategories } from '../src/types/operations';
import { studentRecordIssues } from '../src/utils/student-records';

let stage = 'setup';
async function run() {
  if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') throw new Error('Local isolated PGlite required');
  const root = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'veli-operations-'));
  fs.mkdirSync(path.join(temp, 'server/database'), { recursive: true });
  fs.copyFileSync(path.join(root, 'server/database/supabase_schema.sql'), path.join(temp, 'server/database/supabase_schema.sql'));
  fs.cpSync(path.join(root, 'server/database/migrations'), path.join(temp, 'server/database/migrations'), { recursive: true });
  process.chdir(temp);
  process.env.NODE_ENV = 'test'; process.env.PHONE_CENTRIC_AUTH_ENABLED = 'false';
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64url');
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(48).toString('base64url');
  delete process.env.CLASS_BULK_DELETE_ENABLED;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    if (!String(input).startsWith('http://127.0.0.1:')) throw new Error('External transport prohibited');
    return originalFetch(input, init);
  };
  const { getDb } = await import('../server/database/postgres');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const { createToken } = await import('../server/auth');
  const { apiRouter } = await import('../server/api');
  const { platformTargetContextGuard } = await import('../server/platform-management');
  const db = await getDb(); assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  stage = 'school and user fixtures';
  for (const id of ['school-a', 'school-b']) await db.query("INSERT INTO schools(id,name,code,city,district) VALUES($1,'TEST SCHOOL',$2,'Test','Test')", [id, id]);
  let nextPhone = 100000000;
  const phone = () => '+905' + nextPhone++;
  async function user(role: 'admin' | 'parent' | 'teacher' | 'security' | null, schoolId = 'school-a') {
    const value = await userRepository.create({ phone: phone(), firstName: 'TEST', lastName: 'USER', isPhoneVerified: true });
    if (role) await membershipRepository.createOrActivate({ schoolId, userId: value.id, role });
    return { ...value, token: createToken({ userId: value.id, phone: value.phone, auth_version: 0 }) };
  }
  const admin = await user('admin'), adminB = await user('admin', 'school-b'), parent = await user('parent'), teacher = await user('teacher'), security = await user('security'), platform = await user(null);
  process.env.PLATFORM_ADMIN_USER_IDS = platform.id;
  await db.query("INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,phone,email,branch) VALUES('active-teacher','school-a',$1,'ACTIVE','TEACHER',$2,'','Math')", [teacher.id, teacher.phone]);
  for (let i = 0; i < 27; i++) await db.query("INSERT INTO teacher_profiles(id,school_id,first_name,last_name,phone,email,branch) VALUES($1,'school-a','PENDING',$2,$3,'test@example.test',$4)", ['pending-' + i, String(i).padStart(2, '0'), phone(), i === 0 ? '' : 'Math']);
  await db.query("INSERT INTO teacher_profiles(id,school_id,first_name,last_name,phone,email,branch) VALUES('foreign-teacher','school-b','FOREIGN','TEACHER',$1,'test@example.test','Math')", [phone()]);
  await db.query("INSERT INTO pending_staff(id,school_id,role,first_name,last_name,phone,email) VALUES('pending-security','school-a','security','PENDING','SECURITY',$1,'test@example.test')", [phone()]);
  await db.query("INSERT INTO students(id,school_id,name,class_name,student_number) VALUES('linked','school-a','LINKED STUDENT','5-A','001'),('orphan','school-a','ORPHAN STUDENT','5-B','002')");
  await db.query("INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES('school-a','linked',$1)", [parent.id]);
  const waitingPhone = phone();
  async function roster(id: string, number: string, name = 'WAITING PARENT', school = 'school-a', deleted = false, student = 'TEST STUDENT') {
    await db.query('INSERT INTO school_roster(id,school_id,student_name,class_name,student_number,parent_name,parent_phone,parent_account_deleted_at) VALUES($1,$2,$3,\'5-A\',\'001\',$4,$5,$6)', [id, school, student, name, number, deleted ? new Date().toISOString() : null]);
  }
  await roster('pending-a', waitingPhone); await roster('pending-b', '0' + waitingPhone.slice(3), 'WAITING PARENT', 'school-a', false, 'SECOND STUDENT');
  await roster('pending-format-duplicate', '90' + waitingPhone.slice(3));
  await roster('already-account', parent.phone, 'KNOWN PARENT');
  await roster('already-linked', parent.phone, 'KNOWN PARENT', 'school-a', false, 'LINKED STUDENT');
  await roster('bad-phone', 'invalid'); await roster('deleted-parent', phone(), 'DELETED', 'school-a', true);
  await roster('foreign', phone(), 'FOREIGN PARENT', 'school-b');
  const today = String((await db.query<{ today: string }>("SELECT to_char(NOW() AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD') AS today")).rows[0].today);
  for (const [id, date, time, status] of [['morning', today, '08:00', 'booked'], ['later', today, '10:00', 'pending'], ['historical', '2000-01-01', '09:00', 'pending']]) {
    await db.query("INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,parent_phone,student_id,student_name,class_name,date,start_time,end_time,status,entry_code) VALUES($1,'school-a','active-teacher','ACTIVE TEACHER','Math',$2,'TEST PARENT',$3,'linked','LINKED STUDENT','5-A',$4,$5,'11:00',$6,'123456')", [id, parent.id, parent.phone, date, time, status]);
  }
  const app = express(); app.use(express.json()); app.use('/api/platform-target/:targetSchoolId', platformTargetContextGuard, apiRouter); app.use('/api', apiRouter);
  const server = http.createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  const prefix = '/schools/school-a/management/operations';
  async function request(route: string, token = admin.token, method = 'GET') {
    const response = await fetch(base + route, { method, headers: { authorization: 'Bearer ' + token } });
    return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? await response.json() : {}, cache: response.headers.get('cache-control') };
  }
  try {
    stage = 'tenant and role boundaries';
    for (const actor of [parent, teacher, security, adminB]) assert.equal((await request(prefix, actor.token)).status, 403);
    assert.equal((await request(prefix, '', 'GET')).status, 401);
    assert.equal((await request(prefix, admin.token, 'POST')).status, 404);
    stage = 'real summary and pending parent deduplication';
    const response = await request(prefix); assert.equal(response.status, 200); assert.equal(response.cache, 'no-store');
    const summary = response.body as OperationSummary;
    assert.equal(summary.counts['pending-parents'], 1); assert.equal(summary.counts['pending-staff'], 28);
    assert.equal(summary.counts['pending-appointments'], 2); assert.equal(summary.counts.today, 2); assert.equal(summary.counts.teachers, 28);
    assert.equal(summary.counts.missing, 4, 'optional active-teacher email and already-linked roster are not issues');
    for (const category of operationCategories) {
      const page = (await request(prefix + '/' + category)).body as OperationPage;
      assert.equal(page.total, summary.counts[category]); assert(page.items.length <= 25);
      assert(!JSON.stringify(page).includes('FOREIGN'));
      assert(!/code_hash|password_hash|auth_version|qr_token|entry_code/.test(JSON.stringify(page)));
    }
    const parents = (await request(prefix + '/pending-parents')).body as OperationPage;
    assert.equal(parents.items[0].students?.length, 2);
    const unlinked = (await request('/schools/school-a/management/student-records')).body.records as import('../src/utils/student-records').SchoolStudentRecord[];
    assert(unlinked.some((r) => r.parents.some((p) => p.status === 'unlinked')));
    stage = 'pagination search and local day';
    const first = (await request(prefix + '/pending-staff')).body as OperationPage;
    const second = (await request(prefix + '/pending-staff?page=1')).body as OperationPage;
    assert.equal(first.items.length, 25); assert.equal(second.items.length, 3);
    assert(!first.items.some((a) => second.items.some((b) => a.id === b.id && a.role === b.role)));
    assert.equal(((await request(prefix + '/pending-staff?q=SECURITY')).body as OperationPage).total, 1);
    assert.equal(((await request(prefix + '/pending-staff?q=%25')).body as OperationPage).total, 0, 'search wildcards remain literal');
    const meetings = (await request(prefix + '/today')).body as OperationPage;
    assert.deepEqual(meetings.items.map((m) => m.appointment?.startTime), ['08:00', '10:00']);
    assert.equal(((await request(prefix + '/today?status=pending')).body as OperationPage).total, 1);
    assert.equal((await request(prefix + '/today?page=-1')).status, 400);
    assert.equal((await request(prefix + '/today?status=admin')).status, 400);
    assert.equal((await request(prefix + '/unknown')).status, 400);
    stage = 'platform target and disabled school';
    assert.equal((await request('/platform-target/school-a' + prefix, platform.token)).status, 200);
    assert.equal((await request('/platform-target/school-a' + prefix, parent.token)).status, 403);
    assert.equal((await request('/platform-target/school-b' + prefix, platform.token)).status, 403);
    await db.query("UPDATE schools SET disabled_at=NOW() WHERE id='school-a'");
    assert.equal((await request(prefix)).status, 403);
    await db.query("UPDATE schools SET disabled_at=NULL WHERE id='school-a'");
    stage = 'updates and fail-safe database errors';
    await db.query("DELETE FROM school_roster WHERE id IN ('pending-a','pending-b','pending-format-duplicate')");
    assert.equal(((await request(prefix)).body as OperationSummary).counts['pending-parents'], 0);
    await db.query('ALTER TABLE pending_staff RENAME TO temporarily_unavailable_staff');
    assert.equal((await request(prefix)).status, 500, 'database failure must not appear as zero counts');
    await db.query('ALTER TABLE temporarily_unavailable_staff RENAME TO pending_staff');
    assert.equal((await request('/schools/school-a/management/student-records/class-removal/preview', admin.token, 'POST')).status, 404);
    assert.deepEqual(studentRecordIssues({ id: 'test', kind: 'student', name: 'TEST STUDENT', className: '5-A', studentNumber: '', birthDate: '', parents: [{ fullName: 'TEST PARENT', phone: waitingPhone, status: 'pending' }] }), []);
    console.log('Operations center: real counts/detail consistency, canonical parent dedup, link/account distinction, required-only issues, pagination/search, Istanbul day, role/tenant/platform guards, disabled school and database errors PASS.');
  } finally { globalThis.fetch = originalFetch; await new Promise<void>((resolve) => server.close(() => resolve())); process.chdir(root); }
}
run().catch((error: unknown) => {
  const frame = error instanceof Error ? error.stack?.split('\n').find((line) => line.includes('test-operations-center.ts:')) : '';
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  console.error(`Operations center FAILED at ${stage}. ${frame || ''} ${code} No credentials or response bodies logged.`); process.exitCode = 1;
});
