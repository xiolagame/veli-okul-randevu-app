import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';

let stage = 'isolated setup';
async function run() {
  if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') throw new Error('Local PGlite required');
  const root = process.cwd();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'veli-provisioned-admin-login-'));
  fs.mkdirSync(path.join(temp, 'server/database'), { recursive: true });
  fs.copyFileSync(path.join(root, 'server/database/supabase_schema.sql'), path.join(temp, 'server/database/supabase_schema.sql'));
  fs.cpSync(path.join(root, 'server/database/migrations'), path.join(temp, 'server/database/migrations'), { recursive: true });
  process.chdir(temp);
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64url');
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(48).toString('base64url');
  process.env.PHONE_CENTRIC_AUTH_ENABLED = 'true';
  process.env.WHATSAPP_AUTH_ENABLED = 'true';
  process.env.WHATSAPP_PILOT_ENABLED = 'true';
  process.env.WHATSAPP_UNIFIED_LOGIN_ENABLED = 'true';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  process.env.WHATSAPP_ACCESS_TOKEN = 'synthetic-local-fixture';
  process.env.RESEND_API_KEY = 'synthetic-local-fixture';
  process.env.EMAIL_FROM = 'fixture@example.test';
  const managerPhone = '+905' + crypto.randomInt(100000000, 999999999);
  const unknownPhone = '+905' + crypto.randomInt(100000000, 999999999);
  process.env.WHATSAPP_PILOT_ALLOWED_PHONES = [managerPhone, unknownPhone].join(',');
  const whatsappCodes: string[] = [], emailCodes: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://graph.facebook.com/')) {
      const payload = JSON.parse(String(init?.body)) as { template: { components: { parameters: { text: string }[] }[] } };
      whatsappCodes.push(payload.template.components[0].parameters[0].text);
      return new Response(JSON.stringify({ messages: [{ id: 'synthetic-message' }] }), { status: 200 });
    }
    if (url === 'https://api.resend.com/emails') {
      const payload = JSON.parse(String(init?.body)) as { html: string };
      const code = payload.html.match(/>(\d{6})</)?.[1];
      assert(code, 'local email must contain a code'); emailCodes.push(code);
      return new Response(JSON.stringify({ id: 'synthetic-email' }), { status: 200 });
    }
    if (!url.startsWith('http://127.0.0.1:')) throw new Error('External transport prohibited');
    return originalFetch(input, init);
  };
  const { getDb } = await import('../server/database/postgres');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const { createToken } = await import('../server/auth');
  const { apiRouter } = await import('../server/api');
  const db = await getDb();
  assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  const platform = await userRepository.create({ phone: '+905' + crypto.randomInt(100000000, 999999999), firstName: 'Platform', lastName: 'Fixture', email: 'platform@example.test' });
  process.env.PLATFORM_ADMIN_USER_IDS = platform.id;
  const platformAuth = await userRepository.getById(platform.id); assert(platformAuth);
  const platformToken = createToken({ userId: platform.id, phone: platform.phone, auth_version: platformAuth.authVersion });
  const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port + '/api';
  let ip = 1;
  type Body = { school?: { id: string; code: string }; schools?: { id: string; adminStatus: string }[]; token?: string; pendingEmail?: boolean; requiresSchoolCode?: boolean; attemptId?: string; challengeId?: string; legacyFallbackRequired?: boolean; memberships?: { schoolId: string; role: string }[] };
  const request = async (method: string, route: string, body?: object, token?: string) => {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${ip++}`, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() as Body };
  };
  try {
    stage = 'platform school creation and invitation';
    const created = await request('POST', '/platform/schools', { name: 'Local School', city: 'Test', district: 'Test' }, platformToken);
    assert.equal(created.status, 201); const school = created.body.school; assert(school);
    const digits = managerPhone.slice(3), formatted = '0' + digits;
    const inviteBody = { fullName: 'Local Manager', phone: formatted, email: 'manager@example.test' };
    assert.equal((await request('POST', `/platform/schools/${school.id}/admin-invitation`, inviteBody, platformToken)).status, 201);
    const manager = await userRepository.getByPhone(managerPhone); assert(manager);
    assert.equal((await membershipRepository.getMembershipsByUserId(manager.id)).length, 0);
    const listed = await request('GET', '/platform/schools', undefined, platformToken);
    assert.equal(listed.body.schools?.find(entry => entry.id === school.id)?.adminStatus, 'pending');
    const pendingToken = createToken({ userId: manager.id, phone: manager.phone, auth_version: manager.authVersion });
    assert.equal((await request('GET', `/schools/${school.id}/management/student-records`, undefined, pendingToken)).status, 403);
    const beforeDuplicates = (await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users')).rows[0].count;
    assert.equal((await request('POST', `/platform/schools/${school.id}/admin-invitation`, inviteBody, platformToken)).status, 409);
    assert.equal((await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users')).rows[0].count, beforeDuplicates);
    const resetChallenges = () => db.query('DELETE FROM whatsapp_auth_challenges WHERE target_phone=$1', [managerPhone]);
    stage = 'legacy role login cannot replace the admin activation entry point';
    const beforeLegacy = whatsappCodes.length;
    assert.equal((await request('POST', '/auth/whatsapp/request-code', { purpose: 'login', phone: managerPhone })).status, 200);
    assert.equal(whatsappCodes.length, beforeLegacy, 'legacy parent/staff login must not authorize a pending school admin');
    stage = 'pending admin accepted in all canonical input formats';
    for (const phone of [managerPhone, managerPhone.slice(1), formatted, digits, `(0${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`]) {
      const before = whatsappCodes.length;
      const start = await request('POST', '/auth/phone/request-code', { phone });
      assert.equal(start.status, 200); assert.equal(whatsappCodes.length, before + 1, 'provisioned pending admin must receive a mocked OTP');
      const challenge = (await db.query<{ target_user_id: string; school_id: string; purpose: string }>('SELECT target_user_id,school_id,purpose FROM whatsapp_auth_challenges WHERE id=$1', [start.body.challengeId])).rows[0];
      assert.equal(challenge?.target_user_id, manager.id); assert.equal(challenge.school_id, school.id); assert.equal(challenge.purpose, 'school_admin_activation');
      await resetChallenges();
    }
    stage = 'pilot, disabled school, license, expired and revoked invitations fail closed';
    const noSend = async () => { const before = whatsappCodes.length; assert.equal((await request('POST', '/auth/phone/request-code', { phone: managerPhone })).status, 200); assert.equal(whatsappCodes.length, before); };
    for (const config of [undefined, '', unknownPhone, managerPhone + ',invalid']) {
      if (config === undefined) delete process.env.WHATSAPP_PILOT_ALLOWED_PHONES;
      else process.env.WHATSAPP_PILOT_ALLOWED_PHONES = config;
      const before = whatsappCodes.length;
      const enabled = await request('POST', '/auth/phone/request-code', { phone: managerPhone });
      assert.equal(enabled.status, 200); assert.equal(enabled.body.legacyFallbackRequired, undefined);
      assert.equal(whatsappCodes.length, before + 1); await resetChallenges();
    }
    delete process.env.WHATSAPP_PILOT_ENABLED;
    const beforeFlag = whatsappCodes.length;
    assert.equal((await request('POST', '/auth/phone/request-code', { phone: managerPhone })).status, 200);
    assert.equal(whatsappCodes.length, beforeFlag + 1); await resetChallenges();
    await db.query('UPDATE schools SET disabled_at=NOW() WHERE id=$1', [school.id]); await noSend(); await db.query('UPDATE schools SET disabled_at=NULL WHERE id=$1', [school.id]);
    await db.query("UPDATE school_licenses SET status='suspended' WHERE school_id=$1", [school.id]); await noSend(); await db.query("UPDATE school_licenses SET status='active' WHERE school_id=$1", [school.id]);
    await db.query("UPDATE invitations SET expires_at=NOW()-INTERVAL '1 second' WHERE target_user_id=$1", [manager.id]); await noSend();
    await db.query("UPDATE invitations SET expires_at=NOW()+INTERVAL '1 hour',revoked_at=NOW(),is_active=FALSE WHERE target_user_id=$1", [manager.id]); await noSend();
    stage = 'revoked invitation is not eligible for resend';
    assert.equal((await request('POST', `/platform/schools/${school.id}/admin-invitation/resend`, {}, platformToken)).status, 404);
    // Restore this synthetic fixture to the expired-only state for the independent resend case.
    await db.query("UPDATE invitations SET is_active=TRUE,revoked_at=NULL,expires_at=NOW()-INTERVAL '1 second' WHERE target_user_id=$1", [manager.id]);
    stage = 'expired invitation authorized resend';
    // Existing authorized resend repairs an expired invitation without a replacement account.
    await db.query("UPDATE invitations SET created_at=NOW()-INTERVAL '61 seconds' WHERE target_user_id=$1", [manager.id]);
    assert.equal((await request('POST', `/platform/schools/${school.id}/admin-invitation/resend`, {}, platformToken)).status, 200);
    assert.equal((await userRepository.getByPhone(managerPhone))?.id, manager.id);
    stage = 'unknown phone is masked and never authorized';
    const beforeUnknown = whatsappCodes.length;
    const unknown = await request('POST', '/auth/phone/request-code', { phone: unknownPhone }); assert.equal(unknown.status, 200); assert.equal(whatsappCodes.length, beforeUnknown);
    assert.equal((await request('POST', '/auth/phone/verify-code', { ...unknown.body, phone: unknownPhone, code: '000000' })).status, 401);
    stage = 'OTP failures and phone-only access rejected';
    const start = await request('POST', '/auth/phone/request-code', { phone: managerPhone }); assert.equal(start.status, 200);
    const code = whatsappCodes.at(-1)!;
    assert.equal((await request('POST', '/auth/phone/verify-code', { ...start.body, phone: managerPhone, code: code === '000000' ? '000001' : '000000' })).status, 401);
    await db.query("UPDATE whatsapp_auth_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [start.body.challengeId]);
    assert.equal((await request('POST', '/auth/phone/verify-code', { ...start.body, phone: managerPhone, code })).status, 401); await resetChallenges();
    const valid = await request('POST', '/auth/phone/request-code', { phone: formatted });
    const verified = await request('POST', '/auth/phone/verify-code', { ...valid.body, phone: formatted, code: whatsappCodes.at(-1) });
    assert.equal(verified.status, 200); assert.equal(verified.body.pendingEmail, true); assert.equal(verified.body.requiresSchoolCode, true); assert.equal(verified.body.token, undefined);
    assert.equal((await membershipRepository.getMembershipsByUserId(manager.id)).length, 0);
    const emailCode = emailCodes.at(-1)!;
    assert.equal((await request('POST', '/auth/phone/verify-email', { attemptId: valid.body.attemptId, phone: formatted, emailCode, schoolCode: 'WRONG' })).status, 401);
    stage = 'email and school-code activation, own-tenant access and later login';
    const completed = await request('POST', '/auth/phone/verify-email', { attemptId: valid.body.attemptId, phone: formatted, emailCode, schoolCode: school.code });
    assert.equal(completed.status, 200); assert(completed.body.token); assert.equal(completed.body.memberships?.[0]?.schoolId, school.id);
    assert.equal((await request('GET', `/schools/${school.id}/management/student-records`, undefined, completed.body.token)).status, 200);
    const other = await request('POST', '/platform/schools', { name: 'Other Local School', city: 'Test', district: 'Test' }, platformToken); assert(other.body.school);
    assert.equal((await request('GET', `/schools/${other.body.school.id}/management/student-records`, undefined, completed.body.token)).status, 403);
    assert.equal((await request('GET', '/platform/schools', undefined, completed.body.token)).status, 403);
    assert.equal((await request('POST', '/auth/phone/verify-email', { attemptId: valid.body.attemptId, phone: formatted, emailCode, schoolCode: school.code })).status, 401);
    const later = await request('POST', '/auth/phone/request-code', { phone: managerPhone });
    const loggedIn = await request('POST', '/auth/phone/verify-code', { ...later.body, phone: managerPhone, code: whatsappCodes.at(-1) });
    assert.equal(loggedIn.status, 200); assert(loggedIn.body.token); assert.equal(loggedIn.body.pendingEmail, undefined);
    console.log('Provisioned school-admin phone login PASS: real platform creation/invitation, pending status, formats, pilot/license/disabled guards, resend preserves identity, OTP/email activation, replay rejection, later login and tenant isolation. Local PGlite + mocked delivery only.');
  } finally { globalThis.fetch = originalFetch; await new Promise<void>(resolve => server.close(() => resolve())); }
}
run().catch(() => { console.error(`Provisioned school-admin login FAILED at: ${stage}. No identities, codes or bodies logged.`); process.exitCode = 1; });
