import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';import {execFileSync} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const before=process.argv.includes('--baseline');
const fixture=`window.authBoot={resolve:null,reject:null,calls:0,codeCalls:0};export const api={getAuthCapabilities:()=>{window.authBoot.calls++;return new Promise((resolve,reject)=>Object.assign(window.authBoot,{resolve,reject}));},requestPhoneCentricCode:async()=>{window.authBoot.codeCalls++;return{attemptId:'fixture',challengeId:'fixture',resendAfterSeconds:60}}};`;
const bundle=await build({stdin:{contents:"import React from'react';import{createRoot}from'react-dom/client';import{AuthView}from'./src/components/AuthView';createRoot(document.getElementById('root')).render(<AuthView onOpenHelp={()=>{}} onOpenPublicRequest={()=>{}}/>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"VITE_REVIEW_API_ORIGIN":"https://veli-review-demo.duckdns.org"}'},plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/services\/api$|context\/AppContext$|platform\/runtime-platform$|platform\/android-system-bars$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.endsWith('/api')?fixture:a.path.endsWith('/AppContext')?'export const useApp=()=>({login:async()=>({ok:true}),whatsappLogin:async()=>({ok:true})});':a.path.endsWith('/runtime-platform')?"export const getRuntimePlatform=()=> 'ANDROID';export const isNativeRuntime=()=>false;":"export const setAndroidLoginSurface=()=>{};"}));
 if(before)b.onLoad({filter:/login-capability-policy\.ts$/},()=>({loader:'ts',contents:execFileSync('git',['show','d3121b2:src/platform/login-capability-policy.ts'],{encoding:'utf8'})}));
}}]});
const css=fs.readdirSync('dist/client/assets').filter(n=>n.endsWith('.css')).map(n=>fs.readFileSync('dist/client/assets/'+n,'utf8')).join('\n');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/style.css'?css:'<!doctype html><html data-runtime-platform="android"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});const rows=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await page.addInitScript(()=>{
  window.formEvents=[];
  const scan=node=>{if(!(node instanceof Element))return;for(const selector of ['#login-phone','#phone-centric-phone','input[type=password]'])if(node.matches(selector)||node.querySelector(selector))window.formEvents.push(selector);};
  new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)scan(n);}).observe(document,{subtree:true,childList:true});
 });
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.request().url()==='https://veli-review-demo.duckdns.org/api/review/login'?r.fulfill({status:401,json:{error:'Sentetik inceleme reddedildi.'}}):r.abort());
 const open=async theme=>{await page.goto(origin);await page.getByRole('button',{name:theme==='dark'?'Koyu mod':'Açık mod',exact:true}).filter({visible:true}).click();await page.waitForFunction(()=>window.authBoot.resolve);};
 if(before){await open('light');assert(await page.locator('#login-phone').isVisible());await page.evaluate(()=>authBoot.resolve({whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}));await page.locator('#phone-centric-phone').waitFor();assert((await page.evaluate(()=>formEvents)).includes('#login-phone'));console.log('Baseline defect REPRODUCED: capability pending renders password form, then true response replaces it with WhatsApp.');}
 else{
  for(const theme of ['light','dark'])for(const mode of ['phone','legacy','error','malformed']){
   await open(theme);await page.waitForTimeout(500);
   assert.deepEqual(await page.evaluate(()=>formEvents),[],'No guessed form while capability pending');
   await page.getByRole('status').filter({hasText:'Giriş seçenekleri yükleniyor'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Mağaza inceleme erişimi',exact:true}).count(),1);
   if(mode==='error')await page.evaluate(()=>authBoot.reject(Error('Synthetic offline')));
   else await page.evaluate(mode=>authBoot.resolve(mode==='malformed'?{}:{whatsappAuthEnabled:mode==='phone',unifiedLoginEnabled:mode==='phone',phoneCentricAuthEnabled:mode==='phone'}),mode);
   if(mode==='error'||mode==='malformed'){
    await page.getByRole('button',{name:'Tekrar dene',exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>formEvents),[]);
    await page.getByRole('button',{name:'Tekrar dene',exact:true}).click();await page.waitForFunction(()=>authBoot.calls===2);assert.deepEqual(await page.evaluate(()=>formEvents),[]);
    await page.evaluate(()=>authBoot.resolve({whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}));
   }
   const selected=mode==='legacy'?'#login-phone':'#phone-centric-phone';await page.locator(selected).waitFor();
   const events=await page.evaluate(()=>formEvents);assert(!events.includes(mode==='legacy'?'#phone-centric-phone':'#login-phone'));
   await page.locator(selected).fill('05551234567');const element=await page.locator(selected).elementHandle();
   await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));});
   assert.equal(await page.locator(selected).inputValue(),'0555 123 45 67');assert(await page.locator(selected).evaluate((n,e)=>n===e,element));
   assert.equal(await page.evaluate(()=>authBoot.calls),mode==='error'||mode==='malformed'?2:1);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));rows.push({theme,mode,events,selected,kind:'Synthetic Chromium AuthView'});
  }
  fs.mkdirSync('audit/android-startup',{recursive:true});fs.writeFileSync('audit/android-startup/auth-view-matrix.json',JSON.stringify(rows,null,2));console.log('Android auth startup PASS: 8 theme/capability cases; deferred/error/malformed/retry have no forms, authoritative ready response selects one form; stable field identity/value on pageshow; review entry retained. Chromium fixture, not a physical WebView test.');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
