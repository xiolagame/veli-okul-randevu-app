import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { Appointment, UserRole } from '../src/types';
async function run() {
  assert(!process.env.DATABASE_URL && process.env.NODE_ENV==='test','Isolated local test only');
  const {getDb}=await import('../server/database/postgres');
  const {userRepository,membershipRepository,appointmentRepository}=await import('../server/repositories');
  const {createToken}=await import('../server/auth');
  const {createExpressApp}=await import('../server/app');
  const db=await getDb();assert.equal(db.engineType,'PostgreSQL (Embedded Persistent Engine)');
  const suffix=crypto.randomUUID(), schoolA='matrix-a-'+suffix,schoolB='matrix-b-'+suffix;
  for(const id of [schoolA,schoolB]) await db.query("INSERT INTO schools(id,name,code,city,district) VALUES($1,'SYNTHETIC',$2,'TEST','TEST')",[id,id]);
  async function person(role:UserRole,school=schoolA) {
    const user=await userRepository.create({phone:'+905'+crypto.randomInt(100000000,999999999),firstName:'SYNTHETIC',lastName:'FIXTURE',isPhoneVerified:true});
    await membershipRepository.createOrActivate({userId:user.id,schoolId:school,role});
    return {user,token:createToken({userId:user.id,phone:user.phone,auth_version:0,auth_method:'phone_centric'})};
  }
  const admin=await person('admin'),teacher=await person('teacher'),security=await person('security'),parent=await person('parent');
  const otherParent=await person('parent'),otherTeacher=await person('teacher'),foreignSecurity=await person('security',schoolB);
  const teacherId='profile-'+suffix;
  for(const [id,actor] of [[teacherId,teacher],['other-'+teacherId,otherTeacher]] as const) await db.query("INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch,phone) VALUES($1,$2,$3,'TEST','TEACHER','Türkçe',$4)",[id,schoolA,actor.user.id,actor.user.phone]);
  const platform=await userRepository.create({phone:'+905'+crypto.randomInt(100000000,999999999),firstName:'SYNTHETIC',lastName:'PLATFORM'});
  process.env.PLATFORM_ADMIN_USER_IDS=platform.id;
  const elevated=createToken({userId:platform.id,phone:platform.phone,auth_version:0,auth_method:'phone_centric_platform'});
  const unelevated=createToken({userId:platform.id,phone:platform.phone,auth_version:0,auth_method:'phone_centric'});
  const server=http.createServer(createExpressApp());await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port+'/api';
  const results:object[]=[];
  async function req(label:string,method:string,url:string,token:string|undefined,expected:number,body?:object,headers:Record<string,string>={}) {
    const r=await fetch(base+url,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),...headers},body:body?JSON.stringify(body):undefined});
    const value=await r.json();assert.equal(r.status,expected,label+" expected "+expected+" actual "+r.status);results.push({case:label,method,path:url.replaceAll(schoolA,'A').replaceAll(schoolB,'B'),expected,actual:r.status});return value;
  }
  try {
    for(const [label,actor] of Object.entries({admin,teacher,security,parent})) {
      for(const endpoint of ['info','users?role=security','roster','management/student-records','management/admins','management/operations']) await req(label+' '+endpoint,'GET',`/schools/${schoolA}/${endpoint}`,actor.token,label==='admin'?200:403);
      for(const endpoint of ['teachers','appointments','settings','availability']) await req(label+' own '+endpoint,'GET',`/schools/${schoolA}/${endpoint}`,actor.token,200);
      await req(label+' cross-school','GET',`/schools/${schoolB}/appointments`,actor.token,403);
      await req(label+' platform denied','GET','/platform/schools',actor.token,403);
      await req(label+' target escalation denied','GET',`/platform-target/${schoolA}/schools/${schoolA}/users?role=security`,actor.token,403);
      await req(label+' URL/header mismatch','GET',`/schools/${schoolA}/settings`,actor.token,400,undefined,{'X-School-Id':schoolB});
      await req(label+' QR role','POST',`/schools/${schoolA}/security/qr/verify`,actor.token,label==='security'?200:403,{qrToken:'invalid'});
    }
    await req('anonymous','GET',`/schools/${schoolA}/appointments`,undefined,401);
    await req('platform elevated','GET','/platform/schools',elevated,200);
    await req('platform not elevated','GET','/platform/schools',unelevated,403);
    await req('platform requires target context','GET',`/schools/${schoolA}/users?role=security`,elevated,403);
    await req('platform explicit target','GET',`/platform-target/${schoolA}/schools/${schoolA}/users?role=security`,elevated,200);
    await req('platform target mismatch','GET',`/platform-target/${schoolA}/schools/${schoolB}/users?role=security`,elevated,403);
    await req('platform cannot scan as security','POST',`/platform-target/${schoolA}/schools/${schoolA}/security/qr/verify`,elevated,403,{qrToken:'invalid'});
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const appointment:Appointment={id:'apt-'+suffix,schoolId:schoolA,teacherId,teacherName:'TEST TEACHER',teacherBranch:'Türkçe',parentId:parent.user.id,parentName:'TEST PARENT',parentPhone:parent.user.phone,studentName:'TEST STUDENT',className:'5-A',date,startTime:'00:00',endTime:'23:59',status:'booked',createdAt:new Date().toISOString()};
    await appointmentRepository.createAppointment(appointment);
    const saved=await appointmentRepository.getAppointmentById(schoolA,appointment.id);assert(saved?.qrToken);
    const path=`/schools/${schoolA}/security/qr/verify`;
    const first=await req('security valid QR','POST',path,security.token,200,{qrToken:saved.qrToken});assert.equal(first.allowed,true);
    const replay=await req('security repeat is read-only','POST',path,security.token,200,{qrToken:saved.qrToken});assert.equal(replay.allowed,true);
    assert.equal((await appointmentRepository.getAppointmentById(schoolA,appointment.id))?.status,'booked');
    const foreign=await req('foreign QR cannot disclose appointment','POST',`/schools/${schoolB}/security/qr/verify`,foreignSecurity.token,200,{qrToken:saved.qrToken});assert.equal(foreign.decision,'INVALID');assert(!foreign.appointment);
    for(const status of ['pending','cancelled','rejected','checked_in','checked_out']) {
      await db.query('UPDATE appointments SET status=$1 WHERE id=$2',[status,appointment.id]);
      const answer=await req('QR state '+status,'POST',path,security.token,200,{qrToken:saved.qrToken});assert.equal(answer.allowed,false);
    }
    await req('other parent cannot cancel','POST',`/schools/${schoolA}/appointments/${appointment.id}/cancel`,otherParent.token,403,{});
    await req('other teacher cannot approve','POST',`/schools/${schoolA}/appointments/${appointment.id}/approve`,otherTeacher.token,403,{});
    const parentList=await req('parent owns list','GET',`/schools/${schoolA}/appointments`,otherParent.token,200);assert(!parentList.appointments.some((a:Appointment)=>a.id===appointment.id));
    const teacherList=await req('teacher owns list','GET',`/schools/${schoolA}/appointments`,otherTeacher.token,200);assert(!teacherList.appointments.some((a:Appointment)=>a.id===appointment.id));
    await req('expired token','GET',`/schools/${schoolA}/settings`,createToken({userId:parent.user.id,phone:parent.user.phone,auth_version:0},-1),401);
    fs.writeFileSync('role-api-results.json',JSON.stringify(results,null,2));
    console.log('Five-role direct HTTP matrix, explicit platform elevation/target, foreign school, ownership, QR privacy/state/read-only repeat and expired token PASS ('+results.length+' assertions).');
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
run().then(()=>process.exit(0)).catch(error=>{console.error('Role API matrix FAIL:',error instanceof Error?error.message:'unknown');process.exit(1);});
