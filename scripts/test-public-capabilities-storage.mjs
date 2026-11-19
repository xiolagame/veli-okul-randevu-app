import assert from 'node:assert/strict';
import {build} from 'esbuild';
globalThis.auditSession={reads:0,fail:true,invalidations:[],calls:[],status:200};
const bundle=await build({stdin:{contents:"export{api}from'./src/services/api';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env.VITE_API_BASE_URL':'"https://synthetic.invalid"'},plugins:[{name:'session-fixtures',setup(b){
 b.onResolve({filter:/\/auth-session$/},()=>({path:'session',namespace:'fixture'}));
 b.onResolve({filter:/\/client-preferences$/},()=>({path:'preferences',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='session'?`export const authSession={getToken:async()=>{globalThis.auditSession.reads++;if(globalThis.auditSession.fail)throw Error('Synthetic secure storage unavailable');return 'synthetic-token'},invalidateRejectedToken:async token=>{globalThis.auditSession.invalidations.push(token)}}`:`export const getActiveSchoolId=()=>null;export const getPlatformTargetSchoolId=()=>null;`,loader:'js'}));
}}]});
globalThis.fetch=async(url,options)=>{globalThis.auditSession.calls.push({url,headers:options.headers});return new Response(JSON.stringify(globalThis.auditSession.status===200?{whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true,enabled:true,canEnable:true}:{error:'Synthetic access denied'}),{status:globalThis.auditSession.status,headers:{'Content-Type':'application/json'}});};
const{api}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
assert.equal((await api.getAuthCapabilities()).phoneCentricAuthEnabled,true);assert.equal(auditSession.reads,0);assert.equal(auditSession.calls[0].headers.Authorization,undefined);
await assert.rejects(()=>api.getLicenseWhatsAppPreference('synthetic-school'),/storage/);assert.equal(auditSession.calls.length,1);
auditSession.fail=false;await api.getLicenseWhatsAppPreference('synthetic-school');assert.equal(auditSession.calls.at(-1).headers.Authorization,'Bearer synthetic-token');
auditSession.status=403;await assert.rejects(()=>api.getLicenseWhatsAppPreference('synthetic-school'));assert.equal(auditSession.invalidations.length,0);
auditSession.status=401;await assert.rejects(()=>api.getLicenseWhatsAppPreference('synthetic-school'));assert.equal(auditSession.invalidations.length,1);
await assert.rejects(()=>api.verifyWhatsappCode({challengeId:'synthetic',phone:'05551110001',code:'000000'}));assert.equal(auditSession.invalidations.length,1);
const navbar=await import('node:fs').then(fs=>fs.readFileSync('src/components/Navbar.tsx','utf8'));assert(navbar.includes("currentUser?.role==='admin'&&<LicenseWhatsAppPreference"));
console.log('PASS: public capabilities bypass failed secure storage; protected preference uses Bearer, fail-closed storage, 401 invalidation and 403/OTP preservation; admin-only preference entry. All HTTP mocked.');
