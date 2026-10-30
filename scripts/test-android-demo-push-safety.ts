import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AndroidPushManager} from '../src/platform/android-push';
import type {PushNotificationsPlugin} from '@capacitor/push-notifications';

async function fixture(userId:string,role:string,configured:boolean|'unavailable'){
 const calls:string[]=[],statuses:string[]=[];
 const listeners=new Map<string,(value:any)=>void>();
 const native=new Proxy({}, {get:(_target,name)=>async(...args:any[])=>{
  calls.push(String(name));
  if(name==='addListener'){listeners.set(args[0],args[1]);return {remove:async()=>{}};}
  if(name==='checkPermissions'||name==='requestPermissions')return{receive:'granted'};
  if(name==='register'){listeners.get('registration')?.({value:'synthetic-fcm-target'});}
 }}) as PushNotificationsPlugin;
 const manager=new AndroidPushManager(native,{
  registerPushDevice:async()=>{calls.push('backend-register');},deactivatePushDevice:async()=>{calls.push('backend-deactivate');},
 },()=> 'ANDROID',()=> '00000000-0000-4000-8000-000000000001',{
  getPushAvailability:async()=>{if(configured==='unavailable')throw Error('old host');return{configured};},
  areNotificationsEnabled:async()=>({enabled:true}),openNotificationSettings:async()=>{},
 });
 await manager.start(userId,role,()=>{},s=>statuses.push(s));
 return {manager,calls,statuses};
}

for(const role of ['parent','teacher','admin','security']){
 const f=await fixture('review-google-'+role,role,true);
 await f.manager.enable();await f.manager.refreshPermission();
 await f.manager.beforeLogout();await f.manager.afterSessionInvalidated();
 assert(!f.calls.includes('register')&&!f.calls.includes('unregister')&&!f.calls.includes('backend-register'),'Demo must never call Firebase register/deleteToken');
}
for(const configured of [false,'unavailable'] as const){
 for(const role of ['parent','teacher']){
  const f=await fixture('normal-'+role,role,configured);
  assert.equal(await f.manager.enable(),'unavailable');await f.manager.refreshPermission();
  await f.manager.beforeLogout();
  assert(!f.calls.includes('register')&&!f.calls.includes('unregister'),'Missing Firebase/host guard must prevent native fatal calls, including logout');
 }
}
for(const role of ['parent','teacher']){
 const f=await fixture('normal-'+role,role,true);
 assert(f.calls.includes('register')&&f.calls.includes('backend-register'));
 await f.manager.beforeLogout();assert(f.calls.includes('unregister'));
}
const transition=await fixture('normal-parent','parent',true);
await transition.manager.beforeLogout();transition.calls.length=0;
await transition.manager.start('review-google-parent','parent',()=>{},()=>{});
await transition.manager.enable();await transition.manager.beforeLogout();
assert(!transition.calls.includes('register')&&!transition.calls.includes('unregister'));
await transition.manager.start('normal-parent','parent',()=>{},()=>{});
assert(transition.calls.includes('register'),'Normal push must recover after demo logout');
await transition.manager.beforeLogout();
const native=fs.readFileSync('android/app/src/main/java/com/velirandevu/app/NotificationSettingsPlugin.java','utf8');
assert(native.includes('public void getPushAvailability(PluginCall call)'));
assert(native.includes('Class.forName("com.google.firebase.FirebaseApp").getMethod("getInstance").invoke(null)'));
assert(native.includes('ReflectiveOperationException | RuntimeException | LinkageError'));
assert(!native.includes('initializeApp('));
console.log('Android demo push safety PASS: four review roles never register/unregister FCM; absent Firebase and old host recover on start/enable/foreground/logout; configured normal parent/teacher retain registration and cleanup. Native source contract checked; no Android binary executed.');
