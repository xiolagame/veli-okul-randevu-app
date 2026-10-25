import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';

// Historical command name retained: this now proves pilot retirement cannot bypass eligibility.
let stage = 'setup';
async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local PGlite required');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64url');
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(48).toString('base64url');
  process.env.WHATSAPP_AUTH_ENABLED = 'true';
  process.env.WHATSAPP_UNIFIED_LOGIN_ENABLED = 'true';
  process.env.PHONE_CENTRIC_AUTH_ENABLED = 'true';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  process.env.WHATSAPP_ACCESS_TOKEN = 'local-fixture';
  delete process.env.WHATSAPP_PILOT_ENABLED;
  delete process.env.WHATSAPP_PILOT_ALLOWED_PHONES;
  const originalFetch = globalThis.fetch;
  const codes: string[] = [];
  let failDelivery = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://graph.facebook.com/')) {
      if (failDelivery) return new Response('{}', { status: 503 });
      const payload = JSON.parse(String(init?.body)) as { template: { components: { parameters: { text: string }[] }[] } };
      codes.push(payload.template.components[0].parameters[0].text);
      return new Response(JSON.stringify({ messages: [{ id: 'local-delivery' }] }), { status: 200 });
    }
    if (!url.startsWith('http://127.0.0.1:')) throw new Error('External transport prohibited');
    return originalFetch(input, init);
  };
  const { getDb } = await import('../server/database/postgres');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const { apiRouter } = await import('../server/api');
  const { isWhatsAppAuthEnabled, isWhatsAppPhoneEnabled } = await import('../server/whatsapp-cloud');
  assert(isWhatsAppAuthEnabled()); assert(!isWhatsAppPhoneEnabled('invalid'));
  const db = await getDb(); assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  const schoolId = 'general-wa-' + crypto.randomUUID();
  await db.query("INSERT INTO schools(id,name,code,city,district) VALUES($1,'Local School',$2,'Test','Test')", [schoolId, crypto.randomBytes(8).toString('hex')]);
  const users = [];
  for (const role of ['parent', 'teacher', 'security', 'admin'] as const) {
    const user = await userRepository.create({ phone: '+905' + crypto.randomInt(100000000, 999999999), firstName: 'Local', lastName: role, email: role + '@example.test', isPhoneVerified: true });
    await membershipRepository.createOrActivate({ schoolId, userId: user.id, role }); users.push({ ...user, role });
  }
  const unknownPhone = '+905' + crypto.randomInt(100000000, 999999999);
  const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use('/api', apiRouter);
  const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port + '/api'; let ip = 1;
  type Body = { challengeId?: string; attemptId?: string; token?: string; deliveryStatus?: string; legacyFallbackRequired?: boolean; memberships?: { role: string }[] };
  const request = async (route: string, body: object, fixedIp?: string) => { const response = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': fixedIp || `192.0.2.${ip++}` }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() as Body }; };
  const start = (phone: string, fixedIp?: string) => request('/auth/whatsapp/request-code', { purpose: 'auto', phone }, fixedIp);
  const verify = (phone: string, challengeId: string | undefined, code: string) => request('/auth/whatsapp/verify-code', { phone, challengeId, code });
  const clear = (phone: string) => db.query('DELETE FROM whatsapp_auth_challenges WHERE target_phone=$1', [phone]);
  try {
    stage = 'all registered roles outside retired allowlist';
    for (const user of users) {
      const before = codes.length; const issued = await start(user.phone); assert.equal(issued.status, 200); assert.equal(codes.length, before + 1); assert.equal(issued.body.deliveryStatus, 'unconfirmed');
      const code = codes.at(-1)!;
      const verified = await verify(user.phone, issued.body.challengeId, code); assert.equal(verified.status, 200); assert(verified.body.token); assert.equal(verified.body.memberships?.[0].role, user.role);
      assert.equal((await verify(user.phone, issued.body.challengeId, code)).status, 401);
    }
    const parent = users[0];
    stage = 'old missing empty malformed false and unrelated pilot settings are inert';
    for (const setting of [undefined, '', 'invalid', unknownPhone]) {
      if (setting === undefined) delete process.env.WHATSAPP_PILOT_ALLOWED_PHONES; else process.env.WHATSAPP_PILOT_ALLOWED_PHONES = setting;
      process.env.WHATSAPP_PILOT_ENABLED = 'false';
      await clear(parent.phone); const before = codes.length;
      const issued = await start('0' + parent.phone.slice(3)); assert.equal(issued.status, 200); assert.equal(codes.length, before + 1);
      assert.equal((await verify(parent.phone, issued.body.challengeId, codes.at(-1)!)).status, 200);
    }
    stage = 'unregistered phones stay masked without account or challenge creation';
    const beforeUnknown = codes.length, unknown = await start(unknownPhone); assert.equal(unknown.status, 200); assert.equal(codes.length, beforeUnknown);
    assert.equal(unknown.body.deliveryStatus, 'unconfirmed'); assert.equal(await userRepository.getByPhone(unknownPhone), null);
    assert.equal((await db.query('SELECT id FROM whatsapp_auth_challenges WHERE id=$1', [unknown.body.challengeId])).rows.length, 0);
    assert.equal((await verify(unknownPhone, unknown.body.challengeId, '000000')).status, 401);
    stage = 'resend cooldown and single use';
    await clear(parent.phone); const first = await start(parent.phone), code = codes.at(-1)!, beforeResend = codes.length;
    const second = await start(parent.phone); assert.equal(second.status, 200); assert.equal(codes.length, beforeResend); assert.notEqual(second.body.challengeId, first.body.challengeId);
    assert.equal((await verify(parent.phone, first.body.challengeId, code)).status, 200);
    stage = 'wrong attempts and expiry';
    await clear(parent.phone); const wrong = await start(parent.phone); const wrongCode = codes.at(-1) === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) assert.equal((await verify(parent.phone, wrong.body.challengeId, wrongCode)).status, 401);
    assert.equal((await verify(parent.phone, wrong.body.challengeId, codes.at(-1)!)).status, 401);
    await clear(parent.phone); const expired = await start(parent.phone); await db.query("UPDATE whatsapp_auth_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [expired.body.challengeId]); assert.equal((await verify(parent.phone, expired.body.challengeId, codes.at(-1)!)).status, 401);
    stage = 'inactive memberships and disabled schools';
    await clear(parent.phone); await db.query("UPDATE school_memberships SET status='inactive' WHERE user_id=$1", [parent.id]); const beforeInactive = codes.length; await start(parent.phone); assert.equal(codes.length, beforeInactive);
    await db.query("UPDATE school_memberships SET status='active' WHERE user_id=$1", [parent.id]); await db.query('UPDATE schools SET disabled_at=NOW() WHERE id=$1', [schoolId]); await start(parent.phone); assert.equal(codes.length, beforeInactive); await db.query('UPDATE schools SET disabled_at=NULL WHERE id=$1', [schoolId]);
    stage = 'request rate limit';
    for (let i = 0; i < 5; i++) assert.equal((await start(unknownPhone, '198.51.100.50')).status, 200);
    assert.equal((await start(unknownPhone, '198.51.100.50')).status, 429);
    stage = 'provider failure never claims delivery or leaves usable code';
    await clear(parent.phone); failDelivery = true;
    const failed = await start(parent.phone); assert.equal(failed.status, 200); assert.equal(failed.body.deliveryStatus, 'unconfirmed');
    const revoked = await db.query<{ revoked_at: string | null }>('SELECT revoked_at FROM whatsapp_auth_challenges WHERE target_phone=$1', [parent.phone]); assert(revoked.rows[0]?.revoked_at);
    assert.equal((await verify(parent.phone, failed.body.challengeId, codes.at(-1)!)).status, 401); failDelivery = false;
    stage = 'global kill switch and provider configuration fail closed';
    process.env.WHATSAPP_AUTH_ENABLED = 'false'; assert(!isWhatsAppAuthEnabled()); assert.equal((await start(parent.phone)).status, 404);
    assert.equal((await request('/auth/whatsapp/request-code', { purpose: 'login', phone: parent.phone })).status, 503);
    process.env.WHATSAPP_AUTH_ENABLED = 'true'; delete process.env.WHATSAPP_ACCESS_TOKEN; assert.equal((await start(parent.phone)).status, 503);
    console.log('WhatsApp registered access PASS: retired pilot flags/lists ignored; all roles, unknown denial, no enumeration/false delivery, replay/expiry/attempts/cooldown/rate limits, inactive/disabled guards and global/config kill switches preserved. Mock delivery only.');
  } finally { globalThis.fetch = originalFetch; await new Promise<void>(resolve => server.close(() => resolve())); }
}
run().catch(() => { console.error(`WhatsApp registered access FAILED at: ${stage}. No identities, codes, tokens or response bodies logged.`); process.exitCode = 1; });
