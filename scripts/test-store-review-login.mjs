import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const platform=process.argv[2];assert(['ios','android'].includes(platform));
const root=path.resolve('dist/client');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),target=path.resolve(root,'.'+decodeURIComponent(url.pathname));
 if(!target.startsWith(root+path.sep)&&target!==root){res.writeHead(403);res.end();return;}
 const file=fs.existsSync(target)&&fs.statSync(target).isFile()?target:path.join(root,'index.html');
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});const rows=[];
fs.mkdirSync('audit/store-review',{recursive:true});
try{
 for(const [width,height] of [[375,667],[390,844],[430,932],[820,1180]]){
  const context=await browser.newContext({viewport:{width,height},colorScheme:'dark'});
  await context.addInitScript(platform=>{
   window.CapacitorCustomPlatform={name:platform};
   // Synthetic native bridge: production storage/native code is unchanged.
   // Only empty-session/layout behavior is tested, never real Keychain/APNs.
   const methods={SecureStorage:['internalGetItem','internalSetItem','internalRemoveItem','internalGetPrefixedKeys','internalClearItemsWithPrefix','setSynchronizeKeychain'],App:['getLaunchUrl','getState','addListener','removeListener'],Network:['getStatus','addListener','removeListener'],Keyboard:['setResizeMode','setStyle','setAccessoryBarVisible','addListener','removeListener'],PushNotifications:['checkPermissions','addListener','removeListener'],StatusBar:['setStyle','setBackgroundColor','setOverlaysWebView'],SplashScreen:['hide']};
   window.nativeThemeCalls=[];window.observedThemes=[];
   new MutationObserver(records=>{for(const r of records){if(r.oldValue)window.observedThemes.push(r.oldValue);window.observedThemes.push(document.documentElement.dataset.theme);}}).observe(document,{subtree:true,attributes:true,attributeOldValue:true,attributeFilter:['data-theme']});
   window.Capacitor={getPlatform:()=>platform,PluginHeaders:Object.entries(methods).map(([name,list])=>({name,methods:list.map(name=>({name,rtype:name==='addListener'?'callback':'promise'}))})),nativeCallback:()=> 'synthetic-listener',nativePromise:async(plugin,method,options)=>{
    if(plugin==='StatusBar')window.nativeThemeCalls.push({method,...options});
    if(plugin==='SecureStorage')return method==='internalGetItem'?{data:''}:method==='internalGetPrefixedKeys'?{keys:[]}:{success:true};
    if(method==='getStatus')return{connected:true,connectionType:'wifi'};if(method==='getState')return{isActive:true};if(method==='checkPermissions')return{receive:'prompt'};return{};
   }};
   window.observedOldHeadings=[];
   new MutationObserver(()=>{for(const e of document.querySelectorAll('h1,h2,h3'))if(/telefon numaranızla giriş yapın/i.test(e.textContent||''))window.observedOldHeadings.push(e.textContent);}).observe(document,{subtree:true,childList:true,characterData:true});
  },platform);
  const page=await context.newPage();const reviewRequests=[];
  await page.route('**/*',route=>{
   const url=route.request().url();
   if(url.includes('/api/public/auth-capabilities'))return route.fulfill({json:{whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}});
   if(url.includes('/api/auth/phone/request-code'))return route.fulfill({json:{attemptId:'synthetic-attempt',challengeId:'synthetic-challenge',resendAfterSeconds:60}});
   if(url==='https://veli-review-demo.duckdns.org/api/review/login'){
    assert.equal(route.request().method(),'POST');reviewRequests.push(url);
    return route.fulfill({status:401,json:{error:'Sentetik inceleme erişimi reddedildi.'}});
   }
   return url.startsWith(origin)?route.continue():route.abort();
  });
  await page.goto(origin,{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Okulunuza Hoş Geldiniz',exact:true}).waitFor();
  await page.getByLabel('Telefon numaranız',{exact:true}).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-runtime-platform'),platform);
  const initialTheme=platform==='ios'?'light':'dark';
  assert.equal(await page.locator('html').getAttribute('data-theme'),initialTheme);
  assert((await page.evaluate(()=>window.observedThemes)).every(t=>t===initialTheme),'Opposite theme before manual selection');
  assert.equal(await page.locator('video').count(),0);
  assert.equal(await page.getByRole('button',{name:'Mağaza inceleme erişimi',exact:true}).count(),1);
  const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,background:getComputedStyle(document.body).backgroundImage,oldHeadings:window.observedOldHeadings}));
  assert(metrics.scrollWidth<=width,'Horizontal overflow');if(width<768)assert(metrics.background.includes('04-Mobil.png'));
  assert.deepEqual(metrics.oldHeadings,[]);
  await page.screenshot({path:`audit/store-review/${platform}-welcome-${width}.png`,fullPage:true,animations:'disabled'});
  if(width===390){
   if(platform==='ios'){
    await page.waitForFunction(()=>window.nativeThemeCalls.some(c=>c.color==='#f6f8f7'));
    assert((await page.evaluate(()=>window.nativeThemeCalls)).some(c=>c.style==='LIGHT'));
   }
   await page.getByRole('button',{name:'Koyu mod',exact:true}).filter({visible:true}).click();
   assert.equal(await page.evaluate(()=>localStorage.getItem('veli.theme')),'dark');
   await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Okulunuza Hoş Geldiniz',exact:true}).waitFor();
   assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
   assert((await page.evaluate(()=>window.observedThemes)).every(t=>t==='dark'),'Saved dark preference flashed light');
   if(platform==='ios')await page.waitForFunction(()=>window.nativeThemeCalls.some(c=>c.style==='DARK')&&window.nativeThemeCalls.some(c=>c.color==='#101c19'));
   else assert.deepEqual(await page.evaluate(()=>window.nativeThemeCalls),[]);
   await page.getByRole('button',{name:'Açık mod',exact:true}).filter({visible:true}).click();
   await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Okulunuza Hoş Geldiniz',exact:true}).waitFor();
   assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
   assert((await page.evaluate(()=>window.observedThemes)).every(t=>t==='light'),'Saved light preference flashed dark');
   await page.getByLabel('Telefon numaranız',{exact:true}).fill('0555 123 45 67');
   await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();
   await page.getByLabel('WhatsApp doğrulama kodu',{exact:true}).waitFor();
   await page.getByRole('heading',{name:'Okulunuza Hoş Geldiniz',exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.observedOldHeadings),[]);
   await page.screenshot({path:`audit/store-review/${platform}-otp-390.png`,fullPage:true,animations:'disabled'});
   await page.reload();await page.getByRole('heading',{name:'Okulunuza Hoş Geldiniz',exact:true}).waitFor();
   await page.getByRole('button',{name:'Mağaza inceleme erişimi',exact:true}).click();
   await page.getByLabel('İnceleme kimliği').fill('synthetic-review-identity');
   await page.getByLabel('İnceleme parolası').fill('synthetic-not-a-live-credential');
   await page.getByRole('button',{name:'Demo okuluna gir',exact:true}).click();
   await page.getByText('Sentetik inceleme erişimi reddedildi.',{exact:true}).waitFor();
   assert.deepEqual(reviewRequests,['https://veli-review-demo.duckdns.org/api/review/login']);
  }
  rows.push(metrics);await context.close();
 }
 fs.writeFileSync(`audit/store-review/${platform}-login.json`,JSON.stringify({platform,rows,compiledPackage:true,syntheticCapacitor:true,realDevice:false,realOtpSent:false},null,2));
 console.log(`Compiled ${platform} login PASS: approved welcome + review entry/origin/denial, original mobile photo, no old-heading flash, OTP/reload, no cinematic video; dark system default and manual light/dark reload without opposite theme mutation; iOS native chrome calls, Android unchanged. Chromium with simulated Capacitor; all auth requests mocked, not a device test.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
