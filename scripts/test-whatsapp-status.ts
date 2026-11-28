import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import serverless from 'serverless-http';
import { describeWhatsAppDelivery } from '../src/utils/whatsapp-delivery';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('This test requires local PGlite without DATABASE_URL.');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'local-whatsapp-status-test-secret-at-least-32-chars';
  process.env.AUTH_CODE_SECRET = 'local-whatsapp-status-code-secret-at-least-32-chars';
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  process.env.WHATSAPP_PHONE_NUMBER_ID = '111222333';

  const { createExpressApp } = await import('../server/app');
  const { getDb } = await import('../server/database/postgres');
  const { createToken } = await import('../server/auth');
  const { userRepository } = await import('../server/repositories');
  const db = await getDb();
  const app = createExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;

  let checks = 0;
  const check = (condition: unknown, message: string) => { assert(condition, message); checks++; };
  const equal = (actual: unknown, expected: unknown, message: string) => { assert.equal(actual, expected, message); checks++; };

  const secret = 'local-app-secret';
  const sign = (body: string, key = secret) => `sha256=${crypto.createHmac('sha256', key).update(body).digest('hex')}`;
  const known = `+905${crypto.randomInt(100000000, 999999999)}`;
  const stranger = `+905${crypto.randomInt(100000000, 999999999)}`;
  const challengeId = crypto.randomUUID();
  const createdUsers: string[] = [];
  const ids = [1, 2, 3, 4].map((n) => `wamid.TEST${n}.${crypto.randomUUID()}`);

  const payload = (statuses: object[], phoneNumberId = '111222333') => JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, statuses, messages: [{ text: { body: 'gizli gelen mesaj' } }] } }] }],
  });
  const status = (id: string, name: string, phone = known, extra: object = {}) => ({ id, status: name, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: phone.slice(1), ...extra });
  const post = async (body: string, signature: string | null = sign(body)) => (await fetch(`${base}/webhooks/whatsapp`, {
    method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', ...(signature ? { 'x-hub-signature-256': signature } : {}) }, body,
  })).status;
  const stored = async (id: string) => (await db.query<{ status: string; error_code: number | null; recipient_phone: string }>('SELECT status,error_code,recipient_phone FROM whatsapp_message_status WHERE message_id=$1', [id])).rows[0];
  const verifyUrl = (token: string, challenge = '12345') => `${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=${challenge}`;

  try {
    await db.query(`INSERT INTO whatsapp_auth_challenges(id,school_id,target_phone,target_user_id,target_role,target_profile_id,purpose,code_hash,max_attempts,expires_at,resend_available_at)
      VALUES($1,NULL,$2,NULL,NULL,NULL,'login',$3,5,NOW()+INTERVAL '5 minutes',NOW())`, [challengeId, known, 'a'.repeat(64)]);

    equal((await fetch(verifyUrl('anything'))).status, 404, 'verification is closed until configured');
    equal(await post(payload([status(ids[0], 'sent')])), 404, 'notifications are closed until configured');

    process.env.WHATSAPP_APP_SECRET = secret;
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'local-verify-token';
    const verified = await fetch(verifyUrl('local-verify-token'));
    equal(verified.status, 200, 'correct verify token accepted');
    equal(await verified.text(), '12345', 'challenge is echoed as plain text');
    equal((await fetch(verifyUrl('wrong-token'))).status, 403, 'wrong verify token rejected');
    equal((await fetch(verifyUrl('local-verify-token', '%3Cscript%3E'))).status, 403, 'unexpected challenge content rejected');

    const first = payload([status(ids[0], 'sent')]);
    equal(await post(first, null), 401, 'missing signature rejected');
    equal(await post(first, sign(first, 'other-secret')), 401, 'wrong signature rejected');
    equal(await post(`${first} `, sign(first)), 401, 'altered body rejected');
    equal(await stored(ids[0]), undefined, 'rejected notifications store nothing');
    equal(await post(first), 200, 'signed notification accepted');
    equal((await stored(ids[0])).status, 'sent', 'sent status stored');
    equal((await stored(ids[0])).recipient_phone, known, 'recipient is stored in canonical form');

    await post(payload([status(ids[0], 'delivered')]));
    equal((await stored(ids[0])).status, 'delivered', 'status moves forward');
    await post(payload([status(ids[0], 'sent')]));
    equal((await stored(ids[0])).status, 'delivered', 'late sent report does not move status back');
    await post(payload([status(ids[0], 'failed', known, { errors: [{ code: 131026, title: 'Message undeliverable' }] })]));
    equal((await stored(ids[0])).status, 'delivered', 'delivered message is not turned into a failure');
    await post(payload([status(ids[0], 'read')]));
    equal((await stored(ids[0])).status, 'read', 'read status stored');

    await post(payload([status(ids[1], 'sent')]));
    await post(payload([status(ids[1], 'failed', known, { errors: [{ code: 131026, title: 'Message undeliverable — ç ğ ş' }] })]));
    equal((await stored(ids[1])).status, 'failed', 'failure replaces sent');
    equal(Number((await stored(ids[1])).error_code), 131026, 'failure code stored');

    equal(await post(payload([status(ids[2], 'sent', stranger)])), 200, 'unrelated recipient is acknowledged');
    equal(await stored(ids[2]), undefined, 'recipient without a Veli Randevu code request is not stored');
    equal(await post(payload([status(ids[3], 'sent')], '999999')), 200, 'other sender number is acknowledged');
    equal(await stored(ids[3]), undefined, 'statuses of another sender number are not stored');
    equal(await post(payload([status(ids[3], 'unknown_state')])), 200, 'unknown status is acknowledged');
    equal(await stored(ids[3]), undefined, 'unknown status is not stored');
    equal(await post('not json'), 400, 'invalid JSON rejected');

    // Netlify fonksiyonu gövdeyi metin veya base64 olarak verir: imza iki durumda da tutmalı.
    const handler = serverless(app);
    for (const isBase64Encoded of [false, true]) {
      const body = payload([status(ids[3], 'failed', known, { errors: [{ code: 131049, title: 'Gönderilemedi: İstanbul' }] })]);
      const result = await handler({
        httpMethod: 'POST', path: '/.netlify/functions/api/webhooks/whatsapp', queryStringParameters: {},
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), 'x-hub-signature-256': sign(body) },
        body: isBase64Encoded ? Buffer.from(body).toString('base64') : body, isBase64Encoded,
      }, {}) as { statusCode: number };
      equal(result.statusCode, 200, `serverless request accepted (base64=${isBase64Encoded})`);
    }
    equal((await stored(ids[3])).status, 'failed', 'serverless notification stored');

    // Genel JSON okuma diğer uçlarda değişmedi.
    const other = await fetch(`${base}/public/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ companyWebsite: 'x' }) });
    equal(other.status, 400, 'other endpoints still parse JSON');
    check(String(((await other.json()) as { error: string }).error).includes('doğrulanamadı'), 'other endpoints receive the parsed body');

    const account = async (label: string) => {
      const user = await userRepository.create({ phone: `+905${crypto.randomInt(100000000, 999999999)}`, firstName: label, lastName: 'STATUS TEST', email: `${label.toLowerCase()}-${crypto.randomBytes(3).toString('hex')}@example.test` });
      createdUsers.push(user.id);
      const auth = await userRepository.getById(user.id);
      assert(auth);
      return { user, token: createToken({ userId: user.id, phone: user.phone, auth_version: auth.authVersion }) };
    };
    const platform = await account('PLATFORM');
    const someone = await account('SOMEONE');
    process.env.PLATFORM_ADMIN_USER_IDS = platform.user.id;
    const view = async (token?: string, query = '') => {
      const response = await fetch(`${base}/platform/whatsapp-status${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      return { status: response.status, body: await response.json() as { configured: boolean; messages: Array<{ id: string; phone: string; status: string; errorCode: number | null }>; codeRequests: string[] } };
    };
    equal((await view()).status, 401, 'anonymous cannot view delivery status');
    equal((await view(someone.token)).status, 403, 'non platform user cannot view delivery status');
    const all = await view(platform.token);
    equal(all.status, 200, 'platform admin views delivery status');
    check(all.body.configured && all.body.messages.some((item) => item.id === ids[1] && item.status === 'failed'), 'list contains the failed message');
    check(!JSON.stringify(all.body).includes('gizli gelen mesaj'), 'incoming message content is never exposed');
    const filtered = await view(platform.token, `?phone=${encodeURIComponent(`0${known.slice(3)}`)}`);
    check(filtered.body.messages.length === 3 && filtered.body.messages.every((item) => item.phone === known), 'search returns only that number');
    equal(filtered.body.codeRequests.length, 1, 'search shows code requests of that number');
    equal((await view(platform.token, '?phone=123')).status, 400, 'invalid phone search rejected');
    await db.query(`UPDATE whatsapp_message_status SET created_at=NOW()-INTERVAL '31 days' WHERE message_id=$1`, [ids[1]]);
    await view(platform.token);
    equal(await stored(ids[1]), undefined, 'records older than 30 days are removed');

    equal(describeWhatsAppDelivery({ status: 'delivered', errorCode: null, errorTitle: null }).label, 'Telefona ulaştı', 'delivered label');
    equal(describeWhatsAppDelivery({ status: 'sent', errorCode: null, errorTitle: null }).tone, 'warning', 'sent is not shown as delivered');
    check(describeWhatsAppDelivery({ status: 'failed', errorCode: 131026, errorTitle: 'x' }).explanation.includes('WhatsApp olmayabilir'), 'known error explained in Turkish');
    check(describeWhatsAppDelivery({ status: 'failed', errorCode: 999999, errorTitle: 'Some title' }).explanation.includes('Some title (Kod 999999)'), 'unknown error keeps provider title');

    console.log(`WhatsApp delivery status ${checks} signature, filtering, ordering, authorization and retention checks PASS.`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM whatsapp_message_status WHERE message_id = ANY($1::text[])', [ids]);
    await db.query('DELETE FROM whatsapp_auth_challenges WHERE id=$1', [challengeId]);
    for (const userId of createdUsers) await db.query('DELETE FROM users WHERE id=$1', [userId]);
    delete process.env.PLATFORM_ADMIN_USER_IDS;
  }
}

run().catch((cause: unknown) => {
  console.error('WhatsApp delivery status test FAILED.');
  if (cause instanceof Error) console.error(cause.message);
  process.exitCode = 1;
});
