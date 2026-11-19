import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const fixture = `window.welcomeTest={requests:0,verified:0,logins:0};export const api={getAuthCapabilities:async()=>({whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}),requestPhoneCentricCode:async()=>{window.welcomeTest.requests++;return{attemptId:'synthetic',challengeId:'synthetic',resendAfterSeconds:0}},verifyPhoneCentricCode:async()=>{window.welcomeTest.verified++;return{token:'synthetic',user:{id:'synthetic'},memberships:[]}}};`;
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{WebWelcome}from'./src/components/WebWelcome';import{AuthView}from'./src/components/AuthView';createRoot(document.getElementById('root')).render(<WebWelcome onHelp={()=>location.assign('/help')} onRequest={()=>location.assign('/contact')}><AuthView onOpenPublicRequest={()=>{}} onOpenHelp={()=>{}}/></WebWelcome>);`, loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',loader:{'.css':'empty'},plugins:[{name:'isolated-auth',setup(b){b.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));b.onResolve({filter:/context\/AppContext$/},()=>({path:'context',namespace:'fixture'}));b.onResolve({filter:/platform\/runtime-platform$/},()=>({path:'runtime',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='api'?fixture:args.path==='runtime'?`export const getRuntimePlatform=()=>window.testPlatform||'WEB';export const isNativeRuntime=()=>getRuntimePlatform()!=='WEB';`:`export const useApp=()=>({login:async()=>({ok:true}),whatsappLogin:async()=>{window.welcomeTest.logins++;return{ok:true}}});`}));}}] });
const css=fs.readdirSync('dist/client/assets').filter(x=>x.endsWith('.css')).map(x=>fs.readFileSync('dist/client/assets/'+x,'utf8')).join('\n');
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].text)}
 if(url.pathname.startsWith('/welcome/')||url.pathname.startsWith('/branding/')||url.pathname==='/whatsapp-login-icon.png'){
  const f=path.join(process.cwd(),'public',decodeURIComponent(url.pathname));
  if(!fs.existsSync(f)){res.statusCode=404;return res.end()}
  res.setHeader('Content-Type',f.endsWith('.mp4')?'video/mp4':'image/png');return fs.createReadStream(f).pipe(res);
 }
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 fs.mkdirSync('.cache/welcome-review',{recursive:true});
 for(const width of [375,390,430,768,1024,1366,1440,1920]){
  await page.setViewportSize({width,height:width===1920?1080:width===1366?768:900});await page.goto(origin);
  await page.getByRole('heading',{name:'Eğitim, okul ve aileyle güçlenir.'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Giriş Yap',exact:true}).count(),2);
  assert.equal(await page.getByRole('link',{name:'Hakkımızda',exact:true}).count(),0);
  assert.equal(await page.locator('.welcome-platform').count(),0);
  assert(await page.getByRole('link',{name:'VeliRandevu ana sayfa',exact:true}).isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);
  for(const name of ['Giriş Yap','Platformu İncele'])for(const button of await page.getByRole('button',{name,exact:true}).all()){
   const before=await button.boundingBox();await button.hover();const after=await button.boundingBox();assert.deepEqual(after,before,'hover layout shift '+width);
   const style=await button.evaluate(e=>{const s=getComputedStyle(e);return{shadow:s.boxShadow,box:s.boxSizing,radius:s.borderRadius}});
   assert.equal(style.shadow,'none');assert.equal(style.box,'border-box');assert.notEqual(style.radius,'0px');
   await button.focus();assert(await button.evaluate(e=>getComputedStyle(e).outlineStyle!=='none'),'missing keyboard focus');await button.blur();
  }
  await page.mouse.move(0,0);
  if([390,1366,1440,1920].includes(width))await page.screenshot({path:'.cache/welcome-review/welcome-'+width+'.png',fullPage:true});
 }
 await page.getByRole('button',{name:'Platformu İncele'}).first().click();await page.waitForURL(origin+'/help');
 await page.goto(origin);await page.getByRole('button',{name:'Giriş Yap',exact:true}).first().click();await page.getByRole('dialog',{name:'Giriş ekranı açılıyor'}).waitFor();assert(await page.locator('.welcome-auth').getAttribute('inert')!==null);await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.3);await page.screenshot({path:'.cache/welcome-review/video-playing.png'});await page.waitForFunction(()=>!document.querySelector('.welcome-transition'),{timeout:10000});await page.getByRole('button',{name:'WhatsApp Kodu Gönder'}).waitFor();assert((await page.url()).endsWith('/login'));
 await page.getByLabel('Telefon numaranız',{exact:true}).fill('05551234567');await page.getByRole('button',{name:'WhatsApp Kodu Gönder'}).click();await page.getByText('Lütfen telefonunuza gelen WhatsApp onay kodunu girin.').waitFor();assert.equal(await page.evaluate(()=>window.welcomeTest.requests),1);
 const code=page.getByRole('textbox',{name:/WhatsApp.*kodu|doğrulama kodu/i});await code.fill('123456');await page.getByRole('button',{name:/Doğrula/}).click();await page.waitForFunction(()=>window.welcomeTest.logins===1);assert.equal(await page.evaluate(()=>window.welcomeTest.verified),1);
 await page.goto(origin);await page.getByRole('button',{name:'Giriş Yap',exact:true}).nth(1).click();await page.getByRole('button',{name:'Geçişi atla'}).click();await page.getByRole('button',{name:'WhatsApp Kodu Gönder'}).waitFor();await page.getByRole('button',{name:'Karşılama sayfasına dön'}).click();await page.getByRole('button',{name:'Giriş Yap',exact:true}).first().waitFor();
 await page.route('**/welcome/transition.mp4',r=>r.abort());await page.getByRole('button',{name:'Giriş Yap',exact:true}).first().click();await page.waitForFunction(()=>!document.querySelector('.welcome-transition'));await page.getByRole('button',{name:'WhatsApp Kodu Gönder'}).waitFor();await page.unroute('**/welcome/transition.mp4');
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(origin);await page.getByRole('button',{name:'Giriş Yap',exact:true}).first().click();assert.equal(await page.locator('video').count(),0);await page.getByRole('button',{name:'WhatsApp Kodu Gönder'}).waitFor();await page.emulateMedia({reducedMotion:'no-preference'});
 await page.goto(origin+'/login');assert.equal(await page.locator('video').count(),0);await page.getByRole('button',{name:'WhatsApp Kodu Gönder'}).waitFor();
 for(const [width,height] of [[1920,1080],[1440,900],[768,900],[390,844],[375,812]]){await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'final auth overflow '+width);assert(await page.getByRole('textbox',{name:'Telefon numaranız',exact:true}).isVisible());await page.waitForFunction(()=>Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0));await page.screenshot({path:'.cache/welcome-review/login-'+width+'.png',fullPage:true});}
 // A stalled media response must not trap the user behind the transition.
 await page.route('**/welcome/transition.mp4',()=>{});await page.goto(origin);await page.getByRole('button',{name:'Giriş Yap',exact:true}).first().evaluate(b=>{b.click();b.click()});assert.equal(await page.locator('video').count(),1);await page.getByRole('button',{name:'WhatsApp Kodu Gönder'}).waitFor({timeout:11000});await page.unroute('**/welcome/transition.mp4');
 for(const [name,target] of [['Lisans Talebi','/contact'],['İletişim','/contact'],['Destek','/help']]){await page.goto(origin);await page.getByRole('button',{name,exact:true}).click();await page.waitForURL(origin+target);}
 for(const platform of ['ANDROID','IOS']){const p=await browser.newPage();await p.addInitScript(v=>window.testPlatform=v,platform);await p.goto(origin);await p.getByRole('button',{name:'WhatsApp Kodu Gönder'}).waitFor();assert.equal(await p.locator('.web-welcome,video,.welcome-return').count(),0);await p.close();}
 assert.deepEqual(errors,[]);console.log('Web welcome PASS: 1920x1080/1440x900 and mobile, final real auth card, both login buttons, menu targets, actual MP4 playback/completion, skip/error/stall/double-click/reduced motion, synthetic OTP request/verify/session handoff, Android/iOS bypass. No real messages.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
