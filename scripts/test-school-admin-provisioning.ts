import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { displayStoredTurkishPhone } from '../src/utils/phone';

// Komut adı tarihsel olarak korunur (test:school-admin-provisioning).
// Platform yöneticisi okul açar ve okul yöneticisini telefon + e-posta ile ekler. Okul kodu, lisans kodu ve
// e-posta doğrulama kodu yoktur; yönetici ilk girişini WhatsApp koduyla yapar (ayrıntısı
// test-provisioned-admin-phone-login.ts içinde). E-posta yalnız bilgilendirme ve lisans hatırlatmaları içindir.
let stage = 'setup';
async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local test database required');
  process.env.NODE_ENV = 'test';
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.RESEND_API_KEY = 'local-test-key';
  process.env.EMAIL_FROM = 'test@example.test';
  const emails: Array<{ to: string; subject: string; html: string; text?: string }> = [];
  let failNextEmail = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.resend.com/emails')) {
      if (failNextEmail) { failNextEmail = false; return new Response('{}', { status: 503 }); }
      const payload = JSON.parse(String(init?.body || '{}')) as { to: string[]; subject: string; html: string; text?: string };
      emails.push({ to: payload.to[0], subject: payload.subject, html: payload.html, text: payload.text });
      return new Response(JSON.stringify({ id: 'local-email' }), { status: 200 });
    }
    return originalFetch(input, init);
  };

  const { getDb } = await import('../server/database/postgres');
  const { createExpressApp } = await import('../server/app');
  const { createToken } = await import('../server/auth');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const db = await getDb();
  const phone = () => `+905${crypto.randomInt(100000000, 999999999)}`;
  const platform = await userRepository.create({ phone: phone(), firstName: 'PLATFORM', lastName: 'SAHİBİ' });
  process.env.PLATFORM_ADMIN_USER_IDS = platform.id;
  const tokenFor = async (userId: string) => {
    const user = await userRepository.getById(userId);
    return createToken({ userId, phone: user!.phone, auth_version: user!.authVersion });
  };
  const platformToken = await tokenFor(platform.id);
  const outsider = await userRepository.create({ phone: phone(), firstName: 'YETKİSİZ', lastName: 'KİŞİ', isPhoneVerified: true });
  const outsiderToken = await tokenFor(outsider.id);
  const schools: string[] = [];
  const userIds = [platform.id, outsider.id];

  const server = http.createServer(createExpressApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  async function request(method: string, path: string, token: string, body?: Record<string, unknown>) {
    const payload = body && typeof body.phone === 'string' && /^\+905\d{9}$/.test(body.phone) ? { ...body, phone: displayStoredTurkishPhone(body.phone) } : body;
    const response = await originalFetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: payload ? JSON.stringify(payload) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
  }

  try {
    stage = 'platform creates a school without school or license codes';
    const created = await request('POST', '/platform/schools', platformToken, { name: 'Yönetici Okulu', city: 'Ankara', district: 'Kahramankazan' });
    assert.equal(created.status, 201);
    const school = created.body.school as Record<string, unknown>;
    schools.push(String(school.id));
    assert.equal(school.code, undefined, 'okul kodu gösterilmez');
    assert.equal(school.licenseCode, undefined, 'lisans kodu gösterilmez');
    assert.equal(school.licenseStatus, 'active');
    assert.equal((await request('POST', '/platform/schools', outsiderToken, { name: 'İzinsiz', city: 'A', district: 'B' })).status, 403, 'platform yöneticisi olmayan okul açamaz');

    stage = 'admin invitation validation';
    const path = `/platform/schools/${school.id}/admin-invitation`;
    const managerPhone = phone();
    assert.equal((await request('POST', path, platformToken, { fullName: 'Tek', phone: managerPhone, email: 'a@example.test' })).status, 400, 'ad soyad gerekli');
    assert.equal((await request('POST', path, platformToken, { fullName: 'Ali Veli', phone: '123', email: 'a@example.test' })).status, 400, 'geçerli telefon gerekli');
    assert.equal((await request('POST', path, platformToken, { fullName: 'Ali Veli', phone: managerPhone, email: 'gecersiz' })).status, 400, 'geçerli e-posta gerekli');
    assert.equal((await request('POST', path, outsiderToken, { fullName: 'Ali Veli', phone: managerPhone, email: 'a@example.test' })).status, 403);

    stage = 'invitation creates a pending admin and sends a code-free email';
    const invited = await request('POST', path, platformToken, { fullName: 'Ayşe Yönetici', phone: managerPhone, email: 'ayse@example.test' });
    assert.equal(invited.status, 201);
    assert.equal(invited.body.emailSent, true);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, 'ayse@example.test');
    assert(!/\d{6}/.test(emails[0].text || ''), 'e-postada doğrulama kodu olmamalı');
    assert(!/OKUL KODU|LİSANS KODU/.test(emails[0].html), 'e-postada okul/lisans kodu olmamalı');
    assert(emails[0].html.includes('WhatsApp'), 'e-posta WhatsApp ile girişi anlatmalı');
    const manager = await userRepository.getByPhone(managerPhone);
    assert(manager);
    userIds.push(manager.id);
    assert.equal((await db.query<{ email: string }>('SELECT email FROM users WHERE id=$1', [manager.id])).rows[0].email, 'ayse@example.test', 'e-posta lisans hatırlatmaları için saklanır');
    assert.equal((await membershipRepository.getMembershipsByUserId(manager.id)).length, 0, 'ilk WhatsApp girişine kadar yetki verilmez');
    const listed = (await request('GET', '/platform/schools', platformToken)).body.schools as Array<Record<string, unknown>>;
    const row = listed.find((item) => item.id === school.id)!;
    assert.equal(row.adminStatus, 'pending');
    assert.equal(row.code, undefined);
    assert.equal(row.licenseCode, undefined);
    const invitation = (await db.query(`SELECT expires_at FROM invitations WHERE target_user_id=$1 AND purpose='school_admin_activation' AND is_active=TRUE`, [manager.id])).rows[0] as { expires_at: string };
    const days = (new Date(invitation.expires_at).getTime() - Date.now()) / 86_400_000;
    assert(days > 6.9 && days <= 7.01, 'davet 7 gün geçerlidir');

    stage = 'pending admin cannot use school management';
    assert.equal((await request('GET', `/schools/${school.id}/management/student-records`, await tokenFor(manager.id))).status, 403);

    stage = 'duplicate and conflicting invitations are rejected';
    assert.equal((await request('POST', path, platformToken, { fullName: 'Ayşe Yönetici', phone: managerPhone, email: 'ayse@example.test' })).status, 409);
    const second = await request('POST', '/platform/schools', platformToken, { name: 'İkinci Okul', city: 'Ankara', district: 'Çankaya' });
    schools.push(String(second.body.school.id));
    assert.equal((await request('POST', `/platform/schools/${second.body.school.id}/admin-invitation`, platformToken, { fullName: 'Ayşe Yönetici', phone: managerPhone, email: 'ayse@example.test' })).status, 409, 'aynı kişi iki okulda bekleyen yönetici olamaz');

    stage = 'email failure does not lose the invitation';
    failNextEmail = true;
    const otherPhone = phone();
    const noEmail = await request('POST', `/platform/schools/${second.body.school.id}/admin-invitation`, platformToken, { fullName: 'Mehmet Yönetici', phone: otherPhone, email: 'mehmet@example.test' });
    assert.equal(noEmail.status, 201);
    assert.equal(noEmail.body.emailSent, false);
    const other = await userRepository.getByPhone(otherPhone);
    assert(other);
    userIds.push(other.id);

    stage = 'resend refreshes the same pending invitation';
    await db.query("UPDATE invitations SET created_at=NOW()-INTERVAL '61 seconds' WHERE target_user_id=$1", [manager.id]);
    const before = emails.length;
    const resent = await request('POST', `${path}/resend`, platformToken);
    assert.equal(resent.status, 200);
    assert.equal(emails.length, before + 1);
    assert(!/\d{6}/.test(emails.at(-1)!.text || ''), 'yeniden gönderilen e-postada da kod olmamalı');
    assert.equal((await userRepository.getByPhone(managerPhone))!.id, manager.id, 'yeniden gönderim yeni hesap açmaz');

    console.log('School admin provisioning: code-free school creation, validation, pending admin with code-free email, 7-day invitation, no access before WhatsApp login, conflicts, email failure and resend PASS.');
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const id of schools) await db.query('DELETE FROM schools WHERE id=$1', [id]);
    for (const id of userIds) await db.query('DELETE FROM users WHERE id=$1', [id]);
    delete process.env.PLATFORM_ADMIN_USER_IDS;
  }
}

run().catch((cause) => {
  console.error(`School admin provisioning test FAILED at stage: ${stage}.`);
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
