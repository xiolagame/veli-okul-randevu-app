import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { displayStoredTurkishPhone } from '../src/utils/phone';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('This test requires local PGlite without DATABASE_URL.');
  process.env.NODE_ENV = 'test';
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.RESEND_API_KEY = 'local-test-key';
  process.env.EMAIL_FROM = 'test@example.test';
  const sentEmails: Array<{ to: string; subject: string; html: string }> = [];
  let failNextEmail = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.resend.com/emails')) {
      const payload = JSON.parse(String(init?.body || '{}')) as { to: string[]; subject: string; html: string };
      if (failNextEmail) { failNextEmail = false; return new Response('{}', { status: 503 }); }
      sentEmails.push({ to: payload.to[0], subject: payload.subject, html: payload.html });
      return new Response(JSON.stringify({ id: 'local-test-email' }), { status: 200 });
    }
    return originalFetch(input, init);
  };

  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { platformTargetContextGuard } = await import('../server/platform-management');
  const { createToken } = await import('../server/auth');
  const { generateSetupToken, hashActivationCode, hashSetupToken } = await import('../server/activation-codes');
  const { userRepository, membershipRepository, invitationRepository } = await import('../server/repositories');
  const db = await getDb();
  assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  const suffix = crypto.randomUUID();
  const platformPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const managerPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const expiredPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const otherPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const schoolCode = `SA${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const otherSchoolCode = `SB${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const deniedAdminCode = `SD${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const schoolId = `school-admin-${suffix}`;
  const otherSchoolId = `school-admin-other-${suffix}`;
  const deniedAdminSchoolId = `school-admin-denied-${suffix}`;
  let createdSchoolId = '';
  const platformUser = await userRepository.create({ phone: platformPhone, firstName: 'Platform', lastName: 'Owner' });
  process.env.PLATFORM_ADMIN_USER_IDS = platformUser.id;
  const platformAuth = await userRepository.getById(platformUser.id);
  assert(platformAuth);
  const platformToken = createToken({ userId: platformUser.id, phone: platformUser.phone, auth_version: platformAuth.authVersion });
  const usersToClean = [platformPhone, managerPhone, expiredPhone, otherPhone];
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api/platform-target/:targetSchoolId', platformTargetContextGuard, apiRouter);
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  async function request(method: string, path: string, token?: string, body?: object, clientIp?: string) {
    const input = body as Record<string, unknown> | undefined;
    const payload = input && typeof input.phone === 'string' && /^\+905\d{9}$/.test(input.phone) ? { ...input, phone: displayStoredTurkishPhone(input.phone) } : body;
    const response = await fetch(baseUrl + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(clientIp ? { 'x-forwarded-for': clientIp } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    const text = await response.text();
    try { return { status: response.status, body: JSON.parse(text) as Record<string, unknown> }; }
    catch { throw new Error(`Unexpected non-JSON response: ${method} ${path} ${response.status}`); }
  }
  const emailCode = (index: number) => {
    const code = sentEmails[index]?.html.match(/>(\d{6})</)?.[1];
    assert(code, 'mock email should contain the one-time code');
    return code;
  };
  try {
    const createdSchool = await request('POST', '/platform/schools', platformToken, { name: 'School Admin A', code: schoolCode, city: 'Test', district: 'Test' });
    assert.equal(createdSchool.status, 201);
    createdSchoolId = String((createdSchool.body.school as Record<string, unknown>).id);
    assert(createdSchoolId);
    const platformMembership = await db.query('SELECT id FROM school_memberships WHERE user_id=$1 AND school_id=$2 AND role=\'admin\'', [platformUser.id, createdSchoolId]);
    assert.equal(platformMembership.rows.length, 0, 'platform user must not receive school admin membership');
    assert.equal((await request('GET', `/platform-target/${createdSchoolId}/schools/${createdSchoolId}/info`, platformToken)).status, 200,
      'platform authority should work without a school membership');
    await membershipRepository.createOrActivate({ schoolId: createdSchoolId, userId: platformUser.id, role: 'admin' });
    const legacyManaged = await request('GET', '/platform/schools', platformToken);
    const legacySchool = (legacyManaged.body.schools as Array<Record<string, unknown>>).find((entry) => entry.id === createdSchoolId);
    assert.equal(legacySchool?.adminStatus, 'unassigned', 'legacy platform membership must not appear as a real school manager');

    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [otherSchoolId, 'School Admin B', otherSchoolCode, 'Test', 'Test']);
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [deniedAdminSchoolId, 'School Admin C', deniedAdminCode, 'Test', 'Test']);
    for (const role of ['parent', 'teacher', 'security', 'admin'] as const) {
      const deniedUser = await userRepository.create({ phone: `+905${crypto.randomInt(100000000, 999999999)}`, firstName: 'Denied', lastName: role });
      usersToClean.push(deniedUser.phone);
      await membershipRepository.createOrActivate({ schoolId: role === 'admin' ? deniedAdminSchoolId : createdSchoolId, userId: deniedUser.id, role });
      const deniedAuth = await userRepository.getById(deniedUser.id);
      assert(deniedAuth);
      const deniedToken = createToken({ userId: deniedUser.id, phone: deniedUser.phone, auth_version: deniedAuth.authVersion });
      assert.equal((await request('POST', `/platform/schools/${createdSchoolId}/admin-invitation`, deniedToken,
        { fullName: 'Denied Manager', phone: otherPhone, email: 'denied@example.test' })).status, 403, `${role} must not invite school admins`);
    }

    const invite = await request('POST', `/platform/schools/${createdSchoolId}/admin-invitation`, platformToken,
      { fullName: 'Ada Yönetici', phone: managerPhone, email: 'ada@example.test' });
    assert.equal(invite.status, 201);
    assert.equal(invite.body.emailSent, true);
    assert.equal('code' in invite.body, false);
    assert.equal('setupToken' in invite.body, false);
    assert.equal(sentEmails[0].to, 'ada@example.test');
    assert.match(sentEmails[0].subject, /Okul Yönetimi/);
    const pending = (await db.query<{ id: string; password_hash: string | null }>('SELECT id,password_hash FROM users WHERE phone=$1', [managerPhone])).rows[0];
    assert(pending);
    assert.equal(pending.password_hash, null);
    assert.equal((await db.query('SELECT id FROM school_memberships WHERE user_id=$1', [pending.id])).rows.length, 0);
    const listed = await request('GET', '/platform/schools', platformToken);
    const managedSchool = (listed.body.schools as Array<Record<string, unknown>>).find((entry) => entry.id === createdSchoolId);
    assert.equal(managedSchool?.adminStatus, 'pending');
    assert.equal(managedSchool?.adminName, 'ADA YÖNETİCİ');
    const secondPendingInvite = await request('POST', `/platform/schools/${createdSchoolId}/admin-invitation`, platformToken,
      { fullName: 'İkinci Yönetici', phone: otherPhone, email: 'second@example.test' });
    assert.equal(secondPendingInvite.status, 409, 'another pending school manager must be rejected');
    assert.equal((await db.query("SELECT id FROM invitations WHERE school_id=$1 AND purpose='school_admin_activation' AND is_active=TRUE AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW()", [createdSchoolId])).rows.length, 1);
    assert.equal(await userRepository.getByPhone(otherPhone), null, 'rejected invite must not create an account');

    await db.query("UPDATE invitations SET created_at=NOW()-INTERVAL '61 seconds' WHERE school_id=$1 AND purpose='school_admin_activation'", [createdSchoolId]);
    const resent = await request('POST', `/platform/schools/${createdSchoolId}/admin-invitation/resend`, platformToken);
    assert.equal(resent.status, 200);
    assert.equal(resent.body.emailSent, true);
    const activationCode = emailCode(1);
    assert.equal((await request('POST', '/auth/school-admin/activation-verify', undefined,
      { schoolCode: otherSchoolCode, phone: managerPhone, code: activationCode }, '192.0.2.11')).status, 400, 'wrong school must fail');
    assert.equal((await request('POST', '/auth/school-admin/activation-verify', undefined,
      { schoolCode, phone: expiredPhone, code: activationCode }, '192.0.2.12')).status, 400, 'wrong phone must fail');
    assert.equal((await request('POST', '/auth/school-admin/activation-verify', undefined,
      { schoolCode, phone: managerPhone, code: '000000' }, '192.0.2.13')).status, 400, 'wrong code must fail');
    let clientIp = 14;
    for (const [purpose, role, code] of [['staff_activation', 'teacher', '123456'], ['staff_activation', 'security', '234567'], ['parent_password_reset', 'parent', '345678']] as const) {
      await invitationRepository.createAuthCode({ schoolId: createdSchoolId, targetPhone: managerPhone, targetUserId: pending.id, targetRole: role,
        purpose, codeHash: hashActivationCode(code), expiresAt: new Date(Date.now() + 60_000).toISOString(), token: crypto.randomUUID() });
      assert.equal((await request('POST', '/auth/school-admin/activation-verify', undefined,
        { schoolCode, phone: managerPhone, code }, `192.0.2.${clientIp++}`)).status, 400, `${purpose}/${role} code must not work for admin activation`);
      const codeState = await db.query('SELECT consumed_at FROM invitations WHERE school_id=$1 AND target_phone=$2 AND purpose=$3', [createdSchoolId, managerPhone, purpose]);
      assert(codeState.rows.every((row) => row.consumed_at === null), 'cross-purpose code must remain unconsumed');
    }

    const activation = await request('POST', '/auth/school-admin/activation-verify', undefined, { schoolCode, phone: managerPhone, code: activationCode });
    assert.equal(activation.status, 200);
    assert.equal('setupToken' in activation.body, true);
    assert.equal((await request('POST', '/auth/school-admin/activation-verify', undefined, { schoolCode, phone: managerPhone, code: activationCode })).status, 400,
      'activation code must be single-use');
    assert.equal((await request('POST', '/auth/school-admin/activation-complete', undefined,
      { schoolId: otherSchoolId, phone: managerPhone, setupToken: activation.body.setupToken, password: 'Local-admin-pass-184!abc' })).status, 400,
      'setup token must be scoped to the target school');
    assert.equal((await request('POST', '/auth/school-admin/activation-complete', undefined,
      { schoolId: createdSchoolId, phone: managerPhone, setupToken: activation.body.setupToken, password: 'short' })).status, 400,
      'password policy failure must not consume setup token');
    const activationComplete = await request('POST', '/auth/school-admin/activation-complete', undefined,
      { schoolId: createdSchoolId, phone: managerPhone, setupToken: activation.body.setupToken, password: 'Local-admin-pass-184!abc' });
    assert.equal(activationComplete.status, 200);
    const activated = await db.query<{ id: string; password_hash: string | null; auth_version: number }>('SELECT id,password_hash,auth_version FROM users WHERE phone=$1', [managerPhone]);
    assert(activated.rows[0]?.password_hash);
    const managerId = activated.rows[0].id;
    const adminMemberships = await db.query("SELECT school_id,role FROM school_memberships WHERE user_id=$1 AND role='admin' AND status='active'", [managerId]);
    assert.deepEqual(adminMemberships.rows, [{ school_id: createdSchoolId, role: 'admin' }]);
    const secondManager = await userRepository.create({ phone: otherPhone, firstName: 'İkinci', lastName: 'Yönetici' });
    const secondSetupToken = generateSetupToken();
    await invitationRepository.createAuthCode({ schoolId: createdSchoolId, targetPhone: otherPhone, targetUserId: secondManager.id, targetRole: 'admin',
      purpose: 'school_admin_activation_setup', codeHash: hashSetupToken(secondSetupToken), expiresAt: new Date(Date.now() + 60_000).toISOString(), token: crypto.randomUUID() });
    assert.equal((await request('POST', '/auth/school-admin/activation-complete', undefined,
      { schoolId: createdSchoolId, phone: otherPhone, setupToken: secondSetupToken, password: 'Local-admin-pass-184!abc' })).status, 409,
      'second school manager activation must fail after the first succeeds');
    assert.equal((await db.query("SELECT user_id FROM school_memberships WHERE school_id=$1 AND role='admin' AND status='active'", [createdSchoolId])).rows.filter((row) => row.user_id !== platformUser.id).length, 1);
    assert.equal((await db.query('SELECT password_hash FROM users WHERE id=$1', [secondManager.id])).rows[0].password_hash, null,
      'rejected activation must not set a password');
    assert.equal((await request('POST', `/platform/schools/${createdSchoolId}/admin-invitation`, platformToken,
      { fullName: 'İkinci Yönetici', phone: otherPhone, email: 'second@example.test' })).status, 409, 'school cannot be assigned a second active manager through the provisioning flow');
    assert.equal((await request('POST', `/platform/schools/${otherSchoolId}/admin-invitation`, platformToken,
      { fullName: 'Ada Yönetici', phone: managerPhone, email: 'ada@example.test' })).status, 409, 'active admin identity cannot be assigned to another school');
    const login = await request('POST', '/auth/login', undefined, { phone: managerPhone, password: 'Local-admin-pass-184!abc' });
    assert.equal(login.status, 200);
    const oldToken = String(login.body.token);
    assert.equal((await request('GET', `/schools/${createdSchoolId}/info`, oldToken)).status, 200);
    assert.equal((await request('GET', `/schools/${otherSchoolId}/info`, oldToken)).status, 403);

    await db.query('UPDATE users SET email=$2 WHERE id=$1', [platformUser.id, 'platform@example.test']);
    const emailCount = sentEmails.length;
    const platformResetRequest = await request('POST', '/auth/school-admin/reset-request', undefined, { schoolCode, phone: platformPhone });
    assert.equal(platformResetRequest.status, 200);
    assert.equal(sentEmails.length, emailCount, 'legacy platform membership must not generate a reset email');
    assert.equal((await db.query("SELECT id FROM invitations WHERE target_user_id=$1 AND purpose='school_admin_password_reset'", [platformUser.id])).rows.length, 0);
    const platformResetCode = '683247';
    const platformSetupToken = generateSetupToken();
    await invitationRepository.createAuthCode({ schoolId: createdSchoolId, targetPhone: platformPhone, targetUserId: platformUser.id, targetRole: 'admin',
      purpose: 'school_admin_password_reset', codeHash: hashActivationCode(platformResetCode), expiresAt: new Date(Date.now() + 60_000).toISOString(), token: crypto.randomUUID() });
    await invitationRepository.createAuthCode({ schoolId: createdSchoolId, targetPhone: platformPhone, targetUserId: platformUser.id, targetRole: 'admin',
      purpose: 'school_admin_password_setup', codeHash: hashSetupToken(platformSetupToken), expiresAt: new Date(Date.now() + 60_000).toISOString(), token: crypto.randomUUID() });
    assert.equal((await request('POST', '/auth/school-admin/reset-verify', undefined,
      { schoolCode, phone: platformPhone, code: platformResetCode })).status, 400);
    assert.equal((await request('POST', '/auth/school-admin/reset-complete', undefined,
      { schoolId: createdSchoolId, phone: platformPhone, setupToken: platformSetupToken, password: 'Local-admin-pass-184!abc' })).status, 400);
    const platformActivationCode = '763254';
    const platformActivationSetupToken = generateSetupToken();
    await invitationRepository.createAuthCode({ schoolId: createdSchoolId, targetPhone: platformPhone, targetUserId: platformUser.id, targetRole: 'admin',
      purpose: 'school_admin_activation', codeHash: hashActivationCode(platformActivationCode), expiresAt: new Date(Date.now() + 60_000).toISOString(), token: crypto.randomUUID() });
    await invitationRepository.createAuthCode({ schoolId: createdSchoolId, targetPhone: platformPhone, targetUserId: platformUser.id, targetRole: 'admin',
      purpose: 'school_admin_activation_setup', codeHash: hashSetupToken(platformActivationSetupToken), expiresAt: new Date(Date.now() + 60_000).toISOString(), token: crypto.randomUUID() });
    assert.equal((await request('POST', '/auth/school-admin/activation-verify', undefined,
      { schoolCode, phone: platformPhone, code: platformActivationCode })).status, 400);
    assert.equal((await request('POST', '/auth/school-admin/activation-complete', undefined,
      { schoolId: createdSchoolId, phone: platformPhone, setupToken: platformActivationSetupToken, password: 'Local-admin-pass-184!abc' })).status, 400);
    assert.equal((await db.query('SELECT password_hash FROM users WHERE id=$1', [platformUser.id])).rows[0].password_hash, null);
    assert.equal((await request('GET', `/platform-target/${createdSchoolId}/schools/${createdSchoolId}/info`, platformToken)).status, 200,
      'platform authority must remain available with a legacy membership');

    const genericRequest = await request('POST', '/auth/school-admin/reset-request', undefined, { schoolCode, phone: managerPhone });
    const unknownRequest = await request('POST', '/auth/school-admin/reset-request', undefined, { schoolCode: otherSchoolCode, phone: expiredPhone });
    assert.equal(genericRequest.status, 200);
    assert.equal(genericRequest.body.message, unknownRequest.body.message);
    assert.equal(sentEmails.at(-1)?.to, 'ada@example.test');
    let resetCode = emailCode(sentEmails.length - 1);
    await db.query("UPDATE invitations SET expires_at=NOW()-INTERVAL '1 second' WHERE school_id=$1 AND target_user_id=$2 AND purpose='school_admin_password_reset'", [createdSchoolId, managerId]);
    assert.equal((await request('POST', '/auth/school-admin/reset-verify', undefined, { schoolCode, phone: managerPhone, code: resetCode })).status, 400,
      'expired reset code must fail');
    await db.query("UPDATE invitations SET created_at=NOW()-INTERVAL '61 seconds' WHERE school_id=$1 AND target_user_id=$2 AND purpose='school_admin_password_reset'", [createdSchoolId, managerId]);
    assert.equal((await request('POST', '/auth/school-admin/reset-request', undefined, { schoolCode, phone: managerPhone })).status, 200);
    resetCode = emailCode(sentEmails.length - 1);
    await invitationRepository.createAuthCode({ schoolId: createdSchoolId, targetPhone: managerPhone, targetUserId: managerId, targetRole: 'admin',
      purpose: 'school_admin_activation', codeHash: hashActivationCode('456789'), expiresAt: new Date(Date.now() + 60_000).toISOString(), token: crypto.randomUUID() });
    assert.equal((await request('POST', '/auth/school-admin/reset-verify', undefined, { schoolCode, phone: managerPhone, code: '456789' })).status, 400,
      'activation code must not verify a password reset');
    assert.equal((await request('POST', '/auth/school-admin/reset-verify', undefined, { schoolCode, phone: managerPhone, code: '000000' })).status, 400);
    const reset = await request('POST', '/auth/school-admin/reset-verify', undefined, { schoolCode, phone: managerPhone, code: resetCode });
    assert.equal(reset.status, 200);
    assert.equal((await request('POST', '/auth/school-admin/reset-verify', undefined, { schoolCode, phone: managerPhone, code: resetCode })).status, 400,
      'reset code must be single-use');
    const beforeVersion = activated.rows[0].auth_version;
    const resetComplete = await request('POST', '/auth/school-admin/reset-complete', undefined,
      { schoolId: createdSchoolId, phone: managerPhone, setupToken: reset.body.setupToken, password: 'Local-admin-new-284!pass' });
    assert.equal(resetComplete.status, 200);
    const after = await userRepository.getById(managerId);
    assert.equal(after?.authVersion, beforeVersion + 1);
    assert.equal((await request('GET', `/schools/${createdSchoolId}/info`, oldToken)).status, 401);
    assert.equal((await request('POST', '/auth/login', undefined, { phone: managerPhone, password: 'Local-admin-pass-184!abc' })).status, 401);
    const newLogin = await request('POST', '/auth/login', undefined, { phone: managerPhone, password: 'Local-admin-new-284!pass' });
    assert.equal(newLogin.status, 200);
    assert.equal((await request('GET', `/schools/${createdSchoolId}/info`, String(newLogin.body.token))).status, 200);

    failNextEmail = true;
    const emailFailurePhone = `+905${crypto.randomInt(100000000, 999999999)}`;
    usersToClean.push(emailFailurePhone);
    const failedDelivery = await request('POST', `/platform/schools/${otherSchoolId}/admin-invitation`, platformToken,
      { fullName: 'Bekleyen Yönetici', phone: emailFailurePhone, email: 'pending@example.test' });
    assert.equal(failedDelivery.status, 201);
    assert.equal(failedDelivery.body.emailSent, false);
    const emailFailureUser = await userRepository.getByPhone(emailFailurePhone);
    assert(emailFailureUser);
    assert.equal((await db.query('SELECT id FROM school_memberships WHERE user_id=$1', [emailFailureUser.id])).rows.length, 0,
      'email failure must not create active membership');
    await db.query("UPDATE invitations SET expires_at=NOW()-INTERVAL '1 second' WHERE school_id=$1 AND target_user_id=$2 AND purpose='school_admin_activation'", [otherSchoolId, emailFailureUser.id]);

    const expiredInvite = await request('POST', `/platform/schools/${otherSchoolId}/admin-invitation`, platformToken,
      { fullName: 'Süresi Dolan', phone: expiredPhone, email: 'expired@example.test' });
    assert.equal(expiredInvite.status, 201);
    await db.query("UPDATE invitations SET expires_at=NOW()-INTERVAL '1 second' WHERE school_id=$1 AND target_phone=$2 AND purpose='school_admin_activation'", [otherSchoolId, expiredPhone]);
    const expiredList = await request('GET', '/platform/schools', platformToken);
    const expiredSchool = (expiredList.body.schools as Array<Record<string, unknown>>).find((entry) => entry.id === otherSchoolId);
    assert.equal(expiredSchool?.adminStatus, 'unassigned', 'expired invitations must not appear as pending');
    assert.equal((await request('POST', '/auth/school-admin/activation-verify', undefined,
      { schoolCode: otherSchoolCode, phone: expiredPhone, code: emailCode(sentEmails.length - 1) })).status, 400, 'expired invitation must fail');

    const nonPlatform = await request('GET', '/platform/schools', undefined);
    assert.equal(nonPlatform.status, 401);
    console.log('School admin provisioning: platform separation, invite, purpose-scoped activation, tenant isolation, single-school rule, reset invalidation and email-failure safety PASS.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    await db.query('DELETE FROM schools WHERE id IN ($1,$2,$3,$4)', [createdSchoolId, schoolId, otherSchoolId, deniedAdminSchoolId]);
    for (const phone of usersToClean) await db.query('DELETE FROM users WHERE phone=$1', [phone]);
    delete process.env.PLATFORM_ADMIN_USER_IDS;
  }
}

run().catch((cause) => {
  console.error('School admin provisioning test FAILED. No codes, tokens, credentials or response bodies are logged.', cause instanceof Error ? cause.stack : '');
  process.exitCode = 1;
});
