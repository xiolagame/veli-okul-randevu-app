import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
fs.mkdirSync('audit/theme',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const rows=[];
function luminance(hex){const c=hex.trim().replace('#','');const v=[0,2,4].map(i=>parseInt(c.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
try{
 const page=await browser.newPage({viewport:{width:390,height:844},colorScheme:'light'});
 await page.route('**/api/**',r=>r.fulfill({json:{whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}}));
 for(const theme of ['light','dark'])for(const path of ['/','/yardim','/yardim/veli','/lisans-iletisim']){
  await page.goto('http://127.0.0.1:3005'+path);await page.getByRole('button',{name:theme==='dark'?'Koyu mod':'Açık mod',exact:true}).filter({visible:true}).first().click();
  await page.reload();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
  const tokens=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return Object.fromEntries(['text','surface','muted','input','placeholder'].map(k=>[k,s.getPropertyValue('--theme-'+k).trim().replace(/^#fff$/,'#ffffff')]));});
  assert(contrast(tokens.text,tokens.surface)>=4.5);
  assert(contrast(tokens.muted,tokens.surface)>=4.5);
  assert(contrast(tokens.placeholder,tokens.input)>=4.5);
  for(const width of [320,360,375,390,393,430,820,1180]){
   await page.setViewportSize({width,height:844});
   const row=await page.evaluate(()=>{
    const el=document.querySelector('.auth-form-wrap,.help-guide,.help-hero,.public-request-page-card');
    const s=getComputedStyle(el||document.body);
    return {width:innerWidth,scroll:document.documentElement.scrollWidth,color:s.color,background:s.backgroundColor};
   });
   assert.ok(row.scroll<=width,path+' '+theme+' overflow '+width+' got '+row.scroll);rows.push({path,theme,...row});
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'audit/theme/'+(path==='/'?'login':path.replaceAll('/','-'))+'-'+theme+'.png',fullPage:true});
 }
 await page.goto('http://127.0.0.1:3005/');await page.getByRole('button',{name:'Koyu mod',exact:true}).filter({visible:true}).first().click();await page.reload();
 assert.equal(await page.evaluate(()=>localStorage.getItem('veli.theme')),'dark');
 fs.writeFileSync('audit/theme/results.json',JSON.stringify(rows,null,2));console.log('Theme UI PASS: 64 route/theme/width cases, preference reload, screenshots. Synthetic Chrome.');
}finally{await browser.close();}
