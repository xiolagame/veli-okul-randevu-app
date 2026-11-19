import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { displayStoredTurkishPhone } from '../src/utils/phone';

let stage = 'UI availability';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local test database required');
  process.env.NODE_ENV = 'test';

  const component = fs.readFileSync(new URL('../src/components/BulkRosterImport.tsx', import.meta.url), 'utf8');
  assert.match(component, /<fieldset disabled=\{busy\}/);
  assert.doesNotMatch(component, /bulk-classes|initialClass|Dosyada sınıf sütunu bulunmaz/);
  assert.match(component, /'className'/);
  assert(component.includes('<Button disabled={busy || !records.length} onClick={() => void submit(true)}>Önizle</Button>'));
  assert.match(component, /key === 'className' \? '5-A'/);

  const { getDb } = await import('../server/database/postgres');
  const { createExpressApp } = await import('../server/app');
  const { createToken } = await import('../server/auth');
  const { membershipRepository, userRepository } = await import('../server/repositories');
  const db = await getDb();
  const suffix = crypto.randomBytes(6).toString('hex');
  const emptySchool = `first-empty-${suffix}`;
  const platformSchool = `first-platform-${suffix}`;
  const existingSchool = `first-existing-${suffix}`;
  const schoolIds = [emptySchool, platformSchool, existingSchool];
  const userIds: string[] = [];
  const previousPlatformAdmins = process.env.PLATFORM_ADMIN_USER_IDS;

  async function createUser(role?: 'admin', schoolId?: string) {
    const phone = `+905${crypto.randomInt(100000000, 999999999)}`;
    const user = await userRepository.create({ phone, firstName: 'LOCAL', lastName: 'FIXTURE' });
    userIds.push(user.id);
    if (role && schoolId) await membershipRepository.createOrActivate({ schoolId, userId: user.id, role });
    const stored = await userRepository.getById(user.id);
    return { id: user.id, token: createToken({ userId: user.id, phone: user.phone, auth_version: stored!.authVersion }) };
  }

  let server: http.Server | null = null;
  try {
    for (const [schoolId, code] of [[emptySchool, `EMPTY${suffix}`], [platformSchool, `PLAT${suffix}`], [existingSchool, `EXIST${suffix}`]]) {
      await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [schoolId, 'Local First Student School', code.toUpperCase(), 'Local', 'Local']);
    }
    await db.query(`INSERT INTO school_roster(id,school_id,parent_phone,parent_name,student_name,class_name,student_number,birth_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::date)`, [`rost-${crypto.randomUUID()}`, existingSchool, '+905551110000', 'MEVCUT VELİ', 'MEVCUT ÖĞRENCİ', '5-A', '1', '2014-01-01']);

    const schoolAdmin = await createUser('admin', emptySchool);
    const existingSchoolAdmin = await createUser('admin', existingSchool);
    const platformAdmin = await createUser();
    process.env.PLATFORM_ADMIN_USER_IDS = platformAdmin.id;

    const app = createExpressApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
    async function request(method: string, path: string, token?: string, body?: object) {
      const response = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
    }

    const emptyPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
    const firstRecord = {
      studentName: 'İLK ÖĞRENCİ',
      studentNumber: '1',
      parentName: 'İLK VELİ',
      parentPhone: displayStoredTurkishPhone(emptyPhone),
      birthDate: '14/03/2014',
      className: '8-C',
    };

    stage = 'empty school admin import';
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM school_roster WHERE school_id=$1', [emptySchool])).rows[0].count, 0);
    const emptyPath = `/schools/${emptySchool}/roster/bulk-upload`;
    const missingClass = await request('POST', emptyPath, schoolAdmin.token, { records: [{ ...firstRecord, className: '' }], preview: true });
    assert.equal(missingClass.status, 200);
    assert.equal((missingClass.body.rows as { status: string }[])[0].status, 'invalid');
    const preview = await request('POST', emptyPath, schoolAdmin.token, { records: [firstRecord], preview: true });
    assert.equal(preview.status, 200);
    assert.equal((preview.body.rows as { status: string }[])[0].status, 'valid');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM school_roster WHERE school_id=$1', [emptySchool])).rows[0].count, 0);
    const imported = await request('POST', emptyPath, schoolAdmin.token, { records: [firstRecord], preview: false });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.addedCount, 1);
    assert.deepEqual((await db.query('SELECT class_name FROM school_roster WHERE school_id=$1', [emptySchool])).rows, [{ class_name: '8-C' }]);

    stage = 'platform target empty school import';
    const platformPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
    const platformRecord = { ...firstRecord, studentName: 'PLATFORM ÖĞRENCİ', parentName: 'PLATFORM VELİ', parentPhone: displayStoredTurkishPhone(platformPhone), className: '7-B' };
    const platformPath = `/platform-target/${platformSchool}/schools/${platformSchool}/roster/bulk-upload`;
    assert.equal((await request('POST', platformPath, platformAdmin.token, { records: [platformRecord], preview: true })).status, 200);
    assert.equal((await request('POST', platformPath, platformAdmin.token, { records: [platformRecord] })).status, 200);
    assert.equal((await db.query('SELECT class_name FROM school_roster WHERE school_id=$1', [platformSchool])).rows[0].class_name, '7-B');
    assert.equal((await request('POST', `/platform-target/${platformSchool}/schools/${emptySchool}/roster/bulk-upload`, platformAdmin.token, { records: [platformRecord] })).status, 403);

    stage = 'tenant isolation and existing school regression';
    assert.equal((await request('POST', `/schools/${existingSchool}/roster/bulk-upload`, schoolAdmin.token, { records: [platformRecord] })).status, 403);
    const existingRecord = { ...platformRecord, studentName: 'YENİ ÖĞRENCİ', studentNumber: '2', parentPhone: displayStoredTurkishPhone(`+905${crypto.randomInt(100000000, 999999999)}`), className: '5-A' };
    assert.equal((await request('POST', `/schools/${existingSchool}/roster/bulk-upload`, existingSchoolAdmin.token, { records: [existingRecord], preview: true })).status, 200);
    assert.equal((await request('POST', `/schools/${existingSchool}/roster/bulk-upload`, existingSchoolAdmin.token, { records: [existingRecord] })).status, 200);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM school_roster WHERE school_id=$1 AND class_name=$2', [existingSchool, '5-A'])).rows[0].count, 2);

    stage = 'parent self-registration compatibility';
    const emptySchoolCode = `EMPTY${suffix}`.toUpperCase();
    const challenge = await request('POST', '/auth/parent/registration-challenge', undefined, { schoolCode: emptySchoolCode, phone: displayStoredTurkishPhone(emptyPhone), birthDate: '2014-03-14' });
    assert.equal(challenge.status, 200);
    const password = `Local-${crypto.randomBytes(18).toString('base64url')}9`;
    const completed = await request('POST', '/auth/parent/registration-complete', undefined, { schoolId: emptySchool, phone: displayStoredTurkishPhone(emptyPhone), birthDate: '2014-03-14', challenge: challenge.body.challenge, password });
    assert.equal(completed.status, 200);
    const parent = await userRepository.getByPhone(emptyPhone);
    assert(parent);
    userIds.push(parent.id);
    assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role='parent' AND status='active'", [emptySchool, parent.id])).rows[0].count, 1);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM students WHERE school_id=$1 AND class_name=$2', [emptySchool, '8-C'])).rows[0].count, 1);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM student_parent_relations WHERE school_id=$1 AND parent_user_id=$2', [emptySchool, parent.id])).rows[0].count, 1);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM school_roster WHERE school_id=$1 AND is_claimed=TRUE', [emptySchool])).rows[0].count, 1);

    console.log('First-student empty-school import, platform target, existing-school regression, parent registration and tenant isolation PASS.');
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (previousPlatformAdmins === undefined) delete process.env.PLATFORM_ADMIN_USER_IDS;
    else process.env.PLATFORM_ADMIN_USER_IDS = previousPlatformAdmins;
    for (const schoolId of schoolIds) await db.query('DELETE FROM schools WHERE id=$1', [schoolId]);
    for (const userId of [...new Set(userIds)]) await db.query('DELETE FROM users WHERE id=$1', [userId]);
  }
}

run().catch((cause: unknown) => {
  console.error(`First-student/empty-school test FAILED at stage: ${stage}. No credentials or payloads logged.`);
  if (cause instanceof Error) console.error(cause.stack?.split('\n').find((line) => line.includes('test-first-student-empty-school.ts:'))?.trim());
  process.exitCode = 1;
});
