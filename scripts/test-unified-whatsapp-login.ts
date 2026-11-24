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
  process.env.LEGACY_PASSWORD_LOGIN_FOR_TESTS = '1';
  process.env.WHATSAPP_PILOT_ENABLED = 'true';
  process.env.WHATSAPP_UNIFIED_LOGIN_ENABLED = 'true';
  process.env.PHONE_CENTRIC_AUTH_ENABLED = 'true';
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
  const phoneSchoolId = `unified-phone-${suffix}`;
  const schoolCode = `UW${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const otherSchoolCode = `UO${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const legacySchoolCode = `UL${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const phoneSchoolCode = `UP${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const adminPhoneA = `+905${crypto.randomInt(100000000, 999999999)}`;
  const adminPhoneB = `+905${crypto.randomInt(100000000, 999999999)}`;
  const platformPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const legacyPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const phoneAdminPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  process.env.WHATSAPP_PILOT_ALLOWED_PHONES = [adminPhoneA, adminPhoneB, platformPhone, legacyPhone, phoneAdminPhone].join(',');
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
    await db.query(
      'INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)',
      [phoneSchoolId, 'Phone Centric School', phoneSchoolCode, 'Test', 'Test'],
    );
    const adminA = await userRepository.create({ phone: adminPhoneA, firstName: 'Birinci', lastName: 'Yönetici', email: 'admin-a@example.test' });
    const adminB = await userRepository.create({ phone: adminPhoneB, firstName: 'İkinci', lastName: 'Yönetici', email: 'admin-b@example.test' });
    const platform = await userRepository.create({ phone: platformPhone, firstName: 'Platform', lastName: 'Yönetimi', email: 'platform@example.test' });
    const legacy = await userRepository.create({ phone: legacyPhone, firstName: 'Eski', lastName: 'Mobil', email: 'legacy@example.test' });
    const phoneAdmin = await userRepository.create({ phone: phoneAdminPhone, firstName: 'Telefon', lastName: 'Yönetici', email: 'phone-admin@example.test' });
    createdUserIds.push(adminA.id, adminB.id, platform.id, legacy.id, phoneAdmin.id);
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
    await invitationRepository.createAuthCode({
      schoolId: phoneSchoolId,
      targetPhone: phoneAdmin.phone,
      targetUserId: phoneAdmin.id,
      targetRole: 'admin',
      purpose: 'school_admin_activation',
      codeHash: hashActivationCode('123456'),
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      token: crypto.randomUUID(),
    });

    const phoneStart = await request('POST', '/auth/phone/request-code', { phone: phoneAdminPhone });
    assert.equal(phoneStart.status, 200);
    const phoneWhatsAppCode = whatsappCodes.at(-1)!;
    const phoneVerified = await request('POST', '/auth/phone/verify-code', {
      attemptId: phoneStart.body.attemptId,
      challengeId: phoneStart.body.challengeId,
      phone: phoneAdminPhone,
      code: phoneWhatsAppCode,
    });
    assert.equal(phoneVerified.status, 200);
    assert.equal(typeof phoneVerified.body.token, 'string', 'first school admin login needs only the WhatsApp code');
    assert.equal('pendingEmail' in phoneVerified.body, false);
    assert.equal((await membershipRepository.getActiveMembership(phoneAdmin.id, phoneSchoolId))?.role, 'admin');

    for (let loginIndex = 0; loginIndex < 2; loginIndex += 1) {
      const laterStart = await request('POST', '/auth/phone/request-code', { phone: phoneAdminPhone });
      const laterResult = await request('POST', '/auth/phone/verify-code', {
        attemptId: laterStart.body.attemptId,
        challengeId: laterStart.body.challengeId,
        phone: phoneAdminPhone,
        code: whatsappCodes.at(-1),
      });
      assert.equal(laterResult.status, 200);
      assert.equal(typeof laterResult.body.token, 'string');
      assert.equal('pendingEmail' in laterResult.body, false);
    }

    async function phoneLogin(phone: string) {
      const start = await request('POST', '/auth/phone/request-code', { phone });
      assert.equal(start.status, 200);
      const code = whatsappCodes.at(-1)!;
      return () => request('POST', '/auth/phone/verify-code', { attemptId: start.body.attemptId, challengeId: start.body.challengeId, phone, code });
    }
    const verifyA = await phoneLogin(adminPhoneA);
    const verifyB = await phoneLogin(adminPhoneB);
    const activationResults = await Promise.all([verifyA(), verifyB()]);
    assert.deepEqual(activationResults.map((result) => result.status).sort(), [200, 409]);
    const realAdmins = await db.query<{ user_id: string }>(
      "SELECT user_id FROM school_memberships WHERE school_id=$1 AND role='admin' AND status='active'",
      [schoolId],
    );
    assert.equal(realAdmins.rows.length, 1, 'concurrent activation must create one real school admin');
    const activeAdminId = realAdmins.rows[0].user_id;
    const activeAdmin = activeAdminId === adminA.id ? adminA : adminB;
    assert.equal((await db.query('SELECT password_hash FROM users WHERE id=$1', [activeAdmin.id])).rows[0].password_hash, null);

    const laterAdmin = await (await phoneLogin(activeAdmin.phone))();
    assert.equal(laterAdmin.status, 200);
    const adminToken = String(laterAdmin.body.token);
    assert.equal((await request('GET', `/schools/${schoolId}/settings`, undefined, adminToken)).status, 200);
    assert.equal((await request('GET', `/schools/${otherSchoolId}/settings`, undefined, adminToken)).status, 403);
    assert.equal((await request('GET', '/platform/capabilities', undefined, adminToken)).body.manageSchools, false);

    const deliveriesBeforePlatform = whatsappCodes.length;
    const platformAttempt = await request('POST', '/auth/whatsapp/request-code', { purpose: 'auto', phone: platformPhone });
    assert.equal(platformAttempt.status, 200);
    assert.equal(whatsappCodes.length, deliveriesBeforePlatform, 'platform authority must not receive unified WhatsApp login');

    await db.query('UPDATE schools SET disabled_at=NOW() WHERE id=$1', [schoolId]);
    assert.equal((await request('GET', `/schools/${schoolId}/settings`, undefined, adminToken)).status, 403);
    const deliveriesBeforeDisabled = whatsappCodes.length;
    assert.equal((await request('POST', '/auth/whatsapp/request-code', { purpose: 'auto', phone: activeAdmin.phone })).status, 200);
    assert.equal(whatsappCodes.length, deliveriesBeforeDisabled, 'disabled school must not issue a WhatsApp challenge');
    await db.query('UPDATE schools SET disabled_at=NULL WHERE id=$1', [schoolId]);

    // Parola ve e-posta kodlu eski okul yöneticisi akışları tamamen kaldırıldı.
    for (const path of ['/auth/school-admin/reset-request', '/auth/school-admin/activation-verify', '/auth/school-admin/activation-complete', '/auth/whatsapp/complete-admin-email']) {
      assert.equal((await request('POST', path, { phone: activeAdmin.phone })).status, 404, path + ' must be removed');
    }

    console.log('Unified WhatsApp login: code-only first activation, admin race lock, later login, disabled-school/tenant/platform guards and removed legacy admin flows PASS.');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.PLATFORM_ADMIN_USER_IDS = originalPlatformIds;
    process.env.WHATSAPP_AUTH_ENABLED = 'false';
    process.env.WHATSAPP_PILOT_ENABLED = 'false';
    process.env.WHATSAPP_UNIFIED_LOGIN_ENABLED = 'false';
    process.env.PHONE_CENTRIC_AUTH_ENABLED = 'false';
    delete process.env.WHATSAPP_PILOT_ALLOWED_PHONES;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id IN ($1,$2,$3,$4)', [schoolId, otherSchoolId, legacySchoolId, phoneSchoolId]);
    for (const userId of createdUserIds) await db.query('DELETE FROM users WHERE id=$1', [userId]);
  }
}

run().catch((cause) => {
  console.error('Unified WhatsApp login test FAILED; no code, phone, token, email, or response body is logged.', cause instanceof Error ? cause.stack : '');
  process.exitCode = 1;
});
