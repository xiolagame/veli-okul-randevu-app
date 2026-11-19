import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reviewFixture} from './review-test-fixture';
import {createToken,verifyToken} from '../server/auth';
const f=await reviewFixture(),results:{name:string;status:string}[]=[];
async function test(name:string,run:()=>Promise<void>){try{await f.reset();await run();results.push({name,status:'PASS'});console.log('PASS '+name);}catch{results.push({name,status:'FAIL'});console.log('FAIL '+name);}}
try {
 await test('disabled feature rejects reserved demo login without normal fallback',async()=>{
   f.config.enabled=false;const n=f.normalCalls();assert.equal((await f.request('/api/auth/phone/request-code',{phone:f.config.registry[0].phone})).status,503);assert.equal(f.normalCalls(),n);
 });
 await test('invalid configuration fails closed for review identity',async()=>{
   const key=f.config.key;f.config.key='invalid';assert.equal((await f.request('/api/auth/phone/request-code',{phone:f.config.registry[0].phone})).status,503);f.config.key=key;
 });
 await test('normal identity never uses special credential or review datastore',async()=>{
   const n=f.normalCalls();assert.equal((await f.request('/api/auth/phone/verify-code',{phone:'905559990099',code:f.codes.parent})).status,401);assert.equal(f.normalCalls(),n+1);
 });
 await test('four isolated roles, real phone JSON contract, no platform role',async()=>{
   for(const role of['parent','teacher','admin','security']){const r=await f.login(role);assert.equal(r.status,200);assert.equal(r.body.memberships[0].role,role);assert.equal(r.body.memberships[0].schoolId,f.schoolId);assert.equal((await f.request('/api/platform/capabilities',undefined,r.body.token)).body.manageSchools,false);}
 });
 await test('wrong credential rejected without success/session',async()=>{
   const entry=f.config.registry[0],c=await f.request('/api/auth/phone/request-code',{phone:entry.phone});
   const bad=f.codes.parent==='000000'?'000001':'000000';const r=await f.request('/api/auth/phone/verify-code',{phone:entry.phone,attemptId:c.body.attemptId,challengeId:c.body.challengeId,code:bad});assert.equal(r.status,401);assert(!r.body.token);
 });
 await test('wrong registered phone cannot use another account challenge or credential',async()=>{
   const good=await f.login();const r=await f.request('/api/auth/phone/verify-code',{...good.data,phone:f.config.registry[1].phone});assert.equal(r.status,401);
 });
 await test('account lock survives IP changes; cooldown and bounded unlock',async()=>{
   const phone=f.config.registry[0].phone,c=await f.request('/api/auth/phone/request-code',{phone});assert.equal((await f.request('/api/auth/phone/request-code',{phone})).status,429);
   for(let i=0;i<5;i++)assert.equal((await f.request('/api/auth/phone/verify-code',{phone,attemptId:c.body.attemptId,challengeId:c.body.challengeId,code:'invalid'},undefined,{'x-test-ip':'synthetic-'+i})).status,401);
   assert.equal((await f.request('/api/auth/phone/verify-code',{phone,attemptId:c.body.attemptId,challengeId:c.body.challengeId,code:f.codes.parent},undefined,{'x-test-ip':'new-source'})).status,429);
   f.advance(16*60_000);assert.equal((await f.login()).status,200);
 });
 await test('IP limit persists across accounts',async()=>{
   for(let i=0;i<30;i++)await f.request('/api/auth/phone/request-code',{phone:f.config.registry[i%4].phone},undefined,{'x-test-ip':'shared'});
   assert.equal((await f.request('/api/auth/phone/request-code',{phone:f.config.registry[0].phone},undefined,{'x-test-ip':'shared'})).status,429);
 });
 await test('challenge binding, expiry and replay',async()=>{
   const good=await f.login();assert.equal((await f.request('/api/auth/phone/verify-code',good.data)).status,401);
   await f.reset();const phone=f.config.registry[0].phone,c=await f.request('/api/auth/phone/request-code',{phone});f.advance(6*60_000);
   assert.equal((await f.request('/api/auth/phone/verify-code',{phone,attemptId:c.body.attemptId,challengeId:c.body.challengeId,code:f.codes.parent})).status,401);
 });
 await test('concurrent verification consumes exactly once',async()=>{
   const phone=f.config.registry[0].phone,c=await f.request('/api/auth/phone/request-code',{phone}),body={phone,attemptId:c.body.attemptId,challengeId:c.body.challengeId,code:f.codes.parent};
   const r=await Promise.all([f.request('/api/auth/phone/verify-code',body),f.request('/api/auth/phone/verify-code',body)]);assert.deepEqual(r.map(x=>x.status).sort(),[200,401]);
 });
 await test('own tenant read only; another tenant, header and query denied',async()=>{
   const r=await f.login(),t=r.body.token,n=f.normalCalls();
   assert.equal((await f.request('/api/schools/'+f.schoolId+'/students',undefined,t)).status,200);
   for(const path of['/api/schools/real-school/students','/api/schools/review-other/students','/api/platform-target/real-school/schools/'+f.schoolId+'/students','/api/schools/'+f.schoolId+'/students?schoolId=real-school'])assert.equal((await f.request(path,undefined,t)).status,403);
   assert.equal((await f.request('/api/user/me',undefined,t,{'X-School-Id':'real-school'})).status,403);assert.equal(f.normalCalls(),n);
 });
 await test('normal and forged tokens cannot elevate review scope',async()=>{
   const good=await f.login(),[a,b,c]=good.body.token.split('.');const body=JSON.parse(Buffer.from(b,'base64url').toString());body.role='admin';body.school='real-school';
   const tampered=a+'.'+Buffer.from(JSON.stringify(body)).toString('base64url')+'.'+c;
   assert.equal((await f.request('/api/user/me',undefined,tampered)).status,401);
   assert.equal((await f.request('/api/schools/'+f.schoolId+'/info',undefined,good.body.token)).status,403);
   assert.equal(verifyToken(good.body.token),null,'normal verifier must reject review JWT');
   const normal=createToken({userId:'normal-user',phone:'+905559990099',auth_version:0,auth_method:'phone_centric'});
   const reads=Number((await f.pg.query("SELECT count(*) AS n FROM review_audit WHERE event='read'")).rows[0].n);
   assert.equal((await f.request('/api/schools/'+f.schoolId+'/students',undefined,normal)).status,401);
   assert.equal(Number((await f.pg.query("SELECT count(*) AS n FROM review_audit WHERE event='read'")).rows[0].n),reads);
 });
 await test('all writes, sends, QR mutation, deletion, licensing and future routes denied before production',async()=>{
   const r=await f.login('admin'),n=f.normalCalls();
   for(const path of['/api/mobile/push/devices','/api/platform/licenses','/api/auth/quick-switch','/api/public/requests','/api/user/me/deletion/whatsapp-code','/api/auth/whatsapp/request-code','/api/schools/'+f.schoolId+'/appointments','/api/schools/'+f.schoolId+'/staff','/api/schools/'+f.schoolId+'/security/qr/verify','/api/auth/me/license-reminder-preferences/'+f.schoolId])assert.equal((await f.request(path,{},r.body.token)).status,403);
   assert.equal((await f.request('/api/future/unreviewed-route',undefined,r.body.token)).status,403);assert.equal(f.normalCalls(),n);
 });
 await test('role/tenant cannot be selected through body or token; independent native route prefix',async()=>{
   const r=await f.login(),t=r.body.token;assert.equal((await f.request('/api/user/me',{role:'admin',schoolId:'real'},t)).status,403);
   assert.equal((await f.request('/.netlify/functions/api/user/me',undefined,t)).status,200);
 });
 await test('kill switch, account disable, epoch and account revision revoke existing sessions',async()=>{
   const r=await f.login(),t=r.body.token;f.config.enabled=false;assert.equal((await f.request('/api/user/me',undefined,t)).status,401);
   f.config.enabled=true;f.config.epoch++;assert.equal((await f.request('/api/user/me',undefined,t)).status,401);f.config.epoch--;
   await f.pg.query("UPDATE review_accounts SET active=false WHERE id='review-parent'");assert.equal((await f.request('/api/user/me',undefined,t)).status,401);
   await f.pg.query("UPDATE review_accounts SET active=true,version=version+1 WHERE id='review-parent'");assert.equal((await f.request('/api/user/me',undefined,t)).status,401);
 });
 await test('database kill switch stops existing sessions without redeployment',async()=>{
   const r=await f.login();await f.pg.query('UPDATE review_environment SET enabled=false');
   try{assert.equal((await f.request('/api/user/me',undefined,r.body.token)).status,503);}finally{await f.pg.query('UPDATE review_environment SET enabled=true');}
 });
 await test('session expiry, explicit server logout and fresh reusable credential login',async()=>{
   const r=await f.login(),t=r.body.token;assert.equal((await f.request('/api/auth/review/logout',{},t)).status,200);assert.equal((await f.request('/api/user/me',undefined,t)).status,401);
   f.advance(61_000);const fresh=await f.login();assert.equal(fresh.status,200);f.advance(16*60_000);assert.equal((await f.request('/api/user/me',undefined,fresh.body.token)).status,401);
 });
 await test('foreign data and secret-bearing projection fail closed',async()=>{
   const r=await f.login(),saved=(await f.pg.query("SELECT views FROM review_accounts WHERE id='review-parent'")).rows[0].views as any;
   for(const bad of[{students:[{id:'real-student',schoolId:'real-school'}]},{students:[{id:'review-student',schoolId:f.schoolId,secret:'blocked'}]}]){
    await f.pg.query("UPDATE review_accounts SET views=jsonb_set(views,'{students}',$1::jsonb) WHERE id='review-parent'",[JSON.stringify(bad)]);assert.equal((await f.request('/api/schools/'+f.schoolId+'/students',undefined,r.body.token)).status,503);
   }
   await f.pg.query("UPDATE review_accounts SET views=$1 WHERE id='review-parent'",[JSON.stringify(saved)]);
 });
 await test('audit contains success/failure but no credential, token, phone or raw IP',async()=>{
   const rows=(await f.pg.query('SELECT * FROM review_audit')).rows;assert(rows.some(x=>x.success));assert(rows.some(x=>!x.success));
   for(const row of rows){assert(!('phone'in row)&&!('code'in row)&&!('token'in row));assert(/^[a-f0-9]{64}$/.test(String(row.ip_hash)));}
 });
} finally {await f.close();fs.writeFileSync('audit/review-auth-results.json',JSON.stringify(results,null,2));}
if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
