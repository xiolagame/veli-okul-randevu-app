# Mobil sürüm hazırlığı — 2026-11-22

Bu not mağazaya gönderim yapmaz; yalnızca yeni mobil sürüm için gerekenleri listeler.

## Mobilde yayına girmesi gereken değişiklikler
Uygulamalar web dosyalarını (`dist/client`) kendi içinde taşır. Web deploy'u mobilleri güncellemez.

- `876a2f5` koyu mod okunabilirlik düzeltmesi (`src/theme.css`) — Android, iOS ve web.
- `d4b2d7b` WhatsApp kodu gönderme hızı — yalnızca sunucu tarafı; web deploy'u ile canlıda, uygulama güncellemesi gerekmez.
- Merkezi lisans fiyatı ve hoş geldin ekranı commit'leri (`8335dd8`, `183eae2`) — web/istemci dosyalarını da değiştirir.

## iOS (sürüm 1.0.2, build 1 — `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`)
- `node scripts/verify-ios-source-lock.mjs` şu an **FAIL**: dondurulmuş kaynak kilidi 15 dosyada eski
  (`package.json`, `server/api.ts`, `server/database/postgres.ts`, `server/database/supabase_schema.sql`,
  `server/identity-auth-attempts.ts`, `server/platform-management.ts`, `server/push-notifications.ts`,
  `server/whatsapp-auth.ts`, `src/components/PublicRequestSection.tsx`, `src/components/SchoolManagement.tsx`,
  `src/components/web-welcome.css`, `src/index.css`, `src/platform/api-session-policy.ts`,
  `src/services/api.ts`, `src/theme.css`).
- `server/push-notifications.ts` değişikliği bu oturumun işi değil; kaynağını ayrıca kontrol edin.
- Codemagic iş akışları yalnızca elle başlatılır ve kilit doğrulaması geçmeden IPA üretmez.
- Yapılacaklar: değişikliklerin gözden geçirilmesi → `audit/ios-source-lock.json` yenilenmesi →
  yeni build numarası (veya sürüm) → Codemagic "iOS Signed IPA" iş akışının elle başlatılması →
  App Store Connect'e yükleme/gönderim kullanıcı onayıyla.

## Android
- `versionCode` / `versionName` repoda sabit değil; `VELI_ANDROID_VERSION_CODE` ve
  `VELI_ANDROID_VERSION_NAME` ile dışarıdan verilir (bkz. `docs/STORE-REVIEW-BUILD.md`).
- Play Console'daki son `versionCode` bu oturumda doğrulanamadı; yeni değer ondan büyük olmalı.
- `android/gradle.properties` ve `.bak-*` dosyalarına dokunulmadı.
- Yapılacaklar: `npm run android:sync` → Android Studio'da imzalı AAB (mevcut doğru signing key) →
  Play Console'a yükleme kullanıcı onayıyla.

## Henüz yapılmayanlar
Mobil sürüm numarası artırılmadı, kaynak kilidi yenilenmedi, APK/AAB/IPA üretilmedi, mağazaya gönderim yapılmadı.
