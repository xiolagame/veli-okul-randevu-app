import assert from 'node:assert/strict';import fs from 'node:fs';import {reviewFixture}from'./review-test-fixture';
import {createReviewGateway}from'../server/review-auth';import {createExpressApp}from'../server/app';
const f=await reviewFixture();const app=createExpressApp(createReviewGateway(()=>f.config,()=>f.db));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const a=server.address();assert(a&&typeof a!=='string');const origin='http://127.0.0.1:'+a.port;
const exists=fs.existsSync;let productionStoreChecks=0;
fs.existsSync=((p:fs.PathLike)=>{if(String(p).replaceAll('\\','/').endsWith('/server/data/postgres_db')){productionStoreChecks++;throw new Error('PRODUCTION_STORE_REACHED');}return exists(p);}) as typeof fs.existsSync;
try{const before=exists('server/data/postgres_db');const r=await f.login();assert.equal(r.status,200);
 for(const prefix of['/api','/.netlify/functions/api']){
  const response=await fetch(origin+prefix+'/user/me',{headers:{Authorization:'Bearer '+r.body.token,Origin:'https://localhost'}});assert.equal(response.status,200);assert.equal((await response.json()).user.id,'review-parent');
  const deny=await fetch(origin+prefix+'/platform/licenses',{method:'POST',headers:{Authorization:'Bearer '+r.body.token,'Content-Type':'application/json'},body:'{}'});assert.equal(deny.status,403);
 }
 assert.equal(productionStoreChecks,0);assert.equal(exists('server/data/postgres_db'),before,'review must not initialize production datastore');
 console.log('PASS actual Express app: both mounts, CORS, scoped identity, forbidden licensing, before production DB initialization');
}finally{fs.existsSync=exists;await new Promise<void>(r=>server.close(()=>r()));await f.close();}
