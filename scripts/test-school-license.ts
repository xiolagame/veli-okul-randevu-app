import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { displayStoredTurkishPhone } from '../src/utils/phone';
import { isValidLicenseCode, normalizeLicenseCode } from '../src/utils/license-code';
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
  assert.equal(isValidLicenseCode('VR-ABCD-1234'), true);
  assert.equal(isValidLicenseCode('VR BAD'), false);
  for (let index = 0; index < 32; index++) assert.match(generateSchoolLicenseCode(), /^VR-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);

  const schoolManagementSource = fs.readFileSync(new URL('../src/components/SchoolManagement.tsx', import.meta.url), 'utf8');
  const authViewSource = fs.readFileSync(new URL('../src/components/AuthView.tsx', import.meta.url), 'utf8');
  assert(!schoolManagementSource.includes('licenseCode'));
  assert(!authViewSource.includes('license'));
  assert(!authViewSource.includes('schoolCode'));

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
    stage = 'automatic school licenses';
    const created = await request('POST', '/platform/schools', platformToken, { name: 'License <School> & A', city: 'Test', district: 'Test' });
    assert.equal(created.status, 201);
    const manualSchool = created.body.school as Record<string, unknown>;
    const schoolA = String(manualSchool.id);
    cleanupSchools.push(schoolA);
    assert.equal(manualSchool.licenseCode, undefined);
    assert.equal(manualSchool.code, undefined);
    assert.equal(manualSchool.licenseStatus, 'active');
    const storedLicense = (await db.query('SELECT license_code,status FROM school_licenses WHERE school_id=$1', [schoolA])).rows[0] as { license_code: string; status: string };
    assert.match(storedLicense.license_code, /^VR-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/);
    assert.equal(storedLicense.status, 'active');

    const second = await request('POST', '/platform/schools', platformToken, { name: 'Automatic License School', city: 'Test', district: 'Test' });
    assert.equal(second.status, 201);
    const schoolB = String((second.body.school as Record<string, unknown>).id);
    cleanupSchools.push(schoolB);
    const secondCode = (await db.query('SELECT license_code FROM school_licenses WHERE school_id=$1', [schoolB])).rows[0].license_code;
    assert.notEqual(secondCode, storedLicense.license_code);

    const listed = await request('GET', '/platform/schools', platformToken);
    assert.equal(listed.status, 200);
    const listedA = (listed.body.schools as Array<Record<string, unknown>>).find((entry) => entry.id === schoolA);
    assert.equal(listedA?.licenseCode, undefined);
    assert.equal(listedA?.code, undefined);
    assert.equal(listedA?.licenseStatus, 'active');

    stage = 'database uniqueness';
    const rawSchool = `license-raw-${suffix}`;
    cleanupSchools.push(rawSchool);
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [rawSchool, 'Raw License School', `RA${suffix}`.toUpperCase(), 'Test', 'Test']);
    let uniquenessCode = '';
    try {
      await db.query("INSERT INTO school_licenses(id,school_id,license_code,status) VALUES($1,$2,$3,'active')", [`lic-${crypto.randomUUID()}`, rawSchool, storedLicense.license_code]);
    } catch (cause) { uniquenessCode = String((cause as { code?: string }).code || ''); }
    assert.equal(uniquenessCode, '23505');

    stage = 'first admin invitation email without codes';
    const firstPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
    const invite = await request('POST', `/platform/schools/${schoolA}/admin-invitation`, platformToken, {
      fullName: 'Lisans Yöneticisi', phone: firstPhone, email: 'license-admin@example.test',
    });
    assert.equal(invite.status, 201);
    assert.equal(sentEmails.length, 1);
    assert(!sentEmails[0].html.includes(storedLicense.license_code));
    assert(!/LİSANS KODUNUZ/i.test(sentEmails[0].html));
    assert(!sentEmails[0].html.includes('License <School>'));
    assert(sentEmails[0].html.includes('License &lt;School&gt; &amp; A'));
    assert.equal((await request('POST', '/auth/school-admin/activation-verify', undefined, { phone: firstPhone, code: '123456' })).status, 404);
    const adminUser = await userRepository.create({ phone: `+905${crypto.randomInt(100000000, 999999999)}`, firstName: 'LISANS', lastName: 'YONETICI' });
    cleanupUsers.push(adminUser.id);
    await membershipRepository.createOrActivate({ schoolId: schoolA, userId: adminUser.id, role: 'admin' });
    const adminAuth = await userRepository.getById(adminUser.id);
    const adminToken = createToken({ userId: adminUser.id, phone: adminUser.phone, auth_version: adminAuth!.authVersion });
    assert.equal((await request('GET', `/schools/${schoolA}/settings`, adminToken)).status, 200);

    stage = 'reject additional admin for single-admin school';
    const secondPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
    const secondAdminAttempt = await request('POST', `/schools/${schoolA}/management/admins`, adminToken, {
      fullName: 'Second License Admin', phone: secondPhone, email: 'license-second@example.test',
    });
    assert.equal(secondAdminAttempt.status, 409);
    assert.equal(sentEmails.length, 1);
    stage = 'license status enforcement and platform bypass';
    await db.query("UPDATE school_licenses SET status='suspended',updated_at=NOW() WHERE school_id=$1", [schoolA]);
    assert.equal((await request('GET', `/schools/${schoolA}/settings`, adminToken)).status, 403);
    assert.equal((await request('GET', '/platform/schools', platformToken)).status, 200);
    assert.equal((await request('GET', `/platform-target/${schoolA}/schools/${schoolA}/settings`, platformToken)).status, 200);
    await db.query("UPDATE school_licenses SET status='revoked',updated_at=NOW() WHERE school_id=$1", [schoolA]);
    assert.equal((await request('GET', `/schools/${schoolA}/settings`, adminToken)).status, 403);
    await db.query("UPDATE school_licenses SET status='active',updated_at=NOW() WHERE school_id=$1", [schoolA]);
    assert.equal((await request('GET', `/schools/${schoolA}/settings`, adminToken)).status, 200);

    stage = 'legacy rollout and permanent delete';
    const legacySchool = `license-legacy-${suffix}`;
    cleanupSchools.push(legacySchool);
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [legacySchool, 'Legacy School', `LG${suffix}`.toUpperCase(), 'Test', 'Test']);
    const legacyUser = await userRepository.create({ phone: `+905${crypto.randomInt(100000000, 999999999)}`, firstName: 'LEGACY', lastName: 'ADMIN' });
    cleanupUsers.push(legacyUser.id);
    await membershipRepository.createOrActivate({ schoolId: legacySchool, userId: legacyUser.id, role: 'admin' });
    const legacyAuth = await userRepository.getById(legacyUser.id);
    const legacyToken = createToken({ userId: legacyUser.id, phone: legacyUser.phone, auth_version: legacyAuth!.authVersion });
    assert.equal((await request('GET', `/schools/${legacySchool}/settings`, legacyToken)).status, 200, 'missing license must remain legacy-active during rollout');

    assert.equal((await request('PATCH', `/platform/schools/${schoolA}/status`, platformToken, { active: false })).status, 200);
    assert.equal((await request('DELETE', `/platform/schools/${schoolA}`, platformToken)).status, 200);
    assert.equal((await db.query('SELECT id FROM school_licenses WHERE school_id=$1', [schoolA])).rows.length, 0);
    cleanupSchools.splice(cleanupSchools.indexOf(schoolA), 1);

    console.log('School license automatic creation without visible codes, uniqueness, invitation email, enforcement, legacy rollout and deletion PASS.');
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
