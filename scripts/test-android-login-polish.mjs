// Actual compiled Android review assets, isolated HTTP server and synthetic bridges/API.
// This checks layout and native-call contracts, not OS bar pixels or a physical IME.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = path.resolve('dist/client');
const output = 'audit/android-login-polish';
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep)) file = root + '/index.html';
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = root + '/index.html';
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
async function pageFor(theme, platform = 'android', viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(({ theme, platform }) => {
    if (!localStorage.getItem('veli.theme')) localStorage.setItem('veli.theme', theme);
    window.systemBarCalls = [];
    window.CapacitorCustomPlatform = { name: platform };
    const methods = {
      SecureStorage: ['internalGetItem', 'internalSetItem', 'internalRemoveItem', 'internalGetPrefixedKeys', 'internalClearItemsWithPrefix', 'setSynchronizeKeychain'],
      App: ['getLaunchUrl', 'getState', 'addListener', 'removeListener'],
      Network: ['getStatus', 'addListener', 'removeListener'], Keyboard: ['addListener', 'removeListener'],
      PushNotifications: ['checkPermissions', 'addListener', 'removeListener'],
      AndroidSystemBars: ['apply'], StatusBar: ['setStyle', 'setBackgroundColor'], SplashScreen: ['hide'],
    };
    window.Capacitor = {
      PluginHeaders: Object.entries(methods).map(([name, list]) => ({ name, methods: list.map(name => ({ name, rtype: name === 'addListener' ? 'callback' : 'promise' })) })),
      nativeCallback: () => 'synthetic-listener',
      nativePromise: async (plugin, method, options) => {
        if (plugin === 'AndroidSystemBars') window.systemBarCalls.push(options);
        if (plugin === 'SecureStorage') return method === 'internalGetItem' ? { data: '' } : method === 'internalGetPrefixedKeys' ? { keys: [] } : { success: true };
        if (method === 'getStatus') return { connected: true, connectionType: 'wifi' };
        if (method === 'getState') return { isActive: true };
        if (method === 'checkPermissions') return { receive: 'prompt' };
        return {};
      },
    };
  }, { theme, platform });
  const page = await context.newPage();
  let calls = 0, capabilityError = false;
  const reviews = [];
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api/')) {
      calls++;
      if (u.pathname === '/api/public/auth-capabilities') return route.fulfill(capabilityError
        ? { status: 503, json: { error: 'Synthetic offline' } }
        : { json: { whatsappAuthEnabled: true, unifiedLoginEnabled: true, phoneCentricAuthEnabled: true } });
      if (u.pathname === '/api/auth/phone/request-code') return route.fulfill({ json: { attemptId: 'synthetic-attempt', challengeId: 'synthetic-challenge', resendAfterSeconds: 60 } });
      if (u.pathname === '/api/auth/phone/verify-code') return route.fulfill({ status: 401, json: { error: 'Sentetik kod reddedildi.' } });
      if (u.origin === 'https://veli-review-demo.duckdns.org' && u.pathname === '/api/review/login') {
        reviews.push({ origin: u.origin, method: route.request().method() });
        return route.fulfill({ status: 401, json: { error: 'Sentetik inceleme reddedildi.' } });
      }
      return route.fulfill({ status: 401, json: { error: 'Synthetic unauthorized' } });
    }
    return u.origin === origin ? route.continue() : route.abort();
  });
  await page.goto(origin);
  await page.locator('#phone-centric-phone').waitFor();
  return { page, context, count: () => calls, reviews, failCapabilities: value => { capabilityError = value; } };
}
async function capture(page, name) {
  const metrics = await page.evaluate(() => {
    const heading = document.querySelector('#auth-heading');
    const h = heading.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(heading).lineHeight);
    const brand = document.querySelector('.auth-mobile-brand .brand-name').getBoundingClientRect();
    const theme = document.querySelector('.auth-mobile-brand .theme-switcher').getBoundingClientRect();
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      brandControlOverlap: brand.left < theme.right && brand.right > theme.left && brand.top < theme.bottom && brand.bottom > theme.top,
      headingLines: Math.round(h.height / line),
      heading: heading.textContent, photo: getComputedStyle(document.body).backgroundImage,
      targets: [...document.querySelectorAll('.auth-mobile-brand .theme-switcher button,.auth-form-wrap .ui-button,.auth-form-wrap .auth-help-link')].map(e => e.getBoundingClientRect().height) };
  });
  assert(metrics.scrollWidth <= metrics.width + 1, 'horizontal overflow: ' + name);
  assert.equal(metrics.brandControlOverlap, false, 'brand/theme overlap: ' + name);
  assert.equal(metrics.heading, 'Okulunuza Hoş Geldiniz');
  assert(metrics.photo.includes('04-Mobil.png'));
  assert(metrics.targets.every(height => height >= 48), 'touch target smaller than 48: ' + name);
  await page.screenshot({ path: output + '/' + name + '.png', fullPage: true, animations: 'disabled', mask: [page.locator('input[type=password]')] });
  return metrics;
}
try {
  for (const theme of ['light', 'dark']) {
    for (const [width, height] of [[320, 568], [360, 640], [375, 667], [390, 844], [412, 915], [430, 932]]) {
      const f = await pageFor(theme, 'android', { width, height });
      try {
        const metrics = await capture(f.page, theme + '-' + width);
        assert(metrics.headingLines <= (width >= 360 ? 1 : 2), 'heading wraps excessively');
        assert.equal(await f.page.locator('.auth-help-label-android').innerText(), 'Yardım ve yasal bilgiler');
        const help = await f.page.locator('.auth-help-label-android').evaluate(e => ({ height: e.getBoundingClientRect().height, line: parseFloat(getComputedStyle(e).lineHeight) }));
        assert(help.height <= help.line * 1.2, 'compact help wraps');
        assert(await f.page.getByRole('button', { name: 'Mağaza inceleme erişimi', exact: true }).isVisible());
        const native = await f.page.evaluate(() => window.systemBarCalls);
        assert(native.some(c => c.login === true && c.theme === theme), 'login surface did not reach native chrome');
        results.push({ name: theme + '-' + width, status: 'PASS', metrics });
      } finally { await f.context.close(); }
    }
    const f = await pageFor(theme);
    try {
      const alternate = theme === 'light' ? 'dark' : 'light';
      const before = f.count();
      await f.page.locator('.auth-mobile-brand').getByRole('button', { name: alternate === 'light' ? 'Açık mod' : 'Koyu mod', exact: true }).click();
      assert.equal(await f.page.locator('html').getAttribute('data-theme'), alternate);
      assert.equal(f.count(), before, 'theme triggered an API request');
      assert((await f.page.evaluate(() => window.systemBarCalls)).some(c => c.login === true && c.theme === alternate));
      const stored = await f.page.evaluate(() => localStorage.getItem('veli.theme'));
      assert.equal(stored, alternate);
      await f.page.reload();
      await f.page.locator('#phone-centric-phone').waitFor();
      assert.equal(await f.page.locator('html').getAttribute('data-theme'), alternate);
      await f.page.getByLabel('Telefon numaranız', { exact: true }).fill('0555 123 45 67');
      await f.page.getByRole('button', { name: 'WhatsApp Kodu Gönder', exact: true }).click();
      await f.page.locator('#phone-centric-code').waitFor();
      await capture(f.page, theme + '-otp');
      await f.page.locator('#phone-centric-code').fill('000000');
      await f.page.getByRole('button', { name: 'Kodu Doğrula', exact: true }).click();
      await f.page.getByText('Sentetik kod reddedildi.', { exact: true }).waitFor();
      await capture(f.page, theme + '-otp-error');
      await f.page.getByRole('button', { name: 'Telefonu değiştir', exact: true }).click();
      await f.page.getByRole('button', { name: 'Mağaza inceleme erişimi', exact: true }).click();
      await f.page.getByLabel('İnceleme kimliği').fill('synthetic-review');
      await f.page.getByLabel('İnceleme parolası').fill('synthetic-only-not-a-real-password');
      await f.page.getByRole('button', { name: 'Demo okuluna gir', exact: true }).click();
      await f.page.getByText('Sentetik inceleme reddedildi.', { exact: true }).waitFor();
      assert.deepEqual(f.reviews, [{ origin: 'https://veli-review-demo.duckdns.org', method: 'POST' }]);
      await f.page.keyboard.press('Escape');
      await f.page.getByRole('button', { name: 'Yardım, Kullanım Rehberi ve Yasal Bilgiler', exact: true }).click();
      await f.page.locator('.help-page').waitFor();
      assert((await f.page.evaluate(() => window.systemBarCalls)).some(c => c.login === false && c.theme === alternate));
      results.push({ name: theme + '-otp-review-theme-help-native-contracts', status: 'PASS' });
    } finally { await f.context.close(); }

    const scaled = await pageFor(theme, 'android', { width: 320, height: 568 });
    try {
      await scaled.page.evaluate(() => document.documentElement.style.fontSize = '200%');
      await capture(scaled.page, theme + '-large-type');
      await scaled.page.evaluate(() => document.documentElement.style.fontSize = '');
      await scaled.page.setViewportSize({ width: 390, height: 320 });
      await scaled.page.locator('#phone-centric-phone').focus();
      await scaled.page.getByRole('button', { name: 'WhatsApp Kodu Gönder', exact: true }).scrollIntoViewIfNeeded();
      await capture(scaled.page, theme + '-keyboard-viewport');
      await scaled.page.setViewportSize({ width: 390, height: 844 });
      await scaled.page.evaluate(() => { document.documentElement.style.setProperty('--safe-area-inset-top', '28px'); document.documentElement.style.setProperty('--safe-area-inset-bottom', '24px'); });
      const padding = await scaled.page.locator('.auth-form-side').evaluate(e => ({ top: parseFloat(getComputedStyle(e).paddingTop), bottom: parseFloat(getComputedStyle(e).paddingBottom) }));
      assert(padding.top >= 40 && padding.bottom >= 36);
      await capture(scaled.page, theme + '-insets');
      scaled.failCapabilities(true);
      await scaled.page.reload();
      // Preserve Android's existing legacy fallback on capability failure.
      // iOS uses a different retry contract; this visual task must not rewrite it.
      await scaled.page.locator('#login-phone').waitFor();
      assert.equal(await scaled.page.locator('#auth-heading').innerText(), 'Okulunuza Hoş Geldiniz');
      scaled.failCapabilities(false);
      await scaled.page.reload();
      await scaled.page.locator('#phone-centric-phone').waitFor();
      results.push({ name: theme + '-scaled-text-keyboard-insets-capability-refresh', status: 'PASS' });
    } finally { await scaled.context.close(); }
  }
  // No Android chrome calls or compact labels on the shared iOS source.
  const ios = await pageFor('light', 'ios');
  try {
    assert.equal(await ios.page.locator('.auth-help-label-full').isVisible(), true);
    assert.equal(await ios.page.locator('.auth-help-label-android').isVisible(), false);
    assert.deepEqual(await ios.page.evaluate(() => window.systemBarCalls), []);
    results.push({ name: 'ios-isolation', status: 'PASS' });
  } finally { await ios.context.close(); }
  console.log('Android login polish PASS: six widths, both themes, font reflow, keyboard viewport, safe-area simulation, OTP/review mocks and native bridge contracts. Physical device NOT TESTED.');
} finally {
  fs.writeFileSync(output + '/layout-results.json', JSON.stringify({ results, physicalDevice: 'NOT TESTED', realOtpSent: false, allRemoteRequestsMockedOrBlocked: true }, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
