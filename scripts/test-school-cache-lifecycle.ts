import assert from 'node:assert/strict';
import {AuthSessionManager} from '../src/platform/auth-session';
import {schoolReadCache} from '../src/platform/school-read-cache';
import {setActiveSchoolId,setActiveSchoolRole,setPlatformTargetSchoolId,clearAuthSensitivePreferences} from '../src/platform/client-preferences';
let stored:string|null=null;
const session=new AuthSessionManager({get:async()=>stored,set:async value=>{stored=value},remove:async()=>{stored=null}});
const seed=()=>schoolReadCache.get('synthetic-scope','records',async()=>({id:'synthetic'}));
const absent=()=>assert.equal(schoolReadCache.peek('synthetic-scope','records'),undefined);
await seed();await session.setToken('synthetic-session');absent();
for(const clear of [()=>session.clearToken(),()=>session.clearTokenAfterRemoteInvalidation(),()=>session.clearTokenIfCurrent('synthetic-session'),()=>session.invalidateRejectedToken('synthetic-session')]){
 await session.setToken('synthetic-session');await seed();await clear();absent();
}
for(const change of [()=>setActiveSchoolId('school-a'),()=>setActiveSchoolRole('admin'),()=>setActiveSchoolId('school-b'),()=>setActiveSchoolRole('teacher'),()=>setPlatformTargetSchoolId('school-b'),clearAuthSensitivePreferences]){
 await seed();change();absent();
}
console.log('School cache lifecycle PASS: all session clear/invalidation paths and school/role/platform-target changes physically purge cached records.');
