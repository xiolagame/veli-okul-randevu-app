import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=`window.authFixture={resolve:null,reject:null,legacy:false,logins:0,requests:0,codeError:false,sessionError:false};
export const api={getAuthCapabilities:()=>new Promise((resolve,reject)=>{window.authFixture.resolve=resolve;window.authFixture.reject=reject;}),
requestPhoneCentricCode:async()=>{window.authFixture.requests++;return window.authFixture.legacy?{legacyFallbackRequired:true}:{attemptId:'fixture-'+window.authFixture.requests,challengeId:'fixture',resendAfterSeconds:60};},
verifyPhoneCentricCode:async()=>{if(window.authFixture.codeError)throw Error('Kod geçersiz veya süresi dolmuş. Yeni kod isteyin.');return{pendingEmail:true,requiresSchoolCode:true};},
verifyPhoneCentricEmail:async()=>({token:'fixture',user:{id:'fixture'},memberships:[]})};`;
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{AuthView}from'./src/components/AuthView';createRoot(document.getElementById('root')).render(<AuthView onOpenPublicRequest={()=>{}} onOpenHelp={()=>{}}/>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'synthetic-auth',setup(b){
  b.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));
  b.onResolve({filter:/context\/AppContext$/},()=>({path:'context',namespace:'fixture'}));
  b.onResolve({filter:/platform\/runtime-platform$/},()=>({path:'runtime',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='api'?fixture:a.path==='runtime'?`export const getRuntimePlatform=()=> 'IOS';export const isNativeRuntime=()=>false;`:`export const useApp=()=>({login:async()=>{throw Error('Password login must not run')},whatsappLogin:async()=>{if(window.authFixture.sessionError)return{ok:false};window.authFixture.logins++;return{ok:true}}});`}));
}}]});
const css=fs.readdirSync('dist/client/assets').filter(p=>p.endsWith('.css')).map(p=>fs.readFileSync(path.join('dist/client/assets',p),'utf8')).join('\n');
const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/style.css'?css:'<!doctype html><html lang="tr" data-runtime-platform="ios"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort());
 const open=async()=>{await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('status').waitFor();assert.equal(await page.locator('input[type=password]').count(),0);};
 const ready=async()=>{await page.evaluate(()=>window.authFixture.resolve({whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}));await page.locator('#phone-centric-phone').waitFor();};
 await open();await page.evaluate(()=>window.authFixture.reject(Error('fixture')));await page.getByRole('button',{name:'Tekrar dene'}).waitFor();assert.equal(await page.locator('input[type=password]').count(),0);
 await open();await page.evaluate(()=>window.authFixture.resolve({whatsappAuthEnabled:false,phoneCentricAuthEnabled:false}));await page.getByText('WhatsApp ile giriş şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.').waitFor();assert.equal(await page.locator('input[type=password]').count(),0);
 await open();await ready();await page.evaluate(()=>{window.authFixture.legacy=true;});await page.locator('#phone-centric-phone').fill('05551234567');await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();await page.getByText(/Doğrulama kodu gönderilmedi/).waitFor();assert.equal(await page.locator('input[type=password]').count(),0);
 await open();await ready();
 for(const [width,height] of [[320,740],[375,812],[390,844],[430,932],[507,768],[768,1024],[820,1180],[1024,768],[1180,820],[844,390]]){await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}x${height}`);}
 await page.setViewportSize({width:390,height:844});await page.locator('#phone-centric-phone').fill('05551234567');await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();await page.locator('#phone-centric-code').waitFor();assert.equal(await page.locator('#phone-centric-code').getAttribute('autocomplete'),'one-time-code');assert(await page.getByRole('button',{name:/Yeniden gönder/}).isDisabled());
 await page.evaluate(()=>{window.authFixture.codeError=true;});await page.locator('#phone-centric-code').fill('123456');await page.getByRole('button',{name:'Kodu Doğrula',exact:true}).click();await page.getByText('Kod geçersiz veya süresi dolmuş. Yeni kod isteyin.').waitFor();assert.equal(await page.evaluate(()=>window.authFixture.logins),0);
 // Advance wall time without delivering timer ticks, then simulate foreground/pageshow.
 await page.clock.install();await page.clock.setSystemTime(new Date(Date.now()+65000));await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));assert(await page.getByRole('button',{name:'Kodu yeniden gönder',exact:true}).isEnabled());
 await page.getByRole('button',{name:'Kodu yeniden gönder',exact:true}).click();assert.equal(await page.evaluate(()=>window.authFixture.requests),2);assert.equal(await page.locator('#phone-centric-code').inputValue(),'');assert(await page.getByRole('button',{name:/Yeniden gönder/}).isDisabled());
 await page.evaluate(()=>{window.authFixture.codeError=false;window.authFixture.sessionError=true;});
 await page.locator('#phone-centric-code').fill('123456');await page.getByRole('button',{name:'Kodu Doğrula',exact:true}).click();await page.locator('#phone-centric-email-code').fill('654321');await page.locator('#phone-centric-school-code').fill('TEST001');await page.getByRole('button',{name:'Aktivasyonu Tamamla',exact:true}).click();await page.getByText('Oturum başlatılamadı. Lütfen tekrar deneyin.').waitFor();assert.equal(await page.evaluate(()=>window.authFixture.logins),0);assert.equal(await page.locator('input[type=password]').count(),0);await page.evaluate(()=>{window.authFixture.sessionError=false;});await page.getByRole('button',{name:'Aktivasyonu Tamamla',exact:true}).click();await page.waitForFunction(()=>window.authFixture.logins===1);await open();await ready();assert.equal(await page.locator('#phone-centric-code').count(),0);assert.deepEqual(errors,[]);
 await page.addInitScript(()=>{const viewport=new EventTarget();Object.assign(viewport,{height:300,offsetTop:0});Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});});
 await open();await ready();await page.setViewportSize({width:390,height:844});await page.locator('#phone-centric-phone').fill('05551234567');await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();await page.locator('#phone-centric-code').focus();await page.evaluate(()=>window.visualViewport.dispatchEvent(new Event('resize')));await page.clock.runFor(350);await page.waitForFunction(()=>document.querySelector('#phone-centric-code').getBoundingClientRect().bottom<=300,null,{timeout:3000});
 const keyboard=await page.locator('#phone-centric-code').evaluate(e=>({bottom:e.getBoundingClientRect().bottom,font:parseFloat(getComputedStyle(e).fontSize),inset:document.querySelector('.auth-form-side').style.getPropertyValue('--auth-keyboard-inset')}));fs.writeFileSync('audit/phase3a/keyboard-metrics.json',JSON.stringify({...keyboard,...await page.evaluate(()=>({y:scrollY,height:innerHeight,scrollHeight:document.documentElement.scrollHeight,active:document.activeElement?.id,padding:getComputedStyle(document.querySelector('.auth-form-side')).paddingBottom}))}));assert(keyboard.bottom<=300,'OTP field obscured in simulated keyboard viewport');assert(keyboard.font>=16);assert.equal(keyboard.inset,'544px');
 await page.screenshot({path:'audit/ios-auth-phone.png',fullPage:true});
 console.log('Rendered iOS auth PASS: loading/error/disabled, no downgrade, expiry error, suspended wall-clock/resend, admin email, session failure/restart, 375/390/430/768/820/1024/1180 layouts and simulated 300px keyboard viewport. Synthetic Chromium; no real OTP/device/API.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
