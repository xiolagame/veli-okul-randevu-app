import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const content = await readFile('src/content/help-content.ts', 'utf8');
const slugs = [...content.matchAll(/slug: '([^']+)'/g)].map(m => m[1]);
const routes = ['/yardim', ...new Set(slugs.map(s => '/yardim/' + s)), '/yardim/olmayan-sayfa', '/lisans-iletisim'];
await mkdir('previews', {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
let checks = 0;
for (const [width,height] of [[320,568],[360,640],[375,667],[390,844],[393,852],[430,932]]) {
  const page = await browser.newPage({viewport:{width,height}});
  await page.route('**/api/**', r => r.fulfill({json:{whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}}));
  for (const path of routes) {
    await page.goto('http://127.0.0.1:3002'+path);
    const back = page.locator('.public-page-back');
    await back.waitFor();
    assert.equal(await page.locator('main .brand').count(),0,path);
    const box = await back.boundingBox();
    assert.ok(box.height>=48 && box.y>=0);
    for (const state of ['normal','hover','focus']) {
      if(state==='hover') await back.hover();
      if(state==='focus') await back.focus();
      const colors = await back.evaluate(e=>[getComputedStyle(e).color,getComputedStyle(e.querySelector('svg')).color]);
      assert.deepEqual(colors,['rgb(255, 255, 255)','rgb(255, 255, 255)']);
    }
    const dims = await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:innerWidth}));
    assert.ok(dims.w<=dims.h,path+': horizontal overflow');
    if(width===390 && ['/yardim','/lisans-iletisim'].includes(path)) {
      await page.screenshot({path:'previews/'+(path==='/yardim'?'help':'license')+'-390x844.png',fullPage:true});
    }
    await back.click();
    await page.locator('.auth-mobile-brand .brand').waitFor();
    await page.getByRole('heading',{name:'Okulunuza Hoş Geldiniz'}).waitFor();
    checks++;
  }
  await page.close();
}
await browser.close();
console.log('PASS: '+checks+' route/viewport cases; logo absent, white text/arrow normal-hover-focus, 48px target, no horizontal overflow, return to unchanged login.');
