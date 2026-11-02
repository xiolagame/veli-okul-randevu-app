import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const moduleSpecifier = process.env.PLAYWRIGHT_MODULE
  ? (process.env.PLAYWRIGHT_MODULE.match(/^[A-Za-z]:[\\/]/)
      ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
      : process.env.PLAYWRIGHT_MODULE)
  : 'playwright';
const { chromium } = await import(moduleSpecifier);
const browser = await chromium.launch({ headless: true, channel: process.env.CHROMIUM_CHANNEL || 'chrome' });
const outputDir = new URL('../previews/', import.meta.url);
await mkdir(outputDir, { recursive: true });

const sizes = [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [393, 852],
  [430, 932],
];
const results = [];
// Default to the built web client, avoiding dev-server polling/cold-start timing.
// API calls are intercepted below; this server has no backend or data connection.
const staticRoot = path.resolve('dist/client');
const server = process.env.PREVIEW_URL ? null : http.createServer((req,res) => {
  const file = path.resolve(staticRoot,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(staticRoot+path.sep)&&file!==staticRoot){res.writeHead(403).end();return;}
  const target=fs.existsSync(file)&&fs.statSync(file).isFile()?file:path.join(staticRoot,'index.html');
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(target)]||'text/html');res.end(fs.readFileSync(target));
});
if(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref();}
const previewUrl = process.env.PREVIEW_URL || `http://127.0.0.1:${server.address().port}/login`;
assert(['localhost','127.0.0.1'].includes(new URL(previewUrl).hostname), 'Layout test must use a local preview');

try {
for (const [width, height] of sizes) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(previewUrl).origin ? route.continue() : route.abort());
  await page.route('**/api/public/auth-capabilities', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ whatsappAuthEnabled: true, unifiedLoginEnabled: true, phoneCentricAuthEnabled: true }),
  }));
  await page.route('**/api/auth/phone/request-code', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      message: 'Test kodu hazır.',
      attemptId: 'local-layout-test',
      challengeId: 'local-layout-challenge',
      expiresInSeconds: 300,
      resendAfterSeconds: 30,
    }),
  }));
  await page.goto(previewUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Okulunuza Hoş Geldiniz' }).waitFor();
  assert.equal(await page.getByText('Telefon Numaranızla Giriş Yapın', { exact: true }).count(), 0);
  const layout = await page.evaluate(() => {
    const cta = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Lisans / İletişim'));
    const rect = cta?.getBoundingClientRect();
    const style = getComputedStyle(document.body);
    return {
      innerWidth,
      innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      ctaTop: rect?.top ?? -1,
      ctaBottom: rect?.bottom ?? -1,
      backgroundImage: style.backgroundImage,
    };
  });
  assert.equal(layout.scrollWidth, width, `${width}x${height}: yatay taşma`);
  // Small phones may scroll; preserve readable controls instead of squeezing the approved design.
  const cta=page.getByRole('button',{name:'Lisans / İletişim',exact:true});
  await cta.scrollIntoViewIfNeeded();
  const visibleCta=await cta.boundingBox();
  assert.ok(visibleCta && visibleCta.y>=0 && visibleCta.y+visibleCta.height<=height+1, `${width}x${height}: Lisans / İletişim kaydırmayla da erişilemiyor`);
  assert.ok(visibleCta.height>=44,'Dokunma hedefi küçültülmemeli');
  await page.evaluate(()=>scrollTo(0,0));
  assert.match(layout.backgroundImage, /rgba\(17, 82, 59, 0\.7\)/);
  assert.match(layout.backgroundImage, /rgba\(42, 45, 48, 0\.56\)/);
  assert.match(layout.backgroundImage, /04-Mobil\.png/);

  if (width === 390) {
    await page.screenshot({ path: new URL('mobile-login-390x844.png', outputDir).pathname.slice(1), fullPage: true });
    await page.getByLabel('Telefon numaranız').fill('0555 123 45 67');
    await page.getByLabel('Telefon numaranız').focus();
    await page.setViewportSize({ width: 390, height: 500 });
    const keyboardLayout = await page.evaluate(() => {
      const field = document.querySelector('#phone-centric-phone')?.getBoundingClientRect();
      const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('WhatsApp Kodu Gönder'))?.getBoundingClientRect();
      return { fieldTop: field?.top ?? -1, fieldBottom: field?.bottom ?? -1, buttonBottom: button?.bottom ?? -1 };
    });
    assert.ok(keyboardLayout.fieldTop >= 0 && keyboardLayout.fieldBottom <= 500, 'Klavye görünümünde telefon alanı görünür değil');
    assert.ok(keyboardLayout.buttonBottom <= 500, 'Klavye görünümünde devam düğmesi görünür değil');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'WhatsApp Kodu Gönder' }).click();
    await page.getByLabel('WhatsApp doğrulama kodu').waitFor();
    await page.getByRole('heading', { name: 'Okulunuza Hoş Geldiniz' }).waitFor();
    assert.match((await page.evaluate(() => getComputedStyle(document.body).backgroundImage)), /04-Mobil\.png/);
    await page.screenshot({ path: new URL('mobile-otp-390x844.png', outputDir).pathname.slice(1), fullPage: true });
  }
  results.push({ width, height, ...layout });
  await page.close();
}

} finally {
  await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify(results, null, 2));
console.log('MOBILE AUTH LAYOUT TEST: PASS');
