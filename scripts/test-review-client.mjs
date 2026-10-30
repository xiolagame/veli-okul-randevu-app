import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export {api} from './src/services/api';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',
 define:{'import.meta.env':'{"VITE_API_BASE_URL":"https://velirandevu.com","VITE_REVIEW_API_ORIGIN":"https://review.example.invalid"}'},
 plugins:[{name:'local-session',setup(b){
  b.onResolve({filter:/platform\/auth-session$/},()=>({path:'session',namespace:'fixture'}));
  b.onResolve({filter:/platform\/client-preferences$/},()=>({path:'prefs',namespace:'fixture'}));
  b.onResolve({filter:/platform\/runtime-platform$/},()=>({path:'runtime',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='session'?"export const authSession={getToken:async()=>globalThis.reviewTestToken};":a.path==='runtime'?"export const getRuntimePlatform=()=> 'ANDROID';":"export const getActiveSchoolId=()=>null;export const getPlatformTargetSchoolId=()=>null;"}));
 }}]});
const {api}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const calls=[],original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{calls.push({url,headers:options.headers});return new Response(JSON.stringify({user:{},memberships:[]}));};
const jwt=issuer=>'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({iss:issuer})).toString('base64url')+'.fixture';
try{
 globalThis.reviewTestToken=jwt('production');await api.getMe();
 globalThis.reviewTestToken=jwt('veli-review');await api.getMe();await api.getPublicSchools();
 assert(calls[0].url.startsWith('https://velirandevu.com/'));
 assert(calls[1].url.startsWith('https://review.example.invalid/'));
 assert(calls[2].headers.Authorization.includes(globalThis.reviewTestToken));
 assert(calls.slice(1).every(c=>!c.url.startsWith('https://velirandevu.com/')));
 await api.getAuthCapabilities();
 assert(calls.at(-1).url.startsWith('https://velirandevu.com/'));
 assert.equal(calls.at(-1).headers.Authorization,undefined,'Public Android auth discovery must never send a retained demo JWT');
 console.log('Review client PASS: production/review origin separation and review bootstrap headers; mock fetch only.');
}finally{globalThis.fetch=original;delete globalThis.reviewTestToken;}
