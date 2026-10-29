import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {createReviewAccess,type ReviewIdentity} from '../server/review-access';
import {hashPassword} from '../server/passwords';
const identity:ReviewIdentity={id:'review-apple-parent',userId:'review-apple-parent',schoolId:'review-apple',store:'apple',version:1,enabled:true,passwordHash:hashPassword('local-fixture-only-32chars-secret')};
const counts=new Map<string,number>(),logs:unknown[]=[];
let membershipSchool='review-apple';
const access=createReviewAccess({
 identities:()=>[identity],limit:async(k,max)=>{const n=(counts.get(k)||0)+1;counts.set(k,n);return n<=max;},audit:async e=>{logs.push(e);},
 user:async id=>id===identity.userId?{id,phone:'review-user',firstName:'Demo',lastName:'Veli',isPhoneVerified:false,authVersion:2} as any:null,
 memberships:async()=>[{id:'fixture',userId:identity.userId,schoolId:membershipSchool,role:'parent',status:'active'}] as any,
 sign:()=> 'review-fixture-token',
 verify:t=>t==='review-fixture-token'?{identity:identity.id,userId:identity.userId,schoolId:identity.schoolId,version:1,authVersion:2}:null
});
const app=express();app.use('/api/review',access.router);app.use(access.guard);app.use((_req,res)=>res.json({synthetic:true}));
const server=http.createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+(server.address() as any).port;
const request=(path:string,method='GET',body?:object,token?:string)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
try{
 assert.equal((await request('/api/review/login','POST',{identity:'normal-production-user',password:'local-fixture-only-32chars-secret'})).status,401);
 assert.equal((await request('/api/review/login','POST',{identity:identity.id,password:'wrong'})).status,401);
 assert.equal((await request('/api/review/login','POST',{identity:identity.id,password:'local-fixture-only-32chars-secret'})).status,200);
 assert.equal((await request('/api/schools/review-apple/appointments','GET',undefined,'review-fixture-token')).status,200);
 for(const path of ['/api/schools/real-school/appointments','/api/platform/licenses','/api/auth/phone/request-code','/api/schools/review-apple/whatsapp/send','/api/mobile/push/devices'])
  assert.equal((await request(path,'GET',undefined,'review-fixture-token')).status,403,path);
 assert.equal((await request('/api/schools/review-apple/appointments','GET',undefined,'production-token')).status,401);
 membershipSchool='real-school';assert.equal((await request('/api/user/me','GET',undefined,'review-fixture-token')).status,403);membershipSchool=identity.schoolId;
 identity.enabled=false;assert.equal((await request('/api/user/me','GET',undefined,'review-fixture-token')).status,401);identity.enabled=true;
 identity.version=2;assert.equal((await request('/api/user/me','GET',undefined,'review-fixture-token')).status,401);identity.version=1;
 let limited=false;for(let i=0;i<10;i++)if((await request('/api/review/login','POST',{identity:identity.id,password:'wrong'})).status===429)limited=true;assert(limited);
 assert(logs.length>=8);assert(!JSON.stringify(logs).includes('local-fixture-only'));
 console.log('Review access PASS: explicit identities, password, tenant, role scope, revocation/version, production token rejection, outbound routes, rate limit and safe audit. Injected local store; no production DB.');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
