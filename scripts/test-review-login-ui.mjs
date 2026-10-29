import assert from 'node:assert/strict';
import http from 'node:http';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const entry="import React from'react';import{createRoot}from'react-dom/client';import{ReviewLogin}from'./src/components/ReviewLogin';createRoot(document.getElementById('root')).render(<ReviewLogin/>);";
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{"VITE_REVIEW_API_ORIGIN":"https://review.example.invalid"}'},plugins:[{name:'session-fixture',setup(b){
 b.onResolve({filter:/context\/AppContext$/},()=>({path:'session',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useApp=()=>({whatsappLogin:async(input,result)=>{window.reviewSession={input,result};return {ok:true}}});',loader:'js'}));
}}]});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();let mode='denied';const requests=[];
 const token='e30.'+Buffer.from(JSON.stringify({iss:'veli-review'})).toString('base64url')+'.fixture';
 await page.route('https://review.example.invalid/**',async route=>{
  requests.push(route.request().url());assert.equal(route.request().method(),'POST');
  if(mode==='denied')await route.fulfill({status:401,json:{error:'İnceleme erişimi doğrulanamadı.'}});
  else await route.fulfill({json:{token:mode==='invalid'?'normal-token':token,user:{id:'review-apple-admin'},memberships:[{schoolId:'review-apple'}]}});
 });
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByRole('button',{name:'Mağaza inceleme erişimi',exact:true}).click();
 await page.getByLabel('İnceleme kimliği').fill('review-apple-admin');await page.getByLabel('İnceleme parolası').fill('synthetic-not-a-real-credential');
 const submit=()=>page.getByRole('button',{name:'Demo okuluna gir',exact:true}).click();
 await submit();await page.getByText('İnceleme erişimi doğrulanamadı.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.reviewSession),undefined);
 mode='invalid';await submit();await page.getByText('Geçersiz demo oturumu.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.reviewSession),undefined);
 mode='accepted';await submit();await page.getByRole('dialog').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>window.reviewSession.result.user.id),'review-apple-admin');
 assert(requests.length===3&&requests.every(x=>x==='https://review.example.invalid/api/review/login'));
 console.log('Review login UI PASS: denied/invalid sessions rejected, explicit credential submit, successful session bootstrap; only mocked review endpoint, no WhatsApp request.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
