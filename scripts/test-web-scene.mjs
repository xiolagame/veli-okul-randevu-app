import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root=path.resolve('dist/client'),css=fs.readdirSync(path.join(root,'assets')).filter(x=>x.endsWith('.css')).map(x=>fs.readFileSync(path.join(root,'assets',x),'utf8')).join('\n');
// Execute the actual startup file for each runtime; only application content and
// platform navigation are replaced to avoid session/native side effects.
const boot=await build({entryPoints:['src/main.tsx'],bundle:true,write:false,format:'iife',define:{'import.meta.hot':'false'},loader:{'.css':'empty'},plugins:[{name:'runtime-fixture',setup(b){
 b.onResolve({filter:/^\.\/App$/},()=>({path:'app',namespace:'fixture'}));
 b.onResolve({filter:/context\/AppContext$/},()=>({path:'context',namespace:'fixture'}));
 b.onResolve({filter:/platform\/runtime-platform$/},()=>({path:'runtime',namespace:'fixture'}));
 b.onResolve({filter:/platform\/native-navigation-intent$/},()=>({path:'navigation',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path:p})=>({loader:'js',resolveDir:process.cwd(),contents:p==='app'?`import React from'react';export default()=>React.createElement('div',{className:'admin-backdrop'},React.createElement('section',{className:'surface'},'Synthetic school panel'));`:p==='context'?`export const AppProvider=({children})=>children;`:p==='runtime'?`export const getRuntimePlatform=()=>window.testRuntime;`:`export const subscribeToNativeNavigationIntents=()=>()=>{};`}));
}}]});
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/runtime.js'){res.setHeader('Content-Type','application/javascript');return res.end(boot.outputFiles[0].text)}
 if(u.pathname==='/runtime-check'){res.setHeader('Content-Type','text/html');return res.end(`<meta charset="utf-8"><style>${css}</style><div class="school-background"></div><div id="root"></div><script>window.testRuntime=${JSON.stringify(u.searchParams.get('platform'))}</script><script src="/runtime.js"></script>`)}
 if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');if(u.pathname==='/api/public/auth-capabilities')return res.end(JSON.stringify({whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}));res.statusCode=503;return res.end('{}')}
 let file=path.resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+path.sep)){file=path.join(root,'index.html')}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(root,'index.html');
 const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.mp4':'video/mp4'};res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 for(const platform of ['WEB','ANDROID','IOS']){
  await page.goto(origin+'/runtime-check?platform='+platform);await page.getByText('Synthetic school panel').waitFor();
  const state=await page.evaluate(()=>({runtime:document.documentElement.dataset.webScene,background:getComputedStyle(document.querySelector('.school-background')).backgroundImage,admin:getComputedStyle(document.querySelector('.admin-backdrop')).backgroundImage,surface:getComputedStyle(document.querySelector('.surface')).backgroundColor}));
  assert.equal(state.runtime,platform==='WEB'?'school':undefined);
  assert.equal(state.background.includes('/welcome/login-scene.png'),platform==='WEB');
  assert.equal(state.admin.includes('/welcome/login-scene.png'),platform==='WEB');
  assert.equal(state.surface,'rgb(255, 255, 255)');
 }
 let submissionCount=0;page.on('request',r=>{if(r.method()==='POST')submissionCount++});
 for(const width of [390,768,1366,1440,1920]){
  await page.setViewportSize({width,height:width===1920?1080:width===1366?768:900});
  for(const route of ['/login','/yardim','/lisans-iletisim','/lisans-iletisim?request=contact']){
   await page.goto(origin+route);await page.locator('main').waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.webScene),'school');
   assert(await page.locator('.school-background').evaluate(e=>getComputedStyle(e).backgroundImage.includes('/welcome/login-scene.png')));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+route+' '+width);
   assert.equal(await page.locator('input[type="password"]').count(),0);
   if(route!=='/login'){
    const scene=await page.locator('.school-background').evaluate(e=>getComputedStyle(e).backgroundImage);
    assert(scene.includes('rgba(6, 59, 33, 0.7)')&&scene.includes('rgba(19, 32, 49, 0.56)'),'dark public scene');
    if(width>=1366)assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),'vertical overflow '+route+' '+width);
   }
   if(route.startsWith('/lisans-iletisim')){
    for(const id of ['request-plan','request-school','request-contact','request-email','request-phone','request-message'])assert(await page.locator('#'+id).isVisible(),'missing field '+id);
    const submit=page.getByRole('button',{name:'Talebi Gönder'});assert(await submit.isVisible());
    if(width>=1366)assert((await submit.boundingBox()).y+(await submit.boundingBox()).height<= (await page.viewportSize()).height,'submit below viewport');
    await submit.click();await page.getByText('Lütfen okul adını girin.',{exact:true}).waitFor();
    if(width>=1366)assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),'error state overflow '+width);
    await page.locator('#request-school').fill('Sentetik okul');await page.locator('#request-contact').fill('Sentetik kişi');await page.locator('#request-email').fill('invalid');await submit.click();await page.getByText('E-posta adresini kontrol edin.',{exact:true}).waitFor();
   }
   if([390,1366,1440,1920].includes(width)){await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:'.cache/welcome-review/shared-'+route.slice(1).replaceAll('?','-').replaceAll('=','-')+'-'+width+'.png',fullPage:true});}
  }
 }
 // Every actual help-card destination inherits its parent category theme.
 for(const width of [1366,390]){
  await page.setViewportSize({width,height:width===1366?768:844});await page.goto(origin+'/yardim');await page.locator('.help-category').first().waitFor();
  const links=await page.locator('.help-topic-link').evaluateAll(items=>items.map(e=>({href:e.getAttribute('href'),theme:e.closest('[data-help-theme]').dataset.helpTheme,title:e.querySelector('strong').textContent})));
  assert.equal(links.length,13);
  for(const item of links){
   await page.goto(origin+'/yardim');await page.locator('.help-topic-link[href="'+item.href+'"]').click();
   const target=item.theme==='support'?page.locator('.public-request-page'):page.locator('.help-guide');await target.waitFor();
   assert.equal(await target.getAttribute('data-help-theme'),item.theme);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'guide overflow '+item.href);
   if(item.theme!=='support'){
    assert(await target.locator('.help-guide-section').count()>0);
    assert(await target.locator('.help-category-art').isVisible());
    assert.notEqual(await target.evaluate(e=>getComputedStyle(e).getPropertyValue('--help-accent').trim()),'');
   }
   if(['/yardim/veli','/yardim/hesap-guvenligi','/yardim/gizlilik-politikasi'].includes(item.href))await page.screenshot({path:'.cache/welcome-review/themed-'+item.theme+'-'+width+'.png',fullPage:true});
  }
 }
 assert.equal(submissionCount,0,'no request may be submitted');
 console.log('Web scene PASS: WEB-only startup, native backgrounds unchanged, actual help/license/contact at 390/768/1366/1440/1920px, no desktop scroll, form validation/zero submissions; all 13 category links and all 12 guide themes plus support form checked at desktop/mobile.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
