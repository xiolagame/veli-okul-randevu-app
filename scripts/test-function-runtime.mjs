import assert from 'node:assert/strict';import path from 'node:path';import{pathToFileURL}from'node:url';
const extracted=process.argv[2],names=JSON.parse(process.argv[3]);process.chdir(extracted);
if(process.env.DATABASE_URL)throw Error('REMOTE_DATABASE_FORBIDDEN');
globalThis.fetch=async()=>{throw Error('EXTERNAL_REQUEST_FORBIDDEN');};
try{
 const modules={};for(const name of names){modules[name]=await import(pathToFileURL(path.join(extracted,'netlify/functions',name+'.mjs')).href);assert.equal(typeof modules[name].default,'function',name+' entry');}
 const api=modules.api.default,context={requestId:'synthetic-package-check'};
 for(const route of ['/api/public/auth-capabilities','/.netlify/functions/api/public/auth-capabilities']){
  const response=await api(new Request('http://localhost'+route),context);assert.equal(response.status,200);assert.deepEqual(await response.json(),{whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true});assert.equal(response.headers.get('cache-control'),'no-store');
 }
 const health=await api(new Request('http://localhost/api/health'),context);assert.equal(health.status,200);assert.equal((await health.json()).services.database.status,'connected');
 const denied=await api(new Request('http://localhost/api/platform/licenses'),context);assert.equal(denied.status,401);
 process.env.WHATSAPP_AUTH_ENABLED='false';process.env.PHONE_CENTRIC_AUTH_ENABLED='false';
 const disabled=await api(new Request('http://localhost/api/public/auth-capabilities'),context);const flags=await disabled.json();assert.equal(flags.whatsappAuthEnabled,false);assert.equal(flags.phoneCentricAuthEnabled,false);
 console.log('FUNCTION_RUNTIME_PASS: real API ZIP entry; health/capabilities at both routes, flag changes, unauthorized platform denied; no external network.');process.exit(0);
}catch(e){console.error('FUNCTION_RUNTIME_FAIL',e.code||e.name,String(e.message).slice(0,240));process.exit(1);}
