import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

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

for (const [width, height] of sizes) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
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
  await page.goto('http://127.0.0.1:3002', { waitUntil: 'networkidle' });
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
  assert.ok(layout.scrollHeight <= height + 1, `${width}x${height}: ilk ekranda dikey kaydırma gerekiyor (${layout.scrollHeight}px)`);
  assert.ok(layout.ctaTop >= 0 && layout.ctaBottom <= height, `${width}x${height}: Lisans / İletişim viewport dışında`);
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

await browser.close();
console.log(JSON.stringify(results, null, 2));
console.log('MOBILE AUTH LAYOUT TEST: PASS');
