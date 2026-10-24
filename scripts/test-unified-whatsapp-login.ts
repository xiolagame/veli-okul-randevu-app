import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local PGlite is required.');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.WHATSAPP_AUTH_ENABLED = 'true';
  process.env.WHATSAPP_PILOT_ENABLED = 'true';
  process.env.WHATSAPP_UNIFIED_LOGIN_ENABLED = 'true';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
  process.env.WHATSAPP_ACCESS_TOKEN = 'local-test-token-not-a-real-credential';
  process.env.WHATSAPP_GRAPH_API_VERSION = 'v25.0';
  process.env.RESEND_API_KEY = 'local-test-key';
  process.env.EMAIL_FROM = 'test@example.test';

  const originalFetch = globalThis.fetch;
  const whatsappCodes: string[] = [];
  const emailCodes: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://graph.facebook.com/')) {
      const payload = JSON.parse(String(init?.body || '{}')) as { template?: { components?: Array<{ parameters?: Array<{ text?: string }> }> } };
      const code = payload.template?.components?.[0]?.parameters?.[0]?.text;
      assert.match(code || '', /^\d{6}$/);
      whatsappCodes.push(code!);
      return new Response(JSON.stringify({ messages: [{ id: 'local-message' }] }), { status: 200 });
    }
    if (url === 'https://api.resend.com/emails') {
      const payload = JSON.parse(String(init?.body || '{}')) as { html?: string };
      const code = payload.html?.match(/>(\d{6})</)?.[1];
      assert.match(code || '', /^\d{6}$/);
      emailCodes.push(code!);
      return new Response(JSON.stringify({ id: 'local-email' }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { hashActivationCode } = await import('../server/activation-codes');
  const { invitationRepository, membershipRepository, userRepository } = await import('../server/repositories');
  const db = await getDb();
  const suffix = crypto.randomUUID();
  const schoolId = `unified-school-${suffix}`;
  const otherSchoolId = `unified-other-${suffix}`;
  const legacySchoolId = `unified-legacy-${suffix}`;
  const schoolCode = `UW${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const otherSchoolCode = `UO${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const legacySchoolCode = `UL${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const adminPhoneA = `+905${crypto.randomInt(100000000, 999999999)}`;
  const adminPhoneB = `+905${crypto.randomInt(100000000, 999999999)}`;
  const platformPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const legacyPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  process.env.WHATSAPP_PILOT_ALLOWED_PHONES = [adminPhoneA, adminPhoneB, platformPhone, legacyPhone].join(',');
  const createdUserIds: string[] = [];
  const originalPlatformIds = process.env.PLATFORM_ADMIN_USER_IDS;

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  let ipSequence = 10;
  async function request(method: string, path: string, body?: object, token?: string) {
    try {
      const response = await originalFetch(baseUrl + path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `192.0.2.${ipSequence++}`,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
    } catch (cause) {
      const detail = cause instanceof Error && cause.cause instanceof Error ? cause.cause.message : 'transport failure';
      throw new Error(`${method} ${path} failed: ${detail}`);
    }
  }
  async function requestAuto(phone: string) {
    const before = whatsappCodes.length;
    const response = await request('POST', '/auth/whatsapp/request-code', { purpose: 'auto', phone });
    assert.equal(response.status, 200);
    assert.equal(whatsappCodes.length, before + 1);
    return { challengeId: String(response.body.challengeId), code: whatsappCodes.at(-1)! };
  }
  async function verifyPhone(phone: string, challengeId: string, code: string) {
    const response = await request('POST', '/auth/whatsapp/verify-code', { phone, challengeId, code });
    assert.equal(response.status, 200);
    assert.equal(response.body.pendingEmail, true);
    return { handle: String(response.body.handle), emailCode: emailCodes.at(-1)! };
  }

  try {
    await db.query(
      'INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10),($11,$12,$13,$14,$15)',
      [schoolId, 'Unified School', schoolCode, 'Test', 'Test', otherSchoolId, 'Other School', otherSchoolCode, 'Test', 'Test', legacySchoolId, 'Legacy School', legacySchoolCode, 'Test', 'Test'],
    );
    const adminA = await userRepository.create({ phone: adminPhoneA, firstName: 'Birinci', lastName: 'Yönetici', email: 'admin-a@example.test' });
    const adminB = await userRepository.create({ phone: adminPhoneB, firstName: 'İkinci', lastName: 'Yönetici', email: 'admin-b@example.test' });
    const platform = await userRepository.create({ phone: platformPhone, firstName: 'Platform', lastName: 'Yönetimi', email: 'platform@example.test' });
    const legacy = await userRepository.create({ phone: legacyPhone, firstName: 'Eski', lastName: 'Mobil', email: 'legacy@example.test' });
    createdUserIds.push(adminA.id, adminB.id, platform.id, legacy.id);
    process.env.PLATFORM_ADMIN_USER_IDS = platform.id;

    for (const user of [adminA, adminB]) {
      await invitationRepository.createAuthCode({
        schoolId,
        targetPhone: user.phone,
        targetUserId: user.id,
        targetRole: 'admin',
        purpose: 'school_admin_activation',
        codeHash: hashActivationCode('123456'),
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        token: crypto.randomUUID(),
      });
    }

    const phoneA = await requestAuto(adminPhoneA);
    const phoneB = await requestAuto(adminPhoneB);
    const emailA = await verifyPhone(adminPhoneA, phoneA.challengeId, phoneA.code);
    const emailB = await verifyPhone(adminPhoneB, phoneB.challengeId, phoneB.code);
    const activationResults = await Promise.all([
      request('POST', '/auth/whatsapp/complete-admin-email', { handle: emailA.handle, phone: adminPhoneA, emailCode: emailA.emailCode }),
      request('POST', '/auth/whatsapp/complete-admin-email', { handle: emailB.handle, phone: adminPhoneB, emailCode: emailB.emailCode }),
    ]);
    assert.deepEqual(activationResults.map((result) => result.status).sort(), [200, 409]);
    const realAdmins = await db.query<{ user_id: string }>(
      "SELECT user_id FROM school_memberships WHERE school_id=$1 AND role='admin' AND status='active'",
      [schoolId],
    );
    assert.equal(realAdmins.rows.length, 1, 'concurrent activation must create one real school admin');
    const activeAdminId = realAdmins.rows[0].user_id;
    const activeAdmin = activeAdminId === adminA.id ? adminA : adminB;
    assert.equal((await db.query('SELECT password_hash FROM users WHERE id=$1', [activeAdmin.id])).rows[0].password_hash, null);

    const later = await requestAuto(activeAdmin.phone);
    const laterLogin = await request('POST', '/auth/whatsapp/verify-code', { phone: activeAdmin.phone, challengeId: later.challengeId, code: later.code });
    assert.equal(laterLogin.status, 200);
    assert.equal(laterLogin.body.memberships.length, 1);
    assert.equal(laterLogin.body.memberships[0].role, 'admin');
    const adminToken = String(laterLogin.body.token);
    assert.equal((await request('GET', `/schools/${schoolId}/info`, undefined, adminToken)).status, 200);
    assert.equal((await request('GET', `/schools/${otherSchoolId}/info`, undefined, adminToken)).status, 403);
    assert.equal((await request('GET', '/platform/capabilities', undefined, adminToken)).body.manageSchools, false);

    const deliveriesBeforePlatform = whatsappCodes.length;
    const platformAttempt = await request('POST', '/auth/whatsapp/request-code', { purpose: 'auto', phone: platformPhone });
    assert.equal(platformAttempt.status, 200);
    assert.equal(whatsappCodes.length, deliveriesBeforePlatform, 'platform authority must not receive unified WhatsApp login');

    await db.query('UPDATE schools SET disabled_at=NOW() WHERE id=$1', [schoolId]);
    assert.equal((await request('GET', `/schools/${schoolId}/info`, undefined, adminToken)).status, 403);
    const deliveriesBeforeDisabled = whatsappCodes.length;
    assert.equal((await request('POST', '/auth/whatsapp/request-code', { purpose: 'auto', phone: activeAdmin.phone })).status, 200);
    assert.equal(whatsappCodes.length, deliveriesBeforeDisabled, 'disabled school must not issue a WhatsApp challenge');
    await db.query('UPDATE schools SET disabled_at=NULL WHERE id=$1', [schoolId]);

    const emailsBeforeReset = emailCodes.length;
    assert.equal((await request('POST', '/auth/school-admin/reset-request', { schoolCode, phone: activeAdmin.phone })).status, 200);
    assert.equal(emailCodes.length, emailsBeforeReset + 1, 'passwordless admin recovery must send a reset code');
    const resetVerify = await request('POST', '/auth/school-admin/reset-verify', { schoolCode, phone: activeAdmin.phone, code: emailCodes.at(-1) });
    assert.equal(resetVerify.status, 200);
    assert.equal((await request('POST', '/auth/school-admin/reset-complete', {
      schoolId,
      phone: activeAdmin.phone,
      setupToken: resetVerify.body.setupToken,
      password: 'Recovered-admin-pass-184!abc',
    })).status, 200);
    assert.equal((await request('POST', '/auth/login', { phone: activeAdmin.phone, password: 'Recovered-admin-pass-184!abc' })).status, 200);

    const legacyCode = '654321';
    await invitationRepository.createAuthCode({
      schoolId: legacySchoolId,
      targetPhone: legacyPhone,
      targetUserId: legacy.id,
      targetRole: 'admin',
      purpose: 'school_admin_activation',
      codeHash: hashActivationCode(legacyCode),
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      token: crypto.randomUUID(),
    });
    const legacyVerify = await request('POST', '/auth/school-admin/activation-verify', {
      schoolCode: legacySchoolCode,
      phone: legacyPhone,
      code: legacyCode,
    });
    assert.equal(legacyVerify.status, 200, 'legacy mobile activation verify endpoint must remain available');
    assert.equal((await request('POST', '/auth/school-admin/activation-complete', {
      schoolId: legacySchoolId,
      phone: legacyPhone,
      setupToken: legacyVerify.body.setupToken,
      password: 'Legacy-admin-pass-184!abc',
    })).status, 200, 'legacy mobile activation complete endpoint must remain available');
    assert.equal((await membershipRepository.getActiveMembership(legacy.id, legacySchoolId))?.role, 'admin');

    console.log('Unified WhatsApp login: first activation, admin race lock, later login, disabled-school/tenant/platform guards, passwordless recovery and legacy mobile compatibility PASS.');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.PLATFORM_ADMIN_USER_IDS = originalPlatformIds;
    process.env.WHATSAPP_AUTH_ENABLED = 'false';
    process.env.WHATSAPP_PILOT_ENABLED = 'false';
    process.env.WHATSAPP_UNIFIED_LOGIN_ENABLED = 'false';
    delete process.env.WHATSAPP_PILOT_ALLOWED_PHONES;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id IN ($1,$2,$3)', [schoolId, otherSchoolId, legacySchoolId]);
    for (const userId of createdUserIds) await db.query('DELETE FROM users WHERE id=$1', [userId]);
  }
}

run().catch((cause) => {
  console.error('Unified WhatsApp login test FAILED; no code, phone, token, email, or response body is logged.', cause instanceof Error ? cause.stack : '');
  process.exitCode = 1;
});
