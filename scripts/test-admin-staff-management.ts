import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { displayStoredTurkishPhone } from '../src/utils/phone';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('This test requires local PGlite without DATABASE_URL.');
  process.env.NODE_ENV = 'test';
  process.env.RESEND_API_KEY = 'local-test-key';
  process.env.EMAIL_FROM = 'test@example.test';
  const sentEmails: Array<{to:string;subject:string;html:string}> = [];
  let failNextEmail = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.resend.com/emails')) {
      const payload = JSON.parse(String(init?.body || '{}')) as {to:string[];subject:string;html:string};
      if (failNextEmail) { failNextEmail = false; return new Response('{}',{status:503}); }
      sentEmails.push({to:payload.to[0],subject:payload.subject,html:payload.html});
      return new Response(JSON.stringify({id:'local-test-email'}),{status:200});
    }
    return originalFetch(input,init);
  };
  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken } = await import('../server/auth');
  const { userRepository, membershipRepository, auditLogRepository } = await import('../server/repositories');
  const db = await getDb();
  assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  const suffix = crypto.randomUUID();
  const schoolId = `staff-school-${suffix}`;
  const otherSchoolId = `staff-other-${suffix}`;
  const schoolCode = `ST${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  let teacherId = '';
  const phones: string[] = [];
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  async function request(method: string, path: string, token?: string, body?: object, headerSchool?: string) {
    const input = body as Record<string, unknown> | undefined;
    const payload = input && typeof input.phone === 'string' && /^\+905\d{9}$/.test(input.phone) ? { ...input, phone: displayStoredTurkishPhone(input.phone) } : body;
    const response = await fetch(baseUrl + path, { method, headers: { 'content-type':'application/json', ...(token ? {authorization:`Bearer ${token}`} : {}), ...(headerSchool ? {'x-school-id':headerSchool} : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    const text = await response.text();
    try { return {status:response.status,body:JSON.parse(text) as Record<string,unknown>}; }
    catch { console.error('Non-JSON test response',method,path,response.status,response.headers.get('content-type')); throw new Error('Unexpected non-JSON test response.'); }
  }
  function phone() { const value = `+905${crypto.randomInt(100000000,999999999)}`; phones.push(value); return value; }
  async function fixture(role:'admin'|'parent'|'teacher'|'security', school=schoolId) {
    const user = await userRepository.create({phone:phone(),firstName:'Local',lastName:'Staff Test'});
    await membershipRepository.createOrActivate({userId:user.id,schoolId:school,role});
    const auth = await userRepository.getById(user.id);
    assert(auth);
    return {user,token:createToken({userId:user.id,phone:user.phone,auth_version:auth.authVersion})};
  }
  function emailCode(index: number): string {
    const email = sentEmails[index];
    assert(email);
    const code = email.html.match(/>(\d{6})</)?.[1];
    assert(code, 'email mock should receive a six-digit code');
    return code;
  }
  try {
    for (const [id,code] of [[schoolId,schoolCode],[otherSchoolId,`OT${crypto.randomBytes(5).toString('hex').toUpperCase()}`]]) {
      await db.query('INSERT INTO schools (id,name,code,city,district) VALUES ($1,$2,$3,$4,$5)',[id,'Local Staff Test',code,'Test','Test']);
    }
    const admin = await fixture('admin');
    const parent = await fixture('parent');
    const teacher = await fixture('teacher');
    const security = await fixture('security');
    const foreignAdmin = await fixture('admin',otherSchoolId);
    const teacherPhone = phone();
    const staffPath = `/schools/${schoolId}/staff`;
    const created = await request('POST',staffPath,admin.token,{schoolId:otherSchoolId,role:'teacher',fullName:'Local Teacher',branch:'Türkçe',phone:`0${teacherPhone.slice(3)}`,email:'teacher@example.test'});
    assert.equal(created.status,201);
    assert.equal(created.body.success,true);
    assert.equal('code' in created.body,false);
    const teachers = await request('GET',`/schools/${schoolId}/teachers`,admin.token);
    const pending = (teachers.body.teachers as Array<Record<string,unknown>>).find((row) => row.phone === teacherPhone);
    assert(pending);
    teacherId = String(pending.id);
    assert.equal(pending.schoolId,schoolId);
    assert.equal(pending.userId ?? null,null);
    assert.equal(pending.accountStatus,'pending');
    assert.equal((await db.query('SELECT user_id FROM teacher_profiles WHERE school_id=$1 AND id=$2',[schoolId,teacherId])).rows[0].user_id,null);
    assert.equal(sentEmails[0].to,'teacher@example.test');
    assert.equal((await auditLogRepository.getAuditLogs(schoolId)).some((row) => row.action === 'admin_staff_created'),true);
    assert.equal((await request('POST',staffPath,admin.token,{role:'teacher',fullName:'Cross School',branch:'Türkçe',phone:teacherPhone,email:'x@example.test'})).status,409);
    assert.equal((await request('POST',staffPath,admin.token,{role:'teacher',fullName:'Invalid Phone',branch:'Türkçe',phone:'123',email:'x@example.test'})).status,400);
    assert.equal((await request('POST',staffPath,admin.token,{role:'teacher',fullName:'Missing Branch',phone:phone(),email:'x@example.test'})).status,400);
    assert.equal((await request('POST',staffPath,admin.token,{role:'teacher',fullName:'Tek',branch:'Türkçe',phone:phone(),email:'x@example.test'})).status,400);
    assert.equal((await request('POST',staffPath,admin.token,{role:'teacher',fullName:'Missing Email',branch:'Türkçe',phone:phone()})).status,400);
    for (const token of [parent.token,teacher.token,security.token]) assert.equal((await request('POST',staffPath,token,{role:'security',fullName:'Blocked Staff',phone:phone(),email:'x@example.test'})).status,403);
    assert.equal((await request('POST',`/schools/${otherSchoolId}/staff`,admin.token,{role:'security',fullName:'Cross Tenant',phone:phone(),email:'x@example.test'})).status,403);
    assert.equal((await request('POST',staffPath,foreignAdmin.token,{role:'security',fullName:'Wrong Tenant',phone:phone(),email:'x@example.test'})).status,403);
    assert.equal((await request('POST',staffPath,admin.token,{role:'security',fullName:'Header Spoof',phone:phone(),email:'x@example.test'},otherSchoolId)).status,400);

    const activationCode = emailCode(0);
    assert.match(activationCode,/^\d{6}$/);
    assert.equal((await request('POST',`/schools/${schoolId}/staff/teacher/${teacherId}/resend-activation`,admin.token)).status,429);
    await db.query("UPDATE invitations SET created_at=NOW()-INTERVAL '61 seconds' WHERE school_id=$1 AND target_phone=$2 AND purpose='staff_activation'",[schoolId,teacherPhone]);
    assert.equal((await request('POST',`/schools/${schoolId}/staff/teacher/${teacherId}/resend-activation`,admin.token)).status,200);
    assert.equal((await request('POST','/auth/staff/activation-verify',undefined,{schoolCode,phone:teacherPhone,code:activationCode})).status,400);
    const resentActivationCode=emailCode(1);
    assert.notEqual(resentActivationCode,activationCode);
    const storedActivationCodes=await db.query("SELECT code_hash,consumed_at,revoked_at FROM invitations WHERE school_id=$1 AND target_phone=$2 AND purpose='staff_activation'",[schoolId,teacherPhone]);
    assert.equal(storedActivationCodes.rows.length,2);
    assert.equal(storedActivationCodes.rows.filter((row) => row.revoked_at === null && row.consumed_at === null).length,1);
    assert(!storedActivationCodes.rows.some((row) => row.code_hash === resentActivationCode));
    const verified = await request('POST','/auth/staff/activation-verify',undefined,{schoolCode,phone:teacherPhone,code:activationCode});
    assert.equal(verified.status,400);
    const validVerify = await request('POST','/auth/staff/activation-verify',undefined,{schoolCode,phone:teacherPhone,code:resentActivationCode});
    assert.equal(validVerify.status,200);
    assert.equal(typeof validVerify.body.setupToken,'string');
    const password = crypto.randomBytes(24).toString('base64url');
    assert.equal((await request('POST','/auth/staff/activation-complete',undefined,{schoolId,phone:teacherPhone,setupToken:validVerify.body.setupToken,password})).status,200);
    assert.equal((await request('POST','/auth/staff/activation-complete',undefined,{schoolId,phone:teacherPhone,setupToken:validVerify.body.setupToken,password})).status,400);
    const login = await request('POST','/auth/login',undefined,{phone:teacherPhone,password});
    assert.equal(login.status,200);
    const teacherMembership = (login.body.memberships as Array<{schoolId:string;role:string}>).find((membership) => membership.role === 'teacher');
    assert.equal(teacherMembership?.schoolId,schoolId);
    const linked = await userRepository.getByPhone(teacherPhone);
    assert(linked);
    const stableTeacherId = (await db.query('SELECT user_id FROM teacher_profiles WHERE school_id=$1 AND id=$2',[schoolId,teacherId])).rows[0];
    assert.equal(stableTeacherId.user_id,linked.id);
    assert.equal((await request('POST',`/schools/${otherSchoolId}/staff`,foreignAdmin.token,{role:'teacher',fullName:'Same Teacher',branch:'Dil',phone:teacherPhone,email:'other@example.test'})).status,409);

    const securityPhone = phone();
    failNextEmail = true;
    const createSecurity = await request('POST',staffPath,admin.token,{role:'security',fullName:'Local Security',phone:securityPhone,email:'security@example.test'});
    assert.equal(createSecurity.status,503);
    const pendingUsers = await request('GET',`/schools/${schoolId}/users?role=security`,admin.token);
    assert((pendingUsers.body.users as Array<Record<string,unknown>>).some((row) => row.accountStatus === 'pending' && row.phone === securityPhone));
    assert.equal((await request('POST',`/schools/${schoolId}/staff/security/${String((pendingUsers.body.users as Array<Record<string,unknown>>).find((row) => row.phone === securityPhone)?.id)}/resend-activation`,admin.token)).status,429);
    await db.query("UPDATE invitations SET created_at=NOW()-INTERVAL '61 seconds' WHERE school_id=$1 AND target_phone=$2 AND purpose='staff_activation'",[schoolId,securityPhone]);
    const pendingSecurityId=String((pendingUsers.body.users as Array<Record<string,unknown>>).find((row) => row.phone === securityPhone)?.id);
    assert.equal((await request('POST',`/schools/${schoolId}/staff/security/${pendingSecurityId}/resend-activation`,admin.token)).status,200);
    const newSecurityCode = emailCode(2);
    const securityVerify = await request('POST','/auth/staff/activation-verify',undefined,{schoolCode,phone:securityPhone,code:newSecurityCode});
    assert.equal(securityVerify.status,200);
    const securityPassword = crypto.randomBytes(24).toString('base64url');
    assert.equal((await request('POST','/auth/staff/activation-complete',undefined,{schoolId,phone:securityPhone,setupToken:securityVerify.body.setupToken,password:securityPassword})).status,200);
    assert((await request('POST','/auth/login',undefined,{phone:securityPhone,password:securityPassword})).status === 200);

    const staleToken = login.body.token as string;
    const resetRequest = await request('POST','/auth/staff/reset-request',undefined,{schoolCode,phone:teacherPhone,email:'attacker@example.test'});
    assert.equal(resetRequest.status,200);
    assert.equal(resetRequest.body.message,'Eğer bilgileriniz sistemde kayıtlıysa sıfırlama kodu e-posta adresinize gönderilecektir.');
    assert.equal(sentEmails[3].to,'teacher@example.test');
    const resetCode = emailCode(3);
    assert.equal((await request('POST','/auth/staff/reset-verify',undefined,{schoolCode,phone:teacherPhone,code:activationCode})).status,400);
    const resetVerify = await request('POST','/auth/staff/reset-verify',undefined,{schoolCode,phone:teacherPhone,code:resetCode});
    assert.equal(resetVerify.status,200);
    const replacement = crypto.randomBytes(24).toString('base64url');
    assert.equal((await request('POST','/auth/staff/reset-complete',undefined,{schoolId,phone:teacherPhone,setupToken:resetVerify.body.setupToken,password:replacement})).status,200);
    assert.equal((await request('POST','/auth/login',undefined,{phone:teacherPhone,password})).status,401);
    assert.equal((await request('POST','/auth/login',undefined,{phone:teacherPhone,password:replacement})).status,200);
    assert.equal((await request('GET',`/schools/${schoolId}/teachers`,staleToken)).status,401);
    assert.equal((await db.query('SELECT id,user_id FROM teacher_profiles WHERE school_id=$1 AND id=$2',[schoolId,teacherId])).rows[0].user_id,linked.id);
    assert.equal((await request('DELETE',`/schools/${schoolId}/management/teacher/${teacherId}`,admin.token)).status,200);
    assert.equal((await db.query('SELECT id FROM teacher_profiles WHERE school_id=$1 AND id=$2',[schoolId,teacherId])).rows.length,0);
    assert.equal((await request('POST','/auth/login',undefined,{phone:teacherPhone,password:replacement})).status,401);
    console.log('Admin staff management: tenant guards, email activation/reset, six-digit codes and teacher school invariant PASS.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    await db.query('DELETE FROM schools WHERE id IN ($1,$2)',[schoolId,otherSchoolId]);
    for (const value of phones) await db.query('DELETE FROM users WHERE phone=$1',[value]);
  }
}

run().catch((cause) => {
  console.error('Admin staff management test FAILED. No credentials or response bodies are logged.', cause instanceof Error ? cause.stack : '');
  process.exitCode = 1;
});
