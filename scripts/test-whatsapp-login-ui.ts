import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function run() {
  const [authView, unifiedPanel, styles, app] = await Promise.all([
    source('src/components/AuthView.tsx'),
    source('src/components/UnifiedWhatsAppLoginPanel.tsx'),
    source('src/index.css'),
    source('src/App.tsx'),
  ]);

  assert.match(unifiedPanel, /onUsePassword:\(\)=>void; onUsePlatform:\(\)=>void/);
  assert.match(unifiedPanel, /onClick=\{onUsePassword\}>Parola ile giriş<\/button>/);
  assert.match(unifiedPanel, /onClick=\{onUsePlatform\}>Platform Yönetimi<\/button>/);
  assert.match(unifiedPanel, /role="group" aria-label="Diğer giriş seçenekleri"/);

  assert.match(authView, /type PasswordLoginMode = 'standard' \| 'platform' \| null/);
  assert.match(authView, /onUsePassword=\{\(\) => setPasswordLoginMode\('standard'\)\}/);
  assert.match(authView, /onUsePlatform=\{\(\) => setPasswordLoginMode\('platform'\)\}/);
  assert.match(authView, /setPasswordLoginMode\(null\)\}\>WhatsApp ile girişe dön/);
  assert.match(authView, /await login\(phone, password\)/);
  assert.match(authView, /passwordLoginMode === 'platform'/);

  assert.match(styles, /\.unified-login-alternatives \{ display: grid; grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.unified-login-alternatives \{ grid-template-columns: 1fr; \}/);
  assert.match(app, /<AuthView/);

  console.log('WHATSAPP LOGIN UI TEST: PASS');
}

run().catch((error) => {
  console.error('WHATSAPP LOGIN UI TEST: FAIL');
  console.error(error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
