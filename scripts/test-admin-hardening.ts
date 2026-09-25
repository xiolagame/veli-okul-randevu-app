import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import type { TeacherProfile, Appointment } from '../src/types';

let stage = 'setup';
async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local DB required');
  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { requireSchoolMembership, requireSchoolRole } = await import('../server/auth');
  const { userRepository, membershipRepository, notificationRepository, auditLogRepository } = await import('../server/repositories');
  const { hashPassword } = await import('../server/passwords');
  const { generateActivationCode } = await import('../server/activation-codes');
  const db = await getDb();
  assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  const schoolId = 'hardening-' + crypto.randomUUID();
  const otherSchool = 'hardening-' + crypto.randomUUID();
  const userIds: string[] = [];
  const createdSchoolIds: string[] = [];
  const previousPlatformAdmins = process.env.PLATFORM_ADMIN_USER_IDS;
  delete process.env.PLATFORM_ADMIN_USER_IDS;
  const password = crypto.randomBytes(24).toString('base64url');
  const phone = () => '+905' + crypto.randomInt(100000000, 999999999);
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port + '/api';
  async function request(method: string, path: string, token?: string, body?: object, schoolHeader?: string) {
    const response = await fetch(base + path, { method, headers: {
      'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(schoolHeader ? { 'x-school-id': schoolHeader } : {}),
    }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  async function login(value: string) {
    const result = await request('POST', '/auth/login', undefined, { phone: value, password });
    assert.equal(result.status, 200);
    return result.body.token as string;
  }
  async function fixture(role: 'admin' | 'parent' | 'teacher' | 'security', school = schoolId) {
    stage = 'fixture ' + role;
    const user = await userRepository.create({ phone: phone(), firstName: 'Fixture', lastName: 'Person' });
    userIds.push(user.id);
    await userRepository.updatePasswordHash(user.id, hashPassword(password));
    await membershipRepository.createOrActivate({ schoolId: school, userId: user.id, role });
    return { ...user, token: await login(user.phone) };
  }
  const schoolPath = '/schools/' + schoolId;
  try {
    stage = 'schools';
    for (const id of [schoolId, otherSchool]) await db.query(
      'INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [id, 'Local fixture', id, 'Test', 'Test']);
    const admin = await fixture('admin');
    const parent = await fixture('parent');
    const security = await fixture('security');
    const otherAdmin = await fixture('admin', otherSchool);
    const otherParent = await fixture('parent', otherSchool);
    await db.query("INSERT INTO audit_logs(school_id,timestamp,action,actor_name,details) VALUES($1,$2,$3,$4,$5)",
      [otherSchool, new Date().toISOString(), 'fixture.created', 'Fixture', 'Local test']);
    stage = 'student fixture';
    const studentId = 'student-' + crypto.randomUUID();
    await db.query('INSERT INTO students(id,school_id,name,class_name,student_number) VALUES($1,$2,$3,$4,$5)',
      [studentId, schoolId, 'Fixture Student', '5-A', '12']);
    await db.query('INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES($1,$2,$3)', [schoolId, studentId, parent.id]);
    await db.query(`INSERT INTO school_roster(school_id,parent_phone,parent_name,student_name,class_name,student_number,is_claimed)
      VALUES($1,$2,$3,$4,$5,$6,TRUE)`, [schoolId,parent.phone,'Fixture Person','Fixture Student','5-A','12']);

    stage = 'pending teacher hidden';
    const teacherPhone = phone();
    const created = await request('POST', schoolPath + '/teachers', admin.token, { fullName: 'New Teacher', branch: 'Türkçe', phone: teacherPhone });
    assert.equal(created.status, 201);
    const teacher = created.body.teacher as TeacherProfile;
    assert.equal(teacher.userId ?? null, null);
    const pendingList = await request('GET', schoolPath + '/teachers', parent.token);
    assert(!(pendingList.body.teachers as TeacherProfile[]).some((entry) => entry.id === teacher.id));
    const date = '2090-01-02';
    const booking = { teacherId: teacher.id, studentName: 'Fixture Student', className: '5-A', date, startTime: '10:00', endTime: '10:15' };
    assert.equal((await request('POST', schoolPath + '/appointments', parent.token, booking)).status, 409);
    stage = 'five digit activation';
    for (let attempt = 0; attempt < 100; attempt++) assert.match(generateActivationCode(), /^\d{5}$/);
    const issued = await request('POST', schoolPath + '/auth-codes', admin.token, { targetType: 'teacher', targetId: teacher.id, purpose: 'ACCOUNT_ACTIVATION' });
    assert.equal(issued.status, 200);
    assert.match(issued.body.code as string, /^\d{5}$/);
    assert.equal((await request('POST', '/auth/activate-account', undefined, { schoolId, phone: teacherPhone, password, code: issued.body.code })).status, 200);
    const activated = await userRepository.getByPhone(teacherPhone);
    assert(activated);
    userIds.push(activated.id);
    assert.notEqual(activated.id, teacher.id);
    assert.equal((await db.query('SELECT user_id FROM teacher_profiles WHERE id=$1', [teacher.id])).rows[0].user_id, activated.id);
    let teacherToken = await login(teacherPhone);
    stage = 'availability and booking lifecycle';
    assert.equal((await request('POST', schoolPath + '/availability', teacherToken, { dayOfWeek: new Date(date + 'T00:00:00Z').getUTCDay(), startTime: '10:00', endTime: '11:00', slotDurationMinutes: 15 })).status, 200);
    const visible = await request('GET', schoolPath + '/teachers', parent.token);
    assert((visible.body.teachers as TeacherProfile[]).some((entry) => entry.id === teacher.id));
    const slots = await request('GET', schoolPath + '/availability', parent.token);
    assert((slots.body.availability as Array<{ teacherId: string }>).some((slot) => slot.teacherId === teacher.id));
    await assert.rejects(db.transaction((tx) => notificationRepository.createNotification({
      schoolId, userId: teacher.id, title: 'Local regression fixture', message: 'Local regression fixture',
    }, tx)), (cause: unknown) => typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23503');
    const booked = await request('POST', schoolPath + '/appointments', parent.token, booking);
    assert.equal(booked.status, 200);
    const appointment = booked.body.appointment as Appointment;
    assert(appointment.id);
    assert.equal(appointment.teacherId, teacher.id);
    assert.equal((await request('GET', '/user/me', parent.token)).status, 200);
    assert((await request('GET', schoolPath + '/appointments', teacherToken)).body.appointments instanceof Array);
    const owned = (await request('GET', schoolPath + '/appointments', teacherToken)).body.appointments as Appointment[];
    assert(owned.some((entry) => entry.id === appointment.id));
    const notifications = await db.query('SELECT user_id FROM notifications WHERE school_id=$1 AND appointment_id=$2', [schoolId, appointment.id]);
    assert.equal(notifications.rows[0].user_id, activated.id);
    stage = 'management authorization';
    const manage = schoolPath + '/management';
    const edit = { fullName: 'Updated Teacher', branch: 'Matematik', phone: teacherPhone };
    for (const token of [parent.token, security.token, teacherToken, otherAdmin.token]) {
      assert.equal((await request('PATCH', manage + '/teacher/' + teacher.id, token, edit)).status, 403);
      assert.equal((await request('DELETE', manage + '/teacher/' + teacher.id, token)).status, 403);
      assert.equal((await request('DELETE', manage + '/audit-logs', token)).status, 403);
      for (const [kind, id] of [['parent',parent.id],['security',security.id],['student',studentId]]) {
        assert.equal((await request('PATCH', manage + '/' + kind + '/' + id, token, {})).status, 403);
        if (kind !== 'student') assert.equal((await request('DELETE', manage + '/' + kind + '/' + id, token)).status, 403);
      }
    }
    assert.equal((await request('PATCH', manage + '/teacher/' + teacher.id, admin.token, edit, otherSchool)).status, 400);
    assert.equal((await request('PATCH', manage + '/parent/' + otherParent.id, admin.token, { fullName: 'Blocked Person', phone: otherParent.phone })).status, 404);
    assert.equal((await request('DELETE', manage + '/parent/' + otherParent.id, admin.token)).status, 404);
    assert.equal((await request('PATCH', manage + '/teacher/' + teacher.id, admin.token, { ...edit, phone: '123' })).status, 400);
    assert.equal((await request('PATCH', manage + '/teacher/' + teacher.id, admin.token, { ...edit, phone: parent.phone })).status, 409);
    stage = 'teacher identity edit';
    const newTeacherPhone = phone();
    assert.equal((await request('PATCH', manage + '/teacher/' + teacher.id, admin.token, { ...edit, phone: '0' + newTeacherPhone.slice(3), schoolId: otherSchool })).status, 200);
    const changedTeacher = (await db.query('SELECT * FROM teacher_profiles WHERE id=$1', [teacher.id])).rows[0];
    assert.equal(changedTeacher.user_id, activated.id);
    assert.equal(changedTeacher.phone, newTeacherPhone);
    assert.equal(changedTeacher.first_name, 'Updated');
    assert.equal(changedTeacher.branch, 'Matematik');
    assert.equal((await request('GET', '/user/me', teacherToken)).status, 401);
    assert.equal((await request('POST', '/auth/login', undefined, { phone: teacherPhone, password })).status, 401);
    teacherToken = await login(newTeacherPhone);
    stage = 'parent student security edit';
    const parentPhone = phone();
    assert.equal((await request('PATCH', manage + '/parent/' + parent.id, admin.token, { fullName: 'Updated Parent', phone: parentPhone })).status, 200);
    assert.equal((await userRepository.getByPhone(parentPhone))?.id, parent.id);
    assert.equal((await request('PATCH', manage + '/student/' + studentId, admin.token, { name: 'Updated Student', className: '6-A', studentNumber: '42' })).status, 200);
    const student = (await db.query('SELECT * FROM students WHERE id=$1', [studentId])).rows[0];
    assert.equal(student.name, 'Updated Student');
    assert.equal(student.class_name, '6-A');
    assert.equal(student.student_number, '42');
    const rosterRecord = (await db.query('SELECT * FROM school_roster WHERE school_id=$1', [schoolId])).rows[0];
    assert.equal(rosterRecord.student_name, 'Updated Student');
    assert.equal(rosterRecord.parent_phone, parentPhone);
    assert.equal((await db.query('SELECT * FROM student_parent_relations WHERE student_id=$1 AND parent_user_id=$2', [studentId, parent.id])).rows.length, 1);
    const securityPhone = phone();
    assert.equal((await request('PATCH', manage + '/security/' + security.id, admin.token, { fullName: 'Updated Security', phone: securityPhone })).status, 200);
    const securityToken = await login(securityPhone);
    assert.equal((await request('GET', schoolPath + '/appointments', securityToken)).status, 200);
    stage = 'multi-school identity protection';
    await membershipRepository.createOrActivate({ schoolId: otherSchool, userId: parent.id, role: 'parent' });
    assert.equal((await request('PATCH', manage + '/parent/' + parent.id, admin.token, { fullName: 'Unsafe Change', phone: parentPhone })).status, 409);
    stage = 'safe removal and history';
    const preserved: Array<{ id: string; status: string }> = [];
    for (const [status, fixtureDate] of [['pending','2000-01-01'], ['booked','2091-01-01'], ['checked_in','2000-01-02'], ['checked_out','2091-01-03'], ['completed','2000-01-04'], ['cancelled','2091-01-05']]) {
      const id = 'history-' + crypto.randomUUID();
      await db.query(`INSERT INTO appointments SELECT (jsonb_populate_record(NULL::appointments, to_jsonb(a) || $2::jsonb)).*
        FROM appointments a WHERE a.id=$1`, [appointment.id, JSON.stringify({ id,status,date: fixtureDate, qr_token: null })]);
      preserved.push({ id, status: status === 'booked' || status === 'checked_in' ? 'cancelled' : status });
    }
    const otherTeacher = await request('POST', schoolPath + '/teachers', admin.token, { fullName: 'Other Teacher', branch: 'Türkçe', phone: phone() });
    assert.equal(otherTeacher.status, 201);
    const otherAppointment = 'other-' + crypto.randomUUID();
    await db.query(`INSERT INTO appointments SELECT (jsonb_populate_record(NULL::appointments, to_jsonb(a) || $2::jsonb)).*
      FROM appointments a WHERE a.id=$1`, [appointment.id, JSON.stringify({ id: otherAppointment, teacher_id: (otherTeacher.body.teacher as TeacherProfile).id, qr_token: null })]);
    const foreignTeacher = await request('POST', '/schools/' + otherSchool + '/teachers', otherAdmin.token, { fullName: 'Foreign Teacher', branch: 'Türkçe', phone: phone() });
    assert.equal(foreignTeacher.status, 201);
    const foreignAppointment = 'foreign-' + crypto.randomUUID();
    await db.query(`INSERT INTO appointments SELECT (jsonb_populate_record(NULL::appointments, to_jsonb(a) || $2::jsonb)).*
      FROM appointments a WHERE a.id=$1`, [appointment.id, JSON.stringify({ id: foreignAppointment, school_id: otherSchool,
        teacher_id: (foreignTeacher.body.teacher as TeacherProfile).id, parent_id: otherParent.id, student_id: null, qr_token: null })]);
    await db.query('UPDATE appointments SET checked_in_by=$2 WHERE school_id=$3 AND id=$1', [appointment.id,security.id,schoolId]);
    const createAuditLog = auditLogRepository.createAuditLog;
    auditLogRepository.createAuditLog = async (log, tx) => {
      if (log.action === 'teacher.removed') throw new Error('Local rollback fixture');
      return createAuditLog(log, tx);
    };
    try {
      assert.equal((await request('DELETE', manage + '/teacher/' + teacher.id, admin.token)).status, 500);
      assert.equal((await db.query('SELECT status FROM appointments WHERE id=$1', [appointment.id])).rows[0].status, 'pending');
      assert.equal((await membershipRepository.getActiveMembership(activated.id, schoolId))?.role, 'teacher');
    } finally { auditLogRepository.createAuditLog = createAuditLog; }
    assert.equal((await request('DELETE', manage + '/teacher/' + teacher.id, admin.token)).status, 200);
    const cancelled = (await db.query('SELECT status,notes FROM appointments WHERE id=$1', [appointment.id])).rows[0];
    assert.equal(cancelled.status, 'cancelled');
    assert.match(cancelled.notes, /okul erişimi/);
    for (const entry of preserved) assert.equal((await db.query('SELECT status FROM appointments WHERE id=$1', [entry.id])).rows[0].status, entry.status);
    for (const id of [otherAppointment, foreignAppointment]) assert.equal((await db.query('SELECT status FROM appointments WHERE id=$1', [id])).rows[0].status, 'pending');
    const removalLog = (await db.query("SELECT details FROM audit_logs WHERE school_id=$1 AND action='teacher.removed'", [schoolId])).rows;
    assert(removalLog.some((entry) => JSON.parse(entry.details).cancelledAppointments === 3));
    assert.equal((await request('DELETE', manage + '/parent/' + parent.id, admin.token)).status, 200);
    assert.equal((await request('DELETE', manage + '/security/' + security.id, admin.token)).status, 200);
    assert.equal((await request('GET', schoolPath + '/appointments', securityToken)).status, 403);
    assert.equal((await request('POST', schoolPath + '/security/check-in', securityToken, { qrToken: 'VELIQR1:' + 'A'.repeat(32) })).status, 403);
    assert.equal((await request('GET', schoolPath + '/appointments', teacherToken)).status, 403);
    assert.equal((await membershipRepository.getActiveMembership(parent.id, otherSchool))?.role, 'parent');
    assert.equal((await db.query('SELECT teacher_id,parent_id FROM appointments WHERE id=$1', [appointment.id])).rows[0].teacher_id, teacher.id);
    assert.equal((await db.query('SELECT checked_in_by FROM appointments WHERE id=$1', [appointment.id])).rows[0].checked_in_by, security.id);
    for (const userId of [activated.id, parent.id, security.id]) assert(await userRepository.getById(userId));
    stage = 'platform school authorization and disable';
    for (const token of [admin.token, otherAdmin.token, teacherToken, securityToken, await login(parentPhone)]) {
      assert.equal((await request('GET', '/platform/capabilities', token)).body.manageSchools, false);
      assert.equal((await request('GET', '/platform/schools', token)).status, 403);
      assert.equal((await request('POST', '/platform/schools', token, { name: 'Forbidden', code: 'FORBIDDEN', city: 'Test', district: 'Test' })).status, 403);
      assert.equal((await request('PATCH', '/platform/schools/' + otherSchool + '/status', token, { active: false, platformAdmin: true })).status, 403);
    }
    assert.equal((await request('GET', '/platform/schools')).status, 401);
    process.env.PLATFORM_ADMIN_USER_IDS = admin.id;
    assert.equal((await request('GET', '/platform/capabilities', admin.token)).body.manageSchools, true);
    assert.equal((await request('POST', '/platform/schools', admin.token, { name: '', code: 'ABC', city: 'Test', district: 'Test' })).status, 400);
    const schoolData = { name: 'Created School', code: 'T-' + crypto.randomUUID(), city: 'Test', district: 'Test' };
    const newSchool = await request('POST', '/platform/schools', admin.token, schoolData);
    assert.equal(newSchool.status, 201);
    const newSchoolId = (newSchool.body.school as { id: string }).id;
    createdSchoolIds.push(newSchoolId);
    assert.equal((await membershipRepository.getActiveMembership(admin.id, newSchoolId))?.role, 'admin');
    const newSettings = (await request('GET', '/schools/' + newSchoolId + '/settings', admin.token)).body.settings as Record<string, unknown>;
    assert.equal(newSettings.schoolName, schoolData.name);
    assert.equal(newSettings.defaultSlotMinutes, 15);
    assert.equal((await request('POST', '/platform/schools', admin.token, { ...schoolData, code: schoolData.code.toLowerCase() })).status, 409);
    const membershipsBefore = (await db.query('SELECT * FROM school_memberships WHERE school_id=$1 ORDER BY id', [otherSchool])).rows;
    const foreignProfile = foreignTeacher.body.teacher as TeacherProfile;
    const foreignActivation = await request('POST', '/schools/' + otherSchool + '/auth-codes', otherAdmin.token,
      { targetType: 'teacher', targetId: foreignProfile.id, purpose: 'ACCOUNT_ACTIVATION' });
    assert.equal(foreignActivation.status, 200);
    const foreignRosterId = 'roster-' + crypto.randomUUID();
    await db.query(`INSERT INTO school_roster(id,school_id,parent_phone,parent_name,student_name,class_name,is_claimed)
      VALUES($1,$2,$3,$4,$5,$6,TRUE)`, [foreignRosterId,otherSchool,otherParent.phone,'Fixture Parent','Fixture Student','5-A']);
    const foreignReset = await request('POST', '/schools/' + otherSchool + '/auth-codes', otherAdmin.token,
      { rosterId: foreignRosterId, purpose: 'PASSWORD_RESET' });
    assert.equal(foreignReset.status, 200);
    const authBefore = await userRepository.getAuthByPhone(otherParent.phone);
    assert.equal((await request('PATCH', '/platform/schools/' + otherSchool + '/status', admin.token, { active: false })).status, 200);
    assert.equal((await db.query("SELECT status FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role='admin'", [otherSchool,otherAdmin.id])).rows[0].status, 'active');
    assert.equal(await requireSchoolMembership(otherAdmin.id, otherSchool), null);
    await assert.rejects(requireSchoolRole(otherAdmin.id, otherSchool, ['admin']), /aktif üyeliğiniz bulunmamaktadır/);
    assert.equal((await request('GET', '/schools/' + otherSchool + '/appointments', otherAdmin.token)).status, 403);
    assert.equal(await membershipRepository.getActiveMembership(otherParent.id, otherSchool), null);
    const schools = (await request('GET', '/public/schools')).body.schools as Array<{ id: string }>;
    assert(!schools.some((entry) => entry.id === otherSchool));
    assert.equal((await request('GET', '/public/school-context?code=' + otherSchool)).status, 404);
    assert.equal((await request('POST', '/auth/activate-account', undefined, { schoolId: otherSchool, phone: foreignProfile.phone, password, code: foreignActivation.body.code })).status, 400);
    assert.equal(await userRepository.getByPhone(foreignProfile.phone), null);
    assert.equal((await request('POST', '/auth/reset-password-with-code', undefined, { schoolId: otherSchool, phone: otherParent.phone, password, code: foreignReset.body.code })).status, 400);
    const authAfter = await userRepository.getAuthByPhone(otherParent.phone);
    assert(authBefore?.passwordHash === authAfter?.passwordHash && authBefore?.authVersion === authAfter?.authVersion);
    const foreignCodes = (await db.query('SELECT consumed_at FROM invitations WHERE school_id=$1', [otherSchool])).rows;
    assert(foreignCodes.length >= 2 && foreignCodes.every((entry) => entry.consumed_at === null));
    assert.equal((await request('POST', '/onboarding/check-roster', otherParent.token, { schoolId: otherSchool })).status, 404);
    assert.equal((await request('POST', '/onboarding/claim-students', otherParent.token, { schoolId: otherSchool })).status, 404);
    assert.deepEqual((await db.query('SELECT * FROM school_memberships WHERE school_id=$1 ORDER BY id', [otherSchool])).rows, membershipsBefore);
    assert.equal((await db.query('SELECT status FROM appointments WHERE id=$1', [foreignAppointment])).rows[0].status, 'pending');
    assert.equal((await request('GET', schoolPath + '/appointments', admin.token)).status, 200);
    assert.equal((await request('PATCH', '/platform/schools/' + otherSchool + '/status', admin.token, { active: true })).status, 200);
    assert.equal((await requireSchoolMembership(otherAdmin.id, otherSchool))?.role, 'admin');
    assert.equal((await request('GET', '/schools/' + otherSchool + '/appointments', otherAdmin.token)).status, 200);
    assert.equal((await request('PATCH', '/platform/schools/' + schoolId + '/status', admin.token, { active: false })).status, 200);
    assert.equal((await request('GET', '/platform/schools', admin.token)).status, 200);
    assert.equal((await request('PATCH', '/platform/schools/' + schoolId + '/status', admin.token, { active: true })).status, 200);
    delete process.env.PLATFORM_ADMIN_USER_IDS;
    assert.equal((await request('GET', '/platform/schools', admin.token)).status, 403);
    stage = 'tenant audit clear';
    const pendingId = 'roster-' + crypto.randomUUID();
    await db.query(`INSERT INTO school_roster(id,school_id,parent_phone,parent_name,student_name,class_name)
      VALUES($1,$2,$3,$4,$5,$6)`, [pendingId,schoolId,phone(),'Pending Parent','Pending Student','5-A']);
    const pendingPhone = phone();
    const pendingEdit = { parentName: 'Updated Pending', parentPhone: '0' + pendingPhone.slice(3), studentName: 'Updated Pending Student', className: '6-B', studentNumber: '123' };
    assert.equal((await request('PATCH', manage + '/roster/' + pendingId, otherAdmin.token, pendingEdit)).status, 403);
    assert.equal((await request('PATCH', manage + '/roster/' + pendingId, admin.token, pendingEdit)).status, 200);
    const pendingRecord = (await db.query('SELECT * FROM school_roster WHERE school_id=$1 AND id=$2', [schoolId,pendingId])).rows[0];
    assert.equal(pendingRecord.parent_phone,pendingPhone);
    assert.equal(pendingRecord.student_number,'123');
    assert.equal(pendingRecord.is_claimed,false);
    assert.equal(await userRepository.getByPhone(pendingPhone),null);
    const foreignBefore = await db.query('SELECT id FROM audit_logs WHERE school_id=$1', [otherSchool]);
    assert(foreignBefore.rows.length > 0);
    assert.equal((await request('DELETE', manage + '/audit-logs', admin.token)).status, 200);
    assert.equal((await db.query('SELECT id FROM audit_logs WHERE school_id=$1', [schoolId])).rows.length, 0);
    assert.deepEqual((await db.query('SELECT id FROM audit_logs WHERE school_id=$1', [otherSchool])).rows, foreignBefore.rows);
    console.log('Admin hardening: lifecycle, 5-digit codes, edits, removal rollback/auto-cancel, history, platform school authorization/disable, tenant guards and audit clear PASS.');
  } finally {
    if (previousPlatformAdmins === undefined) delete process.env.PLATFORM_ADMIN_USER_IDS;
    else process.env.PLATFORM_ADMIN_USER_IDS = previousPlatformAdmins;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const id of createdSchoolIds) await db.query('DELETE FROM schools WHERE id=$1', [id]);
    await db.query('DELETE FROM schools WHERE id IN ($1,$2)', [schoolId, otherSchool]);
    for (const id of userIds) await db.query('DELETE FROM users WHERE id=$1', [id]);
  }
}
run().catch((cause: unknown) => {
  const location = cause instanceof Error ? cause.stack?.split('\n').find((line) => line.includes('test-admin-hardening.ts:'))?.trim() : undefined;
  console.error('Admin hardening FAILED at stage: ' + stage + '. ' + (location || '') + ' No credentials logged.');
  if (typeof cause === 'object' && cause !== null && 'code' in cause) console.error('Failure code: ' + String(cause.code));
  process.exitCode = 1;
});
