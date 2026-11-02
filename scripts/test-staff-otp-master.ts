import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';

if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') throw Error('Isolated local test only');
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'veli-staff-master-'));
fs.cpSync(path.join(root,'server/database'),path.join(temp,'server/database'),{recursive:true});
fs.rmSync(path.join(temp,'server/database/seed_supabase_migration.sql'),{force:true});
process.chdir(temp);
Object.assign(process.env,{NODE_ENV:'test',WHATSAPP_AUTH_ENABLED:'true',WHATSAPP_UNIFIED_LOGIN_ENABLED:'true',PHONE_CENTRIC_AUTH_ENABLED:'true',AUTH_CODE_SECRET:crypto.randomBytes(32).toString('hex'),JWT_SECRET:crypto.randomBytes(32).toString('hex'),WHATSAPP_PHONE_NUMBER_ID:'123456789',WHATSAPP_ACCESS_TOKEN:'fixture-only-token',RESEND_API_KEY:'fixture-only-key',EMAIL_FROM:'fixture@example.test'});
const originalFetch=globalThis.fetch,codes=new Map<string,string>(),emails:any[]=[],checks:string[]=[];
let failProvider=false,failEmail=false,providerCalls=0;
globalThis.fetch=async(input,init)=>{
 const url=String(input);
 if(url.startsWith('https://graph.facebook.com/')){
  providerCalls++;
  const b=JSON.parse(String(init?.body));
  assert.equal(b.template.name,'kolayokul_onay');assert.equal(b.template.language.code,'tr');
  if(failProvider)return new Response('{}',{status:503});
  codes.set('+'+b.to,b.template.components[0].parameters[0].text);
  return new Response('{"messages":[{"id":"synthetic"}]}',{status:200});
 }
 if(url==='https://api.resend.com/emails'){
  const b=JSON.parse(String(init?.body));emails.push(b);
  return new Response('{}',{status:failEmail?503:200});
 }
 if(!url.startsWith('http://127.0.0.1:'))throw Error('External network forbidden in test');
 return originalFetch(input,init);
};
const {getDb,closeDatabase}=await import('../server/database/postgres');
const {apiRouter}=await import('../server/api');
const {platformTargetContextGuard}=await import('../server/platform-management');
const {createToken}=await import('../server/auth');
const {userRepository,membershipRepository,auditLogRepository}=await import('../server/repositories');
const {hashPassword}=await import('../server/passwords');
const {registerPushDevice,dispatchPushDeliveries,StalePushSessionError}=await import('../server/push-notifications');
const {runAppointmentReminderJob}=await import('../server/appointment-reminders');
const db=await getDb();assert.equal(db.engineType,'PostgreSQL (Embedded Persistent Engine)');
const app=express();app.use(express.json());app.use('/api/platform-target/:targetSchoolId',platformTargetContextGuard,apiRouter);app.use('/api',apiRouter);
const server=http.createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+(server.address() as any).port+'/api';
const school='local-school-a',other='local-school-b';let stage='setup';
async function req(method:string,url:string,token?:string,body?:object,role?:string){
 const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(role?{'X-School-Role':role}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,body:await r.json() as any};
}
const ok=(name:string)=>checks.push(name);
async function fixture(phone:string,role:'admin'|'parent'|'teacher'|'security',schoolId=school){
 const u=await userRepository.create({phone,firstName:'SENTETİK',lastName:role==='parent'?'VELİ':'PERSONEL',isPhoneVerified:true});
 await membershipRepository.createOrActivate({schoolId,userId:u.id,role});
 return {...u,token:createToken({userId:u.id,phone,auth_version:0,auth_method:role==='admin'?'password':'phone_centric'})};
}
async function start(phone:string){return req('POST','/auth/phone/request-code',undefined,{phone});}
async function verify(phone:string,response:any,code=codes.get(phone)){return req('POST','/auth/phone/verify-code',undefined,{phone,attemptId:response.body.attemptId,challengeId:response.body.challengeId,code});}
try{
 for(const id of [school,other])await db.query("INSERT INTO schools(id,name,code,city,district,settings) VALUES($1,$2,$3,'TEST','TEST',$4::jsonb)",[id,id,id,JSON.stringify({slotDuration:15,dailyQuotaPerParent:10,maxAdvanceBookingDays:36500})]);
 const admin=await fixture('+905551110001','admin'),foreignAdmin=await fixture('+905551110002','admin',other),parent=await fixture('+905551110003','parent');
 const staffPath=`/schools/${school}/staff`,teacherPhone='+905551110004',securityPhone='+905551110005';
 const teacherInput={role:'teacher',fullName:'Sentetik Öğretmen',phone:'0555 111 00 04',branch:'Matematik',email:'teacher-notifications@example.test'};
 stage='staff creation';
 const auditWriter=auditLogRepository.createAuditLog;
 auditLogRepository.createAuditLog=async()=>{throw Error('Synthetic audit failure');};
 try {assert.equal((await req('POST',staffPath,admin.token,{role:'security',fullName:'Atomik Kontrol',phone:'+905551110098'})).status,500);}
 finally{auditLogRepository.createAuditLog=auditWriter;}
 assert.equal((await db.query("SELECT 1 FROM pending_staff WHERE phone='+905551110098'")).rows.length,0,'Audit failure must roll back staff creation');
 assert.equal((await req('POST',staffPath,admin.token,{...teacherInput,email:''})).status,400);
 assert.equal((await req('POST',staffPath,admin.token,{...teacherInput,email:'bad'})).status,400);
 assert.equal((await req('POST',staffPath,foreignAdmin.token,teacherInput)).status,403);
 assert.equal((await req('POST',staffPath,admin.token,teacherInput)).status,201);
 assert.equal((await req('POST',staffPath,admin.token,{role:'security',fullName:'Sentetik Güvenlik',phone:securityPhone})).status,201);
 assert.equal(emails.length,0);assert.equal(codes.size,0);
 const teacherId=(await db.query<any>('SELECT id FROM teacher_profiles WHERE phone=$1',[teacherPhone])).rows[0].id;
 assert.equal((await db.query<any>('SELECT user_id FROM teacher_profiles WHERE id=$1',[teacherId])).rows[0].user_id,null);
 assert.equal((await db.query<any>('SELECT email FROM pending_staff WHERE phone=$1',[securityPhone])).rows[0].email,null);
 const activeSecurity=await fixture('+905551110085','security');
 const legacyPending=await userRepository.create({phone:'+905551110086',firstName:'SENTETİK',lastName:'BEKLEYEN',isPhoneVerified:false});
 await membershipRepository.createOrActivate({schoolId:school,userId:legacyPending.id,role:'security'});
 await fixture('+905551110087','security',other);
 assert.equal((await req('POST',`/schools/${other}/staff`,foreignAdmin.token,{role:'security',fullName:'Başka Okul Bekleyen',phone:'+905551110088'})).status,201);
 const securityRoster=await req('GET',`/schools/${school}/users?role=security`,admin.token);
 assert.equal(securityRoster.status,200);
 assert.equal(securityRoster.body.users.length,3,'Active, legacy pending and pending_staff must each appear once');
 assert.equal(new Set(securityRoster.body.users.map((u:any)=>u.id)).size,3);
 assert.equal(securityRoster.body.users.filter((u:any)=>u.phone===securityPhone&&u.accountStatus==='pending').length,1,'Pending staff must not be appended twice');
 assert.equal(securityRoster.body.users.filter((u:any)=>u.id===activeSecurity.id&&u.accountStatus==='active').length,1);
 assert.equal(securityRoster.body.users.filter((u:any)=>u.id===legacyPending.id&&u.accountStatus==='pending').length,1);
 assert(!securityRoster.body.users.some((u:any)=>['+905551110087','+905551110088'].includes(u.phone)));
 assert.equal((await req('GET',`/schools/${school}/users?role=security`,foreignAdmin.token)).status,403);
 assert.equal((await req('GET',`/schools/${school}/users?role=security`,parent.token)).status,403);
 fs.mkdirSync(path.join(root,'audit/master'),{recursive:true});
 fs.writeFileSync(path.join(root,'audit/master/security-roster-response.json'),JSON.stringify({synthetic:true,users:securityRoster.body.users}));
 assert.equal((await db.query('SELECT 1 FROM invitations WHERE purpose=\'staff_activation\'')).rows.length,0);
 ok('teacher required contact/phone; security no email; tenant guard; pending profiles; no email/code activation');

 stage='existing parent and staff role';
 assert.equal((await req('POST',staffPath,admin.token,{role:'teacher',fullName:'Sentetik Veli',phone:parent.phone,branch:'Fen',email:'dual-role@example.test'})).status,201);
 const dualStart=await start(parent.phone),dual=await verify(parent.phone,dualStart);assert.equal(dual.status,200);
 assert.equal(dual.body.user.id,parent.id);assert(dual.body.memberships.some((m:any)=>m.role==='parent'));assert(dual.body.memberships.some((m:any)=>m.role==='teacher'));
 assert.equal((await req('GET',`/schools/${school}/appointments`,dual.body.token,undefined,'teacher')).status,200);
 assert.equal((await req('GET',`/schools/${school}/appointments`,dual.body.token,undefined,'security')).status,403);
 const dualProfile=(await db.query<any>('SELECT id FROM teacher_profiles WHERE user_id=$1',[parent.id])).rows[0].id;
 // Historical profile labels need not equal the global person's name. A contact edit
 // must not copy that profile label into a parent/staff shared login identity.
 await db.query("UPDATE teacher_profiles SET first_name='ESKİ',last_name='PROFİL' WHERE id=$1",[dualProfile]);
 assert.equal((await req('PATCH',`/schools/${school}/management/teacher/${dualProfile}`,admin.token,{fullName:'Eski Profil',phone:parent.phone,branch:'Fen',email:'updated-dual@example.test'})).status,200);
 assert.equal((await db.query<any>('SELECT last_name FROM users WHERE id=$1',[parent.id])).rows[0].last_name,'VELİ');
 ok('existing parent gains only server-assigned matching staff profile after OTP; explicit valid role selection and forged role denial');

 stage='first staff OTP';
 const teacherStart=await start(teacherPhone);assert.equal(teacherStart.status,200);assert.equal(teacherStart.body.deliveryStatus,'accepted');assert(teacherStart.body.attemptId);
 assert.equal((await db.query<any>('SELECT user_id FROM teacher_profiles WHERE id=$1',[teacherId])).rows[0].user_id,null);
 assert.equal((await verify(teacherPhone,teacherStart,'999999'===codes.get(teacherPhone)?'888888':'999999')).status,401);
 const teacher=await verify(teacherPhone,teacherStart);assert.equal(teacher.status,200);assert(teacher.body.token);
 const userId=teacher.body.user.id,teacherToken=teacher.body.token;
 assert(teacher.body.memberships.some((m:any)=>m.role==='teacher'&&m.schoolId===school));
 assert.equal((await verify(teacherPhone,teacherStart)).status,401);
 assert.equal((await db.query<any>('SELECT email FROM users WHERE id=$1',[userId])).rows[0].email,null);
 assert.equal((await db.query<any>('SELECT email FROM teacher_profiles WHERE id=$1',[teacherId])).rows[0].email,teacherInput.email);
 assert.equal(emails.length,0);
 const securityStart=await start(securityPhone),security=await verify(securityPhone,securityStart);assert.equal(security.status,200);
 const activatedRoster=await req('GET',`/schools/${school}/users?role=security`,admin.token);
 assert.equal(activatedRoster.body.users.filter((u:any)=>u.phone===securityPhone&&u.accountStatus==='active').length,1);
 assert.equal(activatedRoster.body.users.filter((u:any)=>u.phone===securityPhone&&u.accountStatus==='pending').length,0);
 assert.equal(activatedRoster.body.users.length,3,'OTP activation must replace the pending row, not duplicate it');
 assert.equal((await req('POST',staffPath,admin.token,{role:'security',fullName:'Yinelenen Güvenlik',phone:securityPhone})).status,409);
 assert.equal((await req('POST',`/schools/${school}/security/qr/verify`,security.body.token,{qrToken:'invalid'})).status,200);
 assert.equal((await req('POST',`/schools/${other}/security/qr/verify`,security.body.token,{qrToken:'invalid'})).status,403);
 assert.equal((await req('GET',`/schools/${school}/appointments`,teacherToken,undefined,'admin')).status,403);
 assert.equal((await req('GET',`/schools/${other}/appointments`,teacherToken)).status,403);
 const password=crypto.randomBytes(16).toString('hex');await userRepository.updatePasswordHash(userId,hashPassword(password));
 assert.equal((await req('POST','/auth/login',undefined,{phone:teacherPhone,password})).status,401);
 const oldPasswordToken=createToken({userId,phone:teacherPhone,auth_version:0,auth_method:'password'});
 assert.equal((await req('GET',`/schools/${school}/appointments`,oldPasswordToken)).status,403);
 for(const route of ['activation-verify','activation-complete','reset-request','reset-verify','reset-complete'])assert.equal((await req('POST','/auth/staff/'+route,undefined,{})).status,404);
 assert.equal((await req('POST','/auth/activate-account',undefined,{})).status,404);
 ok('staff automatic activation only after OTP; no password/school/email factor; QR and tenant/role security; legacy credentials rejected');

 stage='teacher email separation';
 const versionBefore=(await db.query<any>('SELECT auth_version FROM users WHERE id=$1',[userId])).rows[0].auth_version;
 const updated={fullName:'Sentetik Öğretmen',phone:teacherPhone,branch:'Matematik',email:'new-notifications@example.test'};
 assert.equal((await req('PATCH',`/schools/${school}/management/teacher/${teacherId}`,admin.token,updated)).status,200);
 assert.equal((await db.query<any>('SELECT auth_version FROM users WHERE id=$1',[userId])).rows[0].auth_version,versionBefore);
 assert.equal((await db.query<any>('SELECT email FROM users WHERE id=$1',[userId])).rows[0].email,null);
 assert.equal((await req('GET',`/schools/${school}/appointments`,teacherToken)).status,200);
 assert.equal((await req('PATCH',`/schools/${school}/management/teacher/${teacherId}`,admin.token,{...updated,email:''})).status,400);
 ok('notification email change preserves identity and current session; empty email denied');

 stage='appointment notifications';
 await db.query("INSERT INTO students(id,school_id,name,class_name,student_number) VALUES('child',$1,'SENTETİK ÖĞRENCİ','5-A','1')",[school]);
 await db.query("INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES($1,'child',$2)",[school,parent.id]);
 await db.query("INSERT INTO availability_slots(school_id,teacher_id,day_of_week,start_time,end_time,slot_duration) VALUES($1,$2,EXTRACT(DOW FROM DATE '2090-01-02'),'10:00','14:00',15)",[school,teacherId]);
 assert(await registerPushDevice(userId,{installationId:crypto.randomUUID(),platform:'ANDROID',provider:'FCM',targetKind:'REGISTRATION_TOKEN',providerTarget:'fixture-registration-token-long-enough',appId:'com.velirandevu.app'}));
 const booking={teacherId,studentId:'child',studentName:'SENTETİK ÖĞRENCİ',className:'5-A',date:'2090-01-02',startTime:'10:00',endTime:'10:15'};
 const booked=await req('POST',`/schools/${school}/appointments`,parent.token,booking);assert.equal(booked.status,200);
 assert.deepEqual(emails.at(-1).to,[updated.email]);const emailCount=emails.length;
 let pushCount=0;const provider={send:async()=>{pushCount++;return{status:'SENT' as const,messageId:'fixture-push'};}};
 // The API's default provider saw no Firebase config and scheduled a safe retry.
 await db.query("UPDATE notification_deliveries SET next_attempt_at=NOW() WHERE status='FAILED'");
 await dispatchPushDeliveries(provider);assert.equal(pushCount,1);await dispatchPushDeliveries(provider);assert.equal(pushCount,1);
 assert.equal((await req('POST',`/schools/${school}/appointments`,parent.token,booking)).status,409);assert.equal(emails.length,emailCount);
 failEmail=true;assert.equal((await req('POST',`/schools/${school}/appointments`,parent.token,{...booking,startTime:'10:15',endTime:'10:30'})).status,200);failEmail=false;
 // A booked appointment 20 minutes from now exercises the existing reminder scheduler.
 const now=new Date(Date.now()+20*60_000),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
 await db.query("UPDATE appointments SET status='booked',date=$2,start_time=$3,end_time=$3 WHERE id=$1",[booked.body.appointment.id,date,time]);
 const reminder=await runAppointmentReminderJob({schoolId:school});assert(reminder.sent>=1);assert.deepEqual(emails.at(-1).to,[updated.email]);
 const reminderCount=emails.length;await runAppointmentReminderJob({schoolId:school});assert.equal(emails.length,reminderCount);
 ok('appointment email current profile address; push linked user; duplicate event and reminder prevention; email failure does not fail booking');

 stage='phone update and invalidation';
 await db.query('UPDATE whatsapp_auth_challenges SET resend_available_at=NOW()-INTERVAL \'1 minute\' WHERE target_phone=$1',[teacherPhone]);
 const oldProof=await start(teacherPhone),newPhone='+905551110006';
 assert.equal((await req('PATCH',`/schools/${school}/management/teacher/${teacherId}`,admin.token,{...updated,phone:newPhone})).status,200);
 assert.equal((await req('GET',`/schools/${school}/appointments`,teacherToken)).status,401);
 assert.equal((await verify(teacherPhone,oldProof)).status,401);
 assert.equal((await db.query<any>('SELECT is_phone_verified FROM users WHERE id=$1',[userId])).rows[0].is_phone_verified,false);
 assert.equal((await db.query('SELECT 1 FROM mobile_push_devices WHERE user_id=$1 AND active=TRUE',[userId])).rows.length,0);
 await assert.rejects(registerPushDevice(userId,{installationId:crypto.randomUUID(),platform:'ANDROID',provider:'FCM',targetKind:'REGISTRATION_TOKEN',providerTarget:'old-request-target-must-not-reactivate',appId:'com.velirandevu.app'},versionBefore),StalePushSessionError);
 assert.equal((await db.query('SELECT 1 FROM mobile_push_devices WHERE user_id=$1 AND active=TRUE',[userId])).rows.length,0);
 const newStart=await start(newPhone),newLogin=await verify(newPhone,newStart);assert.equal(newLogin.status,200);assert.equal(newLogin.body.user.id,userId);
 assert.equal((await db.query<any>('SELECT id FROM teacher_profiles WHERE user_id=$1',[userId])).rows[0].id,teacherId);
 assert.equal((await db.query<any>('SELECT teacher_id FROM appointments WHERE id=$1',[booked.body.appointment.id])).rows[0].teacher_id,teacherId);
 assert.equal((await req('POST','/auth/logout',newLogin.body.token)).status,200);
 assert.equal((await req('GET',`/schools/${school}/appointments`,newLogin.body.token)).status,401);
 ok('phone reassignment revokes OTP/JWT/devices; phone reverified without changing IDs or appointments; online logout revokes JWT');

 stage='explicit ineligible account and delivery errors';
 const before=providerCalls,unknownPhone='+905551119999';const unknown=await start(unknownPhone);
 assert.equal(unknown.status,400);assert.deepEqual(unknown.body,{error:'Bu numara sisteme kayıtlı değil.'});assert.equal(providerCalls,before);
 assert.equal((await db.query('SELECT 1 FROM whatsapp_auth_challenges WHERE target_phone=$1',[unknownPhone])).rows.length,0);
 for(let i=0;i<4;i++)assert.equal((await start(unknownPhone)).status,400);
 assert.equal((await start(unknownPhone)).status,429,'Unknown numbers retain per-phone request limit');assert.equal(providerCalls,before);
 assert.equal((await start('not-a-phone')).status,400);
 await db.query("UPDATE school_memberships SET status='inactive' WHERE user_id=$1",[security.body.user.id]);
 const inactive=await start(securityPhone);assert([400,403].includes(inactive.status));assert(!inactive.body.challengeId);
 assert.equal(providerCalls,before,'Inactive staff must not trigger a provider call');
 failProvider=true;const failingPhone='+905551110009';await req('POST',staffPath,admin.token,{role:'security',fullName:'Sentetik Hata',phone:failingPhone});
 const failed=await start(failingPhone);assert.equal(failed.status,503);assert.match(failed.body.error,/gönderilemedi/);assert(!failed.body.success);assert(!failed.body.attemptId);
 assert.equal((await db.query('SELECT 1 FROM whatsapp_auth_challenges WHERE target_phone=$1 AND revoked_at IS NULL',[failingPhone])).rows.length,0);failProvider=false;
 const callsBeforeDeleted=providerCalls;
 await db.query('DELETE FROM users WHERE id=$1',[security.body.user.id]);
 const deleted=await start(securityPhone);assert.equal(deleted.status,400);assert(!deleted.body.challengeId);assert.equal(providerCalls,callsBeforeDeleted);
 let ipBlocked=false;for(let i=0;i<30;i++){const scan=await start('+90555118'+String(i).padStart(4,'0'));if(scan.status===429){ipBlocked=true;break;}assert.equal(scan.status,400);}
 assert(ipBlocked,'IP request limit must also stop scanning across different unknown phones');assert.equal(providerCalls,callsBeforeDeleted);
 ok('unknown exact error/no challenge/provider; phone/IP rate limits; invalid format; inactive/deleted denied; provider 503 and challenge revoked');

 stage='audit scope';
 const auditCount=(await db.query<any>('SELECT COUNT(*)::int AS count FROM audit_logs WHERE school_id=$1',[school])).rows[0].count;
 assert.equal((await req('GET',`/schools/${school}/audit-logs`,admin.token)).status,403);
 assert.equal((await req('DELETE',`/schools/${school}/management/audit-logs`,admin.token)).status,403);
 assert.equal((await db.query<any>('SELECT COUNT(*)::int AS count FROM audit_logs WHERE school_id=$1',[school])).rows[0].count,auditCount);
 process.env.PLATFORM_ADMIN_USER_IDS=admin.id;
 const platform=createToken({userId:admin.id,phone:admin.phone,auth_version:0,auth_method:'phone_centric_platform'});
 assert.equal((await req('GET','/platform/audit-logs',platform)).status,200);
 assert.equal((await req('GET',`/platform-target/${school}/schools/${school}/audit-logs`,platform)).status,200);
 assert((await db.query("SELECT 1 FROM audit_logs WHERE school_id=$1 AND action='staff_whatsapp_activation_completed'",[school])).rows.length>=2);
 ok('school admin audit denied; platform audit retained; security audit still produced');

 stage='RLS';
 await db.query('CREATE ROLE local_anon');await db.query('CREATE ROLE local_authenticated');
 for(const role of ['local_anon','local_authenticated']){
  await db.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON users,teacher_profiles,pending_staff,school_memberships,appointments,whatsapp_auth_challenges TO ${role}`);
  await db.transaction(async tx=>{
   await tx.query(`SET LOCAL ROLE ${role}`);
   for(const table of ['users','teacher_profiles','pending_staff','school_memberships','appointments','whatsapp_auth_challenges']){
    assert.equal((await tx.query(`SELECT * FROM ${table}`)).rows.length,0);
    assert.equal((await tx.query(`DELETE FROM ${table} RETURNING *`)).rows.length,0);
   }
   assert.equal((await tx.query("UPDATE users SET first_name='forbidden' RETURNING id")).rows.length,0);
  });
  await assert.rejects(db.transaction(async tx=>{await tx.query(`SET LOCAL ROLE ${role}`);await tx.query("INSERT INTO users(id,phone) VALUES('forbidden','+905551119998')");}),/row-level security/);
 }
 ok('direct untrusted roles RLS SELECT/INSERT/UPDATE/DELETE denied on real embedded PostgreSQL');
 fs.mkdirSync(path.join(root,'audit/master'),{recursive:true});fs.writeFileSync(path.join(root,'audit/master/staff-results.json'),JSON.stringify({checks,kind:'local PostgreSQL + actual API + mock external providers',physicalDevice:false},null,2));
 console.log('Staff OTP master PASS: '+checks.length+' integrated groups; no live database or external messages.');
}catch(error){console.error('Staff OTP master failed at '+stage);throw error;}
finally{globalThis.fetch=originalFetch;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await closeDatabase();process.chdir(root);}
