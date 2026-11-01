import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const phase=process.argv[2]||'after',base=process.env.PREVIEW_URL||'http://127.0.0.1:3035';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
const rows=[];let savedStorage;
const watchdog=setTimeout(()=>{console.error('Navigation measurement timed out');process.exit(1)},180000);
try{
 for(const [width,theme] of [[1280,'dark'],[820,'light'],[390,'dark']]){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',...(savedStorage?{storageState:savedStorage}:{})});
  const page=await context.newPage();const requests=[];let slow=false;
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==base)return route.abort();
   if(slow&&url.pathname.startsWith('/api/schools/')&&route.request().method()==='GET'){
    const start=performance.now();const response=await route.fetch();const backendMs=performance.now()-start;
    await new Promise(r=>setTimeout(r,2000));
    requests.push({path:url.pathname+url.search,backendMs,artificialNetworkMs:2000});
    return route.fulfill({response});
   }
   return route.continue();
  });
  console.log('Measuring '+width+' '+theme);
  await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
  if(!savedStorage){
  await page.locator('#phone-centric-phone').fill('05551230001');
  await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();
  await page.locator('#phone-centric-code').waitFor();
  const state=await(await fetch(base+'/__local_preview__/state')).json();
  await page.locator('#phone-centric-code').fill(state.otp['+905551230001']);
  await page.getByRole('button',{name:'Kodu Doğrula',exact:true}).click();
  }
  console.log('Session ready');
  await page.locator('.admin-header h2').waitFor();
  console.log('Admin ready');
  if(phase==='after'&&!savedStorage)savedStorage=await context.storageState();
  await page.waitForTimeout(400);slow=true;
  if(await page.evaluate(()=>document.documentElement.dataset.theme||'light')!==theme)await page.getByRole('button',{name:theme==='dark'?'Koyu mod':'Açık mod',exact:true}).filter({visible:true}).click();
  for(const [tab,label,repeat] of [['roster','Öğrenci ve veliler',false],['users','Personel',false],['dashboard','Genel bakış',true],['roster','Öğrenci ve veliler',true],['users','Personel',true],['dashboard','Genel bakış',true]]){
   const count=requests.length;
   const started=performance.now();
   if(width<768)await page.locator('#admin-section').selectOption(tab);
   else await page.locator('.admin-nav').getByRole('button',{name:label,exact:true}).click();
   await page.locator('.admin-header h2').filter({hasText:label}).waitFor();
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const shellMs=performance.now()-started;
   const skeletons=await page.locator('#main-content .skeleton-list:visible').count();
   const filters=tab!=='roster'||await page.locator('#student-record-search').isVisible();
   const cachedRows=tab!=='roster'||await page.locator('.student-record-row').count()>0;
   const skeletonColor=skeletons?await page.locator('.skeleton-card').first().evaluate(el=>getComputedStyle(el).backgroundColor):null;
   await page.waitForTimeout(2250);
   const calls=requests.slice(count);
   console.log(tab+' '+repeat+' shell='+Math.round(shellMs)+' calls='+calls.length);
   rows.push({width,theme,tab,repeat,shellMs:Math.round(shellMs),skeletons,filters,cachedRows,skeletonColor,calls});
   fs.writeFileSync(`audit/master/navigation-${phase}.json`,JSON.stringify({kind:'Local Chromium, artificial 2000ms network delay',rows},null,2));
   if(phase==='after'){
    assert(shellMs<600,'Shell blocked by API');assert(filters,'Search/filter shell must appear before API');
    if(repeat){assert.equal(skeletons,0,'Cached tab must not flash skeleton');assert.equal(calls.length,0,'Fresh tab must not refetch');assert(cachedRows,'Cached records must be visible immediately');}
   }
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await context.close();
 }
 fs.writeFileSync(`audit/master/navigation-${phase}.json`,JSON.stringify({kind:'Chromium + local API + artificial 2000ms network delay; not production/device',rows},null,2));
 console.log('Navigation '+phase+' measured: '+rows.length+' transitions; '+rows.filter(r=>r.repeat).reduce((n,r)=>n+r.calls.length,0)+' repeated-tab requests.');
}catch(error){console.error(error);throw error;}finally{clearTimeout(watchdog);await browser.close();}
