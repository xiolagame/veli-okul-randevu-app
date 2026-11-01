import assert from 'node:assert/strict';import fs from 'node:fs';import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:3035';
const state=await (await fetch(base+'/__local_preview__/state')).json();assert.equal(state.synthetic,true);
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});const rows=[];
fs.mkdirSync('audit/master/screenshots',{recursive:true});
try{
 for(const role of ['teacher','security','parent','admin','platform']){
  const account=state.accounts.find(a=>a.role===role),width=['admin','platform'].includes(role)?1280:390;
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});const errors=[];
  await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.name+': '+e.message.replace(/eyJ[\w.-]+/g,'[redacted]')));
  await page.goto(base+'/login',{waitUntil:'domcontentloaded'});await page.locator('#phone-centric-phone').waitFor();
  assert.equal(await page.getByText('Girişe uygun numaralar WhatsApp koduyla doğrulanır.',{exact:true}).count(),0);assert(await page.getByText('Doğrulama kodunuz WhatsApp üzerinden gönderilecektir.',{exact:true}).isVisible());
  await page.getByRole('button',{name:'Koyu mod',exact:true}).filter({visible:true}).click();
  await page.locator('#phone-centric-phone').fill(account.phone);
  await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();
  await page.locator('#phone-centric-code').waitFor();
  assert(await page.locator('#phone-centric-code').isVisible(),'Successful provider request opens OTP directly');
  const delivered=await(await fetch(base+'/__local_preview__/state')).json();assert.match(delivered.otp[account.phone],/^\d{6}$/);
  await page.locator('#phone-centric-code').fill(delivered.otp[account.phone]);
  await page.getByRole('button',{name:'Kodu Doğrula',exact:true}).click();
  if(role==='platform'){
   await page.locator('#phone-centric-email-code').waitFor();const factor=await(await fetch(base+'/__local_preview__/state')).json();
   assert.match(factor.emailCode,/^\d{6}$/);assert.equal(await page.locator('.profile-trigger').count(),0);
   await page.locator('#phone-centric-email-code').fill(factor.emailCode);await page.getByRole('button',{name:'Aktivasyonu Tamamla',exact:true}).click();
  }
  await page.locator('.profile-trigger').waitFor({timeout:20000});
  if(role==='admin'){
   await page.getByRole('button',{name:'Personel',exact:true}).click();
   await page.getByRole('button',{name:'+ Personel Ekle',exact:true}).click();
   await page.getByLabel('Görevi',{exact:true}).selectOption('security');assert.equal(await page.locator('#staff-email').count(),0);
   await page.getByLabel('Görevi',{exact:true}).selectOption('teacher');assert(await page.locator('#staff-email').isVisible());assert.equal(await page.locator('#staff-email').getAttribute('required'),'');
   await page.getByRole('button',{name:'İptal',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:/[Ss]istem [Gg]ünlüğü|[İi]şlem günlüğü/}).count(),0);
  }
  for(const theme of ['dark','light']){
   if(theme==='light'){
    const toggle=page.getByRole('button',{name:'Açık mod',exact:true}).filter({visible:true});
    await toggle.click();
   }
   for(const viewWidth of [375,390,430,1280]){
    await page.setViewportSize({width:viewWidth,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),role+' '+theme+' overflow '+viewWidth);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
    await page.screenshot({path:`audit/master/screenshots/${role}-${theme}-${viewWidth}.png`,fullPage:true});
    rows.push({role,theme,width:viewWidth,kind:'Chromium + actual local PostgreSQL/API, mock delivery'});
   }
  }
  await page.reload();await page.locator('.profile-trigger').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
  await page.locator('.profile-trigger').click();await page.getByRole('button',{name:'Oturumu kapat',exact:true}).click();
  await page.locator('#phone-centric-phone').waitFor();assert.equal(await page.locator('.profile-trigger').count(),0);
  assert.deepEqual(errors,[]);await context.close();
 }
 // Unknown and provider-error requests must remain below the phone field, without OTP.
 const page=await browser.newPage({viewport:{width:375,height:812}});await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});await page.locator('#phone-centric-phone').fill('05559999999');await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();
 const alert=page.locator('#phone-centric-error [role=alert]');await alert.waitFor();
 assert.equal(await alert.textContent(),'Bu numara sisteme kayıtlı değil.');assert((await alert.getAttribute('class')).includes('tone-danger'));
 assert.equal(await page.locator('#phone-centric-code').count(),0);assert.equal(await page.locator('.tone-info').count(),0);
 assert(await page.evaluate(()=>document.querySelector('#phone-centric-error').getBoundingClientRect().top>=document.querySelector('#phone-centric-phone').getBoundingClientRect().bottom));
 for(const theme of ['light','dark']){
  await page.evaluate(t=>{document.documentElement.dataset.theme=t},theme);
  const color=await alert.evaluate(el=>getComputedStyle(el).color);const channels=color.match(/[0-9.]+/g).map(Number);
  assert(channels[0]>channels[1]&&channels[0]>channels[2],'Error text must be red in '+theme);
 }
 await page.locator('#phone-centric-phone').fill('0555');await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();await page.getByText('Geçerli bir Türkiye GSM numarası girin.',{exact:true}).waitFor();assert.equal(await page.locator('#phone-centric-code').count(),0);
 await page.route('**/api/auth/phone/request-code',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Doğrulama mesajı gönderilemedi. Lütfen tekrar deneyin.'})}));
 await page.locator('#phone-centric-phone').fill('05551230002');await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();await page.getByText('Doğrulama mesajı gönderilemedi. Lütfen tekrar deneyin.',{exact:true}).waitFor();assert.equal(await page.locator('#phone-centric-code').count(),0);assert.equal(await page.locator('.tone-info').count(),0);
 const welcome=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'no-preference'});
 await welcome.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 await welcome.goto(base+'/',{waitUntil:'domcontentloaded'});await welcome.locator('.web-welcome').waitFor();
 await welcome.locator('.welcome-hit-login-top').click();await welcome.locator('video').waitFor();
 await welcome.getByRole('button',{name:'Geçişi atla',exact:true}).click();await welcome.locator('#phone-centric-phone').waitFor();assert.equal(await welcome.locator('video').count(),0);
 fs.writeFileSync('audit/master/ui-results.json',JSON.stringify({rows,unknownNoAutomaticOtp:true,themePersistence:true,logout:true,webCinematic:true,physicalDevice:false},null,2));
 console.log('Staff preview UI PASS: 5 actual local roles, 2 themes, 4 widths (40 views), persisted session/theme, teacher/security forms, admin audit absent, platform second factor and unknown-number negative flow. No physical device.');
}finally{await browser.close();}
