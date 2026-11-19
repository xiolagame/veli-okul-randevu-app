# Production giriş hatası — yerel düzeltme ve yayın paketi

29 Ekim 2026. Site: veliokul / velirandevu.com.

## Kesin neden

Aktif deploy `6ae31a3c27dcfe362d9a3e8d`, Netlify'da ready/Published olmasına rağmen API başlatılamıyor. `/api/health` ve `/api/public/auth-capabilities` HTTP 502 döndürüyor: `ERR_MODULE_NOT_FOUND`, `serverless-http` paketi bulunamıyor. Yetkili geçmiş function logları da aynı hatayı doğruladı (incelenen 18 satırda 9 eksik paket hatası ve 9 module-not-found kaydı). Gizli değerler veya ham loglar rapora alınmadı.

Gerçek çağrı `src/components/AuthView.tsx:79` → `src/services/api.ts:219` → `GET /api/public/auth-capabilities`. Başarısız HTTP isteği AuthView'un mevcut hata ekranını gösteriyor. Endpoint `server/api.ts:198` içinde tanımlı. `/api/*` force redirect'i ve çift Express mount'u doğru; yanıt SPA HTML'i değil, API runtime başlatma hatası.

Eski release klasöründeki `.netlify/functions/api.zip` arşivinde `serverless-http` ve `pg` bağımlılık dosyaları yok. Bu klasörün node_modules'u başka release klasörüne junction ile bağlı. Netlify V2 paketleyicisi NFT kullanıyor; dışarıdaki fiziksel bağımlılık yolu paket dışında kalıyor. Netlify paketleyici kaynak kodu V2 için NFT'yi zorunlu seçtiğinden, yalnızca netlify.toml'a esbuild yazmak çözüm değil.

Yerel normal build/testler junction üzerinden bağımlılıkları bulabiliyordu; ZIP'in Lambda ortamında gerçekten açılıp çalışması önceden test edilmemişti. Yeni test, aynı eski hatalı ZIP'i `ERR_MODULE_NOT_FOUND` ile reddediyor ve temiz bağımlılıklardan hazırlanan ZIP'i kabul ediyor. Bu A/B kontrolüyle paketleme hatası doğrulandı.

## Production ve son sağlıklı sürüm karşılaştırması

- Son sağlıklı deploy: `6ae2f0c2acab961ff0876214`.
- Bu deploy'un bağımsız Netlify adresinde `/api/health` 200, veritabanı connected; `/api/public/auth-capabilities` 200 ve üç giriş özelliği true olarak doğrulandı.
- Yeni deploy'un commit_ref'i boş; GitHub main production kaynağı kabul edilmedi.
- Sağlıklı release kaynağına karşı auth.ts, whatsapp-auth.ts, identity-auth-attempts.ts, app.ts, api.ts, netlify/functions/api.ts ve database/tls.ts hash'leri aynı. Bu incident için auth veya TLS davranışı değiştirilmedi.
- Güncel dört function'ın varlığı, Node 24 runtime'ı, V2 stream/background modları ve iki schedule incelendi. API, randevu işleyicisi ve lisans background işleyicisi yeni deploy'da farklı ve eksik bağımlılıklı paketler taşıyor.
- DATABASE_URL, SUPABASE_DB_CA_B64, JWT_SECRET ve AUTH_CODE_SECRET production/functions kapsamında mevcut. Değerleri görüntülenmedi. İki giriş flag'i Netlify'da Secret işaretli ve API yanıtı maskeli olduğundan güncel değerleri tahmin edilmedi. Doğrulanabilen diğer giriş bayrakları true; bunlar değiştirilmedi. Başlatma hatası environment mantığı çalışmadan önce oluşuyor.

## Yerel çözüm ve dosyalar

İzole tam kaynak/paket klasörü:
`C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029`

Bu klasörde gerçek, junction olmayan node_modules'a `npm ci` ile lockfile'a bağlı kurulum yapıldı. `.env`, kullanıcı veritabanı, native Firebase config veya credential taşınmadı. package-lock.json ve bağımlılık sürümleri değişmedi.

Yeni/Değişen dosyalar:

1. `package.json`: build:functions, test:function-package, build:production-package komutları.
2. `scripts/build-function-package.mjs`: junction'ı reddeden, Netlify CLI 27.14.2 / paketleyici 16.5.1 kontrolü yapan tam paket üretimi; gerçek V2 modları/schedule'lar ve SHA-256 manifesti.
3. `scripts/test-function-package.mjs`: ZIP'leri birbirinden ayrı, depo dışında boş dizinlerde açma ve gerçek giriş modüllerini yükleme testi.
4. `scripts/test-function-runtime.mjs`: ZIP içindeki gerçek API ile iki route biçimi, health, flag değişimi ve yetkisiz erişim testi. Yalnız sentetik PGlite; dış ağ kapalı.
5. `scripts/test-production-package-ui.mjs`: gerçek derlenmiş frontend + ZIP'teki gerçek API; capability isteği, 502 gösterimi ve Tekrar dene ile toparlanma. OTP isteği yapılmaz.
6. `scripts/test-provisioned-admin-phone-login.ts`: eski “aşağıdaki” metin beklentisi, mevcut e-postadaki “yukarıdaki” metniyle eşleştirildi.
7. `scripts/test-school-admin-provisioning.ts`: eski 28px beklentisi yerine mevcut semantik OTP kutusu/32px beklentisi; başarısız testte HTML/kod içerebilen stack çıktısı kaldırıldı.
8. `scripts/test-phone-centric-web-ui.mjs`: mevcut ret mesajının tam ifadesi ve kod gönderilmedi bilgisi doğrulanıyor.
9. `scripts/test-settings-email-reminders.ts`: eski Aktivasyon Kodu etiketi mevcut E-posta Doğrulama Kodu etiketiyle eşleştirildi.

