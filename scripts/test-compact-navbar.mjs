import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import {build} from 'esbuild';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),phase=process.argv[2]||'after';
const fixture=`const no=async()=>{};window.headerFixture={role:'parent',platform:false,notifications:0,admin:0};const f=window.headerFixture;
const school={id:'A',name:'Çok Uzun Şehit Öğretmenler Cumhuriyet İlköğretim ve Ortaöğretim Okulu',code:'TEST'};
export const useApp=()=>({currentUser:{id:'synthetic',role:f.role,firstName:'SENTETİK UZUN',lastName:'TEST KULLANICISI'},currentSchool:school,schools:[school],platformSchools:[school],isPlatformAdmin:f.platform,platformContextActive:f.platform,userMemberships:[{schoolId:'A',role:f.role,status:'active'},{schoolId:'B',role:f.role,status:'active'}],switchSchool:no,switchUser:no,logout:no,unreadNotificationCount:9999,refreshMobileData:no});
export const api={getLicenseWhatsAppPreference:async()=>({enabled:false,canEnable:false}),getAccountDeletionImpact:async()=>({})};`;
const entry=`import React from'react';import{createRoot}from'react-dom/client';import{Navbar}from'./src/components/Navbar';import'fixture';const root=createRoot(document.getElementById('root'));let key=0;window.renderHeader=(role,platform)=>{Object.assign(window.headerFixture,{role,platform});root.render(<Navbar key={++key} onOpenNotifications={()=>window.headerFixture.notifications++} onOpenAdmin={()=>window.headerFixture.admin++} onOpenHelp={()=>{}}/>)};window.renderHeader('parent',false);`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{}'},plugins:[{name:'header-fixtures',setup(b){
 b.onResolve({filter:/context\/AppContext$|services\/api$|^fixture$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture}));
 b.onResolve({filter:/platform\/mobile-push$/},()=>({path:'push',namespace:'push'}));b.onLoad({filter:/.*/,namespace:'push'},()=>({contents:`export const canUseMobilePush=()=>false;export class IosPushActivationError extends Error{};export const mobilePush={};`}));
}}]});
const bootstrap=fs.readFileSync('index.html','utf8').match(/<script>[\s\S]*?<\/script>/)[0];
const css=fs.readdirSync('dist/client/assets').filter(p=>p.endsWith('.css')).map(p=>fs.readFileSync('dist/client/assets/'+p,'utf8')).join('\n')+'\n'+fs.readFileSync('src/theme.css','utf8');
const fixtureCss=css.replace(/env\(safe-area-inset-top(?:,\s*0(?:px)?)?\)/g,'var(--fixture-safe-area-top,0px)');
const server=http.createServer((req,res)=>{
 if(req.url==='/branding/veli-randevu-logo.png'){res.setHeader('content-type','image/png');res.end(fs.readFileSync('public/branding/veli-randevu-logo.png'));return;}
 res.setHeader('content-type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/style.css'?fixtureCss:'<!doctype html><html>'+bootstrap+'<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"><body class="font-sans"><div id="root"></div><script src="/app.js"></script></body></html>');
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});const rows=[],errors=[];fs.mkdirSync('audit/header-mail',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.goto(origin);await page.waitForFunction(()=>!!window.renderHeader);
 for(const platform of phase==='before'?['web']:['web','ios','android'])for(const role of ['parent','teacher','security','admin','platform'])for(const width of [320,375,390,430,768,820,1024,1180,1440]){
  await page.evaluate(({platform,role})=>{document.documentElement.dataset.runtimePlatform=platform;window.renderHeader(role==='platform'?'admin':role,role==='platform');},{platform,role});await page.setViewportSize({width,height:844});
  for(const theme of ['light','dark']){
   if(await page.evaluate(()=>document.documentElement.dataset.theme||'light')!==theme)await page.getByRole('button',{name:theme==='light'?'Açık mod':'Koyu mod',exact:true}).click();
   const metrics=await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {font:getComputedStyle(document.querySelector('.brand-name')).fontFamily,scroll:document.documentElement.scrollWidth,height:document.querySelector('.topbar-inner').getBoundingClientRect().height,themeButtons:document.querySelectorAll('.theme-switcher button').length,targets:[...document.querySelectorAll('.topbar-actions button')].map(rect),brand:rect(document.querySelector('.brand')),logo:rect(document.querySelector('.brand-logo')),name:rect(document.querySelector('.brand-name'))};});
   rows.push({platform,role,width,theme,...metrics});
   if(phase==='after'){
    assert(metrics.scroll<=width+1,'Header horizontal overflow');assert.equal(metrics.themeButtons,1);
    assert(metrics.targets.every(r=>r.width>=44&&r.height>=44),'Touch target too small');
    for(let i=1;i<metrics.targets.length;i++)assert(metrics.targets[i].left>=metrics.targets[i-1].right-1,'Icon collision');
    assert(metrics.brand.right<=metrics.targets[0].left+1,'Brand and controls overlap');assert(metrics.name.right<=metrics.targets[0].left+1,'Brand text overlaps controls');
    if(width<768)assert(metrics.height<=64,'Mobile header still tall');
   }
  }
 }
 if(phase==='after'){
  await page.setViewportSize({width:375,height:844});await page.evaluate(()=>window.renderHeader('admin',true));
  await page.getByRole('button',{name:'Platform Yönetimini aç',exact:true}).click();assert.equal(await page.evaluate(()=>headerFixture.admin),1);
  await page.getByRole('button',{name:'Bildirimler, 9999 okunmamış',exact:true}).click();assert.equal(await page.evaluate(()=>headerFixture.notifications),1);
  await page.locator('.school-trigger').click();await page.getByRole('dialog',{name:'Platform Yönetimi · Okullar',exact:true}).waitFor();await page.getByRole('button',{name:'Pencereyi kapat',exact:true}).click();
  await page.locator('.profile-trigger').click();await page.getByRole('dialog',{name:'Hesabım',exact:true}).waitFor();await page.getByRole('button',{name:'Pencereyi kapat',exact:true}).click();
  const theme=await page.evaluate(()=>document.documentElement.dataset.theme);await page.reload();await page.locator('.theme-switcher button').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
  const safe=await page.evaluate(async()=>{document.documentElement.style.setProperty('--fixture-safe-area-top','44px');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const overlay=document.createElement('div');overlay.className='admin-backdrop';document.body.append(overlay);const result={headerBottom:document.querySelector('.app-topbar').getBoundingClientRect().bottom,overlayTop:overlay.getBoundingClientRect().top};overlay.remove();document.documentElement.style.removeProperty('--fixture-safe-area-top');return result;});assert(safe.overlayTop>=safe.headerBottom-1,'Safe area causes header/management overlay collision');
  const oldTheme=await page.evaluate(()=>document.documentElement.dataset.theme);await page.locator('.theme-switcher button').focus();await page.keyboard.press('Enter');assert.notEqual(await page.evaluate(()=>document.documentElement.dataset.theme),oldTheme);
  await page.evaluate(()=>window.renderHeader('admin',true));await page.locator('.admin-open').waitFor();
  await page.screenshot({path:'audit/header-mail/navbar-375.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(`audit/header-mail/navbar-${phase}.json`,JSON.stringify({rows,physicalDevice:false},null,2));console.log('Navbar '+phase+' PASS: '+rows.length+' role/width/theme/runtime views; fixture callbacks, not a device.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
