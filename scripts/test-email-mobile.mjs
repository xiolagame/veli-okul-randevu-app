import assert from 'node:assert/strict';import fs from 'node:fs';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'chrome',headless:true});const rows=[];
try{
 const page=await browser.newPage({viewport:{width:375,height:812}});
 await page.route('**/*',r=>r.request().url().endsWith('/branding/veli-randevu-logo.png')?r.fulfill({contentType:'image/png',body:fs.readFileSync('public/branding/veli-randevu-logo.png')}):r.abort());
 for(let index=0;index<7;index++)for(const width of [320,375,390,430,768]){
  await page.setViewportSize({width,height:812});await page.setContent(fs.readFileSync(`audit/header-mail/code-${index}.html`,'utf8'));
  const card=await page.locator('[data-email-code]').boundingBox(),greeting=await page.locator('p').filter({hasText:/^Merhaba/}).boundingBox();
  assert(card&&greeting&&card.y+card.height<=greeting.y,'Code is below greeting');
  assert(card.y+card.height<500,'Code is too far down on mobile');
  assert.equal(await page.locator('[data-email-preheader]').isVisible(),false,'Preheader leaked into body');
  const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,codeFont:getComputedStyle(document.querySelector('[data-email-code] td td div:last-child')).fontSize}));
  assert(metrics.scroll<=width+1,'Email overflow');assert(parseInt(metrics.codeFont)>=30,'Code is too small');rows.push({template:index,width,codeBottom:card.y+card.height,greetingY:greeting.y,...metrics});
  if(index===4&&width===375)await page.screenshot({path:'audit/header-mail/platform-code-375.png',fullPage:true});
 }
 fs.writeFileSync('audit/header-mail/email-mobile.json',JSON.stringify({rows,kind:'Synthetic code, Chromium HTML rendering; Gmail/iPhone Mail NOT TESTED'},null,2));
 console.log('Email mobile PASS: 35 template/viewport cases, code above greeting and in first viewport, hidden preheader, 320–768px no overflow. Not Gmail/Mail device testing.');
}finally{await browser.close();}
