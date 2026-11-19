import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const {chromium,webkit}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root=path.resolve('dist/client');
const css=fs.readdirSync(root+'/assets').filter(n=>n.endsWith('.css')).map(n=>fs.readFileSync(root+'/assets/'+n,'utf8')).join('\n');
const fixture=`const school={id:'synthetic',name:'SENTETİK TEST OKULU',code:'TEST01'};
 export const api={getSchoolInfo:async()=>({school}),getOperationSummary:async()=>({counts:{today:12,'pending-appointments':3,teachers:24,'pending-parents':5,'pending-staff':2,missing:0},statuses:{booked:6,pending:3,checked_in:1,checked_out:2}})};`;
const context=`export const useApp=()=>({currentSchool:{id:'synthetic',name:'SENTETİK TEST OKULU'},refreshSchoolData:async()=>{},refreshPlatformSchools:async()=>{},users:[],teachers:[],appointments:[],settings:{schoolName:'SENTETİK TEST OKULU',defaultSlotMinutes:15,minSlotMinutes:10,allowParentCancel:true},auditLogs:[],isPlatformAdmin:true,platformContextActive:true});`;
const bundle=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import{AdminView}from'./src/components/AdminView';createRoot(document.getElementById('root')).render(<AdminView/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',plugins:[{name:'synthetic-school',setup(b){b.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));b.onResolve({filter:/context\/AppContext$/},()=>({path:'context',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='api'?fixture:context}));}}]});
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/dashboard.js'){res.setHeader('content-type','application/javascript');return res.end(bundle.outputFiles[0].text);}
 if(u.pathname==='/dashboard'){res.setHeader('content-type','text/html');return res.end(`<!doctype html><html lang="tr" data-web-scene="school"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${css}</style><div class="school-background"></div><div id="root"></div><script src="/dashboard.js"></script></html>`);}
 if(u.pathname.startsWith('/api/')){res.setHeader('content-type','application/json');if(u.pathname==='/api/public/auth-capabilities')return res.end(JSON.stringify({whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}));res.statusCode=503;return res.end('{}');}
 let file=path.resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())file=root+'/index.html';
 res.setHeader('content-type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
fs.mkdirSync('.cache/ui-reminder-review',{recursive:true});
try{
 for(const [engine,type] of [['chromium',chromium],...(fs.existsSync(webkit.executablePath())?[['webkit',webkit]]:[])]){
  const browser=await type.launch(engine==='chromium'?{channel:'chrome',headless:true}:{headless:true});
  try{const page=await browser.newPage();const errors=[];let writes=0;
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes++;});
   await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
   for(const [width,height] of [[1920,1080],[1440,900],[1366,768],[768,1024],[430,932],[390,844],[375,667]]){
    await page.setViewportSize({width,height});await page.goto(origin+'/dashboard');await page.getByRole('region',{name:'Operasyon Merkezi'}).waitFor();
    const backdrop=await page.locator('.admin-backdrop').evaluate(e=>{const s=getComputedStyle(e);return{image:s.backgroundImage,size:s.backgroundSize};});
    assert(backdrop.image.includes('rgba(6, 59, 33, 0.64)'),JSON.stringify(backdrop));assert.equal(backdrop.size.split(',').at(-1).trim(),'cover');
    assert.equal(await page.locator('.surface').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if([390,1366].includes(width))await page.screenshot({path:`.cache/ui-reminder-review/dashboard-${engine}-${width}.png`});
    await page.goto(origin+'/login');await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).waitFor();
    const state=await page.evaluate(()=>{const e=document.querySelector('.welcome-auth');const s=getComputedStyle(e,'::before');return{html:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor,size:s.backgroundSize,position:s.position,pointer:s.pointerEvents,rootHeight:document.getElementById('root').getBoundingClientRect().height};});
    assert.equal(state.html,'rgb(7, 27, 22)');assert.equal(state.body,state.html);assert.equal(state.size.split(',').at(-1).trim(),'cover');assert.equal(state.position,'fixed');assert.equal(state.pointer,'none');assert(state.rootHeight>=height-1);
    await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if([390,1366].includes(width)){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`.cache/ui-reminder-review/login-${engine}-${width}.png`,fullPage:true});}
   }
   await page.setViewportSize({width:390,height:480});await page.getByRole('textbox',{name:'Telefon numaranız',exact:true}).focus();await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).scrollIntoViewIfNeeded();assert(await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).isVisible());
   assert.equal(writes,0);assert.deepEqual(errors,[]);console.log(engine+' background UI PASS: actual AdminView, opaque cards, dark scene, login cover/no deformation, root continuity, responsive 375–1920px and reduced viewport; no sends.');
  }finally{await browser.close();}
 }
}finally{await new Promise(r=>server.close(r));}
