import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';

let stage = 'setup';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local database required');
  process.env.NODE_ENV = 'test';
  process.env.RESEND_API_KEY = 'local-test-key';
  process.env.EMAIL_FROM = 'local@example.test';
  const originalFetch = globalThis.fetch;
  const previousPlatformAdmins = process.env.PLATFORM_ADMIN_USER_IDS;
  const messages: Array<{ to: string[]; html: string }> = [];
  let failEmail = false;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.resend.com/emails')) {
      if (failEmail) return new Response('{}', { status: 503 });
      const payload = JSON.parse(String(init?.body || '{}')) as { to: string[]; html: string };
      messages.push(payload);
      return new Response('{}', { status: 200 });
    }
    return originalFetch(input, init);
  };
  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { platformTargetContextGuard } = await import('../server/platform-management');
  const { createToken } = await import('../server/auth');
  const { hashSetupToken } = await import('../server/activation-codes');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const { hashPassword } = await import('../server/passwords');
  const db = await getDb();
  assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  const schoolA = `removal-${crypto.randomUUID()}`;
  const schoolB = `removal-${crypto.randomUUID()}`;
  const teacherProfileA = `teacher-${crypto.randomUUID()}`;
  const teacherProfileB = `teacher-${crypto.randomUUID()}`;
  const users: string[] = [];
  const password = crypto.randomBytes(24).toString('base64url');
  const phone = () => '+905' + crypto.randomInt(100000000, 999999999);
  const app = express();
  app.use(express.json());
  app.use('/api/platform-target/:targetSchoolId', platformTargetContextGuard, apiRouter);
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  async function request(method: string, path: string, token?: string, body?: object, reviewToken?: string) {
    const response = await fetch(base + path, { method, headers: {
      'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(reviewToken ? { 'x-appointment-review-token': reviewToken } : {}),
    }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  async function fixture(role: 'admin' | 'parent' | 'teacher' | 'security' | null, school = schoolA) {
    const user = await userRepository.create({ phone: phone(), firstName: 'Local', lastName: 'Fixture' });
    users.push(user.id);
    await userRepository.updatePasswordHash(user.id, hashPassword(password));
    if (role) await membershipRepository.createOrActivate({ schoolId: school, userId: user.id, role });
    return { ...user, token: createToken({ userId: user.id, phone: user.phone, auth_version: 0 }) };
  }
  async function student(parent: { id: string; phone: string }, name: string, number: string, school = schoolA) {
    const id = `student-${crypto.randomUUID()}`;
    await db.query('INSERT INTO students(id,school_id,name,class_name,student_number) VALUES($1,$2,$3,$4,$5)',
      [id, school, name, '5-A', number]);
    await db.query('INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES($1,$2,$3)', [school, id, parent.id]);
    await db.query(`INSERT INTO school_roster(school_id,parent_phone,parent_name,student_name,class_name,student_number,is_claimed)
      VALUES($1,$2,'LOCAL FIXTURE',$3,'5-A',$4,TRUE)`, [school, parent.phone, name, number]);
    return id;
  }
  const schoolPath = `/schools/${schoolA}`;
  try {
    stage = 'fixture setup';
    for (const id of [schoolA, schoolB]) await db.query(
      'INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [id, 'Local school', id, 'Test', 'Test']);
    const admin = await fixture('admin');
    const otherAdmin = await fixture('admin', schoolB);
    const platform = await fixture(null);
    const parentOnly = await fixture('parent');
    const parentSibling = await fixture('parent');
    const parentRole = await fixture('parent');
    await membershipRepository.createOrActivate({ schoolId: schoolB, userId: parentRole.id, role: 'teacher' });
    const teacherA = await fixture('teacher');
    const teacherB = await fixture('teacher');
    const foreignTeacher = await fixture('teacher', schoolB);
    const security = await fixture('security');
    const onlyStudent = await student(parentOnly, 'ONLY STUDENT', '11');
    const siblingOne = await student(parentSibling, 'SIBLING ONE', '12');
    const siblingTwo = await student(parentSibling, 'SIBLING TWO', '13');
    const roleStudent = await student(parentRole, 'ROLE STUDENT', '14');
    const foreignStudent = await student(parentRole, 'FOREIGN STUDENT', '15', schoolB);
    await db.query(`INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch,phone,email)
      VALUES ($1,$2,$3,'LOCAL','TEACHER A','Türkçe',$4,'teacher-a@example.test'),
        ($5,$2,$6,'LOCAL','TEACHER B','Matematik',$7,'teacher-b@example.test')`,
      [teacherProfileA, schoolA, teacherA.id, teacherA.phone, teacherProfileB, teacherB.id, teacherB.phone]);
    const removal = (id: string) => `${schoolPath}/management/students/${id}/removal`;
    stage = 'removal authorization';
    for (const token of [parentOnly.token, teacherA.token, security.token, otherAdmin.token]) {
      assert.equal((await request('DELETE', removal(onlyStudent), token)).status, 403);
    }
    assert.equal((await request('DELETE', removal(foreignStudent), admin.token)).status, 404);
    assert.equal((await db.query('SELECT id FROM students WHERE id=$1', [foreignStudent])).rows.length, 1);

    const booking = { teacherId: teacherProfileA, studentName: 'ONLY STUDENT', className: '5-A',
      date: '2090-01-02', startTime: '10:00', endTime: '10:15' };
    stage = 'booking and email';
    const booked = await request('POST', `${schoolPath}/appointments`, parentOnly.token, booking);
    assert.equal(booked.status, 200);
    const appointmentId = (booked.body.appointment as { id: string }).id;
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].to, ['teacher-a@example.test']);
    for (const text of ['ONLY STUDENT', '5-A', (booked.body.appointment as { parentName: string }).parentName,
      '02/01/2090', '10:00', '10:15', 'Randevu Talebini İncele']) {
      assert(messages[0].html.includes(text));
    }
    const reviewToken = messages[0].html.match(/#appointment-review=[^.]+\.([A-Za-z0-9_-]{43})/)?.[1];
    assert(reviewToken);
    const storedToken = await db.query<{ token: string }>('SELECT token FROM invitations WHERE token=$1', [hashSetupToken(reviewToken)]);
    assert.equal(storedToken.rows[0].token, hashSetupToken(reviewToken));
    assert.notEqual(storedToken.rows[0].token, reviewToken);
    const reviewPath = `${schoolPath}/appointments/email-review`;
    stage = 'review authorization';
    assert.equal((await request('GET', reviewPath, undefined, undefined, reviewToken)).status, 401);
    assert.equal((await request('GET', reviewPath, parentOnly.token, undefined, reviewToken)).status, 403);
    assert.equal((await request('GET', reviewPath, teacherB.token, undefined, reviewToken)).status, 404);
    assert.equal((await request('GET', reviewPath, foreignTeacher.token, undefined, reviewToken)).status, 403);
    assert.equal((await request('GET', `/schools/${schoolB}/appointments/email-review`, foreignTeacher.token, undefined, reviewToken)).status, 404);
    assert.equal((await request('GET', reviewPath, teacherA.token, undefined, 'A'.repeat(43))).status, 404);
    const review = await request('GET', reviewPath, teacherA.token, undefined, reviewToken);
    stage = 'review approval';
    assert.equal(review.status, 200);
    assert(!JSON.stringify(review.body).includes(reviewToken));
    assert.equal((review.body.appointment as { studentName: string }).studentName, 'ONLY STUDENT');
    assert.equal((await db.query('SELECT status FROM appointments WHERE id=$1', [appointmentId])).rows[0].status, 'pending');
    assert.equal((await request('POST', `${reviewPath}/approve`, teacherA.token,
      { appointmentId: 'another-appointment' }, reviewToken)).status, 200);
    assert.equal((await db.query('SELECT status FROM appointments WHERE id=$1', [appointmentId])).rows[0].status, 'booked');
    assert.equal((await request('POST', `${reviewPath}/approve`, teacherA.token, undefined, reviewToken)).status, 404);

    const siblingBooking = { ...booking, studentName: 'SIBLING ONE' };
    async function reviewFixture(startTime: string, endTime: string) {
      const result = await request('POST', `${schoolPath}/appointments`, parentSibling.token,
        { ...siblingBooking, startTime, endTime });
      assert.equal(result.status, 200);
      const token = messages.at(-1)?.html.match(/#appointment-review=[^.]+\.([A-Za-z0-9_-]{43})/)?.[1];
      assert(token);
      return { appointmentId: (result.body.appointment as { id: string }).id, token };
    }
    stage = 'expired link';
    const expired = await reviewFixture('12:00', '12:15');
    await db.query('UPDATE invitations SET expires_at=NOW()-INTERVAL \'1 minute\' WHERE token=$1', [hashSetupToken(expired.token)]);
    assert.equal((await request('GET', reviewPath, teacherA.token, undefined, expired.token)).status, 404);
    assert.equal((await request('POST', `${reviewPath}/approve`, teacherA.token, undefined, expired.token)).status, 404);
    stage = 'revoked link';
    const revoked = await reviewFixture('12:05', '12:20');
    await db.query('UPDATE invitations SET revoked_at=NOW(),is_active=FALSE WHERE token=$1', [hashSetupToken(revoked.token)]);
    assert.equal((await request('GET', reviewPath, teacherA.token, undefined, revoked.token)).status, 404);
    assert.equal((await request('POST', `${reviewPath}/approve`, teacherA.token, undefined, revoked.token)).status, 404);
    stage = 'cancelled and rejected links';
    for (const [startTime, endTime, status] of [['12:15', '12:30', 'cancelled'], ['12:30', '12:45', 'rejected']]) {
      const fixture = await reviewFixture(startTime, endTime);
      await db.query('UPDATE appointments SET status=$2 WHERE id=$1', [fixture.appointmentId, status]);
      assert.equal((await request('POST', `${reviewPath}/approve`, teacherA.token, undefined, fixture.token)).status, 409);
      assert.equal((await db.query('SELECT status FROM appointments WHERE id=$1', [fixture.appointmentId])).rows[0].status, status);
    }
    stage = 'appointment binding';
    const wrongBinding = await reviewFixture('12:45', '13:00');
    await db.query('UPDATE invitations SET description=$2 WHERE token=$1',
      [hashSetupToken(wrongBinding.token), JSON.stringify({ a: wrongBinding.appointmentId, t: teacherProfileA, d: '2090-01-02', s: '10:00', e: '10:15' })]);
    assert.equal((await request('GET', reviewPath, teacherA.token, undefined, wrongBinding.token)).status, 404);
    assert.equal((await request('POST', `${reviewPath}/approve`, teacherA.token, undefined, wrongBinding.token)).status, 404);
    assert.equal((await db.query('SELECT status FROM appointments WHERE id=$1', [wrongBinding.appointmentId])).rows[0].status, 'pending');
    stage = 'already approved link';
    const alreadyApproved = await reviewFixture('13:00', '13:15');
    assert.equal((await request('POST', `${schoolPath}/appointments/${alreadyApproved.appointmentId}/approve`, teacherA.token)).status, 200);
    assert.equal((await request('POST', `${reviewPath}/approve`, teacherA.token, undefined, alreadyApproved.token)).status, 409);

    const successfulEmails = messages.length;
    failEmail = true;
    stage = 'email failure';
    const undelivered = await request('POST', `${schoolPath}/appointments`, parentOnly.token,
      { ...booking, teacherId: teacherProfileB, startTime: '11:00', endTime: '11:15' });
    failEmail = false;
    assert.equal(undelivered.status, 200);
    const undeliveredId = (undelivered.body.appointment as { id: string }).id;
    assert.equal((await db.query('SELECT status FROM appointments WHERE id=$1', [undeliveredId])).rows[0].status, 'pending');
    assert.equal(messages.length, successfulEmails);

    const impact = await request('GET', removal(onlyStudent), admin.token);
    stage = 'orphan removal';
    assert.equal(impact.status, 200);
    assert.equal(impact.body.deletedAccounts, 1);
    assert.equal((await request('DELETE', removal(onlyStudent), admin.token)).status, 200);
    assert.equal((await db.query('SELECT id FROM students WHERE id=$1', [onlyStudent])).rows.length, 0);
    assert.equal((await db.query('SELECT id FROM student_parent_relations WHERE student_id=$1', [onlyStudent])).rows.length, 0);
    assert.equal((await db.query('SELECT id FROM school_roster WHERE student_name=$1 AND school_id=$2', ['ONLY STUDENT', schoolA])).rows.length, 0);
    assert.equal((await db.query('SELECT id FROM users WHERE id=$1', [parentOnly.id])).rows.length, 0);
    assert.equal((await db.query('SELECT id FROM school_memberships WHERE user_id=$1', [parentOnly.id])).rows.length, 0);
    const history = await db.query<{ status: string; parent_id: string | null; student_id: string | null }>(
      'SELECT status,parent_id,student_id FROM appointments WHERE id=$1', [appointmentId]);
    assert.equal(history.rows[0].status, 'cancelled');
    assert.equal(history.rows[0].parent_id, null);
    assert.equal(history.rows[0].student_id, null);
    assert.equal((await db.query('SELECT id FROM notifications WHERE school_id=$1 AND appointment_id=$2', [schoolA, appointmentId])).rows.length, 0);
    assert.equal((await db.query("SELECT id FROM audit_logs WHERE school_id=$1 AND action='Öğrenci Okuldan Kaldırıldı'", [schoolA])).rows.length, 1);
    assert.equal((await db.query('SELECT status FROM appointments WHERE id=$1', [undeliveredId])).rows[0].status, 'cancelled');

    const siblingImpact = await request('GET', removal(siblingOne), admin.token);
    stage = 'sibling preservation';
    assert.equal(siblingImpact.body.siblingAccounts, 1);
    await db.query("UPDATE appointments SET status='checked_in' WHERE id=$1", [expired.appointmentId]);
    assert.equal((await request('DELETE', removal(siblingOne), admin.token)).status, 409);
    assert.equal((await db.query('SELECT id FROM students WHERE id=$1', [siblingOne])).rows.length, 1);
    await db.query("UPDATE appointments SET status='checked_out' WHERE id=$1", [expired.appointmentId]);
    assert.equal((await request('DELETE', removal(siblingOne), admin.token)).status, 200);
    assert.equal((await db.query('SELECT id FROM users WHERE id=$1', [parentSibling.id])).rows.length, 1);
    assert.equal((await db.query('SELECT id FROM students WHERE id=$1', [siblingTwo])).rows.length, 1);
    assert.equal((await db.query('SELECT id FROM student_parent_relations WHERE student_id=$1 AND parent_user_id=$2', [siblingTwo, parentSibling.id])).rows.length, 1);
    assert.equal((await request('POST', '/auth/login', undefined, { phone: parentSibling.phone, password })).status, 200);
    assert.equal((await request('DELETE', removal(roleStudent), admin.token)).status, 200);
    assert.equal((await db.query('SELECT id FROM users WHERE id=$1', [parentRole.id])).rows.length, 1);
    assert.equal((await db.query('SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role=$3', [schoolB, parentRole.id, 'teacher'])).rows.length, 1);

    process.env.PLATFORM_ADMIN_USER_IDS = platform.id;
    stage = 'platform target';
    const platformRemoval = `/platform-target/${schoolA}${removal(siblingTwo)}`;
    assert.equal((await request('DELETE', platformRemoval, parentSibling.token)).status, 403);
    assert.equal((await request('DELETE', platformRemoval, platform.token)).status, 200);
    assert.equal((await db.query('SELECT id FROM students WHERE id=$1', [siblingTwo])).rows.length, 0);
    assert.equal((await db.query('SELECT id FROM students WHERE id=$1', [foreignStudent])).rows.length, 1);
    console.log('Student removal and appointment email review tests PASS. No credentials or tokens logged.');
  } finally {
    if (previousPlatformAdmins === undefined) delete process.env.PLATFORM_ADMIN_USER_IDS;
    else process.env.PLATFORM_ADMIN_USER_IDS = previousPlatformAdmins;
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id IN ($1,$2)', [schoolA, schoolB]);
    for (const id of users) await db.query('DELETE FROM users WHERE id=$1', [id]);
  }
}

run().catch((cause: unknown) => {
  const location = cause instanceof Error ? cause.stack?.split('\n').find((line) => line.includes('test-student-removal-and-appointment-email.ts:'))?.trim() : undefined;
  console.error(`Student removal and appointment email review tests FAILED at ${stage}. ${location || ''} No credentials or response bodies are logged.`);
  process.exitCode = 1;
});
