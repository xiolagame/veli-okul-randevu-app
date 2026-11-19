import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const entry = `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AuthView}from'./src/components/AuthView';import{Dialog}from'./src/components/ui';
function Test(){const[open,setOpen]=useState(true);return new URLSearchParams(location.search).has('dialog')?(open?<Dialog title={'UZUNOKULADI'.repeat(25)} onClose={()=>setOpen(false)}><p>{'Uzun açıklama '.repeat(150)}</p><label>Son alan<input aria-label="Son alan"/></label><button onClick={()=>setOpen(false)}>Tamam</button></Dialog>:<p>Kapandı</p>):<AuthView onOpenOnboarding={()=>{}}/>}createRoot(document.getElementById('root')).render(<Test/>);`;
const apiFixture = `
window.authTest={calls:[],capabilities:null,fallback:false,failVerify:false};
export const api={
getAuthCapabilities:()=>new Promise((resolve,reject)=>{window.authTest.capabilities={resolve,reject}}),
requestPhoneCentricCode:async()=>{window.authTest.calls.push('request');return window.authTest.fallback?{legacyFallbackRequired:true}:{attemptId:'synthetic-attempt',challengeId:'synthetic-challenge',resendAfterSeconds:0,expiresInSeconds:300}},
verifyPhoneCentricCode:async()=>{window.authTest.calls.push('verify');if(window.authTest.failVerify)throw Error('Sentetik kod geçersiz');return{pendingEmail:true,attemptId:'synthetic-attempt',requiresSchoolCode:true}},
verifyPhoneCentricEmail:async()=>{window.authTest.calls.push('verify-email');return{token:'synthetic-session',user:{id:'synthetic-admin'},memberships:[]}}
};`;
const bundle = await build({ stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'local-only-fixtures',setup(b){
 b.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));
 b.onResolve({filter:/context\/AppContext$/},()=>({path:'context',namespace:'fixture'}));
 b.onResolve({filter:/platform\/runtime-platform$/},()=>({path:'runtime',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path:p})=>({loader:'js',contents:p==='api'?apiFixture:p==='runtime'?`export const getRuntimePlatform=()=>window.testPlatform;export const isNativeRuntime=()=>window.testPlatform!=='WEB';`:`export const useApp=()=>({authStorageError:false,accountDeletionNotice:null,login:async()=>{window.authTest.calls.push('password-login')},whatsappLogin:async()=>{window.authTest.calls.push('session')}});`}));
}}] });
const css=fs.readdirSync('dist/client/assets').filter(n=>n.endsWith('.css')).map(n=>fs.readFileSync(path.join('dist/client/assets',n),'utf8')).join('\n');
const server=http.createServer((req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script>window.testPlatform=new URLSearchParams(location.search).get('platform')||'ANDROID';if(window.testPlatform==='ANDROID')document.documentElement.dataset.runtimePlatform='android';</script><script src="/bundle.js"></script></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const results=[];let browser;
async function scenario(name,run){try{await run();results.push({name,status:'PASS'});console.log('PASS '+name)}catch(e){results.push({name,status:'FAIL',error:e.message});console.error('FAIL '+name+': '+e.message)}}
async function open(platform='ANDROID',viewport={width:375,height:812},suffix=''){
 const page=await browser.newPage({viewport,reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await page.goto(origin+'/?platform='+platform+suffix);return page;
}
const caps={whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true};
async function enable(page,value=caps){await page.waitForFunction(()=>window.authTest.capabilities);await page.evaluate(value=>window.authTest.capabilities.resolve(value),value);await page.waitForTimeout(40);}
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 await scenario('Android and web wait for capabilities; failure stays closed and retry works',async()=>{
  for(const platform of ['ANDROID','WEB']){const page=await open(platform);try{
   await page.waitForFunction(()=>window.authTest.capabilities);
   assert.equal(await page.locator('input[type=password]').count(),0,'password form exposed before capabilities: '+platform);
   await page.evaluate(()=>window.authTest.capabilities.reject(Error('synthetic offline')));
   await page.getByText('Giriş seçenekleri alınamadı.',{exact:false}).waitFor();assert.equal(await page.locator('input[type=password]').count(),0);
   await page.getByRole('button',{name:'Tekrar dene',exact:true}).click();await enable(page);await page.locator('#phone-centric-phone').waitFor();
  }finally{await page.close()}}
 });
 await scenario('Android refuses legacy response and disabled capabilities without password fallback',async()=>{
  const page=await open();try{await enable(page);await page.evaluate(()=>window.authTest.fallback=true);await page.locator('#phone-centric-phone').fill('05551234567');await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();await page.getByText('Doğrulama kodu gönderilmedi.',{exact:false}).waitFor({timeout:3000});assert.equal(await page.locator('input[type=password]').count(),0);assert.equal(await page.evaluate(()=>window.authTest.calls.includes('password-login')),false);}finally{await page.close()}
  const off=await open();try{await enable(off,{...caps,phoneCentricAuthEnabled:false});await off.getByText('WhatsApp ile giriş şu anda kullanılamıyor.',{exact:false}).waitFor({timeout:3000});assert.equal(await off.locator('input[type=password]').count(),0)}finally{await off.close()}
 });
 await scenario('OTP error preserves phone; admin email and school-code step remain available',async()=>{
  const page=await open();try{await enable(page);await page.locator('#phone-centric-phone').fill('05551234567');await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();await page.locator('#phone-centric-code').fill('123456');await page.evaluate(()=>window.authTest.failVerify=true);await page.locator('form').filter({has:page.locator('#phone-centric-code')}).locator('button[type=submit]').click();await page.getByText('Sentetik kod geçersiz',{exact:true}).waitFor();assert.equal(await page.locator('#phone-centric-phone').inputValue(),'0555 123 45 67');await page.evaluate(()=>window.authTest.failVerify=false);await page.locator('form').filter({has:page.locator('#phone-centric-code')}).locator('button[type=submit]').click();await page.locator('#phone-centric-email-code').waitFor();await page.locator('#phone-centric-school-code').waitFor();assert.equal(await page.locator('input[type=date]').count(),0);assert.equal(await page.locator('input[type=password]').count(),0);}finally{await page.close()}
 });
 await scenario('Long Android dialog header stays inside phone, landscape and reduced viewport',async()=>{
  for(const viewport of [{width:320,height:640},{width:375,height:812},{width:812,height:375},{width:375,height:320}]){
   const page=await open('ANDROID',viewport,'&dialog=1');try{await page.getByRole('dialog').waitFor();const bounds=await page.evaluate(()=>{const p=document.querySelector('[role=dialog]'),close=document.querySelector('[aria-label="Pencereyi kapat"]'),r=p.getBoundingClientRect(),c=close.getBoundingClientRect();return{scroll:p.scrollWidth,width:p.clientWidth,left:c.left,right:c.right,viewport:innerWidth,bottom:r.bottom,height:innerHeight}});assert(bounds.scroll<=bounds.width+1,JSON.stringify(bounds));assert(bounds.left>=0&&bounds.right<=bounds.viewport,JSON.stringify(bounds));assert(bounds.bottom<=bounds.height+1,JSON.stringify(bounds));await page.getByRole('button',{name:'Pencereyi kapat'}).click();await page.getByText('Kapandı',{exact:true}).waitFor();}finally{await page.close()}
  }
 });
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));fs.mkdirSync('.cache/phase2b',{recursive:true});fs.writeFileSync('.cache/phase2b/auth-layout-results.json',JSON.stringify(results,null,2));}
if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
