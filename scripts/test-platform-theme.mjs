import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const entry="import React from'react';import{createRoot}from'react-dom/client';import{SchoolManagement}from'./src/components/SchoolManagement';createRoot(document.getElementById('root')).render(<SchoolManagement initialSection='schools' onClose={()=>{}} onManageSchool={()=>{}} onChanged={async()=>{}}/>);";
const fixture="export const api=new Proxy({getManagedSchools:async()=>({schools:[{id:'fixture',name:'SENTETİK TEST OKULU',code:'TEST',city:'Demo',district:'Demo',licenseStatus:'active',adminStatus:'active'}]}),getPlatformUnseenRequestCount:async()=>({count:0})},{get:(target,name)=>target[name]||(()=>Promise.resolve({}))});";
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{}'},plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'js'}));
}}]});
const css=fs.readdirSync('dist/client/assets').filter(x=>x.endsWith('.css')).map(x=>fs.readFileSync('dist/client/assets/'+x,'utf8')).join('\n');
let theme='light';const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/style.css'?css:`<!doctype html><html data-theme="${theme}"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
try{const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(theme of ['light','dark'])for(const width of [320,390,820,1180]){
  await page.setViewportSize({width,height:844});await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('heading',{name:'SENTETİK TEST OKULU',exact:true}).waitFor();
  const d=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,color:getComputedStyle(document.querySelector('.surface')).color,bg:getComputedStyle(document.querySelector('.surface')).backgroundColor}));
  assert(d.scroll<=width,'Platform overflow '+width);
  if(theme==='dark')assert.equal(d.bg,'rgb(27, 44, 37)');
  await page.getByRole('button',{name:'Devre dışı bırak',exact:true}).click();await page.getByRole('dialog').waitFor();
  if(width===390)await page.screenshot({path:'audit/theme/platform-'+theme+'.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log('Platform theme PASS: light/dark, school list/form and confirmation modal, 320/390/820/1180; synthetic fixture.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
