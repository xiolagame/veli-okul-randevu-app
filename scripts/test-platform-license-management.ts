import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import http from 'node:http';import express from 'express';
import { extendLicenseCalendar, licenseExpiryFromDay, licenseLastDay } from '../src/utils/license-management';
let stage='calendar';
async function main(){
 assert.equal(extendLicenseCalendar('2028-01-31T09:00:00.000Z',1,new Date('2027-01-01Z')),'2028-02-29T09:00:00.000Z');
 assert.equal(extendLicenseCalendar('2028-02-29T09:00:00.000Z',12,new Date('2027-01-01Z')),'2029-02-28T09:00:00.000Z');
 assert.equal(extendLicenseCalendar(null,3,new Date('2026-12-31T22:00:00.000Z')),'2027-03-31T22:00:00.000Z');
 assert.equal(extendLicenseCalendar('2020-01-01Z',1,new Date('2026-01-31T21:30:00.000Z')),'2026-02-28T21:30:00.000Z');
 assert.equal(licenseExpiryFromDay('2028-02-29'),'2028-02-29T21:00:00.000Z');assert.equal(licenseLastDay('2028-02-29T21:00:00.000Z'),'2028-02-29');
 assert.throws(()=>licenseExpiryFromDay('2027-02-29'));
 if(process.env.DATABASE_URL||process.env.NODE_ENV==='production')throw Error('Local isolated PGlite required');
 const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'veli-licenses-'));fs.mkdirSync(path.join(temp,'server/database'),{recursive:true});
 fs.copyFileSync(path.join(root,'server/database/supabase_schema.sql'),path.join(temp,'server/database/supabase_schema.sql'));fs.cpSync(path.join(root,'server/database/migrations'),path.join(temp,'server/database/migrations'),{recursive:true});process.chdir(temp);
 process.env.NODE_ENV='test';process.env.JWT_SECRET=crypto.randomBytes(48).toString('hex');process.env.AUTH_CODE_SECRET=crypto.randomBytes(48).toString('hex');delete process.env.PHONE_CENTRIC_AUTH_ENABLED;
 const{getDb}=await import('../server/database/postgres');const{userRepository,membershipRepository,schoolLicenseRepository}=await import('../server/repositories');
 const{createToken}=await import('../server/auth');const{apiRouter}=await import('../server/api');const db=await getDb();assert.equal(db.engineType,'PostgreSQL (Embedded Persistent Engine)');
 async function user(role:'admin'|'parent'|'teacher'|'security'|null){const u=await userRepository.create({phone:'+905'+crypto.randomInt(100000000,999999999),firstName:'TEST',lastName:'USER',isPhoneVerified:true});if(role)await membershipRepository.createOrActivate({schoolId:'school-a',userId:u.id,role});return{...u,token:createToken({userId:u.id,phone:u.phone,auth_version:0})};}
 for(const id of ['school-a','school-b','legacy'])await db.query("INSERT INTO schools(id,name,code,city,district)VALUES($1,$2,$3,'Test','Test')",[id,id,id]);
 const platform=await user(null),admin=await user('admin'),parent=await user('parent'),teacher=await user('teacher'),security=await user('security');process.env.PLATFORM_ADMIN_USER_IDS=platform.id;
 await db.query("INSERT INTO school_licenses(id,school_id,license_code,status,expires_at) VALUES('license-a','school-a','VR-TEST-AAAA','active',NOW()+interval '10 days'),('license-b','school-b','VR-TEST-BBBB','suspended',NOW()-interval '1 day')");
 await db.query("INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch)VALUES('profile','school-a',$1,'TEST','TEACHER','Test')",[teacher.id]);
 await db.query("INSERT INTO students(id,school_id,name,class_name,student_number)VALUES('child','school-a','SYNTHETIC','5-A','001')");
 await db.query("INSERT INTO student_parent_relations(school_id,student_id,parent_user_id)VALUES('school-a','child',$1)",[parent.id]);
 await db.query("INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,parent_phone,student_id,student_name,class_name,date,start_time,end_time,status,entry_code,qr_token)VALUES('meeting','school-a','profile','TEST','Test',$1,'TEST',$2,'child','SYNTHETIC','5-A','2999-01-01','10:00','10:15','booked','123456','SYNTHETIC-QR')",[parent.id,parent.phone]);
 const app=express();app.use(express.json());app.use('/api',apiRouter);const server=http.createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+(server.address()as import('node:net').AddressInfo).port+'/api';
 async function request(route:string,token=platform.token,body?:object){const response=await fetch(base+route,{method:body?'PATCH':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:response.status,body:await response.json()};}
 const list=async(query='')=>{const result=await request('/platform/licenses'+query);assert.equal(result.status,200,stage);return result.body;};
 const item=async(id='school-a')=>(await list('?q='+id)).items.find((i:{schoolId:string})=>i.schoolId===id);
 try{
  stage='authorization';for(const u of[admin,parent,teacher,security]){assert.equal((await request('/platform/licenses',u.token)).status,403);assert.equal((await request('/platform/licenses/school-b',u.token,{action:'suspend'})).status,403);}
  const restricted=createToken({userId:platform.id,phone:platform.phone,auth_version:0,auth_method:'whatsapp_otp'});assert.equal((await request('/platform/licenses',restricted)).status,403);
  stage='list filters and legacy';const all=await list();assert.equal(all.total,3);assert.equal(all.summary.expiring,1);assert.equal(all.summary.suspended,1);assert.equal(all.summary.expired,1);
  assert.equal((await item()).viewStatus,'expiring');assert.equal((await list('?threshold=7&q=school-a')).items[0].viewStatus,'active');assert.equal((await list('?status=suspended')).total,1);assert.equal((await list('?problems=true')).total,3);
  assert.equal((await list('?sort=asc')).items[0].schoolId,'school-b');assert.equal((await list('?sort=desc')).items[0].schoolId,'school-a');assert.equal((await list('?page=1')).items.length,0);
  assert.equal((await request('/platform/licenses?threshold=8')).status,400);assert.equal((await request('/platform/licenses?page=-1')).status,400);
  assert(await schoolLicenseRepository.isAccessAllowed('legacy'),'legacy access must be unchanged');assert.equal((await item('legacy')).viewStatus,'legacy');
  stage='expiry validation shortening';let a=await item();const future=new Date(Date.now()+50*86400000).toISOString();
  for(const expiresAt of['not-a-date','2026-02-30T00:00:00.000Z','2000-01-01T00:00:00.000Z'])assert.equal((await request('/platform/licenses/school-a',platform.token,{action:'expiry',expectedRevision:a.revision,note:'',expiresAt})).status,400);
  const shortened=new Date(Date.now()+5*86400000).toISOString();assert.equal((await request('/platform/licenses/school-a',platform.token,{action:'expiry',expectedRevision:a.revision,note:'',expiresAt:shortened})).status,400);
  const update={action:'expiry',expectedRevision:a.revision,note:'Synthetic extension',expiresAt:future};const updated=await request('/platform/licenses/school-a',platform.token,update);assert.equal(updated.status,200);assert(updated.body.auditId);assert.equal(updated.body.license.expiresAt,future);
  assert.equal((await request('/platform/licenses/school-a',platform.token,update)).status,409,'same revision must not update twice');
  stage='suspension guard and no deletion';a=await item();const before=await db.query('SELECT (SELECT count(*) FROM users)::int AS users,(SELECT count(*) FROM students)::int AS students,(SELECT count(*) FROM appointments)::int AS appointments');
  assert.equal((await request('/schools/school-a/info',admin.token)).status,200);
  assert.equal((await request('/platform/licenses/school-a',platform.token,{action:'suspend',expectedRevision:a.revision,note:''})).status,400);
  assert.equal((await request('/platform/licenses/school-a',platform.token,{action:'suspend',expectedRevision:a.revision,note:'Synthetic hold'})).status,200);
  assert.equal(await schoolLicenseRepository.isAccessAllowed('school-a'),false);for(const u of[admin,parent,teacher,security])assert.equal((await request('/schools/school-a/info',u.token)).status,403);
  assert.deepEqual((await db.query('SELECT (SELECT count(*) FROM users)::int AS users,(SELECT count(*) FROM students)::int AS students,(SELECT count(*) FROM appointments)::int AS appointments')).rows,before.rows);
  assert.equal((await request('/platform/licenses')).status,200,'platform license repair access remains available');
  a=await item();assert.equal((await request('/platform/licenses/school-a',platform.token,{action:'resume',expectedRevision:a.revision,note:'Synthetic resume'})).status,200);assert.equal((await request('/schools/school-a/info',admin.token)).status,200);
  stage='expired suspension requires explicit future expiry';let b=await item('school-b');assert.equal(b.expired,true);assert.equal(b.viewStatus,'suspended');assert.equal((await request('/platform/licenses/school-b',platform.token,{action:'resume',expectedRevision:b.revision,note:''})).status,409);
  assert.equal((await request('/platform/licenses/school-b',platform.token,{action:'expiry',expectedRevision:b.revision,note:'',expiresAt:future})).status,200);b=await item('school-b');assert.equal(b.status,'suspended');assert.equal((await request('/platform/licenses/school-b',platform.token,{action:'resume',expectedRevision:b.revision,note:''})).status,200);
  stage='concurrency and transaction rollback';a=await item();const concurrent=await Promise.all([request('/platform/licenses/school-a',platform.token,{action:'expiry',expectedRevision:a.revision,note:'first',expiresAt:new Date(Date.now()+60*86400000).toISOString()}),request('/platform/licenses/school-a',platform.token,{action:'expiry',expectedRevision:a.revision,note:'second',expiresAt:new Date(Date.now()+70*86400000).toISOString()})]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  a=await item();await db.query("CREATE FUNCTION reject_license_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='license.suspend' THEN RAISE EXCEPTION 'synthetic audit rollback'; END IF; RETURN NEW; END $$");await db.query('CREATE TRIGGER reject_license_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_license_audit()');
  assert.equal((await request('/platform/licenses/school-a',platform.token,{action:'suspend',expectedRevision:a.revision,note:'Synthetic rollback'})).status,500);assert.equal((await item()).status,'active');await db.query('DROP TRIGGER reject_license_audit ON audit_logs');
  assert((await db.query("SELECT id FROM audit_logs WHERE action='license.change_failed' AND audit_scope='PLATFORM'")).rows.length>0);
  assert((await db.query("SELECT id FROM audit_logs WHERE action='license.expiry' AND actor_user_id=$1 AND school_id='school-a' AND audit_scope='PLATFORM'",[platform.id])).rows.length>0);
  stage='legacy and revoked protection';const legacy=await item('legacy');assert.equal((await request('/platform/licenses/legacy',platform.token,{action:'expiry',expectedRevision:legacy.revision,note:'',expiresAt:future})).status,409);
  await db.query("UPDATE school_licenses SET status='revoked' WHERE school_id='school-b'");b=await item('school-b');assert.equal(b.viewStatus,'revoked');assert.equal((await request('/platform/licenses/school-b',platform.token,{action:'resume',expectedRevision:b.revision,note:''})).status,409);
  stage='unlimited expiry semantics';await db.query("UPDATE school_licenses SET status='active',expires_at=NULL WHERE school_id='school-b'");b=await item('school-b');assert.equal(b.viewStatus,'active');assert.equal(b.remainingDays,null);assert(await schoolLicenseRepository.isAccessAllowed('school-b'));
  assert.equal((await request('/platform/licenses/school-b',platform.token,{action:'expiry',expectedRevision:b.revision,note:'',expiresAt:future})).status,400,'unlimited to finite requires shortening consent');
  assert.equal((await request('/platform/licenses/school-b',platform.token,{action:'expiry',expectedRevision:b.revision,note:'',expiresAt:future,confirmedShortening:true})).status,200);
  console.log('Platform licenses PASS: calendar/TR UTC boundaries, list/search/filter/order, status semantics, strict validation, shortening consent, suspend/resume, actual tenant guards, platform isolation, optimistic concurrency/replay, transaction audit rollback and legacy/revoked protection. Synthetic PGlite only.');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));process.chdir(root);}
}
main().catch((error:unknown)=>{const line=error instanceof Error?error.stack?.split('\n').find(l=>l.includes('test-platform-license-management.ts:')):'';const code=error&&typeof error==='object'&&'code'in error?String(error.code):'';console.error('License management FAILED at '+stage+'. '+(line||'')+' '+code+' No credentials or personal data logged.');process.exitCode=1;});
