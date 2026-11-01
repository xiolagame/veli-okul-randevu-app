import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const state={platform:(process.argv[2]||'WEB').toUpperCase(),revision:1,school:'a',role:'admin',target:null,token:'synthetic-session-a',calls:0,version:1,status:200};
const compiled=await build({entryPoints:['src/services/api.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',define:{'import.meta.env':'{}'},plugins:[{name:'local-session-fixtures',setup(b){
 b.onResolve({filter:/platform\/(auth-session|client-preferences|runtime-platform|review-origin|api-session-policy)$/},a=>({path:a.path.split('/').at(-1),namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='auth-session'?`export const authSession={getToken:async()=>state.token,getCacheRevision:()=>state.revision};`:a.path==='client-preferences'?`export const getActiveSchoolId=()=>state.school;export const getActiveSchoolRole=()=>state.role;export const getPlatformTargetSchoolId=()=>state.target;`:a.path==='runtime-platform'?`export const getRuntimePlatform=()=>state.platform;`:a.path==='review-origin'?`export const isReviewToken=()=>false;export const reviewOrigin=()=>'';`:`export const isAuthenticatedApiEndpoint=()=>true;export const applyUnauthorizedSessionPolicy=async()=>false;`}));
}}]});
const mod={exports:{}};
vm.runInNewContext(compiled.outputFiles[0].text,{module:mod,exports:mod.exports,state,require:createRequire(import.meta.url),AbortController,console,setTimeout,clearTimeout,fetch:async()=>{
 state.calls++;return new Response(JSON.stringify({records:[{id:'synthetic-'+state.version}],teachers:[],users:[],requests:[],success:true}),{status:state.status});
}});
const api=mod.exports.api,key='/api/schools/a/management/student-records';
await Promise.all([api.getManagedStudentRecords('a'),api.getManagedStudentRecords('a')]);assert.equal(state.calls,1);
assert.equal(api.peekCached(key).records[0].id,'synthetic-1');
await api.getManagedStudentRecords('a');assert.equal(state.calls,1);
const beforeSupport=state.calls;await api.getSchoolRequests('a');await api.getSchoolRequests('a');assert.equal(state.calls,beforeSupport+1);
state.version=2;await api.updateManagedRecord('a','teacher','teacher',{phone:'+905551234567'});
assert.equal(api.peekCached(key),undefined);await api.getManagedStudentRecords('a');assert.equal(api.peekCached(key).records[0].id,'synthetic-2');
for(const change of [()=>state.school='b',()=>state.role='security',()=>{state.role='admin';state.target='b'},()=>{state.revision++;state.token='synthetic-session-b'}]){
 change();assert.equal(api.peekCached(key),undefined);await api.getManagedStudentRecords('a');
}
state.school='a';state.target=null;state.role='admin';state.revision++;
for(const mutate of [()=>api.createStaff('a',{}),()=>api.removeManagedRecord('a','student','synthetic-id'),()=>api.approveAppointment('a','synthetic-appointment'),()=>api.cancelAppointment('a','synthetic-appointment')]){
 await api.getManagedStudentRecords('a');await mutate();assert.equal(api.peekCached(key),undefined,'School CRUD must evict old records');
}

state.status=403;await assert.rejects(api.getManagedStudentRecords('a'));assert.equal(api.peekCached(key),undefined);
state.status=200;await api.getManagedStudentRecords('a');const before=state.calls;
state.role='teacher';await api.getAppointments('a');await api.getAppointments('a');assert.equal(state.calls,before+2,'Teacher mobile refresh must remain uncached');
console.log('School read API '+state.platform+' PASS: concurrent dedup, cache snapshot, CRUD invalidation, scope changes, permission error eviction; non-admin requests unchanged. No live API.');
