import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {createReviewAccess,type ReviewIdentity,type ReviewDependencies} from '../server/review-access';
import {createReviewOperations} from '../server/review-operations';
import {hashPassword} from '../server/passwords';
import {seedReviewFixtures} from '../server/review-fixtures';
import {resetReviewFixtures} from '../server/review-maintenance';
if(process.env.DATABASE_URL||process.env.NODE_ENV==='production')throw Error('Local synthetic database only');
const root=process.cwd(),cwd=fs.mkdtempSync(path.join(os.tmpdir(),'veli-review-integration-'));
fs.cpSync(path.join(root,'server/database'),path.join(cwd,'server/database'),{recursive:true});
process.chdir(cwd);process.env.NODE_ENV='test';process.env.JWT_SECRET='isolated-review-integration-secret-32characters';
const {getDb}=await import('../server/database/postgres');
const {apiRouter}=await import('../server/api');
const {createToken,verifyToken}=await import('../server/auth');
const {userRepository,membershipRepository}=await import('../server/repositories');
const identities:ReviewIdentity[]=[];
const attempts=new Map<string,number>();
for(const store of ['apple','google'] as const)for(const role of ['admin','teacher','parent','security']){
 const id=`review-${store}-${role}`;identities.push({id,userId:id,schoolId:'review-'+store,store,enabled:true,version:1,passwordHash:hashPassword('local-fixture-password-no-live-credentials')});
}
const db=await getDb();await db.transaction(tx=>seedReviewFixtures(tx,identities));
for(const sql of fs.readFileSync(path.join(root,'deploy/review/runtime-schema.sql'),'utf8').split(';').filter(s=>s.trim()))await db.query(sql);
const dependencies:ReviewDependencies={
 identities:()=>identities,limit:async(key,max)=>{const count=(attempts.get(key)||0)+1;attempts.set(key,count);return count<=max;},audit:async()=>{},
 user:userRepository.getById.bind(userRepository),memberships:membershipRepository.getMembershipsByUserId.bind(membershipRepository),
 sign:(identity,user)=>{const payload={userId:user.id,phone:user.phone,auth_version:user.authVersion,auth_method:'phone_centric' as const,iss:'veli-review',aud:'veli-review-api',review:{identity:identity.id,schoolId:identity.schoolId,version:1}};return createToken(payload);},
 verify:token=>{const user=verifyToken(token);if(!user)return null;const data=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());if(!data.review)return null;return{...data.review,userId:user.userId,authVersion:user.auth_version};}
};
const access=createReviewAccess(dependencies);
const app=express();app.use(express.json());app.use('/api/review',access.router);app.use(access.guard);app.use(createReviewOperations({...dependencies,database:getDb}));app.use('/api',apiRouter);
const server=http.createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+(server.address() as any).port;
const originalFetch=globalThis.fetch;
globalThis.fetch=((url:any,options:any)=>{if(!String(url).startsWith(base))throw Error('External egress forbidden in review test');return originalFetch(url,options);}) as typeof fetch;
let count=0;
const sessions=new Map<string,string>();
try{
 for(const identity of identities){
  const response=await fetch(base+'/api/review/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identity:identity.id,password:'local-fixture-password-no-live-credentials'})});
  assert.equal(response.status,200);const session=await response.json();
  sessions.set(identity.id,session.token);
  const get=(url:string)=>fetch(base+url,{headers:{Authorization:'Bearer '+session.token}});
  assert.equal((await get('/api/user/me')).status,200);
  assert.equal((await get('/api/schools/'+identity.schoolId+'/appointments')).status,200);
  assert.equal((await get('/api/schools/production-school/appointments')).status,403);
  assert.equal((await get('/api/schools/'+(identity.store==='apple'?'review-google':'review-apple')+'/appointments')).status,403);
  if(!identity.id.endsWith('-admin'))assert.equal((await get('/api/schools/'+identity.schoolId+'/users')).status,403);
  assert.equal((await get('/api/platform/licenses')).status,403);
  count++;
 }
 const call=async(role:string,path:string,method='GET',body?:object)=>{const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+sessions.get('review-apple-'+role),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};};
 const pref='/api/auth/me/license-reminder-preferences/review-apple';
 assert.equal((await call('admin',pref,'PUT',{enabled:true})).body.enabled,true);
 assert.equal((await call('admin',pref)).body.enabled,true);
 assert.equal((await call('admin',pref,'PUT',{enabled:false})).body.enabled,false);
 assert.equal((await call('parent',pref)).status,403);
 assert.equal((await call('admin','/api/schools/review-apple/management/parents/review-apple-parent','DELETE')).status,403);
 assert.equal((await call('admin',pref.replace('apple','google'))).status,403);
 const push=await call('parent','/api/mobile/push/devices','POST',{token:'synthetic-token-must-not-be-stored'});assert.equal(push.body.simulation,true);
 assert.equal(Number((await db.query<{count:string}>('SELECT COUNT(*)::text AS count FROM mobile_push_devices')).rows[0].count),0);
 const school='/api/schools/review-apple';
 assert.equal((await call('parent','/api/review/scenarios/refresh','POST')).body.simulation,true);
 const sample=(await call('parent',school+'/appointments')).body.appointments.find((a:any)=>a.id==='scenario-apple');
 assert.equal((await call('security',school+'/security/qr/verify','POST',{qrToken:sample.qrToken})).body.decision,'APPROVED');
 assert.equal((await call('security',school+'/security/qr/verify','POST',{qrToken:sample.qrToken})).body.decision,'APPROVED');
 const foreignQr=await fetch(base+'/api/schools/review-google/security/qr/verify',{method:'POST',headers:{Authorization:'Bearer '+sessions.get('review-google-security'),'Content-Type':'application/json'},body:JSON.stringify({qrToken:sample.qrToken})});assert.equal((await foreignQr.json()).decision,'INVALID');
 assert.equal((await call('teacher',school+'/availability','POST',{dayOfWeek:1,startTime:'17:00',endTime:'17:15'})).status,200);
 assert.equal((await call('parent',school+'/availability','POST',{dayOfWeek:1,startTime:'17:00',endTime:'17:15'})).status,403);
 const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
 const booking=await call('parent',school+'/appointments','POST',{teacherId:'profile-apple',studentName:'Sentetik Öğrenci',className:'5-A',date,startTime:'10:00',endTime:'10:15'});
 assert.equal(booking.status,200,JSON.stringify(booking.body));const appointment=booking.body.appointment;
 assert.equal((await call('teacher',school+'/appointments/'+appointment.id+'/approve','POST',{})).status,200);
 assert.equal((await call('parent',school+'/security/qr/verify','POST',{qrToken:'bad'})).status,403);
 assert.equal((await call('security',school+'/security/qr/verify','POST',{qrToken:'bad'})).body.decision,'INVALID');
 const own=(await call('parent',school+'/appointments')).body.appointments.find((a:any)=>a.id===appointment.id);
 const qr=await call('security',school+'/security/qr/verify','POST',{qrToken:own.qrToken});assert.equal(qr.status,200);assert.equal(qr.body.allowed,false);assert.equal(qr.body.decision,'TOO_EARLY');
 assert.equal((await call('parent',school+'/appointments/'+appointment.id+'/cancel','POST',{})).status,200);
 const deletion='/api/user/me/deletion',requestId=crypto.randomUUID();
 assert.equal((await call('parent',deletion,'POST',{password:'wrong',confirmation:'HESABIMI SİL',requestId})).status,403);
 assert.equal((await call('parent',deletion,'POST',{password:'local-fixture-password-no-live-credentials',confirmation:'HESABIMI SİL',requestId,whatsappCode:'000000'})).status,400);
 for(let n=0;n<5;n++)assert.equal((await call('security',deletion,'POST',{password:'wrong',confirmation:'HESABIMI SİL',requestId:crypto.randomUUID()})).status,403);
 assert.equal((await call('security',deletion,'POST',{password:'wrong',confirmation:'HESABIMI SİL',requestId:crypto.randomUUID()})).status,429);
 assert.equal((await call('security','/api/user/me')).status,200);
 assert.equal((await call('parent',deletion,'POST',{password:'local-fixture-password-no-live-credentials',confirmation:'HESABIMI SİL',requestId,targetUserId:'review-google-admin'})).status,400);
 const result=await call('parent',deletion,'POST',{password:'local-fixture-password-no-live-credentials',confirmation:'HESABIMI SİL',requestId});assert.equal(result.status,200);assert.equal(result.body.simulation,true);assert.equal(result.body.notificationSent,false);
 assert.equal((await call('parent','/api/user/me')).status,401);
 assert.equal((await call('teacher','/api/user/me')).status,200);
 const again=await fetch(base+'/api/review/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identity:'review-apple-parent',password:'local-fixture-password-no-live-credentials'})});assert.equal(again.status,200);
 assert.equal((await db.query<{count:string}>("SELECT COUNT(*)::text AS count FROM users WHERE id LIKE 'review-%'")).rows[0].count,'8');
 // Reset must refuse the unrelated synthetic baseline records before making changes.
 await assert.rejects(db.transaction(tx=>resetReviewFixtures(tx,identities)),/Non-review records/);
 await db.query("DELETE FROM schools WHERE id NOT IN ('review-apple','review-google')");
 await db.query("DELETE FROM users WHERE id NOT LIKE 'review-%'");
 await db.query("INSERT INTO users(id,phone,first_name) VALUES('usr-synthetic-created','synthetic-extra','Demo')");
 await db.query("INSERT INTO school_memberships(id,user_id,school_id,role,status) VALUES('extra-member','usr-synthetic-created','review-apple','parent','active')");
 const before=(await db.query<{auth_version:number}>("SELECT auth_version FROM users WHERE id='review-apple-parent'")).rows[0].auth_version;
 await db.transaction(tx=>resetReviewFixtures(tx,identities));
 assert.equal((await db.query<{auth_version:number}>("SELECT auth_version FROM users WHERE id='review-apple-parent'")).rows[0].auth_version,before+1);
 assert.equal((await call('teacher','/api/user/me')).status,401);
 assert.equal((await db.query<{count:string}>("SELECT COUNT(*)::text AS count FROM users")).rows[0].count,'8');
 console.log('Review integration PASS: '+count+' identities; real auth/tenant/roles, availability, booking/approval, refreshable approved/early/invalid/cross-school QR and read-only repeat behavior, preference on/off, synthetic push without token storage, deletion verification/target rejection/session revocation/relogin/other identities preserved; reset scope refusal and old-session invalidation. Local PGlite; no live delivery.');
}finally{
 globalThis.fetch=originalFetch;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));process.chdir(root);
}
process.exit(0);
