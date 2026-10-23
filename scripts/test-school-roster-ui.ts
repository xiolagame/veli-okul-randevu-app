import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { auditDisplay } from '../src/utils/audit-display';
import { formatRosterDraftInput, LEGACY_ROSTER_HEADERS, normalizeBirthDate, parseDelimited, rowsToDrafts, validateRosterRow, ROSTER_HEADERS } from '../src/utils/roster-import';
import { getTurkishPhoneLookupDigits, normalizeTurkishPhone } from '../src/utils/phone';
import { displayStoredTurkishPhone } from '../src/utils/phone';
import { validateStaffForm } from '../src/utils/staff-form';
import { readRosterFile, rosterTemplate } from '../src/utils/roster-files';

let stage = 'pure validation';
async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local test database required');
  process.env.NODE_ENV = 'test';
  for (const value of ['14.03.2014', '14/03/2014', '2014-03-14']) assert.equal(normalizeBirthDate(value), '2014-03-14');
  for (const value of ['31.02.2014', '', '03/14/2014', '2100-01-01']) assert.equal(normalizeBirthDate(value), null);
  const baseRow = { studentName: 'Test Student', studentNumber: '1', className: '5-A', parentName: 'Test Parent', parentPhone: '+905551234567', birthDate: '2014-03-14' };
  const displayed = formatRosterDraftInput({ ...baseRow, parentPhone: '05551234567' });
  assert.equal(displayed.parentPhone, '0555 123 45 67');
  assert.equal(displayed.birthDate, '14/03/2014');
  assert.equal(displayed.studentName, 'TEST STUDENT');
  for (const phone of ['05551234567', '5551234567', '905551234567', '+905551234567', '0555 123 45 67', '(0555) 123-45-67']) assert.equal(validateRosterRow({ ...baseRow, parentPhone: phone }).record.parentPhone, baseRow.parentPhone);
  for (const phone of ['', '555123456', '055512345678', '2121234567', 'text', '+445551234567']) assert.equal(validateRosterRow({ ...baseRow, parentPhone: phone }).status, 'invalid');
  for (const key of ['studentName', 'className', 'parentName', 'parentPhone']) assert.equal(validateRosterRow({ ...baseRow, [key]: '' }).status, 'invalid');
  assert.equal(validateRosterRow({ ...baseRow, birthDate: '' }).status, 'valid');
  assert.equal(validateRosterRow({ ...baseRow, className: '5 a' }).record.className, '5-A');
  assert.equal(validateRosterRow({ ...baseRow, studentNumber: '1,2' }).status, 'invalid');
  const quotedCsv = ROSTER_HEADERS.join(',') + '\n"Test, Student",1,5-A,Test Parent,05551234567';
  assert.equal(rowsToDrafts(parseDelimited(quotedCsv))[0].studentName, 'Test, Student');
  const draft = { fullName: 'Test Person', role: 'security' as const, phone: '0555 123 45 67', email: 'test@example.test', branch: '' };
  assert.deepEqual(validateStaffForm(draft), {});
  assert(validateStaffForm({ ...draft, role: '' }).role);
  assert(validateStaffForm({ ...draft, email: '' }).email);
  assert(validateStaffForm({ ...draft, email: 'bad' }).email);
  assert(validateStaffForm({ ...draft, role: 'teacher' }).branch);
  assert.deepEqual(auditDisplay('parent.removed', '{"id":"private-user"}'), { label: 'Veli okuldan kaldırıldı.', tone: 'rose', summary: '' });
  assert.deepEqual(auditDisplay('school.code_changed', JSON.stringify({ oldCode: 'OLD123', newCode: 'NEW123' })), { label: 'Okul kodu değiştirildi.', tone: 'info', summary: '' });
  assert.equal(auditDisplay('teacher_deleted', '{"id":"private","deletedAppointments":2,"reason":"private"}').summary, 'Silinen randevu: 2');
  assert.deepEqual(auditDisplay('private-action', '{"secret":"private"}'), { label: 'Sistem işlemi gerçekleştirildi.', tone: 'neutral', summary: '' });
  for (const action of ['__proto__', 'constructor', 'toString']) assert.equal(auditDisplay(action, '{}').label, 'Sistem işlemi gerçekleştirildi.');
  stage = 'xlsx template and parsing';
  const { default: writeXlsxFile } = await import('write-excel-file/universal');
  const { readSheet } = await import('read-excel-file/universal');
  assert.deepEqual(await readSheet(await rosterTemplate(), 'Kayıtlar'), [ROSTER_HEADERS]);
  const data: import('write-excel-file/universal').SheetData = [LEGACY_ROSTER_HEADERS, ['Test Student', '001', '5-A', 'Test Parent', 5334138206, { value: new Date('2014-03-14T00:00:00Z'), type: Date, format: 'yyyy-mm-dd' }]];
  const arrayBuffer = await (await writeXlsxFile(data, { sheet: 'Kayıtlar' }).toBlob()).arrayBuffer();
  const parsed = await readRosterFile(arrayBuffer, 'test.xlsx');
  assert.equal(parsed[0].birthDate, '2014-03-14');
  assert.equal(parsed[0].studentNumber, '001');
  assert.equal(validateRosterRow(parsed[0]).record.parentPhone, '+905334138206');
  data[1][0] = { type: 'Formula', value: '1+1' };
  const formulaRows = await readRosterFile(await (await writeXlsxFile(data, { sheet: 'Kayıtlar' }).toBlob()).arrayBuffer(), 'test.xlsx');
  assert.equal(formulaRows[0].studentName, '');
  assert.equal(validateRosterRow(formulaRows[0]).status, 'invalid');
  const { getDb } = await import('../server/database/postgres');
  const { createExpressApp } = await import('../server/app');
  const { createToken } = await import('../server/auth');
  const { userRepository, membershipRepository, auditLogRepository } = await import('../server/repositories');
  const db = await getDb();
  assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  const schoolA = 'bulk-a-' + crypto.randomUUID(), schoolB = 'bulk-b-' + crypto.randomUUID();
  const schoolCode = 'BULK' + crypto.randomBytes(6).toString('hex').toUpperCase();
  let activeSchoolCode = schoolCode;
  const createdSchools = [schoolA, schoolB], userIds: string[] = [];
  const previousPlatform = process.env.PLATFORM_ADMIN_USER_IDS;
  delete process.env.PLATFORM_ADMIN_USER_IDS;
  const app = createExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port + '/api';
  async function request(method: string, path: string, token?: string, body?: object) {
    const input = body as Record<string, unknown> | undefined;
    const payload = input && typeof input.phone === 'string' && /^\+905\d{9}$/.test(input.phone)
      ? { ...input, phone: displayStoredTurkishPhone(input.phone) } : body;
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  }
  async function fixture(role: 'admin' | 'parent' | 'teacher' | 'security') {
    const user = await userRepository.create({ phone: '+905' + crypto.randomInt(100000000,999999999), firstName: 'Local', lastName: 'Fixture' });
    userIds.push(user.id);
    await membershipRepository.createOrActivate({ schoolId: schoolA, userId: user.id, role });
    const stored = await userRepository.getById(user.id);
    return { id: user.id, token: createToken({ userId: user.id, phone: user.phone, auth_version: stored!.authVersion }) };
  }
  try {
    for (const [id, code] of [[schoolA, schoolCode], [schoolB, 'B' + schoolCode]]) await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [id,'Local School',code,'Local','Local']);
    const admin = await fixture('admin'), schoolAdmin = await fixture('admin'), parent = await fixture('parent'), teacher = await fixture('teacher'), security = await fixture('security');
    stage = 'school info and scoped directory';
    assert.equal((await request('GET', '/public/schools')).status, 401);
    for (const user of [admin,parent,teacher,security]) {
      const list = await request('GET', '/public/schools', user.token);
      assert.equal(list.status, 200);
      assert.deepEqual((list.body.schools as { id: string }[]).map((entry) => entry.id), [schoolA]);
      assert.equal((await request('GET', '/platform/schools', user.token)).status, 403);
      assert.equal((await request('GET', '/schools/' + schoolB + '/info', user.token)).status, 403);
    }
    assert.equal((await request('GET', '/schools/' + schoolA + '/info', admin.token)).status, 200);
    assert.equal((await request('POST', '/platform/schools', admin.token, { name: 'Unauthorized', code: 'DENIED', city: 'Local', district: 'Local' })).status, 403);
    await membershipRepository.createOrActivate({ schoolId: schoolB, userId: parent.id, role: 'parent' });
    const parentSchools = (await request('GET', '/public/schools', parent.token)).body.schools as {id: string}[];
    assert.deepEqual(parentSchools.map((entry) => entry.id).sort(), [schoolA, schoolB].sort());
    assert.equal((await request('PATCH', '/schools/' + schoolA + '/info', admin.token, { code: 'REPLACED' })).status, 404);
    assert.equal((await db.query('SELECT code FROM schools WHERE id=$1',[schoolA])).rows[0].code, schoolCode);
    stage = 'platform school code ownership';
    process.env.PLATFORM_ADMIN_USER_IDS = admin.id;
    const preflight = await fetch(base + '/platform/schools/' + schoolA + '/code', { method: 'OPTIONS', headers: { origin: 'https://local.test', 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization,content-type' } });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-methods') || '', /PATCH/);
    assert.equal((await request('GET', '/platform/security', admin.token)).status, 200);
    assert.equal((await request('GET', '/platform-target/' + schoolA + '/schools/' + schoolA + '/info', admin.token)).status, 200);
    assert.equal((await request('GET', '/platform-target/' + schoolB + '/schools/' + schoolA + '/info', admin.token)).status, 403);
    for (const user of [schoolAdmin, parent, teacher, security]) {
      assert.equal((await request('GET', '/platform/security', user.token)).status, 403);
      assert.equal((await request('GET', '/platform-target/' + schoolA + '/schools/' + schoolA + '/info', user.token)).status, 403);
      assert.equal((await request('PATCH', '/platform/schools/' + schoolA + '/code', user.token, { code: 'DENIED' })).status, 403);
    }
    const initialSchoolId = schoolA;
    const initialMembershipCount = (await db.query('SELECT id FROM school_memberships WHERE school_id=$1', [schoolA])).rows.length;
    const initialUserVersions = (await db.query('SELECT id,auth_version FROM users ORDER BY id')).rows;
    const updatedCode = 'NEW' + crypto.randomBytes(6).toString('hex').toUpperCase();
    assert.equal((await request('PATCH', '/platform/schools/' + schoolA + '/code', admin.token, { code: '!' })).status, 400);
    assert.equal((await request('PATCH', '/platform/schools/' + schoolA + '/code', admin.token, { code: 'B' + schoolCode })).status, 409);
    assert.equal((await request('PATCH', '/platform/schools/' + schoolA + '/code', admin.token, { code: updatedCode.toLowerCase() })).status, 200);
    activeSchoolCode = updatedCode;
    assert.equal((await request('GET', '/public/school-context?code=' + encodeURIComponent(updatedCode))).body.school?.id, schoolA);
    assert.notEqual((await request('GET', '/public/school-context?code=' + encodeURIComponent(schoolCode))).status, 200);
    assert.equal((await db.query('SELECT id FROM schools WHERE id=$1', [schoolA])).rows[0].id, initialSchoolId);
    assert.equal((await db.query('SELECT id FROM school_memberships WHERE school_id=$1', [schoolA])).rows.length, initialMembershipCount);
    assert.deepEqual((await db.query('SELECT id,auth_version FROM users ORDER BY id')).rows, initialUserVersions);
    assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM audit_logs WHERE school_id=$1 AND action='school.code_changed'", [schoolA])).rows[0].count, 1);
    for (const code of ['CUSTOM' + crypto.randomBytes(6).toString('hex'), '', '']) {
      const created = await request('POST','/platform/schools',admin.token,{name:'Generated Fixture',code,city:'Local',district:'Local'});
      assert.equal(created.status,201);
      const school = created.body.school as {id:string;code:string};
      createdSchools.push(school.id);
      assert(code ? school.code === code.toUpperCase() : /^[A-F0-9]{10}$/.test(school.code));
      assert.equal((await request('POST','/platform/schools',admin.token,{name:'Duplicate',code:school.code,city:'Local',district:'Local'})).status,409);
    }
    stage = 'bulk validation and transaction';
    const path = '/schools/' + schoolA + '/roster/bulk-upload';
    const rosterPhone = '+905334138206';
    const classInputs = ['5-a', '7 c', '5-A', '8-b', '6 D', '7-C'];
    const phoneInputs: Array<string | number> = ['05334138206', 5334138206, '905334138206', '+905334138206', '0533 413 82 06', '(0533) 413-82-06'];
    const rows = classInputs.map((className, index) => ({ ...baseRow, studentName: 'Student ' + index, studentNumber: String(index + 1), parentPhone: phoneInputs[index], birthDate: '14.03.2014', schoolId: schoolB, className }));
    const payload = { records:rows, schoolId:schoolB };
    const largeBatch = Array.from({ length: 500 }, (_, index) => ({ ...baseRow, studentName: 'Student ' + index + ' ' + 'A'.repeat(120), parentName: 'Parent ' + 'B'.repeat(120), studentNumber: String(index + 100), parentPhone: displayStoredTurkishPhone(rosterPhone) }));
    assert(Buffer.byteLength(JSON.stringify(largeBatch)) > 100 * 1024);
    assert.equal((await request('POST',path,admin.token,{records:largeBatch,preview:true})).status,200);
    assert.equal((await request('POST',path,admin.token,{records:[...largeBatch,largeBatch[0]],preview:true})).status,400);
    assert.equal((await request('POST',path,admin.token,{records:[{ ...baseRow, studentName:'A'.repeat(1024 * 1024) }],preview:true})).status,413);
    for (const user of [parent,teacher,security]) assert.equal((await request('POST',path,user.token,payload)).status,403);
    for (const records of [[{...rows[0],birthDate:'31.02.2014'}],[{...rows[0],className:''}],[{...rows[0],parentName:''}],[{...rows[0],studentName:''}],[{...rows[0],parentPhone:'123'}]]) assert.equal((await request('POST',path,admin.token,{records})).status,400);
    assert.equal((await request('POST','/schools/' + schoolB + '/roster/bulk-upload',admin.token,payload)).status,403);
    const preview = await request('POST',path,admin.token,{...payload,preview:true});
    assert.equal(preview.status,200);
    assert.equal((await db.query('SELECT id FROM school_roster WHERE school_id=$1',[schoolA])).rows.length,0);
    const counts = async () => (await db.query('SELECT (SELECT COUNT(*) FROM users)::int AS users,(SELECT COUNT(*) FROM school_memberships)::int AS memberships,(SELECT COUNT(*) FROM student_parent_relations)::int AS relations')).rows[0];
    const before = await counts();
    const originalAudit = auditLogRepository.createAuditLog;
    auditLogRepository.createAuditLog = async () => { throw new Error('Local rollback fixture'); };
    try { assert.equal((await request('POST',path,admin.token,payload)).status,500); }
    finally { auditLogRepository.createAuditLog = originalAudit; }
    assert.equal((await db.query('SELECT id FROM school_roster WHERE school_id=$1',[schoolA])).rows.length,0);
    const added = await request('POST',path,admin.token,payload);
    assert.equal(added.status,200); assert.equal(added.body.addedCount,6);
    assert.equal((await request('POST',path,admin.token,payload)).body.addedCount,0);
    assert.equal((await request('POST',path,admin.token,{records:[{...rows[0],studentName:'Conflicting Name'}]})).status,400);
    assert.deepEqual(await counts(),before);
    const inserted = await db.query('SELECT parent_phone,class_name,birth_date::text FROM school_roster WHERE school_id=$1',[schoolA]);
    assert.equal(inserted.rows.length,6);
    assert.deepEqual((await db.query('SELECT student_number,class_name FROM school_roster WHERE school_id=$1 ORDER BY student_number',[schoolA])).rows,
      [{student_number:'1',class_name:'5-A'},{student_number:'2',class_name:'7-C'},{student_number:'3',class_name:'5-A'},{student_number:'4',class_name:'8-B'},{student_number:'5',class_name:'6-D'},{student_number:'6',class_name:'7-C'}]);
    for (const row of inserted.rows) { assert.equal(row.parent_phone,rosterPhone); assert.equal(row.birth_date,'2014-03-14'); }
    assert.equal((await db.query('SELECT id FROM school_roster WHERE school_id=$1',[schoolB])).rows.length,0);
    const logs = await db.query("SELECT details FROM audit_logs WHERE school_id=$1 AND action='roster.bulk_imported'",[schoolA]);
    for (const log of logs.rows) assert.deepEqual(Object.keys(JSON.parse(log.details)).sort(),['addedCount','classNames']);
    stage = 'self registration from imported roster';
    const challenge = await request('POST','/auth/parent/registration-challenge',undefined,{schoolCode: activeSchoolCode,phone:rosterPhone,birthDate:'2014-03-14'});
    if (challenge.status !== 200) {
      const lookupDigits = getTurkishPhoneLookupDigits(normalizeTurkishPhone(rosterPhone)) || [];
      const schoolExists = (await db.query('SELECT id FROM schools WHERE id=$1 AND code=$2', [schoolA, activeSchoolCode])).rows.length === 1;
      const matchingRosterCount = (await db.query(`SELECT COUNT(*)::int AS count FROM school_roster
        WHERE school_id=$1 AND birth_date=$2::date AND is_claimed=FALSE AND regexp_replace(parent_phone,'[^0-9]','','g') IN ($3,$4,$5)`,
      [schoolA, '2014-03-14', ...lookupDigits])).rows[0].count;
      const existingUser = !!await userRepository.getByPhone(normalizeTurkishPhone(rosterPhone));
      console.error(`Registration challenge diagnostic: HTTP ${challenge.status}; school match=${schoolExists}; eligible roster rows=${matchingRosterCount}; existing phone account=${existingUser}; response keys=${Object.keys(challenge.body).join(',')}`);
    }
    assert.equal(challenge.status,200,`Registration challenge expected HTTP 200, got ${challenge.status}; response keys: ${Object.keys(challenge.body).join(',')}`);
    assert.equal((await request('POST','/auth/parent/registration-complete',undefined,{schoolId:schoolA,phone:rosterPhone,birthDate:'2014-03-14',challenge:challenge.body.challenge,password:crypto.randomBytes(24).toString('base64url')})).status,200);
    const newParent = await userRepository.getByPhone(rosterPhone);
    assert(newParent); userIds.push(newParent.id);
    assert.equal((await db.query('SELECT id FROM school_roster WHERE school_id=$1 AND is_claimed=TRUE',[schoolA])).rows.length,6);
    stage = 'disabled school enforcement';
    assert.equal((await request('PATCH','/platform/schools/' + schoolA + '/status',admin.token,{active:false})).status,200);
    assert.equal((await request('GET','/schools/' + schoolA + '/info',admin.token)).status,403);
    assert.equal((await request('POST',path,admin.token,payload)).status,403);
    assert.equal((await request('GET','/public/schools',teacher.token)).body.schools instanceof Array,true);
    assert.equal(((await request('GET','/public/schools',teacher.token)).body.schools as unknown[]).length,0);
    assert.equal((await request('PATCH','/platform/schools/' + schoolA + '/status',admin.token,{active:true})).status,200);
    console.log('School info, scoped directory, codes, bulk rollback/validation/self-registration, XLSX/CSV, staff validation and audit display PASS.');
  } finally {
    if (previousPlatform === undefined) delete process.env.PLATFORM_ADMIN_USER_IDS; else process.env.PLATFORM_ADMIN_USER_IDS = previousPlatform;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const id of createdSchools) await db.query('DELETE FROM schools WHERE id=$1',[id]);
    for (const id of userIds) await db.query('DELETE FROM users WHERE id=$1',[id]);
  }
}
run().catch((cause: unknown) => { console.error('School/roster/UI test FAILED at stage: ' + stage + '. No credentials or payloads logged.'); if (cause instanceof Error) console.error(cause.stack?.split('\n').find((line) => line.includes('test-school-roster-ui.ts:'))?.trim()); process.exitCode = 1; });
