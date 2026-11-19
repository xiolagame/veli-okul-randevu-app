import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { displayStoredTurkishPhone } from '../src/utils/phone';
import { formatLicenseCodeInput, isValidLicenseCode, normalizeLicenseCode } from '../src/utils/license-code';
import { generateSchoolLicenseCode } from '../server/school-license';

let stage = 'license helpers';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local test database required');
  process.env.NODE_ENV = 'test';
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.RESEND_API_KEY = 'local-license-test';
  process.env.EMAIL_FROM = 'test@example.test';

  assert.equal(normalizeLicenseCode(' vr-abcd-1234 '), 'VR-ABCD-1234');
  assert.equal(formatLicenseCodeInput('vr-abcd-1234!'), 'VR-ABCD-1234');
  assert.equal(isValidLicenseCode('VR-ABCD-1234'), true);
  assert.equal(isValidLicenseCode('VR BAD'), false);
  for (let index = 0; index < 32; index++) assert.match(generateSchoolLicenseCode(), /^VR-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);

  const schoolManagementSource = fs.readFileSync(new URL('../src/components/SchoolManagement.tsx', import.meta.url), 'utf8');
  const authViewSource = fs.readFileSync(new URL('../src/components/AuthView.tsx', import.meta.url), 'utf8');
  assert(schoolManagementSource.includes("formatLicenseCodeInput(event.target.value)"));
  assert(schoolManagementSource.includes('autoCapitalize={key === \'licenseCode\' ? \'characters\''));
  assert(authViewSource.includes('id="school-admin-activation-license"'));
  assert(authViewSource.includes('Ek yöneticiler için gerekli değildir.'));

  const sentEmails: Array<{ to: string; subject: string; html: string; text?: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.resend.com/emails')) {
      const payload = JSON.parse(String(init?.body || '{}')) as { to: string[]; subject: string; html: string; text?: string };
      sentEmails.push({ to: payload.to[0], subject: payload.subject, html: payload.html, text: payload.text });
      return new Response(JSON.stringify({ id: 'license-email' }), { status: 200 });
    }
    return originalFetch(input, init);
  };

  const { getDb } = await import('../server/database/postgres');
  const { createExpressApp } = await import('../server/app');
  const { createToken } = await import('../server/auth');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const db = await getDb();
  const suffix = crypto.randomBytes(6).toString('hex');
  const platform = await userRepository.create({ phone: `+905${crypto.randomInt(100000000, 999999999)}`, firstName: 'PLATFORM', lastName: 'LICENSE' });
  process.env.PLATFORM_ADMIN_USER_IDS = platform.id;
  const platformAuth = await userRepository.getById(platform.id);
  const platformToken = createToken({ userId: platform.id, phone: platform.phone, auth_version: platformAuth!.authVersion });
  const cleanupSchools: string[] = [];
  const cleanupUsers = [platform.id];
  const app = createExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  async function request(method: string, path: string, token?: string, body?: object) {
    const input = body as Record<string, unknown> | undefined;
    const payload = input && typeof input.phone === 'string' && /^\+905\d{9}$/.test(input.phone)
      ? { ...input, phone: displayStoredTurkishPhone(input.phone) } : body;
    const response = await originalFetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  }
  const emailCode = (index: number) => {
    const code = sentEmails[index]?.html.match(/>(\d{6})</)?.[1];
    assert(code);
    return code;
  };

  try {
    stage = 'manual and automatic school licenses';
    const manual = await request('POST', '/platform/schools', platformToken, {
      name: 'License <School> & A', code: `LICA${suffix}`, licenseCode: 'vr-abcd-1234', city: 'Test', district: 'Test',
    });
    assert.equal(manual.status, 201);
    const manualSchool = manual.body.school as Record<string, unknown>;
    const schoolA = String(manualSchool.id);
    cleanupSchools.push(schoolA);
    assert.equal(manualSchool.licenseCode, 'VR-ABCD-1234');
    assert.equal(manualSchool.licenseStatus, 'active');
    assert.equal((await db.query('SELECT license_code,status FROM school_licenses WHERE school_id=$1', [schoolA])).rows[0].license_code, 'VR-ABCD-1234');

    const duplicate = await request('POST', '/platform/schools', platformToken, {
      name: 'Duplicate License', code: `LICD${suffix}`, licenseCode: 'VR-ABCD-1234', city: 'Test', district: 'Test',
    });
    assert.equal(duplicate.status, 409);

    const automatic = await request('POST', '/platform/schools', platformToken, {
      name: 'Automatic License School', code: `LICB${suffix}`, licenseCode: '', city: 'Test', district: 'Test',
    });
    assert.equal(automatic.status, 201);
    const automaticSchool = automatic.body.school as Record<string, unknown>;
    const schoolB = String(automaticSchool.id);
    cleanupSchools.push(schoolB);
    const automaticCode = String(automaticSchool.licenseCode);
    assert.match(automaticCode, /^VR-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);
    assert.notEqual(automaticCode, 'VR-ABCD-1234');

    const listed = await request('GET', '/platform/schools', platformToken);
    assert.equal(listed.status, 200);
    const listedA = (listed.body.schools as Array<Record<string, unknown>>).find((entry) => entry.id === schoolA);
    assert.equal(listedA?.licenseCode, 'VR-ABCD-1234');
    assert.equal(listedA?.licenseStatus, 'active');

    stage = 'database uniqueness';
    const rawSchool = `license-raw-${suffix}`;
    cleanupSchools.push(rawSchool);
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [rawSchool, 'Raw License School', `RA${suffix}`.toUpperCase(), 'Test', 'Test']);
    let uniquenessCode = '';
    try {
      await db.query("INSERT INTO school_licenses(id,school_id,license_code,status) VALUES($1,$2,$3,'active')", [`lic-${crypto.randomUUID()}`, rawSchool, 'VR-ABCD-1234']);
    } catch (cause) { uniquenessCode = String((cause as { code?: string }).code || ''); }
    assert.equal(uniquenessCode, '23505');

    stage = 'first admin email and license-bound activation';
    const firstPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
    const invite = await request('POST', `/platform/schools/${schoolA}/admin-invitation`, platformToken, {
      fullName: 'Lisans Yöneticisi', phone: firstPhone, email: 'license-admin@example.test',
    });
    assert.equal(invite.status, 201);
    assert.equal(sentEmails.length, 1);
    assert.match(sentEmails[0].html, /http:\/\/localhost:3000\/branding\/veli-randevu-logo\.png/);
    assert.match(sentEmails[0].html, /VR-ABCD-1234/);
    assert.match(sentEmails[0].html, /LİSANS KODUNUZ/);
    assert(sentEmails[0].text?.includes('Lisans Kodu: VR-ABCD-1234'));
    assert(!sentEmails[0].html.includes('License <School>'));
    assert(sentEmails[0].html.includes('License &lt;School&gt; &amp; A'));
    const activationCode = emailCode(0);
    assert.equal((await request('POST', '/auth/school-admin/activation-verify', undefined, {
      schoolCode: manualSchool.code, phone: firstPhone, licenseCode: automaticCode, code: activationCode,
    })).status, 400);
    const verified = await request('POST', '/auth/school-admin/activation-verify', undefined, {
      schoolCode: manualSchool.code, phone: firstPhone, licenseCode: 'vr-abcd-1234', code: activationCode,
    });
    assert.equal(verified.status, 200);
    assert.equal((await request('POST', '/auth/school-admin/activation-complete', undefined, {
      schoolId: schoolA, phone: firstPhone, setupToken: verified.body.setupToken, password: 'License-admin-123!',
    })).status, 200);
    const firstAdmin = await userRepository.getByPhone(firstPhone);
    assert(firstAdmin);
    cleanupUsers.push(firstAdmin.id);
    const login = await request('POST', '/auth/login', undefined, { phone: firstPhone, password: 'License-admin-123!' });
    assert.equal(login.status, 200);
    const adminToken = String(login.body.token);
    assert.equal((await request('GET', `/schools/${schoolA}/info`, adminToken)).status, 200);

    stage = 'additional admin without license prompt';
    const secondPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
    assert.equal((await request('POST', `/schools/${schoolA}/management/admins`, adminToken, {
      fullName: 'İkinci Lisans Yöneticisi', phone: secondPhone, email: 'license-second@example.test',
    })).status, 201);
    assert.equal(sentEmails.length, 2);
    assert(!sentEmails[1].html.includes('VR-ABCD-1234'));
    const secondVerified = await request('POST', '/auth/school-admin/activation-verify', undefined, {
      schoolCode: manualSchool.code, phone: secondPhone, licenseCode: '', code: emailCode(1),
    });
    assert.equal(secondVerified.status, 200);

    stage = 'license status enforcement and platform bypass';
    await db.query("UPDATE school_licenses SET status='suspended',updated_at=NOW() WHERE school_id=$1", [schoolA]);
    assert.equal((await request('GET', `/schools/${schoolA}/info`, adminToken)).status, 403);
    assert.equal((await request('GET', '/platform/schools', platformToken)).status, 200);
    assert.equal((await request('GET', `/platform-target/${schoolA}/schools/${schoolA}/info`, platformToken)).status, 200);
    await db.query("UPDATE school_licenses SET status='revoked',updated_at=NOW() WHERE school_id=$1", [schoolA]);
    assert.equal((await request('GET', `/schools/${schoolA}/info`, adminToken)).status, 403);
    await db.query("UPDATE school_licenses SET status='active',updated_at=NOW() WHERE school_id=$1", [schoolA]);
    assert.equal((await request('GET', `/schools/${schoolA}/info`, adminToken)).status, 200);

    stage = 'legacy rollout and permanent delete';
    const legacySchool = `license-legacy-${suffix}`;
    cleanupSchools.push(legacySchool);
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [legacySchool, 'Legacy School', `LG${suffix}`.toUpperCase(), 'Test', 'Test']);
    const legacyUser = await userRepository.create({ phone: `+905${crypto.randomInt(100000000, 999999999)}`, firstName: 'LEGACY', lastName: 'ADMIN' });
    cleanupUsers.push(legacyUser.id);
    await membershipRepository.createOrActivate({ schoolId: legacySchool, userId: legacyUser.id, role: 'admin' });
    const legacyAuth = await userRepository.getById(legacyUser.id);
    const legacyToken = createToken({ userId: legacyUser.id, phone: legacyUser.phone, auth_version: legacyAuth!.authVersion });
    assert.equal((await request('GET', `/schools/${legacySchool}/info`, legacyToken)).status, 200, 'missing license must remain legacy-active during rollout');

    assert.equal((await request('PATCH', `/platform/schools/${schoolA}/status`, platformToken, { active: false })).status, 200);
    assert.equal((await request('DELETE', `/platform/schools/${schoolA}`, platformToken)).status, 200);
    assert.equal((await db.query('SELECT id FROM school_licenses WHERE school_id=$1', [schoolA])).rows.length, 0);
    cleanupSchools.splice(cleanupSchools.indexOf(schoolA), 1);

    console.log('School license manual/auto creation, canonicalization, uniqueness, activation, email, enforcement, legacy rollout and deletion PASS.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    for (const schoolId of cleanupSchools) await db.query('DELETE FROM schools WHERE id=$1', [schoolId]);
    for (const userId of [...new Set(cleanupUsers)]) await db.query('DELETE FROM users WHERE id=$1', [userId]);
    delete process.env.PLATFORM_ADMIN_USER_IDS;
  }
}

run().catch((cause: unknown) => {
  console.error(`School license test FAILED at stage: ${stage}. No license values, codes, tokens or credentials are logged.`);
  if (cause instanceof Error) console.error(cause.stack?.split('\n').find((line) => line.includes('test-school-license.ts:'))?.trim());
  process.exitCode = 1;
});
