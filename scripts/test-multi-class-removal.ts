import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';

let stage = 'setup';
async function main() {
  if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') throw new Error('Local isolated PGlite required');
  const root = process.cwd(), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'veli-multi-class-'));
  fs.mkdirSync(path.join(temp, 'server/database'), { recursive: true });
  fs.copyFileSync(path.join(root, 'server/database/supabase_schema.sql'), path.join(temp, 'server/database/supabase_schema.sql'));
  fs.cpSync(path.join(root, 'server/database/migrations'), path.join(temp, 'server/database/migrations'), { recursive: true });
  process.chdir(temp);
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex'); process.env.AUTH_CODE_SECRET = crypto.randomBytes(48).toString('hex');
  process.env.WHATSAPP_AUTH_ENABLED = 'true'; process.env.WHATSAPP_PHONE_NUMBER_ID = '123456'; process.env.WHATSAPP_ACCESS_TOKEN = 'synthetic-only';
  delete process.env.CLASS_MULTI_DELETE_ENABLED; process.env.CLASS_BULK_DELETE_ENABLED = 'true';
  let code = '', recipient = '', deliveries = 0, failDelivery = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://graph.facebook.com/')) {
      if (failDelivery) return new Response('{}', { status: 503 });
      const payload = JSON.parse(String(init?.body)) as { to: string; template: { name: string; components: { parameters: { text: string }[] }[] } };
      assert.equal(payload.template.name, 'kolayokul_onay'); recipient = payload.to; code = payload.template.components[0].parameters[0].text; deliveries++;
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
  const db = await getDb(); assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  stage = 'school fixtures';
  for (const id of ['school-a', 'school-b']) await db.query("INSERT INTO schools(id,name,code,city,district) VALUES($1,'Test school',$2,'Test','Test')", [id, id]);
  async function user(role: 'admin' | 'parent' | 'teacher' | 'security' | null, school = 'school-a') {
    const u = await userRepository.create({ phone: '+905' + crypto.randomInt(100000000, 999999999), firstName: 'TEST', lastName: 'USER', isPhoneVerified: true });
    if (role) await membershipRepository.createOrActivate({ schoolId: school, userId: u.id, role });
    return { ...u, token: createToken({ userId: u.id, phone: u.phone, auth_version: 0 }) };
  }
  stage = 'user fixtures';
  const admin = await user('admin'), otherAdmin = await user('admin', 'school-b'), teacher = await user('teacher'), security = await user('security'), platform = await user(null);
  const only = await user('parent'), shared = await user('parent'), foreign = await user('parent');
  await membershipRepository.createOrActivate({ schoolId: 'school-b', userId: foreign.id, role: 'parent' });
  process.env.PLATFORM_ADMIN_USER_IDS = platform.id;
  await db.query("INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch) VALUES('teacher-a','school-a',$1,'TEST','TEACHER','Test')", [teacher.id]);
  async function child(id: string, owner: typeof only, cls: string, school = 'school-a') {
    await db.query("INSERT INTO students(id,school_id,name,class_name,student_number) VALUES($1,$2,$3,$4,$5)", [id, school, id, cls, id]);
    await db.query('INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES($1,$2,$3)', [school, id, owner.id]);
    await db.query("INSERT INTO school_roster(id,school_id,student_name,class_name,student_number,parent_name,parent_phone,is_claimed) VALUES($1,$2,$3,$4,$5,'TEST',$6,TRUE)", ['roster-' + id, school, id, cls, id, owner.phone]);
  }
  stage = 'student fixtures';
  await child('only-a', only, '5-A'); await child('only-b', only, '6-B');
  await child('shared-a', shared, '5-A'); await child('shared-outside', shared, '7-C');
  await child('foreign-a', foreign, '6-B'); await child('foreign-outside', foreign, '5-A', 'school-b');
  await child('foreign-class', foreign, '8-F', 'school-b');
  const app = express(); app.use(express.json()); app.use('/api/platform-target/:targetSchoolId', platformTargetContextGuard, apiRouter); app.use('/api', apiRouter);
  const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const prefix = '/schools/school-a/management/student-records', route = prefix + '/multi-class-removal';
  const base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port + '/api';
  async function request(endpoint: string, body: object, token = admin.token) {
    const response = await fetch(base + endpoint, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  const names = ['5-A', '6-B'], confirmation = 'SEÇİLİ SINIFLARI SİL', deletionPolicy = 'PERMANENT_CLASSES_V1';
  const complete = (challenge: object, extra: object = {}, token = admin.token) => request(route + '/complete', { classNames: names, confirmation, deletionPolicy, ...challenge, ...extra }, token);
  async function resetRate(actorId = admin.id) {
    await db.query("UPDATE auth_rate_limits SET window_started_at=NOW()-interval '1 hour' WHERE scope_hash=$1", [hashSetupToken('class-delete-rate:' + actorId)]);
    await db.query("UPDATE invitations SET created_at=NOW()-interval '61 seconds' WHERE purpose IN ('CLASS_MULTI_DELETE','CLASS_BULK_DELETE')");
  }
  async function challenge(classNames = names, token = admin.token, endpoint = route) {
    await resetRate(token === platform.token ? platform.id : admin.id);
    const preview = await request(endpoint + '/preview', { classNames }, token); assert.equal(preview.status, 200, stage + ': preview');
    const before = deliveries;
    const started = await request(endpoint + '/request-code', { classNames, snapshot: preview.body.snapshot, confirmation, deletionPolicy }, token);
    assert.equal(started.status, 200, stage + ': request'); assert.equal(deliveries, before + 1, 'exactly one WhatsApp message for the full class set');
    assert.equal(started.body.expiresInSeconds, 300); assert.equal(started.body.resendAfterSeconds, 60);
    return { challengeId: started.body.challengeId, code };
  }
  try {
    stage = 'flags and authorization';
    for (const action of ['preview', 'request-code', 'complete', 'cancel']) assert.equal((await request(route + '/' + action, { classNames: names })).status, 404);
    process.env.CLASS_MULTI_DELETE_ENABLED = 'true'; process.env.CLASS_BULK_DELETE_ENABLED = 'false';
    assert.equal((await request(route + '/preview', { classNames: names })).status, 404);
    process.env.CLASS_BULK_DELETE_ENABLED = 'true';
    for (const u of [only, teacher, security, otherAdmin]) assert.equal((await request(route + '/preview', { classNames: names }, u.token)).status, 403);
    for (const classNames of [['5-A'], ['5-A', '5/A'], ['5-A', '__ALL__']]) assert.notEqual((await request(route + '/preview', { classNames })).status, 200);
    assert.equal((await request(route + '/preview', { classNames: ['5-A', '8-F'], schoolId: 'school-b' })).status, 409);
    stage = 'combined preview and explicit consent';
    const preview = await request(route + '/preview', { classNames: names }); assert.equal(preview.status, 200);
    assert.equal(preview.body.studentCount, 4); assert.equal(preview.body.removableAccounts, 1); assert.equal(preview.body.preservedAccounts, 2);
    const beforeConsent = deliveries;
    assert.equal((await request(route + '/request-code', { classNames: names, snapshot: preview.body.snapshot, deletionPolicy })).status, 400); assert.equal(deliveries, beforeConsent);
    stage = 'purpose isolation and scope changes';
    const first = await challenge(); assert.equal(recipient, admin.phone.slice(1));
    const invitation = (await db.query('SELECT code_hash,description,expires_at,created_at FROM invitations WHERE id=$1', [first.challengeId])).rows[0];
    assert(!invitation.description.includes(first.code)); assert.notEqual(invitation.code_hash, first.code); assert(invitation.description.length <= 255);
    assert(Math.abs((new Date(invitation.expires_at).getTime() - new Date(invitation.created_at).getTime()) - 300000) < 1000);
    assert.equal((await request(prefix + '/class-removal/complete', { ...first, className: '5-A', confirmation: '5-A', deletionPolicy: 'PERMANENT_CLASS_V1' })).status, 400);
    await resetRate();
    const singlePreview = await request(prefix + '/class-removal/preview', { className: '5-A' });
    const single = await request(prefix + '/class-removal/request-code', { className: '5-A', snapshot: singlePreview.body.snapshot, confirmation: '5-A', deletionPolicy: 'PERMANENT_CLASS_V1' });
    assert.equal(single.status, 200);
    assert.equal((await complete({ challengeId: single.body.challengeId, code })).status, 400, 'single-class code cannot authorize a multi-class operation');
    assert.equal((await complete(first, {}, otherAdmin.token)).status, 403);
    assert.equal((await complete(first, { classNames: ['5-A', '7-C'] })).status, 400);
    assert.equal((await complete(first)).status, 400, 'scope tamper revokes the original challenge');
    const second = await challenge();
    assert.equal((await request(route + '/preview', { classNames: ['5-A', '7-C'] })).status, 200);
    assert.equal((await complete(second)).status, 400, 'new selection preview invalidates the previous selection');
    const cancelled = await challenge(); assert.equal((await request(route + '/cancel', cancelled)).status, 200); assert.equal((await complete(cancelled)).status, 400);
    stage = 'wrong codes attempts expiry and resend';
    const wrong = await challenge();
    for (let i = 0; i < 5; i++) assert.equal((await complete(wrong, { code: wrong.code === '000000' ? '000001' : '000000' })).status, 400);
    assert.equal((await complete(wrong)).status, 400);
    const expired = await challenge(); await db.query("UPDATE invitations SET expires_at=NOW()-interval '1 second' WHERE id=$1", [expired.challengeId]); assert.equal((await complete(expired)).status, 400);
    const cooldown = await challenge(); const cooldownPreview = await request(route + '/preview', { classNames: names });
    assert.equal((await request(route + '/request-code', { classNames: names, snapshot: cooldownPreview.body.snapshot, confirmation, deletionPolicy })).status, 429);
    assert.equal((await db.query('SELECT revoked_at FROM invitations WHERE id=$1', [cooldown.challengeId])).rows[0].revoked_at, null);
    for (let i = 0; i < 2; i++) {
      await db.query("UPDATE invitations SET created_at=NOW()-interval '61 seconds' WHERE purpose='CLASS_MULTI_DELETE'");
      assert.equal((await request(route + '/request-code', { classNames: names, snapshot: cooldownPreview.body.snapshot, confirmation, deletionPolicy })).status, 200);
    }
    await db.query("UPDATE invitations SET created_at=NOW()-interval '61 seconds' WHERE purpose='CLASS_MULTI_DELETE'");
    assert.equal((await request(route + '/request-code', { classNames: names, snapshot: cooldownPreview.body.snapshot, confirmation, deletionPolicy })).status, 429, 'fourth send in 15 minutes is rejected');
    stage = 'drift delivery and actor revocation';
    const drift = await challenge(); await db.query("UPDATE students SET student_number='CHANGED' WHERE id='only-b'"); assert.equal((await complete(drift)).status, 409);
    await db.query("UPDATE students SET student_number='only-b' WHERE id='only-b'");
    const guarded = await challenge();
    await db.query("UPDATE school_memberships SET status='inactive' WHERE user_id=$1 AND school_id='school-a' AND role='admin'", [admin.id]); assert.equal((await complete(guarded)).status, 403);
    await db.query("UPDATE school_memberships SET status='active' WHERE user_id=$1 AND school_id='school-a' AND role='admin'", [admin.id]);
    await resetRate(); failDelivery = true;
    const failed = await request(route + '/request-code', { classNames: names, snapshot: (await request(route + '/preview', { classNames: names })).body.snapshot, confirmation, deletionPolicy });
    failDelivery = false; assert.equal(failed.status, 503);
    assert.equal((await db.query("SELECT id FROM invitations WHERE purpose='CLASS_MULTI_DELETE' AND is_active=TRUE")).rows.length, 0);
    stage = 'appointment QR notification fixtures';
    for (const [id, date, status] of [['past', '2000-01-01', 'completed'], ['future', '2999-01-01', 'booked']]) {
      await db.query(`INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,parent_phone,student_id,student_name,class_name,date,start_time,end_time,status,entry_code,qr_token)
        VALUES($1,'school-a','teacher-a','TEST','TEST',$2,'TEST',$3,'only-a','only-a','5-A',$4,'10:00','10:15',$5,'123456',$6)`, [id, only.id, only.phone, date, status, 'VELIQR1.' + crypto.randomBytes(32).toString('base64url')]);
      await db.query("INSERT INTO notifications(id,school_id,user_id,title,message,date,appointment_id) VALUES($1,'school-a',$2,'TEST','TEST','2000-01-01',$3)", ['n-' + id, only.id, id]);
    }
    await db.query("INSERT INTO mobile_push_devices(id,user_id,installation_id,provider_target,target_hash,platform,auth_version,provider,target_kind,app_id) VALUES('device',$1,$2,'SYNTHETIC','synthetic','ANDROID',0,'FCM','REGISTRATION_TOKEN','com.velirandevu.app')", [only.id, crypto.randomUUID()]);
    await db.query("INSERT INTO notification_deliveries(id,notification_id,device_id,channel,event_type,status) VALUES('delivery','n-past','device','FCM','APPOINTMENT_APPROVED','PENDING')");
    await db.query("UPDATE appointments SET status='checked_in' WHERE id='future'");
    assert.equal((await request(route + '/preview', { classNames: names })).status, 409, 'ongoing visits veto the whole operation');
    await db.query("UPDATE appointments SET status='booked' WHERE id='future'");
    const finalPreview = await request(route + '/preview', { classNames: names }); assert.equal(finalPreview.body.appointmentCount, 2); assert.equal(finalPreview.body.notificationCount, 2); assert.equal(finalPreview.body.deliveryCount, 1); assert.equal(finalPreview.body.qrCount, 2);
    stage = 'whole-operation rollback including OTP';
    const atomic = await challenge();
    await db.query("CREATE FUNCTION reject_second_class() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.class_name='6-B' THEN RAISE EXCEPTION 'synthetic rollback'; END IF; RETURN OLD; END $$");
    await db.query('CREATE TRIGGER reject_second_class BEFORE DELETE ON students FOR EACH ROW EXECUTE FUNCTION reject_second_class()');
    assert.equal((await complete(atomic)).status, 500);
    assert((await db.query("SELECT id FROM audit_logs WHERE action='class.multi_delete' AND details LIKE '%FAILED%'")).rows.length > 0);
    assert.equal((await db.query("SELECT id FROM students WHERE id IN ('only-a','only-b','shared-a','foreign-a')")).rows.length, 4);
    assert.equal((await db.query("SELECT id FROM appointments WHERE id IN ('past','future')")).rows.length, 2);
    assert.equal((await db.query('SELECT consumed_at FROM invitations WHERE id=$1', [atomic.challengeId])).rows[0].consumed_at, null);
    assert(await userRepository.getById(only.id));
    await db.query('DROP TRIGGER reject_second_class ON students');
    stage = 'concurrent atomic completion and account protection';
    const concurrent = await Promise.all([complete(atomic), complete(atomic)]); assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 400]);
    const success = concurrent.find(r => r.status === 200)!; assert.equal(success.body.removedCount, 4); assert.equal(success.body.removedAccounts, 1); assert.equal(success.body.preservedAccounts, 2);
    assert.equal(await userRepository.getById(only.id), null); assert(await userRepository.getById(shared.id)); assert(await userRepository.getById(foreign.id));
    assert.equal((await db.query("SELECT id FROM students WHERE id IN ('shared-outside','foreign-outside')")).rows.length, 2);
    assert(await membershipRepository.getActiveMembership(foreign.id, 'school-b'));
    for (const table of ['appointments', 'notifications', 'notification_deliveries']) assert.equal((await db.query('SELECT id FROM ' + table)).rows.length, 0);
    assert.equal((await complete(atomic)).status, 400);
    assert.equal((await db.query("SELECT id FROM audit_logs WHERE action='class.multi_permanently_deleted'")).rows.length, 1);
    stage = 'platform authority and continuing visits';
    await child('platform-one', shared, '8-A'); await child('platform-two', shared, '8-B');
    const platformRoute = '/platform-target/school-a' + route;
    assert.equal((await request(platformRoute + '/preview', { classNames: ['8-A', '8-B'] }, platform.token)).status, 403);
    await db.query(`INSERT INTO platform_phone_bindings(id,user_id,candidate_phone,auth_version_at_start,email_recipient_fingerprint,email_code_hash,status,expires_at,consumed_at)
      VALUES($1,$2,$3,0,$4,$4,'COMPLETED',NOW()+interval '1 hour',NOW())`, [crypto.randomUUID(), platform.id, platform.phone, 'a'.repeat(64)]);
    const platformChallenge = await challenge(['8-A', '8-B'], platform.token, platformRoute); assert.equal(recipient, platform.phone.slice(1));
    assert.equal((await request(platformRoute + '/complete', { ...platformChallenge, classNames: ['8-A', '8-B'], confirmation, deletionPolicy }, platform.token)).status, 200);
    stage = 'legacy ambiguity veto';
    await child('legacy-one', shared, '4-A'); await child('legacy-two', shared, '4-B');
    await db.query("INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,parent_phone,student_name,class_name,date,start_time,end_time,status,entry_code) VALUES('legacy','school-a','teacher-a','TEST','TEST',$1,'TEST',$2,'legacy-one','4-A','2000-01-01','10:00','10:15','completed','123456')", [shared.id, shared.phone]);
    assert.equal((await request(route + '/preview', { classNames: ['4-A', '4-B'] })).status, 409);
    console.log('Multi-class removal PASS: one OTP, explicit scope, feature defaults, 5 attempts, expiry, cooldown, cancel/replay, tenant/role/platform authorization, whole-operation rollback, concurrency, shared/orphan parents and appointment/QR/notification cleanup. Synthetic PGlite only.');
  } finally { globalThis.fetch = originalFetch; await new Promise<void>(resolve => server.close(() => resolve())); process.chdir(root); }
}
main().catch((error: unknown) => {
  const line = error instanceof Error ? error.stack?.split('\n').find(entry => entry.includes('test-multi-class-removal.ts:')) : '';
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  console.error('Multi-class removal FAILED at ' + stage + '. ' + (line || '') + ' ' + code + ' No credentials or personal data logged.'); process.exitCode = 1;
});
