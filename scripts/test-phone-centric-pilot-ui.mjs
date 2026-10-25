import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root=process.cwd();
const contents=`import React from 'react';import{createRoot}from'react-dom/client';import{PhoneCentricLoginPanel}from'./src/components/PhoneCentricLoginPanel';window.pilotTest={fallbacks:0,verifyCalls:0};const native=new URLSearchParams(location.search).has('native');createRoot(document.getElementById('root')).render(<PhoneCentricLoginPanel allowLegacyFallback={native} onLegacyFallback={()=>window.pilotTest.fallbacks++}/>);`;
const result=await build({stdin:{contents,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'isolated-pilot-response',setup(b){
 b.onResolve({filter:/context\/AppContext$/},()=>({path:'context',namespace:'fixture'}));
 b.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='context'?`export const useApp=()=>({whatsappLogin:async()=>{throw Error('Unexpected login')}});`:`export const api={requestPhoneCentricCode:async()=>({success:true,message:'Kod gönderilebildiyse kısa süre içinde WhatsApp hesabınıza ulaşacaktır.',legacyFallbackRequired:true}),verifyPhoneCentricCode:async()=>{window.pilotTest.verifyCalls++;throw Error('Unexpected verification')}};`}));
}}]});
const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?result.outputFiles[0].text:'<!doctype html><html lang="tr"><meta charset="utf-8"><div id="root"></div><script src="/app.js"></script></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort());
 const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base);await page.getByLabel('Telefon numaranız',{exact:true}).fill('05551234567');await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();
 const alert=page.getByRole('alert');await alert.waitFor();assert.match(await alert.innerText(),/şu anda kullanılamıyor\. Doğrulama kodu gönderilmedi\./);
 assert.doesNotMatch(await alert.innerText(),/kayıtlı değil|kayıtsız/);assert.equal(await page.getByLabel('WhatsApp doğrulama kodu',{exact:true}).count(),0);assert.equal(await page.getByText('Lütfen telefonunuza gelen WhatsApp onay kodunu girin.',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>window.pilotTest.fallbacks),0);assert.equal(await page.evaluate(()=>window.pilotTest.verifyCalls),0);assert(await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).isEnabled());
 await page.goto(base+'/?native');await page.getByLabel('Telefon numaranız',{exact:true}).fill('05551234567');await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();await page.waitForFunction(()=>window.pilotTest.fallbacks===1);assert.equal(await page.getByRole('alert').count(),0);assert.deepEqual(errors,[]);
 console.log('Phone-centric pilot refusal UI PASS: HTTP 200/success is not delivery, no code screen/login/enumeration, explicit no-send message, existing native fallback preserved. Mock response; no real messages.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
