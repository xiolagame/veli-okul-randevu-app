import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { preview } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const urls = [
  'https://apps.apple.com/tr/app/veli-randevu/id6823597940?l=tr',
  'https://play.google.com/store/apps/details?id=com.velirandevu.app',
];
const sizes = [[1920, 1080], [1600, 900], [1440, 900], [1366, 768],
  [1280, 720], [1024, 768], [390, 844], [375, 667], [360, 800], [375, 580]];
const output = 'audit/web-store-downloads';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function withPreview(outDir, callback) {
  const server = await preview({ configFile: false, build: { outDir },
    preview: { host: '127.0.0.1', port: 0 } });
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  try {
    await callback(origin);
  } finally {
    await new Promise(resolve => server.httpServer.close(resolve));
  }
}

async function mockRequests(page, origin, navigations) {
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (urls.includes(url)) {
      navigations.push(url);
      await route.fulfill({ status: 204, body: '' });
    } else if (new URL(url).pathname.startsWith('/api/')) {
      await route.fulfill({ json: { whatsappAuthEnabled: true,
        phoneCentricAuthEnabled: true, unifiedLoginEnabled: true } });
    } else if (new URL(url).origin === origin) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
}

try {
  await withPreview('dist/client', async origin => {
    for (const [width, height] of sizes) {
      const mobile = width < 768;
      const page = await browser.newPage({ viewport: { width, height },
        hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce' });
      try {
        const navigations = [];
        await mockRequests(page, origin, navigations);
        await page.goto(origin);
        const cards = page.getByRole('link', { name: /Veli Randevu · (App Store|Google Play)/ });
        await cards.first().waitFor();
        assert.equal(await cards.count(), 2);
        await page.evaluate(() => document.fonts.ready);
        const layout = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
          visible: [...document.querySelectorAll('.web-welcome button,.web-welcome h1,.web-welcome p,.welcome-store-card')]
            .filter(el => el.getClientRects().length && !el.classList.contains('welcome-accessible'))
            .map(el => {
              const { left, top, right, bottom } = el.getBoundingClientRect();
              return { text: el.textContent.trim(), left, top, right, bottom };
            }),
        }));
        assert(layout.width <= width && layout.height <= height, JSON.stringify({ width, height, ...layout }));
        for (const rect of layout.visible) {
          assert(rect.left >= -1 && rect.top >= -1 && rect.right <= width + 1 &&
            rect.bottom <= height + 1, JSON.stringify(rect));
        }
        for (let index = 0; index < urls.length; index++) {
          const card = cards.nth(index);
          assert.equal(await card.getAttribute('href'), urls[index]);
          const bounds = await card.boundingBox();
          assert(bounds.width >= 44 && bounds.height >= 44);
          const badge = card.locator('.welcome-store-badge');
          assert(await badge.evaluate(img => img.complete && img.naturalWidth > 0));
          const qr = card.locator('.welcome-store-qr');
          assert.equal(await qr.isVisible(), !mobile);
          if (!mobile) {
            assert(await qr.evaluate(img => img.complete && img.naturalWidth > 0));
            if (width === 1024) await qr.screenshot({ path: `${output}/qr-${index}.png` });
          }
        }
        await page.screenshot({ path: `${output}/${width}x${height}.png` });
        for (let index = 0; index < urls.length; index++) {
          const card = cards.nth(index);
          if (mobile) {
            await card.tap({ position: { x: 5, y: 5 } });
          } else if (index === 0) {
            for (let step = 0; step < 20; step++) {
              await page.keyboard.press('Tab');
              if (await card.evaluate(el => el === document.activeElement)) break;
            }
            assert(await card.evaluate(el => el === document.activeElement &&
              el.matches(':focus-visible') && getComputedStyle(el).outlineStyle === 'solid'));
            await page.keyboard.press('Enter');
          } else {
            await card.locator('.welcome-store-qr').click();
          }
          for (let attempt = 0; attempt < 40 && !navigations.includes(urls[index]); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          assert(navigations.includes(urls[index]));
        }
        assert.deepEqual(navigations, urls);
        await page.getByRole('button', { name: 'Giriş Yap', exact: true }).last().click();
        await page.locator('.welcome-auth').waitFor();
        assert.equal(await cards.count(), 0);
        console.log(`${width}x${height} PASS — fit, badges, QR visibility, links and login`);
      } finally {
        await page.close();
      }
    }
  });
  for (const mode of ['ios', 'android']) {
    await withPreview(`.cache/store-downloads-${mode}`, async origin => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      try {
        await mockRequests(page, origin, []);
        await page.goto(origin);
        await page.locator('.auth-layout').waitFor();
        assert.equal(await page.locator('.web-welcome,.welcome-downloads').count(), 0);
        const assets = `.cache/store-downloads-${mode}/assets`;
        const files = await fs.readdir(assets);
        assert(!files.some(name => /^(apple|google)(-qr)?-/.test(name)));
        for (const file of files.filter(name => /\.(js|css)$/.test(name))) {
          const contents = await fs.readFile(`${assets}/${file}`, 'utf8');
          assert(!contents.includes('welcome-store-card') && !urls.some(url => contents.includes(url)));
        }
        console.log(`${mode} PASS — native-mode login and store assets excluded`);
      } finally {
        await page.close();
      }
    });
  }
} finally {
  await browser.close();
}
