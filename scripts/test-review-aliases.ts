import assert from 'node:assert/strict';import http from 'node:http';import express from 'express';import crypto from 'node:crypto';
import {createReviewAccess,type ReviewIdentity} from '../server/review-access';import {hashPassword} from '../server/passwords';
const roles=['admin','teacher','parent','security'];
const rows:ReviewIdentity[]=['apple','google'].flatMap(store=>roles.map((role,i)=>({id:`review-${store}-${role}`,userId:`review-${store}-${role}`,schoolId:'review-'+store,store:store as 'apple'|'google',loginName:store+(i+1),enabled:true,version:2,passwordHash:hashPassword('fixture-only-password')})));
const counts=new Map<string,number>(),audit:unknown[]=[];
const access=createReviewAccess({identities:()=>rows,limit:async(key,max)=>{const n=(counts.get(key)||0)+1;counts.set(key,n);return n<=max;},audit:async e=>{audit.push(e);},
 user:async id=>({id,authVersion:1}) as any,memberships:async id=>{const r=rows.find(x=>x.id===id)!;return[{schoolId:r.schoolId,role:id.split('-').at(-1),status:'active'}] as any;},
 sign:r=>JSON.stringify({identity:r.id,userId:r.id,schoolId:r.schoolId,version:r.version,authVersion:1}),verify:t=>{try{return JSON.parse(t);}catch{return null;}}
});
const app=express();app.use('/api/review',access.router);app.use(access.guard);app.use((_req,res)=>res.json({ok:true}));const server=http.createServer(app);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(server.address() as any).port;
const login=(identity:string,password='fixture-only-password')=>fetch(base+'/api/review/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identity,password})});
try{
 for(const row of rows){
  assert.equal((await login(row.id)).status,401,'Old username must not authenticate');
  const response=await login(row.loginName!);assert.equal(response.status,200);const data=await response.json();
  assert.equal(JSON.parse(data.token).identity,row.id,'Canonical relationships must remain stable');
  const other=row.store==='apple'?'google':'apple';assert.equal((await fetch(base+'/api/schools/review-'+other+'/appointments',{headers:{Authorization:'Bearer '+data.token}})).status,403);
  row.version++;assert.equal((await fetch(base+'/api/user/me',{headers:{Authorization:'Bearer '+data.token}})).status,401);row.version--;
 }
 const row=rows[0],key='id:'+crypto.createHash('sha256').update(row.id).digest('hex');assert.equal(counts.get(key),2);
 assert(!counts.has('id:'+crypto.createHash('sha256').update(row.loginName!).digest('hex')),'Alias must not create a fresh rate-limit identity');
 let limited=false;for(let i=0;i<8;i++)if((await login(row.loginName!,'wrong')).status===429)limited=true;assert(limited);
 assert(!JSON.stringify(audit).includes('fixture-only-password'));
 console.log('Review aliases PASS: 8 login names, canonical roles/tenants intact, old names/tokens denied, canonical attempt budget/IP limits and audit retained. Local injected store; no live credentials.');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
