import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';

// Komut adı tarihsel olarak korunur (test:auth / test:activation).
// Giriş yalnız telefon + WhatsApp kodudur. Bu test, kaldırılan parola, aktivasyon kodu, okul kodu ve
// parola sıfırlama uçlarının üretim ayarlarında kapalı kaldığını ve kimseye hesap açtırmadığını doğrular.
let stage = 'setup';
async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local test database required');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.WHATSAPP_AUTH_ENABLED = 'true';
  process.env.PHONE_CENTRIC_AUTH_ENABLED = 'true';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  process.env.WHATSAPP_ACCESS_TOKEN = 'local-fixture';
  // Testlere özel parola anahtarı burada bilerek KAPALI: üretimdeki gibi davranmalı.
  delete process.env.LEGACY_PASSWORD_LOGIN_FOR_TESTS;

  const { getDb } = await import('../server/database/postgres');
  const { createExpressApp } = await import('../server/app');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const { hashPassword } = await import('../server/passwords');
  const db = await getDb();
  const suffix = crypto.randomBytes(5).toString('hex');
  const schoolId = `retired-auth-${suffix}`;
  const schoolCode = `RA${suffix}`.toUpperCase();
  const phone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const password = `Local-${crypto.randomBytes(12).toString('base64url')}9!`;
  await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [schoolId, 'Retired Auth School', schoolCode, 'Test', 'Test']);
  const user = await userRepository.create({ phone, firstName: 'ESKİ', lastName: 'PAROLA', isPhoneVerified: true });
  await userRepository.updatePasswordHash(user.id, hashPassword(password));
  await membershipRepository.createOrActivate({ schoolId, userId: user.id, role: 'teacher' });
  const authVersionBefore = (await userRepository.getById(user.id))!.authVersion;

  const server = http.createServer(createExpressApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  const post = async (path: string, body: object) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  };

  try {
    stage = 'password login is closed even with a correct password';
    const login = await post('/auth/login', { phone, password });
    assert.equal(login.status, 404);
    assert.equal(login.body.token, undefined, 'parola ile hiçbir zaman oturum açılmamalı');

    stage = 'retired activation, reset and school-code endpoints are closed';
    const retired: Array<[string, object]> = [
      ['/auth/activate-account', { schoolId, phone, code: '123456', password }],
      ['/auth/staff/activation-verify', { schoolCode, phone, code: '123456' }],
      ['/auth/staff/activation-complete', { schoolId, phone, password }],
      ['/auth/staff/reset-request', { schoolCode, phone }],
      ['/auth/staff/reset-verify', { schoolCode, phone, code: '123456' }],
      ['/auth/staff/reset-complete', { schoolId, phone, password }],
      ['/auth/parent/registration-challenge', { schoolCode, phone, code: '123456' }],
      ['/auth/parent/registration-complete', { schoolId, phone, password }],
      ['/auth/parent/reset-challenge', { schoolCode, phone }],
      ['/auth/parent/reset-complete', { schoolId, phone, password }],
      ['/auth/school-admin/activation-verify', { schoolCode, phone, code: '123456' }],
      ['/auth/school-admin/activation-complete', { schoolId, phone, password }],
      ['/auth/school-admin/reset-request', { schoolCode, phone }],
      ['/auth/school-admin/reset-verify', { schoolCode, phone, code: '123456' }],
      ['/auth/school-admin/reset-complete', { schoolId, phone, password }],
      ['/auth/reset-password-with-code', { schoolCode, phone, code: '123456', password }],
      ['/auth/whatsapp/complete-admin-email', { phone, emailCode: '123456' }],
    ];
    for (const [path, body] of retired) {
      const response = await post(path, body);
      assert.equal(response.status, 404, `${path} kapalı olmalı`);
      assert.equal(response.body.token, undefined, `${path} oturum vermemeli`);
    }
    const schoolContext = await fetch(`${base}/public/school-context?code=${encodeURIComponent(schoolCode)}`);
    assert.equal(schoolContext.status, 404, 'okul kodu ile okul bilgisi sorgulanamamalı');

    stage = 'no account, membership or password change happened';
    const after = await userRepository.getById(user.id);
    assert(after);
    assert.equal(after.authVersion, authVersionBefore, 'oturum sürümü değişmemeli');
    const memberships = await membershipRepository.getMembershipsByUserId(user.id);
    assert.deepEqual(memberships.map((item) => item.role), ['teacher']);
    assert.equal((await db.query('SELECT COUNT(*)::int AS c FROM users WHERE phone=$1', [phone])).rows[0].c, 1);

    console.log('Retired password, activation-code, school-code and reset endpoints stay closed under production-like settings PASS.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id=$1', [schoolId]);
    await db.query('DELETE FROM users WHERE id=$1', [user.id]);
  }
}

run().catch((cause) => {
  console.error(`Retired auth test FAILED at stage: ${stage}.`);
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
});
