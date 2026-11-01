import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({reducedMotion:'reduce',viewport:{width:390,height:844}});
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:3035'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:3035/login',{waitUntil:'domcontentloaded'});await page.locator('#phone-centric-phone').waitFor();
 for(const theme of ['dark','light']){
  await page.getByRole('button',{name:theme==='dark'?'Koyu mod':'Açık mod',exact:true}).filter({visible:true}).click();
  const values=await page.evaluate(()=>{
   const card=document.createElement('div');card.className='skeleton-card';card.innerHTML='<span></span>';document.body.append(card);
   const result={background:getComputedStyle(card).backgroundColor,animation:getComputedStyle(card.firstChild).animationName,surface:getComputedStyle(document.documentElement).getPropertyValue('--theme-surface').trim()};card.remove();return result;
  });
  assert.equal(values.animation,'none','Reduced motion must disable pulse');
  if(theme==='dark')assert.notEqual(values.background,'rgb(255, 255, 255)','Dark skeleton must not be white');
  console.log(theme+' skeleton '+values.background+' reduced-motion='+values.animation);
 }
 console.log('Loading theme PASS: actual stylesheet, both themes, 390px and reduced motion. Chromium, not a device.');
}finally{await browser.close();}
