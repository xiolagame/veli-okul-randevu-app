import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import { normalizeSchoolCodeInput } from '../src/utils/school-code';

let stage = 'setup';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local PGlite required.');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(32).toString('hex');
  const previousPlatformAdmins = process.env.PLATFORM_ADMIN_USER_IDS;
  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken } = await import('../server/auth');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const db = await getDb();
  assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');

  const suffix = crypto.randomUUID();
  const schoolA = `delete-a-${suffix}`;
  const schoolB = `delete-b-${suffix}`;
  const teacherId = `delete-teacher-${suffix}`;
  const studentId = `delete-student-${suffix}`;
  const schoolOnlyStudentId = `delete-school-only-student-${suffix}`;
  const appointmentId = `delete-appointment-${suffix}`;
  const userIds: string[] = [];
  const phone = () => `+905${crypto.randomInt(100000000, 999999999)}`;
  const createUser = async () => {
    const user = await userRepository.create({ phone: phone(), firstName: 'Local', lastName: 'Fixture' });
    userIds.push(user.id);
    const stored = await userRepository.getById(user.id);
    assert(stored);
    return { ...user, token: createToken({ userId: user.id, phone: user.phone, auth_version: stored.authVersion }) };
  };

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  const request = async (method: string, path: string, token?: string, body?: object) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };

  try {
    assert.equal(normalizeSchoolCodeInput('aea-123_test'), 'AEA-123_TEST');
    const schoolManagement = fs.readFileSync('src/components/SchoolManagement.tsx', 'utf8');
    const authView = fs.readFileSync('src/components/AuthView.tsx', 'utf8');
    const schoolInfo = fs.readFileSync('src/components/SchoolInfo.tsx', 'utf8');
    const stylesheet = fs.readFileSync('src/index.css', 'utf8');
  assert(schoolManagement.includes("school.disabledAt && <Button variant=\"danger\"") && schoolManagement.includes('deleteConfirmation !== normalizeSchoolCodeInput(deleteTarget.code)'));
    assert(authView.includes('normalizeSchoolCodeInput(event.target.value)'));
    assert(schoolInfo.includes('school-info-list') && schoolInfo.includes("copied ? 'Kopyalandı ✓' : 'Kopyala'"));
    assert(stylesheet.includes('.platform-nav button') && stylesheet.includes('min-height: 44px'));

    stage = 'fixtures';
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)',
      [schoolA, 'Delete School A', `DA${suffix.replace(/-/g, '').slice(0, 8)}`.toUpperCase(), 'Test', 'Test',
        schoolB, 'Delete School B', `DB${suffix.replace(/-/g, '').slice(0, 8)}`.toUpperCase(), 'Test', 'Test']);
    const platform = await createUser();
    const schoolAdmin = await createUser();
    const sharedUser = await createUser();
    const schoolOnlyUser = await createUser();
    const teacherUser = await createUser();
    process.env.PLATFORM_ADMIN_USER_IDS = platform.id;
    await membershipRepository.createOrActivate({ schoolId: schoolA, userId: platform.id, role: 'admin' });
    await membershipRepository.createOrActivate({ schoolId: schoolA, userId: schoolAdmin.id, role: 'admin' });
    await membershipRepository.createOrActivate({ schoolId: schoolA, userId: sharedUser.id, role: 'parent' });
    await membershipRepository.createOrActivate({ schoolId: schoolB, userId: sharedUser.id, role: 'parent' });
    await membershipRepository.createOrActivate({ schoolId: schoolA, userId: schoolOnlyUser.id, role: 'parent' });
    await membershipRepository.createOrActivate({ schoolId: schoolA, userId: teacherUser.id, role: 'teacher' });
    await db.query(`INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch,phone)
      VALUES($1,$2,$3,'LOCAL','TEACHER','Türkçe',$4)`, [teacherId, schoolA, teacherUser.id, teacherUser.phone]);
    await db.query(`INSERT INTO availability_slots(school_id,teacher_id,day_of_week,start_time,end_time,slot_duration)
      VALUES($1,$2,1,'09:00','09:15',15)`, [schoolA, teacherId]);
    await db.query(`INSERT INTO students(id,school_id,name,class_name,student_number) VALUES($1,$2,'LOCAL STUDENT','5-A','1')`, [studentId, schoolA]);
    await db.query(`INSERT INTO students(id,school_id,name,class_name,student_number) VALUES($1,$2,'SCHOOL ONLY STUDENT','5-B','2')`, [schoolOnlyStudentId, schoolA]);
    await db.query('INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES($1,$2,$3)', [schoolA, studentId, sharedUser.id]);
    await db.query('INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES($1,$2,$3)', [schoolA, schoolOnlyStudentId, schoolOnlyUser.id]);
    await db.query(`INSERT INTO school_roster(school_id,parent_phone,parent_name,student_name,class_name,student_number,is_claimed)
      VALUES($1,$2,'LOCAL PARENT','LOCAL STUDENT','5-A','1',TRUE)`, [schoolA, sharedUser.phone]);
    await db.query(`INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,parent_phone,student_id,student_name,class_name,date,start_time,end_time,status,entry_code)
      VALUES($1,$2,$3,'LOCAL TEACHER','Türkçe',$4,'LOCAL PARENT',$5,$6,'LOCAL STUDENT','5-A','2090-01-02','09:00','09:15','pending','123456')`,
      [appointmentId, schoolA, teacherId, sharedUser.id, sharedUser.phone, studentId]);
    await db.query(`INSERT INTO notifications(school_id,user_id,title,message,date,appointment_id) VALUES($1,$2,'Local','Local','2090-01-02',$3)`, [schoolA, sharedUser.id, appointmentId]);
    await db.query(`INSERT INTO audit_logs(school_id,timestamp,action,actor_name,details) VALUES($1,$2,'fixture.created','Local','Local')`, [schoolA, new Date().toISOString()]);
    await db.query(`INSERT INTO invitations(school_id,token,description,is_active) VALUES($1,$2,'Local',TRUE)`, [schoolA, `delete-token-${suffix}`]);
    await db.query(`INSERT INTO pending_staff(id,school_id,role,first_name,last_name,phone,email,created_by)
      VALUES($1,$2,'security','LOCAL','SECURITY',$3,$4,$5)`, [`delete-staff-${suffix}`, schoolA, phone(), `local-${suffix}@example.test`, schoolAdmin.id]);
    await db.query(`INSERT INTO school_roster(school_id,parent_phone,parent_name,student_name,class_name,is_claimed)
      VALUES($1,$2,'OTHER PARENT','OTHER STUDENT','6-B',FALSE)`, [schoolB, phone()]);

    stage = 'authorization and active-school rejection';
    const activeDelete = await request('DELETE', `/platform/schools/${schoolA}`, platform.token);
    assert.equal(activeDelete.status, 409, `Active school delete returned HTTP ${activeDelete.status}.`);
    assert.equal((await request('DELETE', `/platform/schools/${schoolA}`, schoolAdmin.token)).status, 403);
    assert.equal((await request('PATCH', `/platform/schools/${schoolA}/status`, platform.token, { active: false })).status, 200);
    assert.equal((await request('DELETE', `/platform/schools/${schoolA}`, schoolAdmin.token)).status, 403);

    stage = 'transaction rollback';
    await db.query(`CREATE TABLE IF NOT EXISTS school_delete_test_blockers (
      id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT)`);
    await db.query('INSERT INTO school_delete_test_blockers(id,school_id) VALUES($1,$2)', [`block-${suffix}`, schoolA]);
    assert.equal((await request('DELETE', `/platform/schools/${schoolA}`, platform.token)).status, 500);
    assert.equal((await db.query('SELECT id FROM schools WHERE id=$1', [schoolA])).rows.length, 1);
    assert.equal((await db.query('SELECT id FROM appointments WHERE school_id=$1', [schoolA])).rows.length, 1);
    assert(await userRepository.getById(schoolOnlyUser.id), 'Rollback must preserve school-only users.');
    await db.query('DELETE FROM school_delete_test_blockers WHERE school_id=$1', [schoolA]);
    await db.query('DROP TABLE school_delete_test_blockers');

    stage = 'permanent deletion';
    const deleted = await request('DELETE', `/platform/schools/${schoolA}`, platform.token);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.message, 'Okul ve okula bağlı veriler kalıcı olarak silindi.');
    const scopedTables = ['school_memberships', 'school_roster', 'students', 'student_parent_relations', 'teacher_profiles',
      'availability_slots', 'appointments', 'notifications', 'audit_logs', 'invitations', 'pending_staff'];
    assert.equal((await db.query('SELECT id FROM schools WHERE id=$1', [schoolA])).rows.length, 0);
    for (const table of scopedTables) {
      const rows = await db.query(`SELECT 1 FROM ${table} WHERE school_id=$1 LIMIT 1`, [schoolA]);
      assert.equal(rows.rows.length, 0, `${table} must not retain deleted-school rows.`);
    }
    assert(await userRepository.getById(sharedUser.id), 'Shared global user must be preserved.');
    assert.equal((await membershipRepository.getMembershipsByUserId(sharedUser.id)).some((membership) => membership.schoolId === schoolB), true);
    const sharedMe = await request('GET', '/user/me', sharedUser.token);
    assert.equal(sharedMe.status, 200, 'Shared user must remain authenticated after School A deletion.');
    assert.equal((sharedMe.body.memberships as Array<{ schoolId: string }>).some((membership) => membership.schoolId === schoolB), true);
    assert.equal(await userRepository.getById(schoolOnlyUser.id), null, 'School-only orphan user must be deleted.');
    assert.equal(await userRepository.getById(schoolAdmin.id), null, 'School-only admin user must be deleted.');
    assert.equal(await userRepository.getById(teacherUser.id), null, 'School-only teacher user must be deleted.');
    assert(await userRepository.getById(platform.id), 'Platform admin must be preserved even with a deleted-school membership.');
    assert.equal((await db.query('SELECT id FROM schools WHERE id=$1', [schoolB])).rows.length, 1);
    assert.equal((await db.query('SELECT 1 FROM school_roster WHERE school_id=$1', [schoolB])).rows.length, 1);
    console.log('Platform permanent school deletion, rollback, orphan cleanup, shared-user protection, authorization, uppercase and UI contract tests PASS.');
  } finally {
    if (previousPlatformAdmins === undefined) delete process.env.PLATFORM_ADMIN_USER_IDS;
    else process.env.PLATFORM_ADMIN_USER_IDS = previousPlatformAdmins;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DROP TABLE IF EXISTS school_delete_test_blockers');
    await db.query('DELETE FROM schools WHERE id IN ($1,$2)', [schoolA, schoolB]);
    for (const userId of userIds) await db.query('DELETE FROM users WHERE id=$1', [userId]);
  }
}

run().catch((cause: unknown) => {
  const location = cause instanceof Error ? cause.stack?.split('\n').find((line) => line.includes('test-platform-school-deletion.ts:'))?.trim() : undefined;
  const detail = cause instanceof Error ? cause.message : 'Unknown assertion failure.';
  console.error(`Platform school deletion tests FAILED at ${stage}. ${detail} ${location || ''} No credentials or response bodies are logged.`);
  process.exitCode = 1;
});
