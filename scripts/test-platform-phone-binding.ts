import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import { applyUnauthorizedSessionPolicy } from '../src/platform/api-session-policy';

async function main() {
  const ui = fs.readFileSync('src/components/PlatformPhoneBinding.tsx', 'utf8');
  assert.match(ui, /Platform WhatsApp telefonu/);
  assert.match(ui, /getPlatformPhoneBindingStatus/);
  assert.match(ui, /startPlatformPhoneBinding/);
  assert.match(ui, /verifyPlatformPhoneBindingEmail/);
  assert.match(ui, /completePlatformPhoneBinding/);
  assert.match(ui, /startPlatformEmailBinding/);
  assert.match(ui, /completePlatformEmailBinding/);
  assert.match(ui, /WhatsApp telefonu bağlı/);
  assert.match(ui, /clearTokenAfterRemoteInvalidation/);

  const previous = {
    nodeEnv: process.env.NODE_ENV,
    jwt: process.env.JWT_SECRET,
    authCode: process.env.AUTH_CODE_SECRET,
    whatsappAuth: process.env.WHATSAPP_AUTH_ENABLED,
    whatsappPilot: process.env.WHATSAPP_PILOT_ENABLED,
    whatsappAllowed: process.env.WHATSAPP_PILOT_ALLOWED_PHONES,
    whatsappPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    whatsappToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneCentric: process.env.PHONE_CENTRIC_AUTH_ENABLED,
    platformIds: process.env.PLATFORM_ADMIN_USER_IDS,
    resend: process.env.RESEND_API_KEY,
    emailFrom: process.env.EMAIL_FROM,
  };
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'local-platform-phone-binding-jwt-secret-123456789';
  process.env.AUTH_CODE_SECRET = 'local-platform-phone-binding-code-secret-123456';
  process.env.WHATSAPP_AUTH_ENABLED = 'true';
  process.env.WHATSAPP_PILOT_ENABLED = 'true';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
  process.env.WHATSAPP_ACCESS_TOKEN = 'local-test-token';
  process.env.PHONE_CENTRIC_AUTH_ENABLED = 'false';
  process.env.RESEND_API_KEY = 'local-test-email-key';
  process.env.EMAIL_FROM = 'test@example.test';

  const suffix = String(crypto.randomInt(100000000, 999999999));
  const oldPhone = `+905${suffix}`;
  const candidatePhone = `+905${String((Number(suffix) + 1) % 900000000 + 100000000).slice(0, 9)}`;
  const conflictPhone = `+905${String((Number(suffix) + 2) % 900000000 + 100000000).slice(0, 9)}`;
  const candidateEmail = `platform-new-${suffix}@example.test`;
  process.env.WHATSAPP_PILOT_ALLOWED_PHONES = `${candidatePhone},${conflictPhone}`;

  const originalFetch = globalThis.fetch;
  let emailCode = '';
  let whatsappCode = '';
  let emailDeliveries = 0;
  let failEmailDelivery = false;
  let whatsappDeliveries = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = String(input);
    if (target === 'https://api.resend.com/emails') {
      if (failEmailDelivery) return new Response('{}', { status: 503 });
      const body = JSON.parse(String(init?.body || '{}')) as { html?: string };
      emailCode = body.html?.match(/>(\d{6})</)?.[1] || '';
      emailDeliveries += 1;
      return new Response(JSON.stringify({ id: 'local-email' }), { status: 200 });
    }
    if (target.startsWith('https://graph.facebook.com/')) {
      const body = JSON.parse(String(init?.body || '{}')) as { template?: { components?: Array<{ parameters?: Array<{ text?: string }> }> } };
      whatsappCode = body.template?.components?.[0]?.parameters?.[0]?.text || '';
      whatsappDeliveries += 1;
      return new Response(JSON.stringify({ messages: [{ id: 'local-message' }] }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  let server: http.Server | null = null;
  try {
    const { getDb } = await import('../server/database/postgres');
    const { userRepository } = await import('../server/repositories');
    const { createToken, verifyToken } = await import('../server/auth');
    const { hashPassword } = await import('../server/passwords');
    const { hashSetupToken } = await import('../server/activation-codes');
    const platform = await userRepository.create({
      phone: oldPhone,
      firstName: 'Platform',
      lastName: 'Yönetici',
      isPhoneVerified: false,
    });
    const normal = await userRepository.create({
      phone: `+905${String((Number(suffix) + 3) % 900000000 + 100000000).slice(0, 9)}`,
      firstName: 'Normal',
      lastName: 'Kullanıcı',
      email: 'normal-binding@example.test',
      isPhoneVerified: true,
    });
    const conflicting = await userRepository.create({
      phone: conflictPhone,
      firstName: 'Çakışan',
      lastName: 'Kullanıcı',
      isPhoneVerified: true,
    });
    process.env.PLATFORM_ADMIN_USER_IDS = platform.id;
    await userRepository.updatePasswordHash(platform.id, hashPassword('Local-Platform-Password-42'));
    const storedBefore = await userRepository.getById(platform.id);
    assert(storedBefore);
    const platformToken = createToken({ userId: platform.id, phone: oldPhone, auth_version: storedBefore.authVersion });
    const normalStored = await userRepository.getById(normal.id);
    assert(normalStored);
    const normalToken = createToken({ userId: normal.id, phone: normal.phone, auth_version: normalStored.authVersion });

    const { apiRouter } = await import('../server/api');
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
    const request = async (method: string, path: string, token?: string, body?: object) => {
      const response = await originalFetch(baseUrl + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const db = await getDb();

    const unauthorizedStatus = (await request('GET', '/platform/phone-binding', normalToken)).status;
    assert.equal(unauthorizedStatus, 403);
    const initialStatus = await request('GET', '/platform/phone-binding', platformToken);
    assert.equal(initialStatus.status, 200);
    assert.equal(initialStatus.body.emailConfigured, false);
    assert.equal(initialStatus.body.passwordReauthAvailable, true);
    assert.equal(initialStatus.body.whatsappPhoneBound, false);

    assert.equal((await request('POST', '/platform/email-binding/start', normalToken, {
      email: candidateEmail, password: 'Local-Platform-Password-42',
    })).status, 403);
    const rejectedReauth = await request('POST', '/platform/email-binding/start', platformToken, {
      email: candidateEmail, password: 'wrong-password',
    });
    assert.equal(rejectedReauth.status, 401);
    assert.equal(rejectedReauth.body.code, 'PLATFORM_BINDING_VERIFICATION_FAILED');
    let sessionInvalidations = 0;
    const session = { invalidateRejectedToken: async () => { sessionInvalidations += 1; } };
    assert.equal(await applyUnauthorizedSessionPolicy(rejectedReauth.status, '/api/platform/email-binding/start', platformToken, session, rejectedReauth.body.code), false);
    assert.equal(sessionInvalidations, 0, 'wrong step-up password must preserve the Platform session');
    assert.equal(emailDeliveries, 0);
    assert.equal((await request('POST', '/platform/email-binding/start', platformToken, {
      email: 'normal-binding@example.test', password: 'Local-Platform-Password-42',
    })).status, 409);
    assert.equal(emailDeliveries, 0);

    failEmailDelivery = true;
    const deliveryFailure = await request('POST', '/platform/email-binding/start', platformToken, {
      email: candidateEmail, password: 'Local-Platform-Password-42',
    });
    assert.equal(deliveryFailure.status, 503);
    assert.equal(await applyUnauthorizedSessionPolicy(deliveryFailure.status, '/api/platform/email-binding/start', platformToken, session), false);
    assert.equal((await request('GET', '/platform/capabilities', platformToken)).status, 200);
    const afterDeliveryFailure = (await db.query<{ email: string | null; auth_version: number }>(
      'SELECT email,auth_version FROM users WHERE id=$1', [platform.id],
    )).rows[0];
    assert.equal(afterDeliveryFailure.email, null);
    assert.equal(afterDeliveryFailure.auth_version, storedBefore.authVersion);
    assert.equal((await db.query("SELECT id FROM platform_email_bindings WHERE user_id=$1 AND revoked_at IS NULL", [platform.id])).rows.length, 0);
    failEmailDelivery = false;
    // Advance only this fixture's rate-limit window; production limit stays unchanged.
    await db.query("UPDATE auth_rate_limits SET window_started_at=NOW()-interval '1 hour' WHERE scope_hash=$1", [
      hashSetupToken(`platform-phone-binding-rate:127.0.0.1:email-setup-start:${platform.id}`),
    ]);
    assert.equal(await applyUnauthorizedSessionPolicy(500, '/api/platform/email-binding/start', platformToken, session), false);
    assert.equal(await applyUnauthorizedSessionPolicy(503, '/api/platform/phone-binding', platformToken, session), false);
    assert.equal(sessionInvalidations, 0, 'database/delivery failures must preserve the session');
    const originalGetById = userRepository.getById;
    const originalConsoleError = console.error;
    try {
      userRepository.getById = async () => { throw new Error('Synthetic database connection unavailable'); };
      console.error = () => {};
      const databaseFailure = await request('POST', '/platform/email-binding/start', platformToken, {
        email: candidateEmail, password: 'Local-Platform-Password-42',
      });
      assert.equal(databaseFailure.status, 500);
      assert.equal(await applyUnauthorizedSessionPolicy(databaseFailure.status, '/api/platform/email-binding/start', platformToken, session, databaseFailure.body.code), false);
      assert.equal(sessionInvalidations, 0);
    } finally {
      userRepository.getById = originalGetById;
      console.error = originalConsoleError;
    }
    assert.equal((await request('GET', '/platform/capabilities', platformToken)).status, 200, 'same JWT must work after the database recovers');
    assert.equal(await applyUnauthorizedSessionPolicy(401, '/api/platform/email-binding/start', platformToken, session), true);
    assert.equal(sessionInvalidations, 1, 'genuine middleware 401 must still invalidate the JWT');

    const emailStarted = await request('POST', '/platform/email-binding/start', platformToken, {
      email: candidateEmail, password: 'Local-Platform-Password-42',
    });
    assert.equal(emailStarted.status, 201);
    assert.equal(typeof emailStarted.body.bindingId, 'string');
    assert.match(emailCode, /^\d{6}$/);
    const initialEmailCode = emailCode;
    assert.equal(emailDeliveries, 1);
    assert.equal((await db.query<{ email: string | null }>('SELECT email FROM users WHERE id=$1', [platform.id])).rows[0].email, null, 'email must not change before ownership verification');
    const storedEmailBinding = (await db.query<{ code_hash: string }>(
      'SELECT code_hash FROM platform_email_bindings WHERE id=$1', [emailStarted.body.bindingId],
    )).rows[0];
    assert.notEqual(storedEmailBinding.code_hash, initialEmailCode);

    const wrongInitialEmailCode = initialEmailCode === '000000' ? '000001' : '000000';
    assert.equal((await request('POST', '/platform/email-binding/verify', platformToken, {
      bindingId: emailStarted.body.bindingId, code: wrongInitialEmailCode,
    })).status, 401);
    assert.equal((await db.query<{ attempts: number }>(
      'SELECT attempts FROM platform_email_bindings WHERE id=$1', [emailStarted.body.bindingId],
    )).rows[0].attempts, 1, 'failed initial email attempt must persist');
    assert.equal((await db.query<{ email: string | null }>('SELECT email FROM users WHERE id=$1', [platform.id])).rows[0].email, null);

    const emailCompleted = await request('POST', '/platform/email-binding/verify', platformToken, {
      bindingId: emailStarted.body.bindingId, code: initialEmailCode,
    });
    assert.equal(emailCompleted.status, 200);
    assert.equal(emailCompleted.body.sessionInvalidated, true);
    const emailBoundUser = await userRepository.getById(platform.id);
    assert(emailBoundUser);
    assert.equal((await db.query<{ email: string | null }>('SELECT email FROM users WHERE id=$1', [platform.id])).rows[0].email, candidateEmail);
    assert.equal(emailBoundUser.authVersion, storedBefore.authVersion + 1);
    assert.equal((await request('GET', '/platform/capabilities', platformToken)).status, 401, 'email binding must invalidate the old token');
    const postEmailToken = createToken({ userId: platform.id, phone: oldPhone, auth_version: emailBoundUser.authVersion });
    assert.equal((await request('POST', '/platform/email-binding/verify', postEmailToken, {
      bindingId: emailStarted.body.bindingId, code: initialEmailCode,
    })).status, 401, 'initial email code must be single use');
    const emailAudit = (await db.query<{ details: string }>(
      "SELECT details FROM audit_logs WHERE actor_user_id=$1 AND action='platform.email_bound' ORDER BY created_at DESC LIMIT 1",
      [platform.id],
    )).rows[0];
    assert(emailAudit);
    assert.equal(emailAudit.details.includes(candidateEmail), false, 'audit must not contain the email');

    emailDeliveries = 0;
    assert.equal((await request('POST', '/platform/phone-binding/start', postEmailToken, { phone: conflictPhone })).status, 409);
    assert.equal(emailDeliveries, 0);

    emailCode = '';
    const started = await request('POST', '/platform/phone-binding/start', postEmailToken, { phone: candidatePhone });
    assert.equal(started.status, 201);
    assert.equal(typeof started.body.bindingId, 'string');
    assert.match(emailCode, /^\d{6}$/);
    assert.equal(emailDeliveries, 1);
    assert.equal((await userRepository.getById(platform.id))?.phone, oldPhone, 'phone must not change before both factors');
    const storedCodes = (await db.query<{ email_code_hash: string; whatsapp_code_hash: string | null }>(
      'SELECT email_code_hash,whatsapp_code_hash FROM platform_phone_bindings WHERE id=$1',
      [started.body.bindingId],
    )).rows[0];
    assert.notEqual(storedCodes.email_code_hash, emailCode);
    assert.equal(storedCodes.whatsapp_code_hash, null);

    const wrongEmailCode = emailCode === '000000' ? '000001' : '000000';
    assert.equal((await request('POST', '/platform/phone-binding/verify-email', postEmailToken, {
      bindingId: started.body.bindingId, code: wrongEmailCode,
    })).status, 401);
    assert.equal((await db.query<{ email_attempts: number }>(
      'SELECT email_attempts FROM platform_phone_bindings WHERE id=$1', [started.body.bindingId],
    )).rows[0].email_attempts, 1, 'failed email attempt must persist');
    assert.equal((await userRepository.getById(platform.id))?.phone, oldPhone);

    const emailVerified = await request('POST', '/platform/phone-binding/verify-email', postEmailToken, {
      bindingId: started.body.bindingId, code: emailCode,
    });
    assert.equal(emailVerified.status, 200);
    assert.match(whatsappCode, /^\d{6}$/);
    assert.notEqual(whatsappCode, emailCode);
    assert.equal(whatsappDeliveries, 1);
    assert.equal((await userRepository.getById(platform.id))?.phone, oldPhone);
    assert.equal((await request('POST', '/platform/phone-binding/verify-email', postEmailToken, {
      bindingId: started.body.bindingId, code: emailCode,
    })).status, 401, 'email code must be single use');

    const wrongWhatsappCode = whatsappCode === '000000' ? '000001' : '000000';
    assert.equal((await request('POST', '/platform/phone-binding/verify-whatsapp', postEmailToken, {
      bindingId: started.body.bindingId, code: wrongWhatsappCode,
    })).status, 401);
    assert.equal((await db.query<{ whatsapp_attempts: number }>(
      'SELECT whatsapp_attempts FROM platform_phone_bindings WHERE id=$1', [started.body.bindingId],
    )).rows[0].whatsapp_attempts, 1, 'failed WhatsApp attempt must persist');
    assert.equal((await userRepository.getById(platform.id))?.phone, oldPhone);

    const completed = await request('POST', '/platform/phone-binding/verify-whatsapp', postEmailToken, {
      bindingId: started.body.bindingId, code: whatsappCode,
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.sessionInvalidated, true);
    const bound = await userRepository.getById(platform.id);
    assert(bound);
    assert.equal(bound.phone, candidatePhone);
    assert.equal(bound.isPhoneVerified, true);
    assert.equal(bound.authVersion, storedBefore.authVersion + 2);
    assert.equal(process.env.PLATFORM_ADMIN_USER_IDS, platform.id);
    assert.equal((await request('GET', '/platform/capabilities', postEmailToken)).status, 401, 'phone binding must invalidate the prior token');
    const fullyBoundToken = createToken({ userId: platform.id, phone: candidatePhone, auth_version: bound.authVersion });
    const completedStatus = await request('GET', '/platform/phone-binding', fullyBoundToken);
    assert.equal(completedStatus.status, 200);
    assert.equal(completedStatus.body.whatsappPhoneBound, true);
    assert.equal(completedStatus.body.emailConfigured, true);
    const audit = (await db.query<{ details: string }>(
      "SELECT details FROM audit_logs WHERE actor_user_id=$1 AND action='platform.phone_bound' ORDER BY created_at DESC LIMIT 1",
      [platform.id],
    )).rows[0];
    assert(audit);
    assert.equal(audit.details.includes(candidatePhone), false, 'audit must not contain the phone');

    process.env.PHONE_CENTRIC_AUTH_ENABLED = 'true';
    for (let loginAttempt = 0; loginAttempt < 2; loginAttempt += 1) {
      emailCode = '';
      whatsappCode = '';
      const loginStart = await request('POST', '/auth/phone/request-code', undefined, { phone: candidatePhone });
      assert.equal(loginStart.status, 200);
      assert.match(whatsappCode, /^\d{6}$/);
      const firstFactorCode = whatsappCode;
      const firstFactor = await request('POST', '/auth/phone/verify-code', undefined, {
        attemptId: loginStart.body.attemptId,
        challengeId: loginStart.body.challengeId,
        phone: candidatePhone,
        code: firstFactorCode,
      });
      assert.equal(firstFactor.status, 200);
      assert.equal(firstFactor.body.pendingEmail, true);
      assert.equal('token' in firstFactor.body, false);
      assert.match(emailCode, /^\d{6}$/);
      assert.notEqual(emailCode, firstFactorCode);
      const secondFactor = await request('POST', '/auth/phone/verify-email', undefined, {
        attemptId: loginStart.body.attemptId,
        phone: candidatePhone,
        emailCode,
      });
      assert.equal(secondFactor.status, 200);
      assert.equal(verifyToken(String(secondFactor.body.token))?.auth_method, 'phone_centric_platform');
    }
    assert.equal((await request('POST', '/auth/login', undefined, {
      phone: candidatePhone, password: 'Local-Platform-Password-42',
    })).status, 401, 'platform password must not bypass two-factor login in phone-centric mode');

    console.log('Platform Admin phone binding: email re-auth, WhatsApp ownership, atomic update, session invalidation, audit safety and repeated two-factor login PASS.');

    await db.query('DELETE FROM platform_phone_bindings WHERE user_id=$1', [platform.id]);
    await db.query('DELETE FROM platform_email_bindings WHERE user_id=$1', [platform.id]);
    await db.query("DELETE FROM audit_logs WHERE actor_user_id=$1 AND action IN ('platform.phone_bound','platform.email_bound')", [platform.id]);
    await db.query('DELETE FROM identity_auth_attempts WHERE target_user_id=$1', [platform.id]);
    await db.query('DELETE FROM whatsapp_auth_challenges WHERE target_user_id=$1', [platform.id]);
    await db.query('DELETE FROM users WHERE id IN ($1,$2,$3)', [platform.id, normal.id, conflicting.id]);
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    globalThis.fetch = originalFetch;
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    };
    restore('NODE_ENV', previous.nodeEnv);
    restore('JWT_SECRET', previous.jwt);
    restore('AUTH_CODE_SECRET', previous.authCode);
    restore('WHATSAPP_AUTH_ENABLED', previous.whatsappAuth);
    restore('WHATSAPP_PILOT_ENABLED', previous.whatsappPilot);
    restore('WHATSAPP_PILOT_ALLOWED_PHONES', previous.whatsappAllowed);
    restore('WHATSAPP_PHONE_NUMBER_ID', previous.whatsappPhoneId);
    restore('WHATSAPP_ACCESS_TOKEN', previous.whatsappToken);
    restore('PHONE_CENTRIC_AUTH_ENABLED', previous.phoneCentric);
    restore('PLATFORM_ADMIN_USER_IDS', previous.platformIds);
    restore('RESEND_API_KEY', previous.resend);
    restore('EMAIL_FROM', previous.emailFrom);
  }
}

main().catch((error) => {
  console.error('Platform Admin phone binding test FAILED. No credentials, codes, tokens or phone numbers are logged.');
  process.exitCode = 1;
});
