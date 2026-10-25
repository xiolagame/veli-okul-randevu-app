import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local PGlite is required.');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'local-whatsapp-jwt-secret-at-least-32-characters';
  process.env.AUTH_CODE_SECRET = 'local-whatsapp-code-secret-at-least-32-characters';
  process.env.WHATSAPP_AUTH_ENABLED = 'true';
  process.env.WHATSAPP_PILOT_ENABLED = 'true';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
  process.env.WHATSAPP_ACCESS_TOKEN = 'local-test-token-not-a-real-credential';
  process.env.WHATSAPP_GRAPH_API_VERSION = 'v25.0';

  const realFetch = globalThis.fetch;
  const deliveredCodes: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith('https://graph.facebook.com/')) {
      const payload = JSON.parse(String(init?.body || '{}')) as { template?: { components?: Array<{ parameters?: Array<{ text?: string }> }> } };
      const code = payload.template?.components?.[0]?.parameters?.[0]?.text;
      assert.match(code || '', /^\d{6}$/);
      deliveredCodes.push(code!);
      return new Response(JSON.stringify({ messages: [{ id: 'test-message' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken, verifyToken } = await import('../server/auth');
  const { hashPassword } = await import('../server/passwords');
  const { membershipRepository, userRepository } = await import('../server/repositories');
  const db = await getDb();
  const suffix = crypto.randomUUID();
  const schoolA = `wa-a-${suffix}`;
  const schoolB = `wa-b-${suffix}`;
  const schoolC = `wa-c-${suffix}`;
  const codeA = `WA${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const codeB = `WB${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const codeC = `WC${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const parentPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const teacherPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const unknownPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const securityPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const deletionPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  process.env.WHATSAPP_PILOT_ALLOWED_PHONES = [parentPhone, teacherPhone, securityPhone, deletionPhone].join(',');
  const createdUsers: string[] = [];
  const previousPlatformAdmins = process.env.PLATFORM_ADMIN_USER_IDS;

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  async function request(method: string, path: string, body?: object, token?: string) {
    try {
      const response = await realFetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
    } catch (cause) {
      const transportMessage = cause instanceof Error
        ? `${cause.message}${cause.cause instanceof Error ? `: ${cause.cause.message}` : ''}`
        : 'unknown transport error';
      throw new Error(`${method} ${path} transport failed: ${transportMessage}`);
    }
  }
  async function requestCode(purpose: 'login' | 'parent_registration' | 'staff_activation', phone: string, schoolCode?: string) {
    const response = await request('POST', '/auth/whatsapp/request-code', { purpose, phone, schoolCode });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.match(response.body.challengeId, /^[0-9a-f-]{36}$/i);
    return { challengeId: response.body.challengeId as string, code: deliveredCodes.at(-1) || '' };
  }

  try {
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10),($11,$12,$13,$14,$15)',
      [schoolA, 'WhatsApp School A', codeA, 'Test', 'Test', schoolB, 'WhatsApp School B', codeB, 'Test', 'Test', schoolC, 'WhatsApp School C', codeC, 'Test', 'Test']);
    const parent = await userRepository.create({ phone: parentPhone, firstName: 'Ortak', lastName: 'Hesap', isPhoneVerified: false });
    createdUsers.push(parent.id);
    await userRepository.updatePasswordHash(parent.id, hashPassword('Aa12345'));
    await membershipRepository.createOrActivate({ schoolId: schoolA, userId: parent.id, role: 'admin' });
    await membershipRepository.createOrActivate({ schoolId: schoolC, userId: parent.id, role: 'admin' });
    process.env.PLATFORM_ADMIN_USER_IDS = parent.id;
    await db.query(`INSERT INTO school_roster(school_id,parent_phone,parent_name,student_name,class_name,student_number,is_claimed)
      VALUES($1,$2,$3,$4,$5,$6,FALSE),($1,$2,$3,$7,$8,$9,FALSE)`,
      [schoolA, parentPhone, 'Ortak Hesap', 'Birinci Çocuk', '5-A', '101', 'İkinci Çocuk', '3-B', '202']);

    const callsBeforeUnknown = deliveredCodes.length;
    const unknown = await request('POST', '/auth/whatsapp/request-code', { purpose: 'login', phone: unknownPhone });
    assert.equal(unknown.status, 200);
    assert.equal(deliveredCodes.length, callsBeforeUnknown);
    assert.notEqual((await request('POST', '/auth/parent/registration-challenge', { schoolCode: codeA, phone: parentPhone, code: '000000' })).status, 404,
      'legacy mobile parent activation endpoint must remain available during WhatsApp rollout');

    const registration = await requestCode('parent_registration', parentPhone, codeA);
    assert.match(registration.code, /^\d{6}$/);
    const wrong = await request('POST', '/auth/whatsapp/verify-code', { challengeId: registration.challengeId, phone: parentPhone, code: '000000' });
    assert.equal(wrong.status, 401);
    const activated = await request('POST', '/auth/whatsapp/verify-code', { challengeId: registration.challengeId, phone: parentPhone, code: registration.code });
    assert.equal(activated.status, 200);
    const parentToken = activated.body.token as string;
    assert.equal(activated.body.memberships.length, 1);
    assert.equal(activated.body.memberships[0].role, 'parent');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM student_parent_relations WHERE school_id=$1 AND parent_user_id=$2', [schoolA, parent.id])).rows[0].count, 2);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM school_roster WHERE school_id=$1 AND is_claimed=TRUE', [schoolA])).rows[0].count, 2);
    assert.equal((await request('POST', '/auth/whatsapp/verify-code', { challengeId: registration.challengeId, phone: parentPhone, code: registration.code })).status, 401);
    assert.equal((await request('GET', `/schools/${schoolA}/management/parents`, undefined, parentToken)).status, 403);
    assert.equal((await request('GET', '/platform/capabilities', undefined, parentToken)).body.manageSchools, false);
    assert.equal((await request('GET', `/schools/${schoolB}/teachers`, undefined, parentToken)).status, 403);
    assert.equal((await request('GET', `/schools/${schoolC}/students`, undefined, parentToken)).status, 403);

    await db.query(`INSERT INTO school_roster(school_id,parent_phone,parent_name,student_name,class_name,student_number,is_claimed)
      VALUES($1,$2,$3,$4,$5,$6,FALSE)`, [schoolB, parentPhone, 'Ortak Hesap', 'Üçüncü Çocuk', '6-C', '303']);
    const secondSchool = await requestCode('parent_registration', parentPhone, codeB);
    const secondSchoolLogin = await request('POST', '/auth/whatsapp/verify-code', { challengeId: secondSchool.challengeId, phone: parentPhone, code: secondSchool.code });
    assert.equal(secondSchoolLogin.status, 200);
    assert.deepEqual(secondSchoolLogin.body.memberships.map((entry: { schoolId: string; role: string }) => `${entry.schoolId}:${entry.role}`).sort(),
      [`${schoolA}:parent`, `${schoolB}:parent`].sort());
    const visibleSchools = (await request('GET', '/public/schools', undefined, secondSchoolLogin.body.token as string)).body.schools as Array<{ id: string }>;
    assert.deepEqual(visibleSchools.map((entry) => entry.id).sort(), [schoolA, schoolB].sort());

    const expired = await requestCode('login', parentPhone);
    await db.query("UPDATE whatsapp_auth_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [expired.challengeId]);
    assert.equal((await request('POST', '/auth/whatsapp/verify-code', { challengeId: expired.challengeId, phone: parentPhone, code: expired.code })).status, 401);
    const concurrent = await requestCode('login', parentPhone);
    const concurrentResults = await Promise.all([
      request('POST', '/auth/whatsapp/verify-code', { challengeId: concurrent.challengeId, phone: parentPhone, code: concurrent.code }),
      request('POST', '/auth/whatsapp/verify-code', { challengeId: concurrent.challengeId, phone: parentPhone, code: concurrent.code }),
    ]);
    assert.deepEqual(concurrentResults.map((result) => result.status).sort(), [200, 401]);

    const teacherId = `wa-teacher-${suffix}`;
    await db.query(`INSERT INTO teacher_profiles(id,school_id,first_name,last_name,branch,phone,email)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [teacherId, schoolA, 'Test', 'Öğretmen', 'Türkçe', teacherPhone, 'teacher@example.test']);
    const staff = await requestCode('staff_activation', teacherPhone, codeA);
    assert.equal((await request('POST', '/auth/whatsapp/request-code', { purpose: 'staff_activation', phone: teacherPhone, schoolCode: codeA })).status, 429);
    await db.query("UPDATE whatsapp_auth_challenges SET resend_available_at=NOW()-INTERVAL '1 second' WHERE id=$1", [staff.challengeId]);
    const resentStaff = await requestCode('staff_activation', teacherPhone, codeA);
    assert.equal((await request('POST', '/auth/whatsapp/verify-code', { challengeId: staff.challengeId, phone: teacherPhone, code: staff.code })).status, 401);
    const conflictingTeacherId = `wa-conflicting-teacher-${suffix}`;
    await db.query(`INSERT INTO teacher_profiles(id,school_id,first_name,last_name,branch,phone,email)
      VALUES($1,$2,'Başka','Öğretmen','Matematik',$3,$4)`, [conflictingTeacherId, schoolB, teacherPhone, 'conflict@example.test']);
    assert.equal((await request('POST', '/auth/whatsapp/verify-code', { challengeId: resentStaff.challengeId, phone: teacherPhone, code: resentStaff.code })).status, 409);
    await db.query('DELETE FROM teacher_profiles WHERE id=$1', [conflictingTeacherId]);
    const staffLogin = await request('POST', '/auth/whatsapp/verify-code', { challengeId: resentStaff.challengeId, phone: teacherPhone, code: resentStaff.code });
    assert.equal(staffLogin.status, 200);
    const teacher = await userRepository.getByPhone(teacherPhone);
    assert(teacher);
    createdUsers.push(teacher.id);
    assert.equal((await membershipRepository.getActiveMembership(teacher.id, schoolA))?.role, 'teacher');
    assert.equal((await db.query('SELECT user_id FROM teacher_profiles WHERE id=$1', [teacherId])).rows[0].user_id, teacher.id);

    const pendingSecurityId = `wa-security-${suffix}`;
    await db.query(`INSERT INTO pending_staff(id,school_id,role,first_name,last_name,phone,email)
      VALUES($1,$2,'security','Test','Güvenlik',$3,$4)`, [pendingSecurityId, schoolA, securityPhone, 'security@example.test']);
    const limited = await requestCode('staff_activation', securityPhone, codeA);
    const invalidLimitedCode = String((Number(limited.code) + 1) % 1_000_000).padStart(6, '0');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await request('POST', '/auth/whatsapp/verify-code', { challengeId: limited.challengeId, phone: securityPhone, code: invalidLimitedCode })).status, 401);
    }
    assert.equal((await request('POST', '/auth/whatsapp/verify-code', { challengeId: limited.challengeId, phone: securityPhone, code: limited.code })).status, 401);
    const limitedRow = (await db.query<{ attempts: number; revoked_at: string | null }>('SELECT attempts,revoked_at FROM whatsapp_auth_challenges WHERE id=$1', [limited.challengeId])).rows[0];
    assert.equal(limitedRow.attempts, 5);
    assert(limitedRow.revoked_at);
    const recoveredSecurity = await requestCode('staff_activation', securityPhone, codeA);
    const securityLogin = await request('POST', '/auth/whatsapp/verify-code', { challengeId: recoveredSecurity.challengeId, phone: securityPhone, code: recoveredSecurity.code });
    assert.equal(securityLogin.status, 200);
    const securityUser = await userRepository.getByPhone(securityPhone);
    assert(securityUser);
    createdUsers.push(securityUser.id);
    assert.equal((await membershipRepository.getActiveMembership(securityUser.id, schoolA))?.role, 'security');

    const deletionUser = await userRepository.create({ phone: deletionPhone, firstName: 'Silinecek', lastName: 'WhatsApp', isPhoneVerified: true });
    createdUsers.push(deletionUser.id);
    await membershipRepository.createOrActivate({ schoolId: schoolB, userId: deletionUser.id, role: 'parent' });
    const deletionUserWithVersion = await userRepository.getById(deletionUser.id);
    assert(deletionUserWithVersion);
    const deletionToken = createToken({ userId: deletionUser.id, phone: deletionPhone, auth_version: deletionUserWithVersion.authVersion, auth_method: 'whatsapp_otp' });
    const deletionChallenge = await request('POST', '/user/me/deletion/whatsapp-code', undefined, deletionToken);
    assert.equal(deletionChallenge.status, 200);
    const deletionResult = await request('POST', '/user/me/deletion', {
      whatsappChallengeId: deletionChallenge.body.challengeId,
      whatsappCode: deliveredCodes.at(-1),
      confirmation: 'HESABIMI SİL',
      requestId: crypto.randomUUID(),
    }, deletionToken);
    assert.equal(deletionResult.status, 200);
    assert.equal((await userRepository.getById(deletionUser.id)), null);
    assert.equal((await request('GET', '/user/me', undefined, deletionToken)).status, 401);

    const secret = process.env.JWT_SECRET!;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const noExpBody = Buffer.from(JSON.stringify({ userId: parent.id, phone: parentPhone, auth_version: 0 })).toString('base64url');
    const noExpSignature = crypto.createHmac('sha256', secret).update(`${header}.${noExpBody}`).digest('base64url');
    assert.equal(verifyToken(`${header}.${noExpBody}.${noExpSignature}`), null);
    const validToken = createToken({ userId: parent.id, phone: parentPhone, auth_version: (await userRepository.getById(parent.id))!.authVersion });
    assert.equal(verifyToken(validToken)?.userId, parent.id);
    assert.equal(verifyToken(validToken.slice(0, -1) + (validToken.endsWith('a') ? 'b' : 'a')), null);

    process.env.WHATSAPP_AUTH_ENABLED = 'false';
    process.env.WHATSAPP_PILOT_ENABLED = 'false';
    delete process.env.WHATSAPP_PILOT_ALLOWED_PHONES;
    assert.equal((await request('POST', '/auth/whatsapp/request-code', { purpose: 'login', phone: parentPhone })).status, 503);
    assert.equal((await request('POST', '/auth/login', { phone: parentPhone, password: 'Aa12345' })).status, 200);
    assert.equal((await request('POST', '/auth/parent/registration-challenge', {})).status, 400);
    console.log('WhatsApp auth: feature flag, anti-enumeration, parent multi-child/multi-school activation, teacher/security activation, one-school teacher invariant, resend/attempt limits, passwordless deletion, tenant/admin isolation and JWT hardening PASS.');
  } finally {
    globalThis.fetch = realFetch;
    process.env.PLATFORM_ADMIN_USER_IDS = previousPlatformAdmins;
    process.env.WHATSAPP_AUTH_ENABLED = 'false';
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id IN ($1,$2,$3)', [schoolA, schoolB, schoolC]);
    for (const userId of createdUsers) await db.query('DELETE FROM users WHERE id=$1', [userId]);
  }
}

run().catch((cause) => {
  console.error('WhatsApp authentication test FAILED; no code, phone, token, or response body is logged.', cause instanceof Error ? cause.stack : '');
  process.exitCode = 1;
});
