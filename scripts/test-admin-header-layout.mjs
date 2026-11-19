import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const context = `const school={id:'test',name:'TEST SCHOOL'};export const useApp=()=>({
 currentSchool:school,isPlatformAdmin:true,platformContextActive:true,users:[],teachers:[],appointments:[],auditLogs:[],isolationTestResults:[],
 settings:{schoolName:'TEST SCHOOL',defaultSlotMinutes:15,maxBookingDaysAhead:30,allowParentCancel:true},
 refreshSchoolData:async()=>{},refreshPlatformSchools:async()=>{},runIsolationTests:async()=>[]});`;
const bundle = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{AdminView}from'./src/components/AdminView';createRoot(document.getElementById('root')).render(<AdminView/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'navigation-fixtures', setup(b) {
    b.onResolve({ filter: /context\/AppContext$/ }, () => ({ path: 'context', namespace: 'fixture' }));
    b.onResolve({ filter: /services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'context' ? context : 'export const api={};' }));
    b.onResolve({ filter: /^\.\/(StaffManagement|StudentManagement|AuditManagement|BulkRosterImport|SchoolInfo|SchoolAdminManagement|SchoolRequestCenter|OperationsCenter)$/ }, args => ({ path: args.path.slice(2), namespace: 'child' }));
    b.onLoad({ filter: /.*/, namespace: 'child' }, args => ({ loader: 'js', resolveDir:process.cwd(), contents: `import React from 'react';export const ${args.path}=()=>React.createElement('h3',null,'İçerik başlığı');` }));
  } }],
});
const css = fs.readdirSync('dist/client/assets').filter(n => n.endsWith('.css')).map(n => fs.readFileSync(path.join('dist/client/assets', n), 'utf8')).join('\n');
const server = http.createServer((req, res) => {
  res.setHeader('content-type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : `<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:' + server.address().port);
  for (const width of [375, 390, 430, 767, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const section of ['dashboard', 'roster', 'users', 'admins', 'appointments', 'settings', 'audit', 'isolation']) {
      const select = page.getByLabel('Yönetim bölümü', { exact: true });
      if (await select.isVisible()) await select.selectOption(section);
      else {
        const label = await select.locator(`option[value="${section}"]`).textContent();
        await page.getByRole('navigation', { name: 'Yönetim bölümleri' }).getByRole('button', { name: label, exact: true }).click();
      }
      const header = page.locator('.admin-header');
      const box = await header.boundingBox();
      if (width <= 767) {
        assert(box && box.height <= 1, 'mobile header must consume no visible row');
        const layout = await page.evaluate(() => {
          const panel = document.querySelector('.admin-panel').getBoundingClientRect();
          const nav = document.querySelector('.admin-mobile-nav').getBoundingClientRect();
          return { panelTop: panel.top, navTop: nav.top };
        });
        assert.equal(layout.navTop, layout.panelTop, 'no gap before mobile section selector');
        assert(await select.isVisible(), 'mobile section selector retained');
      } else {
        assert(box && box.height > 30, 'desktop header remains visible at original size');
        assert(await header.locator('p').isVisible(), 'desktop school description retained');
        assert.equal(await header.locator('p').textContent(), 'Platform Yönetimi · TEST SCHOOL');
      }
      assert.equal(await header.getByRole('heading', { level: 2 }).count(), 1, 'accessible section heading retained');
      assert(await page.locator('.admin-content h3').first().isVisible(), 'real content heading retained');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), section + ' overflow at ' + width);
    }
  }
  await page.screenshot({ path: '.cache/roster-review/admin-header-desktop.png' });
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'.cache/roster-review/admin-header-mobile.png'});
  assert.deepEqual(errors, []);
  console.log('Admin header layout PASS: eight sections × seven widths (375–1440px), accessible heading, real content headings, mobile selector and desktop navigation retained; mobile header consumes no row; desktop title and school description retained. Mock child content/context only.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
