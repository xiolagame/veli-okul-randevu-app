import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function run() {
  const [authView, unifiedPanel, phoneCentricPanel, styles, app] = await Promise.all([
    source('src/components/AuthView.tsx'),
    source('src/components/UnifiedWhatsAppLoginPanel.tsx'),
    source('src/components/PhoneCentricLoginPanel.tsx'),
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
  assert.match(authView, /resolveLoginEntry\(getRuntimePlatform\(\), capabilitiesStatus, phoneCentricAuthEnabled, passwordLoginMode !== null\)/);
  assert.match(authView, /usePhoneCentricLogin \? <PhoneCentricLoginPanel allowLegacyFallback=\{allowLegacyPhoneFallback\(getRuntimePlatform\(\)\)\}/);

  assert.match(phoneCentricPanel, /'WhatsApp Kodu Gönder'/);
  assert.match(phoneCentricPanel, /placeholder="0555 123 45 67"/);
  assert.match(phoneCentricPanel, /requiresSchoolCode && <label/);
  assert.doesNotMatch(phoneCentricPanel, /İlk kez veli kaydı oluştur/);
  assert.doesNotMatch(phoneCentricPanel, /doğum tarihi|birthDate|BirthDate/);
  assert.match(phoneCentricPanel, /response\.legacyFallbackRequired/);
  assert.match(phoneCentricPanel, /onLegacyFallback\(canonicalPhone\)/);
  assert.match(phoneCentricPanel, /if \(!allowLegacyFallback\) throw new Error/);
  assert.match(phoneCentricPanel, /şu anda kullanılamıyor\. Doğrulama kodu gönderilmedi\./);
  assert.doesNotMatch(phoneCentricPanel, /sisteme kayıtlı değil|numara kayıtlı değil/);
  assert.match(phoneCentricPanel, /Lütfen telefonunuza gelen WhatsApp onay kodunu girin\./);
  assert.doesNotMatch(phoneCentricPanel, /setMessage\(response.message\)/);
  assert.doesNotMatch(phoneCentricPanel, /Mevcut giriş yöntemleri/);
  assert.doesNotMatch(phoneCentricPanel, /Parola ile giriş|Platform Yönetimi|Şifremi unuttum|type="password"/);
  assert.match(authView, /onLegacyFallback=\{\(fallbackPhone\) => \{ setPhone\(displayStoredTurkishPhone\(fallbackPhone\)\); setPasswordLoginMode\('standard'\); \}\}/);
  assert.match(authView, /Giriş seçenekleri alınamadı/);

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
