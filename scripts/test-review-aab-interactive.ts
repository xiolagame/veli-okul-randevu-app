import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import cp from 'node:child_process';import crypto from 'node:crypto';import {pathToFileURL}from'node:url';
import {reviewFixture}from'./review-test-fixture';
const aab='C:/Users/XIO/Documents/Codex/veli-randevu-android-sync-20261029/android/app/release/app-release.aab';
const expected='8b7f215dc0791143a7e9be581b07b5e3bc46d1e268c4d0fe80be11563c8a7b62';
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(aab)).digest('hex'),expected);
const folder=path.resolve('.cache/review-aab');fs.mkdirSync(folder,{recursive:true});
const unpack=cp.spawnSync('python',['-c',`import zipfile,pathlib,sys
root=pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1])as z:
 for name in z.namelist():
  if not name.startswith('base/assets/public/') or name.endswith('/'):continue
  p=(root/name.removeprefix('base/assets/public/')).resolve()
  assert p.is_relative_to(root)
  p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(name))`,aab,folder],{encoding:'utf8'});assert.equal(unpack.status,0);
const f=await reviewFixture(true);const server=http.createServer((req,res)=>{const u=new URL(req.url||'/','http://localhost');const rel=u.pathname==='/'?'index.html':u.pathname.slice(1);const file=path.resolve(folder,rel);if(!file.startsWith(folder+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}const ext=path.extname(file);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}as Record<string,string>)[ext]||'application/octet-stream');res.end(fs.readFileSync(file));});server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const addr=server.address();assert(addr&&typeof addr!=='string');const origin='http://127.0.0.1:'+addr.port;
const {chromium}=await import(pathToFileURL('C:/Users/XIO/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);const browser=await chromium.launch({channel:'chrome',headless:true});const results:any[]=[];
try{for(const role of ['parent','teacher','security','admin']){await f.reset();const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();const calls:{path:string;method:string;status:number}[]=[];const errors:string[]=[];page.on('pageerror',()=>errors.push('pageerror'));
 try{
  await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin===origin){await route.continue();return;}
   if(u.origin==='https://velirandevu.com'&&u.pathname.startsWith('/api/')){
    const request=route.request(),r=await fetch(f.origin+u.pathname+u.search,{method:request.method(),headers:{...request.headers(),host:new URL(f.origin).host},body:['GET','HEAD'].includes(request.method())?undefined:request.postData()||undefined});calls.push({path:u.pathname,method:request.method(),status:r.status});await route.fulfill({status:r.status,contentType:'application/json',body:await r.text()});return;
   }await route.abort();
  });
  await page.goto(origin);await page.locator('#phone-centric-phone').waitFor();
  await page.locator('#phone-centric-phone').fill(f.config.registry.find(x=>x.role===role)!.phone);await page.locator('form').filter({has:page.locator('#phone-centric-phone')}).locator('button[type=submit]').click();await page.locator('#phone-centric-code').waitFor();
  await page.locator('#phone-centric-code').fill(f.codes[role]);await page.locator('form').filter({has:page.locator('#phone-centric-code')}).locator('button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#phone-centric-phone'));
  await page.locator('.profile-trigger').waitFor();
  await page.waitForTimeout(800);
  assert(calls.some(x=>x.path==='/api/user/me'&&x.status===200)||calls.some(x=>x.path==='/api/public/schools'&&x.status===200));
  assert(calls.some(x=>x.path==='/api/auth/phone/request-code'&&x.status===200));assert(calls.some(x=>x.path==='/api/auth/phone/verify-code'&&x.status===200));

  if(role==='parent'){
    await page.getByRole('button',{name:'Yeni randevu al',exact:true}).first().click();await page.getByRole('button',{name:'Randevu al',exact:true}).first().click();
    const dialog=page.getByRole('dialog',{name:'Görüşmenizi planlayın'});await dialog.waitFor();
    const days=dialog.locator('.calendar-days button:not([disabled])');
    // Select a future working day, avoiding same-day elapsed hours.
    await days.nth(Math.min(1,(await days.count())-1)).click();
    const slot=dialog.locator('.slot-grid button:not([disabled])').filter({hasText:'10:00'});await slot.waitFor();await slot.click();
    await dialog.locator('button[type=submit]').click();await dialog.waitFor({state:'hidden'});
    if(!calls.some(x=>x.path.endsWith('/appointments')&&x.method==='POST'&&x.status===201))throw Error('Real AAB booking did not succeed');
    const state=(await f.pg.query('SELECT state FROM review_school_state')).rows[0].state as any;const last=state.appointments.at(-1);await page.locator('[data-appointment-id=\"'+last.id+'\"]').getByRole('button',{name:'Randevuyu iptal et',exact:true}).click();await page.waitForTimeout(300);if(!calls.some(x=>x.path.endsWith('/'+last.id+'/cancel')&&x.status===200))throw Error('Real AAB parent cancellation failed');
  }
  if(role==='teacher'){
    await page.locator('.role-navigation').getByRole('button',{name:/Randevular/}).click();const approve=page.getByRole('button',{name:'Onayla',exact:true});await approve.first().click();
    await page.waitForTimeout(300);if(!calls.some(x=>x.path.endsWith('/approve')&&x.status===200))throw Error('Real AAB teacher approval failed');
    await page.locator('.role-navigation').getByRole('button',{name:/Müsaitlik/}).click();
    const times=page.locator('input[type=time]');await times.nth(0).fill('18:00');await times.nth(1).fill('19:00');await page.getByRole('button',{name:'Programa ekle',exact:true}).click();await page.waitForTimeout(300);
    if(!calls.some(x=>x.path.endsWith('/availability')&&x.method==='POST'&&x.status===200))throw Error('Real AAB availability failed');
  }
  if(role==='security'){
    const state=(await f.pg.query('SELECT state FROM review_school_state')).rows[0].state as any;
    const {default:QRCode}=await import('qrcode');const png=await QRCode.toDataURL(state.appointments[0].qrToken,{width:512,margin:6});
    await context.grantPermissions(['camera']);await page.evaluate('window.__name=function(fn){return fn;}');
    await page.evaluate(async(png:string)=>{const img=new Image();img.src=png;await img.decode();const canvas=document.createElement('canvas');canvas.width=640;canvas.height=640;const draw=()=>{const c=canvas.getContext('2d')!;c.fillStyle='white';c.fillRect(0,0,640,640);c.drawImage(img,64,64,512,512);};draw();const stream=canvas.captureStream(10);setInterval(draw,80);Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>stream,configurable:true});},png);
    await page.getByRole('button',{name:'QR Kod Tara',exact:true}).click();await page.waitForFunction(()=>!!document.querySelector('.camera-result-panel'),{},{timeout:15000});
    if(!calls.some(x=>x.path.endsWith('/security/qr/verify')&&x.status===200))throw Error('Real AAB scanner did not call synthetic verification');
  }
  if(role==='admin'){
    await page.locator('#admin-section').selectOption('settings');await page.locator('#settings-school').fill('Synthetic Changed School');await page.getByRole('button',{name:'Değişiklikleri kaydet',exact:true}).click();await page.waitForTimeout(300);
    if(!calls.some(x=>x.path.endsWith('/settings')&&x.method==='PUT'&&x.status===200))throw Error('Real AAB school settings failed');
    await page.locator('#admin-section').selectOption('roster');await page.waitForTimeout(300);if(!calls.some(x=>x.path.endsWith('/management/student-records')&&x.status===200))throw Error('Student management contract missing');
  }
  await page.reload();await page.waitForTimeout(1200);assert.equal(await page.locator('#phone-centric-phone').count(),0);assert(calls.some(x=>x.path==='/api/user/me'&&x.status===200));
  const logout=page.getByRole('button',{name:'Oturumu kapat',exact:true});
  if(await logout.count()===0)await page.locator('.profile-trigger').click();
  await page.getByRole('button',{name:'Oturumu kapat',exact:true}).click();await page.locator('#phone-centric-phone').waitFor();await page.reload();await page.locator('#phone-centric-phone').waitFor();
  assert.deepEqual(errors,[]);results.push({role,status:'PASS',calls,assertions:['original AAB JS and CSS','interactive role requests','bootstrap role/tenant','reload session persistence','existing client logout and signed-out reload'],limitation:'Chromium web runtime; not Android WebView or physical-device test'});console.log('PASS interactive original AAB UI '+role+' request/verify/session/restore/logout');
 }catch(e){results.push({role,status:'FAIL',calls,error:e instanceof Error?e.message:'failure'});console.log('FAIL original AAB UI '+role);fs.mkdirSync('audit/aab-screenshots',{recursive:true});await page.screenshot({path:'audit/aab-screenshots/'+role+'.png'});}finally{await context.close();}
}}finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));await f.close();fs.writeFileSync('audit/aab-interactive-results.json',JSON.stringify({aabSha256:expected,results},null,2));}
if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
