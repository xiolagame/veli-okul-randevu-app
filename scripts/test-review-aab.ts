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
const f=await reviewFixture();const server=http.createServer((req,res)=>{const u=new URL(req.url||'/','http://localhost');const rel=u.pathname==='/'?'index.html':u.pathname.slice(1);const file=path.resolve(folder,rel);if(!file.startsWith(folder+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}const ext=path.extname(file);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}as Record<string,string>)[ext]||'application/octet-stream');res.end(fs.readFileSync(file));});server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const addr=server.address();assert(addr&&typeof addr!=='string');const origin='http://127.0.0.1:'+addr.port;
const {chromium}=await import(pathToFileURL('C:/Users/XIO/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);const browser=await chromium.launch({channel:'chrome',headless:true});const results:any[]=[];
try{for(const role of ['parent','teacher']){await f.reset();const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();const calls:{path:string;method:string;status:number}[]=[];const errors:string[]=[];page.on('pageerror',()=>errors.push('pageerror'));
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
  await page.reload();await page.waitForTimeout(1200);assert.equal(await page.locator('#phone-centric-phone').count(),0);assert(calls.some(x=>x.path==='/api/user/me'&&x.status===200));
  const logout=page.getByRole('button',{name:'Oturumu kapat',exact:true});
  if(await logout.count()===0)await page.locator('.profile-trigger').click();
  await page.getByRole('button',{name:'Oturumu kapat',exact:true}).click();await page.locator('#phone-centric-phone').waitFor();await page.reload();await page.locator('#phone-centric-phone').waitFor();
  assert.deepEqual(errors,[]);results.push({role,status:'PASS',calls,assertions:['original AAB JS and CSS','actual request/verify JSON','bootstrap role/tenant','reload session persistence','existing client logout and signed-out reload'],limitation:'Chromium web runtime; not Android WebView or physical-device test'});console.log('PASS original AAB UI '+role+' request/verify/session/restore/logout');
 }catch(e){results.push({role,status:'FAIL',calls,error:e instanceof Error?e.message:'failure'});console.log('FAIL original AAB UI '+role);fs.mkdirSync('audit/aab-screenshots',{recursive:true});await page.screenshot({path:'audit/aab-screenshots/'+role+'.png'});}finally{await context.close();}
}}finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));await f.close();fs.writeFileSync('audit/aab-runtime-results.json',JSON.stringify({aabSha256:expected,results},null,2));}
if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
