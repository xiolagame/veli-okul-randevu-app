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
      return new Response(JSON.stringify({ messages: [{ id: 'pilot-message' }] }), { status: 200 });
    }
    if (url === 'https://api.resend.com/emails') {
      const payload = JSON.parse(String(init?.body || '{}')) as { html?: string };
      const code = payload.html?.match(/>(\d{6})</)?.[1];
      assert.match(code || '', /^\d{6}$/);
      emailCodes.push(code!);
      return new Response(JSON.stringify({ id: 'pilot-email' }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { hashActivationCode } = await import('../server/activation-codes');
  const { invitationRepository, membershipRepository, userRepository } = await import('../server/repositories');
  const { isWhatsAppPilotModeEnabled, isWhatsAppPilotPhoneAllowed } = await import('../server/whatsapp-cloud');
  const db = await getDb();
  const suffix = crypto.randomUUID();
  const schoolId = `pilot-school-${suffix}`;
  const schoolCode = `WP${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const allowedPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const blockedPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const adminPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const createdUserIds: string[] = [];
  const formattedAllowedPhone = `0${allowedPhone.slice(3)}`;

  process.env.WHATSAPP_PILOT_ALLOWED_PHONES = `${formattedAllowedPhone}, ${adminPhone}`;
  assert.equal(isWhatsAppPilotModeEnabled(), true);
  assert.equal(isWhatsAppPilotPhoneAllowed(allowedPhone), true);
  assert.equal(isWhatsAppPilotPhoneAllowed(`(${formattedAllowedPhone.slice(0, 4)}) ${formattedAllowedPhone.slice(4, 7)}-${formattedAllowedPhone.slice(7)}`), true);
  assert.equal(isWhatsAppPilotPhoneAllowed(blockedPhone), false);

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  let ipSequence = 40;
  async function request(method: string, path: string, body?: object) {
    try {
      const response = await originalFetch(baseUrl + path, {
        method,
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${ipSequence++}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
    } catch (cause) {
      const detail = cause instanceof Error && cause.cause instanceof Error ? cause.cause.message : 'transport failure';
      throw new Error(`${method} ${path} failed: ${detail}`);
    }
  }
  async function requestAuto(phone: string) {
    const deliveredBefore = whatsappCodes.length;
    const response = await request('POST', '/auth/whatsapp/request-code', { purpose: 'auto', phone });
    assert.equal(response.status, 200);
    return { response, deliveredBefore, deliveredAfter: whatsappCodes.length, code: whatsappCodes.at(-1) || '' };
  }

  try {
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)',
      [schoolId, 'WhatsApp Pilot School', schoolCode, 'Test', 'Test']);
    const allowedUser = await userRepository.create({ phone: allowedPhone, firstName: 'Pilot', lastName: 'Allowed', isPhoneVerified: true });
    const blockedUser = await userRepository.create({ phone: blockedPhone, firstName: 'Pilot', lastName: 'Blocked', isPhoneVerified: true });
    const adminUser = await userRepository.create({ phone: adminPhone, firstName: 'Pilot', lastName: 'Admin', email: 'pilot-admin@example.test' });
    createdUserIds.push(allowedUser.id, blockedUser.id, adminUser.id);
    await membershipRepository.createOrActivate({ schoolId, userId: allowedUser.id, role: 'parent' });
    await membershipRepository.createOrActivate({ schoolId, userId: blockedUser.id, role: 'parent' });
    await invitationRepository.createAuthCode({
      schoolId,
      targetPhone: adminPhone,
      targetUserId: adminUser.id,
      targetRole: 'admin',
      purpose: 'school_admin_activation',
      codeHash: hashActivationCode('123456'),
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      token: crypto.randomUUID(),
    });

    const blockedRequest = await requestAuto(blockedPhone);
    assert.equal(blockedRequest.deliveredAfter, blockedRequest.deliveredBefore);
    assert.equal((await db.query('SELECT id FROM whatsapp_auth_challenges WHERE target_phone=$1', [blockedPhone])).rows.length, 0);
    assert.equal((await request('POST', '/auth/whatsapp/verify-code', {
      phone: blockedPhone,
      challengeId: blockedRequest.response.body.challengeId,
      code: '123456',
    })).status, 401);

    const allowedRequest = await requestAuto(allowedPhone);
    assert.equal(allowedRequest.deliveredAfter, allowedRequest.deliveredBefore + 1);
    process.env.WHATSAPP_PILOT_ALLOWED_PHONES = adminPhone;
    assert.equal((await request('POST', '/auth/whatsapp/verify-code', {
      phone: allowedPhone,
      challengeId: allowedRequest.response.body.challengeId,
      code: allowedRequest.code,
    })).status, 401);
    process.env.WHATSAPP_PILOT_ALLOWED_PHONES = `${formattedAllowedPhone},${adminPhone}`;
    assert.equal((await request('POST', '/auth/whatsapp/verify-code', {
      phone: allowedPhone,
      challengeId: allowedRequest.response.body.challengeId,
      code: allowedRequest.code,
    })).status, 200);

    const resendSource = await requestAuto(allowedPhone);
    assert.equal(resendSource.deliveredAfter, resendSource.deliveredBefore + 1);
    process.env.WHATSAPP_PILOT_ALLOWED_PHONES = '';
    const blockedResend = await requestAuto(allowedPhone);
    assert.equal(blockedResend.deliveredAfter, blockedResend.deliveredBefore);
    assert.equal((await request('POST', '/auth/whatsapp/verify-code', {
      phone: allowedPhone,
      challengeId: resendSource.response.body.challengeId,
      code: resendSource.code,
    })).status, 401);
    process.env.WHATSAPP_PILOT_ALLOWED_PHONES = `${formattedAllowedPhone},${adminPhone}`;
    assert.equal((await request('POST', '/auth/whatsapp/verify-code', {
      phone: allowedPhone,
      challengeId: resendSource.response.body.challengeId,
      code: resendSource.code,
    })).status, 200);

    const adminRequest = await requestAuto(adminPhone);
    assert.equal(adminRequest.deliveredAfter, adminRequest.deliveredBefore + 1);
    const phoneVerification = await request('POST', '/auth/whatsapp/verify-code', {
      phone: adminPhone,
      challengeId: adminRequest.response.body.challengeId,
      code: adminRequest.code,
    });
    assert.equal(phoneVerification.status, 200);
    assert.equal(phoneVerification.body.pendingEmail, true);
    const emailCode = emailCodes.at(-1);
    assert.match(emailCode || '', /^\d{6}$/);
    process.env.WHATSAPP_PILOT_ALLOWED_PHONES = formattedAllowedPhone;
    assert.equal((await request('POST', '/auth/whatsapp/complete-admin-email', {
      handle: phoneVerification.body.handle,
      phone: adminPhone,
      emailCode,
    })).status, 401);
    process.env.WHATSAPP_PILOT_ALLOWED_PHONES = `${formattedAllowedPhone},${adminPhone}`;
    assert.equal((await request('POST', '/auth/whatsapp/complete-admin-email', {
      handle: phoneVerification.body.handle,
      phone: adminPhone,
      emailCode,
    })).status, 200);

    process.env.WHATSAPP_PILOT_ALLOWED_PHONES = `${formattedAllowedPhone},not-a-phone`;
    assert.equal(isWhatsAppPilotPhoneAllowed(allowedPhone), false);
    const malformedAllowlist = await requestAuto(allowedPhone);
    assert.equal(malformedAllowlist.deliveredAfter, malformedAllowlist.deliveredBefore);

    delete process.env.WHATSAPP_PILOT_ALLOWED_PHONES;
    assert.equal(isWhatsAppPilotModeEnabled(), true);
    assert.equal(isWhatsAppPilotPhoneAllowed(blockedPhone), false);
    const missingAllowlist = await requestAuto(allowedPhone);
    assert.equal(missingAllowlist.deliveredAfter, missingAllowlist.deliveredBefore);

    process.env.WHATSAPP_PILOT_ALLOWED_PHONES = `${formattedAllowedPhone},${adminPhone}`;
    process.env.WHATSAPP_PILOT_ENABLED = 'false';
    assert.equal(isWhatsAppPilotPhoneAllowed(allowedPhone), false);
    assert.equal((await request('POST', '/auth/whatsapp/request-code', {
      purpose: 'login',
      phone: allowedPhone,
    })).status, 503);

    delete process.env.WHATSAPP_PILOT_ENABLED;
    assert.equal(isWhatsAppPilotModeEnabled(), false);
    assert.equal(isWhatsAppPilotPhoneAllowed(allowedPhone), false);
    assert.equal((await request('POST', '/auth/whatsapp/request-code', {
      purpose: 'login',
      phone: allowedPhone,
    })).status, 503);
    assert.equal((await request('POST', '/auth/whatsapp/request-code', {
      purpose: 'auto',
      phone: adminPhone,
    })).status, 404);
    assert.equal((await request('POST', '/auth/whatsapp/verify-code', {
      phone: allowedPhone,
      challengeId: crypto.randomUUID(),
      code: '123456',
    })).status, 503);
    console.log('WhatsApp pilot: explicit flag, canonical allowlist, fail-closed configuration, request/resend/verify and admin completion guards PASS.');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.WHATSAPP_PILOT_ENABLED;
    delete process.env.WHATSAPP_PILOT_ALLOWED_PHONES;
    process.env.WHATSAPP_AUTH_ENABLED = 'false';
    process.env.WHATSAPP_UNIFIED_LOGIN_ENABLED = 'false';
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id=$1', [schoolId]);
    for (const userId of createdUserIds) await db.query('DELETE FROM users WHERE id=$1', [userId]);
  }
}

run().catch((cause) => {
  console.error('WhatsApp pilot test FAILED; no phone, code, token, credential, or response body is logged.', cause instanceof Error ? cause.stack : '');
  process.exitCode = 1;
});