Son dört test uyumsuzluğu mevcut e-posta/UI metin değişikliklerinden kalmıştı; ürün davranışı bu testler için değiştirilmedi. İlk iki regresyonun başarısızlığı ise izole harness'te sentetik seed ve kaynak fixture'larının eksikliğiydi; geçici test dizinleri düzeltilip tekrar çalıştırıldı.

Kaynak src/server/netlify dizinleri onaylı son yerel web release ile aynı. Dashboard/mobil CSS, lisans izin güvenliği ve TLS hash karşılaştırmaları PASS. Ana Git worktree, codemagic.yaml ve kullanıcı dosyaları değiştirilmedi. Eski web release'e yalnız bu görevde eklenen build-function-package aracı da doğru sürümüyle bırakıldı; junction varken bilerek hata verir.

## Son testler

PASS:

- npm ci / lock uyumu; TypeScript; client/server build; release artifact safety.
- Dört ZIP'i ayrı, depo dışındaki boş dizinlerden yükleme.
- Paketlenmiş API üzerinden health/capabilities 200, hem /api hem /.netlify/functions/api route'u, cache=no-store, gerçek environment flag okuma, platform 401.
- Gerçek frontend/API paketi ile 502 hata ve yeniden deneme toparlanması.
- Bilinen hatalı eski ZIP'in regresyon kapısında reddedilmesi.
- WhatsApp auth, unified login, activation/password reset, parent self-service.
- Provisioned admin ilk aktivasyon/sonraki giriş, school admin provisioning, tek yönetici/tenant güvenliği.
- Platform phone binding, her girişte iki faktör; identity attempts/replay/concurrency/revocation.
- Production auth guards, WhatsApp pilot/registered-access guards, WhatsApp login UI, phone-centric web UI ve pilot refusal UI.
- Lisans hatırlatma PGlite/sağlayıcı ve API/UI izin güvenliği.
- Settings/e-posta/randevu hatırlatma regresyonu; mobile-platform session/lifecycle/network/back sözleşmeleri.
- Web welcome/video/gerçek AuthView, Chromium+WebKit background testleri ve Android/iOS welcome bypass.
- Değişen dosyalarda whitespace kontrolü.

Gerçek cihazla ve gerçek OTP göndererek production login testi YAPILMADI. Production hâlâ mevcut hatalı deploy'da; bu rapor yerel paketin sonucudur.

## Eksiksiz yayın paketi

- `release/client`: yalnız frontend/statik dosyalar.
- `release/functions`: api.zip, appointment-reminders.zip, license-reminders-background.zip, license-reminders.zip ve metadata manifesti.
- `release/artifact-manifest.json`: Node/paketleyici sürümleri, dosya boyutları ve SHA-256 özetleri.
- `release/checks`: yerel doğrulama kayıtları; public dizine konmaz.

Schedule'lar: appointment-reminders `*/5 * * * *`; license-reminders `0 6 * * *` (Türkiye 09.00). Background invocation modu korunur.

## Yalnız ayrıca yayın onayından sonra çalıştırılacak komut

```powershell
Set-Location 'C:\Users\XIO\Documents\Codex\veli-randevu-auth-runtime-hotfix-20261029'
npm run build:production-package
if ($LASTEXITCODE -ne 0) { throw 'Paket doğrulanamadı; yayın durduruldu.' }
netlify deploy --prod --site f15fdc98-3bb3-4f0d-88ca-bb8c685ffaea --dir release/client --functions netlify/functions --no-build --message "Fix complete Netlify function dependencies; preserve approved web and consent safety"
```

Global Netlify CLI 27.14.2 gerekir; build script sürümü doğrular. Hemen ardından yapılan deploy, oluşturulan kısa ömürlü `.netlify/functions/manifest.json` üzerinden test edilen ZIP'leri kullanabilir. Cache süresi dolarsa CLI aynı gerçek node_modules ve kaynaklardan tekrar paketler; junction kullanılmaz. Manifest/schedule kaybına yol açabilecek çıplak ZIP klasörüyle eski deploy yöntemini kullanmayın.

Yayın öncesi aktif deploy ID'si yeniden kontrol edilmeli; beklenmedik yeni sürüm varsa durulmalıdır. Yayından hemen sonra health/capabilities 200, runtime flag'ler ve dört function/schedule doğrulanmalı; giriş, lisans alıcı sayaçları ve genel site salt okunur kontrol edilmelidir. Gerçek mesaj kendiliğinden elle gönderilmemelidir.

Kritik hata olursa geri dönüş adayı `6ae2f0c2acab961ff0876214` bağımsız adresinden yeniden sağlık kontrolü yapılarak restore edilmelidir. Geri dönüş bu görevde uygulanmadı.

Production deploy, rollback, migration, veri yazma, environment değişikliği, gerçek mesaj, commit veya push yapılmadı.
