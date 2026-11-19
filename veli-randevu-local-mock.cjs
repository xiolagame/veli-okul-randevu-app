/**
 * Veli Randevu — local-only WhatsApp + email transport mock.
 * NOT for production. Load with NODE_OPTIONS=--require path/to/this/file.
 * Refuses non-development, remote DB/env, unexpected credentials, and outside localhost.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const guard = () => {
  const p = process.env;
  if (p.NODE_ENV !== 'development' || p.WHATSAPP_AUTH_ENABLED !== 'true' || p.WHATSAPP_UNIFIED_LOGIN_ENABLED !== 'true') {
    throw new Error('[LOCAL MOCK] Requires development + enabled unified WhatsApp flags.');
  }
  for (const key of ['DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) {
    if (p[key]) throw new Error(`[LOCAL MOCK] Refusing environment with ${key} configured.`);
  }
  if (p.WHATSAPP_PHONE_NUMBER_ID !== '1234567890' || p.WHATSAPP_ACCESS_TOKEN !== 'LOCAL_TEST_FAKE_TOKEN_DO_NOT_USE') {
    throw new Error('[LOCAL MOCK] Requires the specified FAKE test-only WhatsApp credentials.');
  }
  if (p.RESEND_API_KEY !== 'LOCAL_TEST_FAKE_RESEND_KEY' || p.EMAIL_FROM !== 'local-test@example.invalid') {
    throw new Error('[LOCAL MOCK] Requires the specified FAKE test-only email credentials.');
  }
  if (path.basename(process.cwd()) !== 'veli-randevu-tek-giris-test') {
    throw new Error('[LOCAL MOCK] Run only from veli-randevu-tek-giris-test.');
  }
};
guard();

const outbox = path.join(process.cwd(), '.local-mock-outbox');
fs.mkdirSync(outbox, { recursive: true, mode: 0o700 });
const realFetch = globalThis.fetch;
const save = (name, content) => fs.writeFileSync(path.join(outbox, name), content, { mode: 0o600 });

/** Mock only the two explicit outbound providers; never send to external hosts. */
globalThis.fetch = async (input, init = {}) => {
  guard();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  if (/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/1234567890\/messages$/.test(url)) {
    const payload = JSON.parse(String(init.body || '{}'));
    const code = payload?.template?.components?.[0]?.parameters?.[0]?.text;
    if (!/^\d{6}$/.test(code) || !/^[0-9]{10,15}$/.test(String(payload?.to || ''))) {
      throw new Error('[LOCAL MOCK] Unexpected WhatsApp request payload.');
    }
    save('whatsapp.txt', `LOCAL TEST ONLY — NO MESSAGE WAS SENT\nPhone: ${payload.to}\nCode: ${code}\nGenerated: ${new Date().toISOString()}\n`);
    return new Response(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'local-mock-whatsapp' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url === 'https://api.resend.com/emails') {
    const payload = JSON.parse(String(init.body || '{}'));
    if (!payload.html || !Array.isArray(payload.to)) throw new Error('[LOCAL MOCK] Unexpected email request payload.');
    save('email-preview.html', String(payload.html));
    save('email-info.txt', `LOCAL TEST ONLY — NO EMAIL WAS SENT\nRecipient: ${payload.to.join(', ')}\nSubject: ${payload.subject}\nOpen email-preview.html to see the verification code.\nGenerated: ${new Date().toISOString()}\n`);
    return new Response(JSON.stringify({ id: 'local-mock-email' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (/^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(String(url)) || /^http:\/\/localhost(?::\d+)?(?:\/|$)/.test(String(url))) {
    return realFetch(input, init);
  }
  throw new Error(`[LOCAL MOCK] Blocked non-local outbound fetch: ${new URL(String(url)).hostname}`);
};

process.stdout.write('[LOCAL MOCK] WhatsApp and email intercepted; outgoing external fetch is blocked.\n');
