import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function run() {
  const [authView, phoneCentricPanel, app] = await Promise.all([
    source('src/components/AuthView.tsx'),
    source('src/components/PhoneCentricLoginPanel.tsx'),
    source('src/App.tsx'),
  ]);

  // Giriş yalnız telefon numarası + WhatsApp koduyla yapılır.
  assert.match(authView, /PhoneCentricLoginPanel/);
  assert.match(authView, /resolveLoginEntry\(/);
  assert.doesNotMatch(authView, /PasswordLoginMode|passwordLoginMode|type="password"|Parola ile giriş|Şifremi unuttum/);
  assert.doesNotMatch(authView, /schoolCode|licenseCode|Okul kodu|Lisans kodu/i);
  assert.match(authView, /Giriş seçenekleri alınamadı/);

  assert.match(phoneCentricPanel, /'WhatsApp Kodu Gönder'/);
  assert.match(phoneCentricPanel, /placeholder="0555 123 45 67"/);
  assert.doesNotMatch(phoneCentricPanel, /requiresSchoolCode|schoolCode|Okul kodu|allowLegacyFallback|onLegacyFallback/);
  assert.doesNotMatch(phoneCentricPanel, /doğum tarihi|birthDate|BirthDate/);
  assert.doesNotMatch(phoneCentricPanel, /sisteme kayıtlı değil|numara kayıtlı değil/);
  assert.match(phoneCentricPanel, /WhatsApp doğrulama kodunuz gönderildi/);
  assert.match(phoneCentricPanel, /setStep\('WHATSAPP_CODE'\)/);
  assert.doesNotMatch(phoneCentricPanel, /AWAIT_CODE|WhatsApp kodum var/);
  assert.doesNotMatch(phoneCentricPanel, /setMessage\(response.message\)/);
  assert.doesNotMatch(phoneCentricPanel, /Parola ile giriş|Şifremi unuttum|type="password"/);
  assert.match(app, /<AuthView/);

  console.log('WHATSAPP LOGIN UI TEST: PASS');
}

run().catch((error) => {
  console.error('WHATSAPP LOGIN UI TEST: FAIL');
  console.error(error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
