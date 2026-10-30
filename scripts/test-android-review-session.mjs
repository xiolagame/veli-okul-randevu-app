// Explicit opt-in live synthetic review test. Credentials enter via stdin only.
// No passwords/tokens, request bodies, trace recordings or storage state are written.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
if(!process.argv.includes('--live-isolated-review'))throw Error('Explicit isolated review opt-in required');
let accounts;
try{accounts=JSON.parse(fs.readFileSync(0,'utf8'));}catch{throw Error('Invalid private credential input');}
assert.equal(accounts.length,4);
assert.deepEqual(accounts.map(a=>a.id).sort(),['admin','parent','security','teacher'].map(r=>'review-google-'+r).sort());
const review='https://veli-review-demo.duckdns.org',root=path.resolve('dist/client');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const server=http.createServer((req,res)=>{
 let file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(root,'index.html');
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
const rows=[];
try{
 await Promise.all(accounts.map(async account=>{
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const secure=new Map(),nativeCalls=[],errors=[],requests=[];
  await context.exposeBinding('fixtureSecureStorage',(_source,method,options)=>{
   if(method==='internalGetItem')return{data:secure.get(options.prefixedKey)??null};
   if(method==='internalSetItem'){secure.set(options.prefixedKey,options.data);return{};}
   if(method==='internalRemoveItem'){secure.delete(options.prefixedKey);return{success:true};}
   if(method==='internalGetPrefixedKeys')return{keys:[...secure.keys()]};
   return{};
  });
  await context.exposeBinding('fixtureNativeCall',(_source,plugin,method)=>nativeCalls.push(plugin+'.'+method));
  await context.addInitScript(()=>{
   window.CapacitorCustomPlatform={name:'android'};window.fixtureEvents={};
   const methods={SecureStorage:['internalGetItem','internalSetItem','internalRemoveItem','internalGetPrefixedKeys','internalClearItemsWithPrefix','setSynchronizeKeychain'],App:['getLaunchUrl','getState','addListener','removeListener'],Network:['getStatus','addListener','removeListener'],Keyboard:['addListener','removeListener'],PushNotifications:['addListener','removeListener','checkPermissions','requestPermissions','createChannel','register','unregister','removeAllDeliveredNotifications'],NotificationSettings:['getPushAvailability','areNotificationsEnabled','openNotificationSettings'],AndroidSystemBars:['apply'],StatusBar:['setStyle','setBackgroundColor'],SplashScreen:['hide']};
   window.Capacitor={getPlatform:()=> 'android',PluginHeaders:Object.entries(methods).map(([name,list])=>({name,methods:list.map(name=>({name,rtype:name==='addListener'?'callback':'promise'}))})),nativeCallback:(plugin,method,options,callback)=>{window.fixtureEvents[plugin+'.'+options.eventName]=callback;return 'fixture-listener';},nativePromise:async(plugin,method,options)=>{
    await window.fixtureNativeCall(plugin,method);
    if(plugin==='SecureStorage')return window.fixtureSecureStorage(method,options);
    if(method==='getStatus')return{connected:true,connectionType:'wifi'};
    if(method==='getState')return{isActive:true};
    if(method==='getLaunchUrl')return undefined;
    if(method==='checkPermissions'||method==='requestPermissions')return{receive:'granted'};
    if(method==='getPushAvailability')return{configured:false};
    if(method==='areNotificationsEnabled')return{enabled:true};
    if(plugin==='PushNotifications'&&['register','unregister'].includes(method))throw Error('Forbidden Firebase call in review session');
    return{};
   }};
  });
  const page=await context.newPage();page.on('pageerror',e=>{
   let message=e.message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[JWT REDACTED]');
   for(const a of accounts)message=message.replaceAll(a.password,'[PASSWORD REDACTED]');
   errors.push(message.slice(0,250));
  });
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin===origin)return route.continue();
   if(url.pathname==='/api/public/auth-capabilities')return route.fulfill({json:{whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}});
   if(url.origin!==review)return route.abort();
   // Read-only demo data + explicit review login only. No mutations/provider calls.
   if(req.method()!=='GET'&&!(req.method()==='POST'&&url.pathname==='/api/review/login')){errors.push('UnexpectedReviewMutation');return route.abort();}
   const headers=await req.allHeaders();
   const response=await fetch(url,{method:req.method(),headers:{'Content-Type':'application/json',...(headers.authorization?{Authorization:headers.authorization}:{}),...(headers['x-school-id']?{'X-School-Id':headers['x-school-id']}:{})},...(req.postData()?{body:req.postData()}:{}),signal:AbortSignal.timeout(25000)});
   requests.push({path:url.pathname,status:response.status});
   return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
  });
  const login=async()=>{
   await page.getByRole('button',{name:'Mağaza inceleme erişimi',exact:true}).click();
   await page.getByLabel('İnceleme kimliği').fill(account.loginName||account.id);await page.getByLabel('İnceleme parolası').fill(account.password);
   await page.getByRole('button',{name:'Demo okuluna gir',exact:true}).click();
   await page.locator('.review-banner').waitFor({timeout:30000});
  };
  await page.goto(origin,{waitUntil:'domcontentloaded'});await login();const started=Date.now();
  for(const label of ['Randevular','Müsaitlik','Profil']){
   const button=page.locator('.role-navigation').getByRole('button',{name:new RegExp(label)});
   if(await button.count()===1)await button.click();
  }
  for(const label of ['Randevular','Genel bakış']){
   const button=page.locator('.admin-nav').getByRole('button',{name:label,exact:true});
   if(await button.count()===1)await button.click();
  }
  await page.evaluate(()=>{window.fixtureEvents['App.appStateChange']?.({isActive:false});window.dispatchEvent(new Event('pagehide'));});
  await page.evaluate(()=>{window.fixtureEvents['App.appStateChange']?.({isActive:true});window.dispatchEvent(new Event('pageshow'));});
  await new Promise(r=>setTimeout(r,Math.max(0,61000-(Date.now()-started))));
  assert(await page.locator('.review-banner').isVisible());assert.deepEqual(errors,[]);
  assert(!nativeCalls.some(c=>/^PushNotifications\.(register|unregister)$/.test(c)));
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.review-banner').waitFor({timeout:30000});
  await page.locator('.profile-trigger').click();
  await page.getByRole('button',{name:'Oturumu kapat',exact:true}).click();
  await page.getByRole('button',{name:'Mağaza inceleme erişimi',exact:true}).waitFor();assert.equal(secure.size,0);
  await login();assert.deepEqual(errors,[]);
  rows.push({role:account.id.split('-').at(-1),stableMs:Date.now()-started,errors,forbiddenFirebaseCalls:0,sessionRestore:true,logoutRelogin:true,requests,syntheticAndroidBridge:true,realAndroidBinary:false});
  await context.close();
 }));
 fs.mkdirSync('audit/android-demo-crash',{recursive:true});fs.writeFileSync('audit/android-demo-crash/session-stability.json',JSON.stringify(rows,null,2));
 console.log('Four Google review roles PASS: live isolated API, 61 seconds each, navigation, simulated background/foreground, native-storage fixture restore, logout/relogin, no FCM register/unregister. Chromium + synthetic native bridge, NOT a physical Android post-fix test.');
}catch(error){
 let safe=String(error.stack||error.message||'Review stability test failed').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[JWT REDACTED]');
 for(const a of accounts)safe=safe.replaceAll(a.password,'[PASSWORD REDACTED]');
 console.error(safe);process.exitCode=1;
}finally{await browser.close();await new Promise(r=>server.close(r));for(const a of accounts)a.password='';}
