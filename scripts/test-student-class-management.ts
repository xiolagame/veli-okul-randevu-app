import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { classSummaries, classTone, SchoolStudentRecord } from '../src/utils/student-records';

let stage = 'setup';
async function main() {
  if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') throw new Error('Isolated local database required');
  const root = process.cwd();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'veli-class-removal-'));
  fs.mkdirSync(path.join(temp, 'server/database'), { recursive: true });
  fs.copyFileSync(path.join(root, 'server/database/supabase_schema.sql'), path.join(temp, 'server/database/supabase_schema.sql'));
  fs.cpSync(path.join(root, 'server/database/migrations'), path.join(temp, 'server/database/migrations'), { recursive: true });
  process.chdir(temp);
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64url');
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(48).toString('base64url');
  process.env.WHATSAPP_AUTH_ENABLED = 'true'; process.env.WHATSAPP_PILOT_ENABLED = 'true';
  process.env.PHONE_CENTRIC_AUTH_ENABLED = 'false';
  delete process.env.CLASS_BULK_DELETE_ENABLED;
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456'; process.env.WHATSAPP_ACCESS_TOKEN = 'local-test-only';
  const originalFetch = globalThis.fetch;
  let deliveredCode = '', recipient = '', deliveries = 0, failDelivery = false;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://graph.facebook.com/')) {
      if (failDelivery) return new Response('{}', { status: 503 });
      const body = JSON.parse(String(init?.body)) as { to: string; template: { components: Array<{ parameters: Array<{ text: string }> }> } };
      recipient = body.to; deliveredCode = body.template.components[0].parameters[0].text; deliveries++;
      return new Response('{}', { status: 200 });
    }
    if (!String(input).startsWith('http://127.0.0.1:')) throw new Error('External transport prohibited');
    return originalFetch(input, init);
  };
  const { getDb } = await import('../server/database/postgres');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const { apiRouter } = await import('../server/api');
  const { platformTargetContextGuard } = await import('../server/platform-management');
  const { createToken } = await import('../server/auth');
  const { hashSetupToken } = await import('../server/activation-codes');
  const db = await getDb();
  assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  for (const id of ['school-a', 'school-b']) await db.query("INSERT INTO schools(id,name,code,city,district) VALUES($1,'Test school',$2,'Test','Test')", [id, id]);
  const phone = () => '+905' + crypto.randomInt(100000000, 999999999);
  async function user(role: 'admin' | 'parent' | 'teacher' | 'security' | null, schoolId = 'school-a') {
    const u = await userRepository.create({ phone: phone(), firstName: 'TEST', lastName: 'USER', isPhoneVerified: true });
    if (role) await membershipRepository.createOrActivate({ schoolId, userId: u.id, role });
    return { ...u, token: createToken({ userId: u.id, phone: u.phone, auth_version: 0 }) };
  }
  const admin = await user('admin'), otherAdmin = await user('admin', 'school-b'), platform = await user(null);
  const parent = await user('parent'), teacher = await user('teacher'), security = await user('security');
  await membershipRepository.createOrActivate({ schoolId: 'school-b', userId: parent.id, role: 'parent' });
  process.env.PLATFORM_ADMIN_USER_IDS = platform.id;
  process.env.WHATSAPP_PILOT_ALLOWED_PHONES = [admin.phone, platform.phone, otherAdmin.phone].join(',');
  const app = express(); app.use(express.json());
  app.use('/api/platform-target/:targetSchoolId', platformTargetContextGuard, apiRouter); app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  async function request(method: string, route: string, token: string, body?: object) {
    if (body && /class-removal\/(request-code|complete)$/.test(route)) { const original=body as Record<string,unknown>; body={deletionPolicy:'PERMANENT_CLASS_V1',confirmation:original.className,...original}; }
    const response = await fetch(base + route, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  const prefix = '/schools/school-a/management/student-records';
  async function addStudent(id: string, cls = '5-A', school = 'school-a') {
    await db.query('INSERT INTO students(id,school_id,name,class_name,student_number) VALUES($1,$2,$5,$3,$4)', [id, school, cls, '001', id]);
    await db.query('INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES($1,$2,$3)', [school, id, parent.id]);
    await db.query("INSERT INTO school_roster(id,school_id,student_name,class_name,student_number,parent_name,parent_phone,is_claimed) VALUES($1,$2,$3,$4,'001','TEST PARENT',$5,TRUE)", ['roster-' + id, school, id, cls, parent.phone]);
  }
  async function resetRate(actorId = admin.id) {
    await db.query("UPDATE auth_rate_limits SET window_started_at=NOW()-interval '1 hour' WHERE scope_hash=$1", [hashSetupToken('class-delete-rate:' + actorId)]);
    await db.query("UPDATE invitations SET created_at=NOW()-INTERVAL '61 seconds' WHERE purpose='CLASS_BULK_DELETE'");
  }
  async function challenge(cls: string, token = admin.token, route = prefix) {
    await db.query("UPDATE invitations SET created_at=NOW()-INTERVAL '61 seconds' WHERE purpose='CLASS_BULK_DELETE'");
    const preview = await request('POST', route + '/class-removal/preview', token, { className: cls }); assert.equal(preview.status, 200, stage + ': preview');
    const start = await request('POST', route + '/class-removal/request-code', token, { className: cls, snapshot: preview.body.snapshot }); assert.equal(start.status, 200, stage + ': request code');
    return { challengeId: start.body.challengeId, className: cls, code: deliveredCode, confirmation: cls };
  }
  try {
    stage = 'dynamic list and authorization';
    await addStudent('student-a'); await addStudent('student-other', '6-B'); await addStudent('student-foreign', '5-A', 'school-b');
    const listed = await request('GET', prefix, admin.token); assert.equal(listed.status, 200);
    assert.equal((listed.body.records as SchoolStudentRecord[]).length, 2);
    assert.equal((listed.body.records as SchoolStudentRecord[]).some((r) => r.id === 'student-foreign'), false);
    assert.equal(listed.body.classBulkDeleteEnabled, false);
    await membershipRepository.createOrActivate({ schoolId: 'school-a', userId: platform.id, role: 'parent' });
    assert.equal((await request('PATCH', '/schools/school-a/management/parent/' + platform.id, admin.token,
      { fullName: 'CHANGED PLATFORM', phone: phone() })).status, 403, 'school identity editor must never change a Platform account');
    stage = 'student editing and parent identity protection';
    const additionalParentPhone = phone();
    await db.query("INSERT INTO school_roster(id,school_id,student_name,class_name,student_number,parent_name,parent_phone) VALUES('additional-parent','school-a','student-other','6-B','001','SECOND PARENT',$1)", [additionalParentPhone]);
    const withPendingParent = (await request('GET', prefix, admin.token)).body.records as SchoolStudentRecord[];
    assert.equal(withPendingParent.find((r) => r.id === 'student-other')?.parents.length, 2, 'unclaimed second parent must remain visible on an existing student');
    const editPath = '/schools/school-a/management/student/student-other';
    assert.equal((await request('PATCH', editPath, parent.token, { name: 'EDITED STUDENT', className: '6-C', studentNumber: '002' })).status, 403);
    assert.equal((await request('PATCH', editPath, admin.token, { name: 'EDITED STUDENT', className: '6-C', studentNumber: '002' })).status, 200);
    assert.equal((await db.query("SELECT class_name FROM students WHERE id='student-other'")).rows[0].class_name, '6-C');
    assert.equal((await db.query("SELECT class_name FROM school_roster WHERE id='roster-student-other'")).rows[0].class_name, '6-C');
    assert.equal((await db.query("SELECT class_name FROM school_roster WHERE id='additional-parent'")).rows[0].class_name, '6-C', 'student edits must include pending parent roster rows');
    assert.equal((await request('PATCH', '/schools/school-a/management/parent/' + parent.id, admin.token, { fullName: 'TEST USER', phone: phone() })).status, 409, 'shared identity must not be changed by one school');
    assert.equal((await request('PATCH', editPath, admin.token, { name: 'EDITED STUDENT', className: '6-B', studentNumber: '002' })).status, 200);
    await db.query("INSERT INTO school_roster(id,school_id,student_name,class_name,student_number,parent_name,parent_phone) VALUES('pending-test','school-a','PENDING STUDENT','8-C','0007','PENDING PARENT',$1)", [phone()]);
    const secondPendingPhone = phone();
    await db.query("INSERT INTO school_roster(id,school_id,student_name,class_name,student_number,parent_name,parent_phone) VALUES('pending-second','school-a','PENDING STUDENT','8-C','0007','SECOND PARENT',$1)", [secondPendingPhone]);
    const pendingBefore = (await request('GET', prefix, admin.token)).body.records as SchoolStudentRecord[];
    const pendingRecord = pendingBefore.find((r) => r.id === 'pending-test' || r.id === 'pending-second')!;
    assert.equal(pendingRecord.parents.length, 2);
    assert(pendingRecord.parents.every((p) => p.rosterId));
    assert.equal((await request('PATCH', '/schools/school-a/management/roster/pending-second', admin.token,
      { studentName: 'PENDING STUDENT', className: '8-D', studentNumber: '0008', parentName: 'SECOND PARENT', parentPhone: secondPendingPhone })).status, 200);
    assert.equal((await db.query("SELECT class_name FROM school_roster WHERE id='pending-test'")).rows[0].class_name, '8-D');
    assert.equal((await request('DELETE', prefix + '/roster/pending-test', parent.token)).status, 403);
    assert.equal((await request('DELETE', prefix + '/roster/pending-test', admin.token)).status, 200);
    assert.equal((await db.query("SELECT id FROM school_roster WHERE id='pending-test'")).rows.length, 0);
    assert.equal((await request('POST', prefix + '/class-removal/preview', admin.token, { className: '5-A' })).status, 404);
    process.env.CLASS_BULK_DELETE_ENABLED = 'true';
    for (const u of [parent, teacher, security, otherAdmin]) assert.equal((await request('POST', prefix + '/class-removal/preview', u.token, { className: '5-A' })).status, 403);
    stage = 'wrong class and attempts';
    const initial = await challenge('5-A');
    assert.equal(recipient, admin.phone.slice(1));
    assert.equal((await request('POST', prefix + '/class-removal/complete', admin.token, { ...initial, className: '6-B', confirmation: '6-B' })).status, 400);
    for (let i = 0; i < 4; i++) assert.equal((await request('POST', prefix + '/class-removal/complete', admin.token, { ...initial, code: initial.code === '000000' ? '000001' : '000000' })).status, 400);
    assert.equal((await request('POST', prefix + '/class-removal/complete', admin.token, initial)).status, 400, 'fifth attempt must revoke');
    assert.equal((await db.query('SELECT id FROM students WHERE id=$1', ['student-a'])).rows.length, 1);
    stage = 'snapshot drift';
    const stale = await challenge('5-A');
    await addStudent('student-new');
    assert.equal((await request('POST', prefix + '/class-removal/complete', admin.token, stale)).status, 409);
    stage = 'authorization rechecked at consumption';
    await resetRate();
    const guarded = await challenge('5-A');
    await db.query("UPDATE school_memberships SET status='inactive' WHERE user_id=$1 AND school_id='school-a' AND role='admin'", [admin.id]);
    assert.equal((await request('POST', prefix + '/class-removal/complete', admin.token, guarded)).status, 403);
    await db.query("UPDATE school_memberships SET status='active' WHERE user_id=$1 AND school_id='school-a' AND role='admin'", [admin.id]);
    await db.query("UPDATE schools SET disabled_at=NOW() WHERE id='school-a'");
    assert.equal((await request('POST', prefix + '/class-removal/complete', admin.token, guarded)).status, 403);
    await db.query("UPDATE schools SET disabled_at=NULL WHERE id='school-a'");
    process.env.WHATSAPP_AUTH_ENABLED = 'false';
    assert.equal((await request('POST', prefix + '/class-removal/complete', admin.token, guarded)).status, 403);
    process.env.WHATSAPP_AUTH_ENABLED = 'true';
    assert.equal((await db.query('SELECT consumed_at FROM invitations WHERE id=$1', [guarded.challengeId])).rows[0].consumed_at, null);
    stage = 'expiry';
    const expired = await challenge('5-A');
    await db.query("UPDATE invitations SET expires_at=NOW()-interval '1 second' WHERE id=$1", [expired.challengeId]);
    assert.equal((await request('POST', prefix + '/class-removal/complete', admin.token, expired)).status, 400);
    const preview = await request('POST', prefix + '/class-removal/preview', admin.token, { className: '5-A' });
    assert.equal((await request('POST',prefix+'/class-removal/request-code',admin.token,{className:'5-A',snapshot:preview.body.snapshot,deletionPolicy:undefined})).status,400,'old preservation UI cannot authorize permanent deletion');
    await db.query("UPDATE invitations SET created_at=NOW()-INTERVAL '61 seconds' WHERE purpose='CLASS_BULK_DELETE'");
    assert.equal((await request('POST', prefix + '/class-removal/request-code', admin.token, { className: '5-A', snapshot: preview.body.snapshot })).status, 200, 'third request in the window remains permitted');
    assert.equal((await request('POST', prefix + '/class-removal/request-code', admin.token, { className: '5-A', snapshot: preview.body.snapshot })).status, 429);
    await resetRate();
    stage = 'revocation';
    const revoked = await challenge('5-A');
    await db.query('UPDATE invitations SET revoked_at=NOW(),is_active=FALSE WHERE id=$1', [revoked.challengeId]);
    assert.equal((await request('POST', prefix + '/class-removal/complete', admin.token, revoked)).status, 400);
    stage = 'old-policy OTP cannot authorize permanent deletion';
    await resetRate();
    const oldPolicy = await challenge('5-A');
    await db.query("UPDATE invitations SET description=(description::jsonb-'policy')::text WHERE id=$1", [oldPolicy.challengeId]);
    assert.equal((await request('POST',prefix+'/class-removal/complete',admin.token,oldPolicy)).status,400);
    assert.equal((await db.query("SELECT id FROM students WHERE id='student-a'")).rows.length,1);
    stage = 'delivery failure';
    await resetRate();
    failDelivery = true;
    const failedDelivery = await request('POST', prefix + '/class-removal/request-code', admin.token, { className: '5-A', snapshot: preview.body.snapshot });
    failDelivery = false; assert.equal(failedDelivery.status, 503);
    assert.equal((await db.query("SELECT id FROM invitations WHERE purpose='CLASS_BULK_DELETE' AND is_active=TRUE AND target_user_id=$1", [admin.id])).rows.length, 0);
    await db.query("INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch) VALUES('profile-a','school-a',$1,'TEST','TEACHER','Test')", [teacher.id]);
    for (const [id, date, status] of [['future', '2999-01-01', 'booked'], ['history', '2000-01-01', 'completed']]) {
      await db.query(`INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,parent_phone,student_id,student_name,class_name,date,start_time,end_time,status,entry_code)
        VALUES($1,'school-a','profile-a','TEST','Test',$2,'TEST',$3,'student-a','student-a','5-A',$4,'10:00','10:15',$5,'123456')`, [id, parent.id, parent.phone, date, status]);
    }
    await resetRate();
    stage = 'rollback';
    const rollback = await challenge('5-A');
    await db.query("CREATE FUNCTION fail_student_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic rollback'; END $$");
    await db.query('CREATE TRIGGER fail_student_test BEFORE DELETE ON students FOR EACH ROW EXECUTE FUNCTION fail_student_test()');
    assert.equal((await request('POST', prefix + '/class-removal/complete', admin.token, rollback)).status, 500);
    assert.equal((await db.query("SELECT status FROM appointments WHERE id='future'")).rows[0].status, 'booked');
    assert.equal((await db.query('SELECT consumed_at FROM invitations WHERE id=$1', [rollback.challengeId])).rows[0].consumed_at, null);
    await db.query('DROP TRIGGER fail_student_test ON students');
    stage = 'concurrent completion and preservation';
    const results = await Promise.all([request('POST', prefix + '/class-removal/complete', admin.token, rollback), request('POST', prefix + '/class-removal/complete', admin.token, rollback)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    assert.equal((await db.query('SELECT id FROM users WHERE id=$1', [parent.id])).rows.length, 1);
    assert.equal((await db.query("SELECT id FROM students WHERE id IN ('student-other','student-foreign')")).rows.length, 2);
    assert.equal((await db.query("SELECT id FROM student_parent_relations WHERE school_id='school-b' AND parent_user_id=$1", [parent.id])).rows.length, 1);
    assert.equal((await db.query("SELECT id FROM appointments WHERE id IN ('history','future')")).rows.length, 0, 'confirmed permanent class policy deletes both history and future appointments');
    const remaining = (await request('GET', prefix, admin.token)).body.records as SchoolStudentRecord[];
    assert(!classSummaries(remaining).some((c) => c.className === '5-A'));
    stage = 'platform authority';
    const platformPrefix = '/platform-target/school-a' + prefix;
    assert.equal((await request('POST', platformPrefix + '/class-removal/preview', platform.token, { className: '6-B' })).status, 403, 'legacy phone-verified flag alone cannot prove Platform WhatsApp ownership');
    await db.query(`INSERT INTO platform_phone_bindings(id,user_id,candidate_phone,auth_version_at_start,email_recipient_fingerprint,email_code_hash,status,expires_at,consumed_at)
      VALUES($1,$2,$3,0,$4,$4,'COMPLETED',NOW()+interval '1 hour',NOW())`, [crypto.randomUUID(), platform.id, platform.phone, 'a'.repeat(64)]);
    const platformChallenge = await challenge('6-B', platform.token, platformPrefix);
    assert.equal(recipient, platform.phone.slice(1));
    assert.equal((await request('POST', platformPrefix + '/class-removal/complete', parent.token, platformChallenge)).status, 403);
    assert.equal((await request('POST', platformPrefix + '/class-removal/complete', platform.token, platformChallenge)).status, 200);
    assert((await db.query("SELECT id FROM audit_logs WHERE school_id='school-a' AND action='class.bulk_delete' AND details LIKE '%COMPLETED%'")).rows.length >= 2);
    stage = 'single deletion';
    assert.equal(await membershipRepository.getActiveMembership(parent.id,'school-a'),null,'empty-school parent membership is removed while the shared global user survives');
    await membershipRepository.createOrActivate({schoolId:'school-a',userId:parent.id,role:'parent'});
    await addStudent('single-student', '7-A');
    assert.equal((await request('DELETE', '/schools/school-a/management/students/single-student/removal', admin.token)).status, 200);
    assert.equal((await db.query('SELECT id FROM users WHERE id=$1', [parent.id])).rows.length, 1);
    assert.equal((await db.query("SELECT id FROM students WHERE id='student-foreign'")).rows.length, 1);
    stage = 'parent relationship matrix and exact notification cleanup';
    await resetRate();
    const only = await user('parent'), same = await user('parent'), shared = await user('parent'), triple = await user('parent'), foreign = await user('parent'), staffParent = await user('parent');
    await membershipRepository.createOrActivate({schoolId:'school-b',userId:foreign.id,role:'parent'});
    await membershipRepository.createOrActivate({schoolId:'school-a',userId:staffParent.id,role:'security'});
    const child = async (id:string, owner:typeof parent, cls='8-Z', school='school-a') => {
      await db.query('INSERT INTO students(id,school_id,name,class_name,student_number) VALUES($1::text,$2,$1::text,$3,$1::text)',[id,school,cls]);
      await db.query('INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES($1,$2,$3)',[school,id,owner.id]);
      await db.query("INSERT INTO school_roster(id,school_id,student_name,class_name,student_number,parent_name,parent_phone,is_claimed) VALUES($1,$2,$3::text,$4,$3::text,'TEST PARENT',$5,TRUE)",['roster-'+id,school,id,cls,owner.phone]);
    };
    await child('only-child',only); await child('same-one',same); await child('same-two',same);
    await child('shared-deleted',shared); await child('shared-retained',shared,'6-Z');
    await child('triple-one',triple); await child('triple-two',triple); await child('triple-retained',triple,'7-Z');
    await child('foreign-deleted',foreign); await child('foreign-retained',foreign,'8-Z','school-b'); await child('staff-child',staffParent);
    const qrTokens = new Map<string,string>();
    for(const [id,student,owner,cls,date,status] of [['deleted-past','only-child',only,'8-Z','2000-01-01','completed'],['deleted-future','shared-deleted',shared,'8-Z','2999-01-01','booked'],['kept-meeting','shared-retained',shared,'6-Z','2999-01-02','booked']] as const){
      const qrToken='VELIQR1:'+crypto.randomBytes(24).toString('base64url'); qrTokens.set(id,qrToken);
      await db.query(`INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,parent_phone,student_id,student_name,class_name,date,start_time,end_time,status,entry_code,qr_token)
        VALUES($1,'school-a','profile-a','TEST','Test',$2,'TEST',$3,$4::text,$4::text,$5,$6,'12:00','12:15',$7,'123456',$8)`,[id,owner.id,owner.phone,student,cls,date,status,qrToken]);
      await db.query("INSERT INTO notifications(id,school_id,user_id,title,message,date,appointment_id) VALUES($1,'school-a',$2,'TEST','TEST','2000-01-01',$3)",['n-'+id,owner.id,id]);
    }
    await db.query("INSERT INTO mobile_push_devices(id,user_id,installation_id,provider_target,target_hash,platform,auth_version,provider,target_kind,app_id) VALUES('family-device',$1,$2,'SYNTHETIC','synthetic-family-target','ANDROID',0,'FCM','REGISTRATION_TOKEN','com.velirandevu.app')",[only.id,crypto.randomUUID()]);
    await db.query("INSERT INTO notification_deliveries(id,notification_id,device_id,channel,event_type,status) VALUES('family-delivery','n-deleted-past','family-device','FCM','APPOINTMENT_APPROVED','PENDING')");
    stage='family preview counts';
    const familyPreview=await request('POST',prefix+'/class-removal/preview',admin.token,{className:'8-Z'});assert.equal(familyPreview.status,200);
    assert.equal(familyPreview.body.studentCount,8);assert.equal(familyPreview.body.relationCount,8);assert.equal(familyPreview.body.preservedAccounts,4);assert.equal(familyPreview.body.removableAccounts,2);assert.equal(familyPreview.body.appointmentCount,2);assert.equal(familyPreview.body.qrCount,2);
    stage='family challenge and cooldown';
    const familyChallenge=await challenge('8-Z');
    // No resend before 60 seconds; a failed request must not revoke the usable challenge.
    assert.equal((await request('POST',prefix+'/class-removal/request-code',admin.token,{className:'8-Z',snapshot:familyPreview.body.snapshot})).status,429);
    assert.equal((await db.query('SELECT revoked_at FROM invitations WHERE id=$1',[familyChallenge.challengeId])).rows[0].revoked_at,null);
    // An unrelated FK error must roll every part of the deletion back.
    stage='family FK rollback';
    await db.query('CREATE TABLE local_student_hold(student_id TEXT REFERENCES students(id) ON DELETE RESTRICT)');
    await db.query("INSERT INTO local_student_hold(student_id) VALUES('only-child')");
    assert.equal((await request('POST',prefix+'/class-removal/complete',admin.token,familyChallenge)).status,500);
    assert.equal((await db.query("SELECT id FROM appointments WHERE id IN ('deleted-past','deleted-future')")).rows.length,2);
    assert.equal((await db.query('SELECT id FROM users WHERE id=$1',[only.id])).rows.length,1);
    await db.query('DROP TABLE local_student_hold');
    stage='family deletion and global accounts';
    const familyResult=await request('POST',prefix+'/class-removal/complete',admin.token,familyChallenge);assert.equal(familyResult.status,200);
    assert.equal(familyResult.body.removedCount,8);assert.equal(familyResult.body.removedAccounts,2);assert.equal(familyResult.body.preservedAccounts,4);
    stage='family deletion checks';
    for(const owner of [only,same])assert.equal(await userRepository.getById(owner.id),null);
    for(const owner of [shared,triple,foreign,staffParent])assert(await userRepository.getById(owner.id));
    assert.equal((await request('GET','/user/me',only.token)).status,401);
    assert.equal((await request('GET','/user/me',shared.token)).status,200);
    stage='retained parent login, deleted-child booking and revoked QR';
    const parentStart=await request('POST','/auth/whatsapp/request-code','',{purpose:'login',phone:shared.phone});assert.equal(parentStart.status,200);
    const parentLogin=await request('POST','/auth/whatsapp/verify-code','',{phone:shared.phone,challengeId:parentStart.body.challengeId,code:deliveredCode});assert.equal(parentLogin.status,200);
    assert.equal((await request('POST','/schools/school-a/appointments',shared.token,{teacherId:'profile-a',studentName:'shared-deleted',className:'8-Z',date:'2999-01-03',startTime:'13:00',endTime:'13:15'})).status,403);
    const qrCheck=await request('POST','/schools/school-a/security/qr/verify',security.token,{qrToken:qrTokens.get('deleted-future')});assert.equal(qrCheck.status,200);assert.equal(qrCheck.body.allowed,false);assert.equal(qrCheck.body.decision,'INVALID');
    assert.equal((await db.query("SELECT id FROM appointments WHERE id IN ('deleted-past','deleted-future')")).rows.length,0);
    assert.equal((await db.query("SELECT id FROM notifications WHERE id IN ('n-deleted-past','n-deleted-future')")).rows.length,0);
    assert.equal((await db.query("SELECT id FROM notification_deliveries WHERE id='family-delivery'")).rows.length,0);
    assert.equal((await db.query("SELECT qr_token FROM appointments WHERE id='kept-meeting'")).rows[0].qr_token,qrTokens.get('kept-meeting'));
    assert.equal((await db.query("SELECT id FROM students WHERE id IN ('shared-retained','triple-retained','foreign-retained')")).rows.length,3);
    assert.equal((await db.query("SELECT id FROM students WHERE school_id='school-a' AND class_name='8-Z'")).rows.length,0);
    assert.equal((await db.query("SELECT id FROM school_roster WHERE school_id='school-a' AND class_name='8-Z'")).rows.length,0);
    const metadata=(await db.query("SELECT details FROM audit_logs WHERE action='class.permanently_deleted' ORDER BY created_at DESC LIMIT 1")).rows[0].details;
    for(const value of [only.phone,shared.phone,'only-child','same-one'])assert(!metadata.includes(value),'audit must not archive deleted identities');
    stage='ambiguous legacy appointment blocks deletion';
    await child('legacy-child',shared,'4-Z');
    await db.query("INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,parent_phone,student_name,class_name,date,start_time,end_time,status,entry_code) VALUES('legacy-meeting','school-a','profile-a','TEST','TEST',$1,'TEST',$2,'legacy-child','4-Z','2000-01-01','11:00','11:15','completed','123456')",[shared.id,shared.phone]);
    assert.equal((await request('POST',prefix+'/class-removal/preview',admin.token,{className:'4-Z'})).status,409);

    const thirty = Array.from({ length: 30 }, (_, i) => ({ id: String(i), kind: 'student' as const, name: 'TEST', className: `${5 + Math.floor(i / 10)}-${String.fromCharCode(65 + i % 10)}`, studentNumber: '001', birthDate: '', parents: [] }));
    assert.equal(classSummaries(thirty).length, 30); assert.equal(classTone('5-A'), 'green'); assert.equal(classTone('8-C'), 'purple');
    assert(deliveries > 0);
    console.log('Student/class management: tenant/role guards, dynamic counts, actor-scoped OTP, attempts/expiry/revocation, snapshot drift, rate/delivery errors, rollback, concurrency and shared parent preservation and permanent appointment deletion PASS.');
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.chdir(root);
  }
}
main().catch((error: unknown) => {
  const line = error instanceof Error ? error.stack?.split('\n').find((entry) => entry.includes('test-student-class-management.ts:')) : '';
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  console.error(`Student/class management FAILED at ${stage}. ${line || ''} ${code} No credentials or personal data logged.`); process.exitCode = 1;
});
