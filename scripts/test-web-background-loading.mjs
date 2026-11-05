import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';

// Real production frontend; only API/external services are mocked. No live writes.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const baseline=process.argv.includes('--baseline');
const out=path.resolve('audit/background-loading',baseline?'before':'after');
fs.mkdirSync(out,{recursive:true});
const root=path.resolve('dist/client');
const server=http.createServer((req,res)=>{
  let file=path.resolve(root,'.'+decodeURI(req.url.split('?')[0]));
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()) file=path.join(root,'index.html');
  const size=fs.statSync(file).size;
  const type={'.js':'text/javascript','.css':'text/css','.png':'image/png','.mp4':'video/mp4','.html':'text/html'}[path.extname(file)]||'application/octet-stream';
  res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');
  const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if(range){const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):size-1,size-1);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});fs.createReadStream(file,{start,end}).pipe(res);}
  else{res.setHeader('Content-Length',size);fs.createReadStream(file).pipe(res);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try{
 for(const width of baseline?[1440]:[1440,390])for(const scenario of baseline?['normal']:['normal','slow-3g','high-latency','video-delay','image-delay','image-failure']){
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:'light'});
  const page=await context.newPage(),requests=[],errors=[];
  page.on('request',r=>{if(r.url().includes('school-background.png'))requests.push(r.url());});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=route.request().url();
   if(url.includes('/api/')){await route.fulfill({status:200,json:{whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}});return;}
   if(!url.startsWith(origin)){await route.abort();return;}
   if(scenario==='video-delay'&&url.includes('transition.mp4'))await new Promise(r=>setTimeout(r,10000));
   if(scenario==='image-delay'&&/\.(png|webp|jpg)(\?|$)/.test(url))await new Promise(r=>setTimeout(r,10000));
   if(scenario==='image-failure'&&/\.(png|webp|jpg)(\?|$)/.test(url)){await route.abort();return;}
   await route.continue().catch(()=>{});
  });
  const cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  if(['slow-3g','high-latency'].includes(scenario))await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:scenario==='slow-3g'?400:1500,downloadThroughput:scenario==='slow-3g'?50000:-1,uploadThroughput:50000});
  await page.addInitScript(()=>{
   window.backgroundEvidence={frames:0,legacy:[],phases:[]};
   const inspect=()=>{
    const e=window.backgroundEvidence;e.frames++;
    const candidates=[document.body,document.querySelector('.school-background'),document.querySelector('.welcome-auth'),document.querySelector('.welcome-transition')].filter(Boolean);
    for(const node of candidates)for(const pseudo of [null,'::before','::after'])if(getComputedStyle(node,pseudo).backgroundImage.includes('school-background.png'))e.legacy.push({frame:e.frames,node:node.className,pseudo});
    const phase=document.querySelector('.welcome-transition')?'video':document.querySelector('.welcome-auth')?'login':document.querySelector('.web-welcome')?'welcome':'boot';
    if(e.phases.at(-1)!==phase)e.phases.push(phase);
    requestAnimationFrame(inspect);
   };requestAnimationFrame(inspect);
  });
  for(const visit of baseline?['first']:['first','reload']){
   const prefix=`${width}-${scenario}-${visit}`;
   if(visit==='reload'){await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:120000});await page.reload({waitUntil:'domcontentloaded',timeout:120000});}
   else await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:120000});
   await page.locator('.web-welcome').waitFor({timeout:120000});
   await page.screenshot({path:path.join(out,prefix+'-welcome.png'),timeout:120000});
   await page.locator(width>=1280?'.welcome-hit-login':'.welcome-actions button').last().click();
   await page.locator('.welcome-transition').waitFor();
   await page.screenshot({path:path.join(out,prefix+'-video-start.png'),timeout:120000});
   let shots=0;
   while(await page.locator('.welcome-transition').count()){
    await page.waitForTimeout(500);
    if(shots<20){await page.screenshot({path:path.join(out,`${prefix}-transition-${shots++}.png`),timeout:120000});}
   }
   await page.locator('.welcome-auth:not(.is-preparing)').waitFor();
   await page.screenshot({path:path.join(out,prefix+'-login.png'),timeout:120000});
   const evidence=await page.evaluate(()=>({...window.backgroundEvidence,surface:getComputedStyle(document.querySelector('.welcome-auth')).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth}));
   results.push({width,scenario,visit,oldRequests:requests.length,errors:[...errors],...evidence});
   if(baseline)assert(requests.length>0&&evidence.legacy.length>0,'Baseline must reproduce legacy layer');
   else{assert.equal(requests.length,0,prefix+': old image requested');assert.equal(evidence.legacy.length,0,prefix+': legacy CSS layer');assert.equal(evidence.overflow,false,prefix+': overflow');assert.equal(evidence.surface,'rgb(23, 62, 48)',prefix+': stable login fallback');assert.equal(errors.length,0,prefix+': JS errors');assert(evidence.phases.includes('video')&&evidence.phases.includes('login'));}
  }
  await context.close();
  console.log(`${width} ${scenario} ${baseline?'baseline reproduced':'PASS (first/reload, cache disabled)'}`);
 }
 if(!baseline){
  const css=fs.readdirSync(path.join(root,'assets')).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(root,'assets',f),'utf8')).join('\n');
  assert(!css.includes('/branding/school-background.png'),'Old image cannot be referenced by bundled CSS');
 }
}finally{
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
 await browser.close();await new Promise(r=>server.close(r));
}
