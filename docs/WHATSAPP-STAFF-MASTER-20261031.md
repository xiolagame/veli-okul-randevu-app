# Veli Randevu — WhatsApp OTP ve otomatik personel aktivasyonu

Güncelleme: Kayıtsız telefon ve doğrudan OTP ekranı için kullanıcının sonraki kesin kararı uygulanmıştır. Aşağıdaki önceki maskeleme/“WhatsApp kodum var” açıklamaları tarihsel ilk teslim davranışıdır; güncel sonuçlar [kayıtsız telefon düzeltme raporunda](UNREGISTERED-PHONE-FIX-20261031.md) yer alır.

31 Ekim 2026. Bu teslim yalnız izole yerel geliştirmedir. Production, Oracle demo, Supabase, Netlify ve mağazalarda işlem yapılmadı; gerçek mesaj gönderilmedi. Native binary oluşturulmadı. Commit/push yapılmadı.

## 1. Kaynak ve mimari

- Çalışma: `C:\Users\XIO\Documents\Codex\veli-staff-otp-master-20261031`.
- Dal: `feature/staff-otp-master-20261031`; başlangıç/HEAD: `ecbedc4fac7d657fff147d647625736c7be29c05`.
- Başlangıç Android kaynağıdır; güncel canlı production ile eşit olduğu varsayılmadı. Arşiv production manifesti `6adfb61f25d7939bddb03d01` deploy referanslıdır ve kendisi de yayımlanmış backend byte'larının kanıtı olmadığını belirtir.
- Web karşılama referansı: salt-okunur yerel production arşivi `veli-randevu-production-review-base-20261029`, deploy `6ae32197a83a6b6d246716d0`. Mevcut iOS açık tema düzeltmesi `a2dec7245d91c0b0437b25b0752493457ca3c260` üzerinden seçilerek korundu; körlemesine merge yapılmadı.
- Express/Netlify ortak API, PostgreSQL repository katmanı, uygulama JWT/auth_version, okul üyelikleri, öğretmen profilleri ve ayrı bekleyen güvenlik kayıtları mevcut. Kullanıcı oturumu Supabase Auth e-postasına taşınmadı; mevcut uygulama kimlikleri korundu.
- React/TypeScript ortak arayüz; Capacitor 8.5.2, Bundle ID `com.velirandevu.app`. Yeni plugin/bağımlılık güncellemesi yok.
- Supabase service-role erişimi istemciye taşınmadı. Sunucu tenant kontrolleri zorunlu kalır; istemci rol tercihi yetki vermez. RLS ayrıca yerel PostgreSQL üzerinde sınandı; gerçek hosted Supabase politikalarının uygulanmış durumu test edilmedi. [Supabase RLS belgesi](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 2. Personel kaydı ve aktivasyon

Öğretmen kaydı telefon, geçerli bildirim e-postası ve mevcut görev alanlarını gerektirir. E-posta öğretmen profilinde bildirim adresidir; yeni personelin global giriş kimliğine kopyalanmaz. E-posta düzenlemesi kullanıcının telefonunu, JWT sürümünü veya geçmiş ilişkilerini değiştirmez. Tarihsel paylaşımlı veli/personel kimliğinde profil adı farkı da global kişiyi yeniden adlandırmaz.

Güvenlik ekleme/düzenleme/import arayüzü e-posta istemez; yeni kayıt NULL saklar. Eski e-postalar silinmez. Toplu aktarım ortak öğretmen e-posta kolonunu korur; güvenlik satırında dikkate almaz. Aynı bildirim posta kutusunu paylaşmak authentication çakışması sayılmaz; mükerrer telefon kontrolleri korunur.

Personel ve oluşturma audit kaydı aynı transaction içindedir. Audit yazılamazsa personel de kaydedilmez. Yeni kayıt OTP gönderiminde etkinleşmez. Yalnız başarılı, tek kullanımlık WhatsApp doğrulamasıyla sunucudaki okul/rol ilişkisi etkinleşir. Şifre, okul kodu, aktivasyon kodu veya aktivasyon e-postası yoktur. Eski personel aktivasyon/reset endpoint gövdeleri kaldırılıp 404; yeniden aktivasyon e-postası yolu 410 yapılmıştır. Personelin eski parola girişi ve eski parola JWT'siyle personel API erişimi reddedilir. Platform ve okul yöneticisinin mevcut ayrı güvenlik akışları kaldırılmadı.

Devre dışı üyelik otomatik canlandırılmaz. Silinmiş hesap/profil, okul/lisans kısıtları korunur. Aynı telefondaki mevcut veliye yalnız sunucuda önceden atanmış, adı eşleşen uygun personel üyeliği eklenebilir. Belirsiz kimlikler birleştirilmez. Önceden var olan tek-okul öğretmen kuralı korunmuştur; sınırsız çoklu-okul kimlik göçü bu teslimde yapılmadı. Çoklu üyelikte okul/rol seçimi OTP sonrasında sunucunun döndürdüğü üyelikler üzerindendir; sahte `X-School-Role` yetki sağlamaz.

## 3. OTP ve oturum güvenliği

Mevcut kriptografik 6 haneli üretim, HMAC, 5 dakika süre, tek kullanımlılık, atomik tüketim, yanlış deneme sınırı, yeniden gönderim beklemesi, önceki kodun iptali ve sağlayıcı hata iptali korunmuştur. Ek telefon/purpose başına 15 dakikada 6 istek kontrolü farklı IP'ler üzerinden suistimali sınırlar. Daha sıkı mevcut sınırlar kaldırılmadı. OTP/token loglanmaz. Gerçek Meta şablon onayı ve teslimatı doğrulanmadı; kaynakta kullanılan mevcut yapılandırma korundu, canlı Meta çağrısı yapılmadı.

**Hesap keşfi tercihi:** kayıtlı, kayıtsız ve uygun olmayan numaralar public request aşamasında genel, gönderimi doğrulamayan yanıt alır. Kayıtsıza sağlayıcı çağrısı veya kullanılabilir challenge oluşturulmaz. Arayüz “gönderildi” demez ve OTP alanını otomatik açmaz; kullanıcı kod gerçekten ulaştığında “WhatsApp kodum var” ile açar. Yanlış biçim/yanlış kod kırmızı hatadır. Kayıtsız numaraya özel anlık kırmızı hata bilerek verilmez; bu, kullanıcı talebindeki anti-enumeration önceliğidir. Production akışında 8,5 saniye + 0–249 ms taban süre vardır; bu mutlak sabit-zaman kanıtı değildir, internet/sağlayıcı gecikmesinin tüm yan kanallarını ortadan kaldırmaz.

Telefon değişikliği yetkili yönetici işlemi ve audit ile yapılır; eski OTP/identity attempt/JWT/push cihazları geçersizleşir. Yeni telefon yeniden doğrulanır; user/profile/randevu kimlikleri korunur. Paylaşımlı çoklu rol/okul kimliğinde global telefon değişikliği güvenli 409 ile durdurulur. Yanlış veya devredilmiş telefonun idari kimlik teyidi yine operasyonel sorumluluktur.

Online çıkış sunucudaki hesap auth_version değerini artırır. İstemci uzak iptali 1,5 saniyelik bütçeyle dener ve yerel oturumu temizler; çevrimdışı durumda sunucu iptali garanti edilemez. Mevcut hesap-sürümü modeli nedeniyle online çıkış diğer hesap oturumlarını da geçersizleştirebilir. Demo JWT normal logout API'sine gönderilmez.

Push kaydı, middleware'de doğrulanan auth_version değerini transaction içinde kilitli kullanıcı satırında tekrar kontrol eder. Telefon değişimi/çıkıştan önce başlamış istek yeni sürümle cihazı yeniden bağlayamaz. İptal edilen cihaz hedefleri temizlenir ve bekleyen teslimatlar iptal edilir. Sağlayıcının daha önce kabul ettiği ağdaki bir bildirimi geri çağırmak garanti edilemez.

## 4. Öğretmen bildirimleri

Desteklenen mevcut davranış korundu: randevu talebinde öğretmen e-postası, uygulama içi/push bildirimi; mevcut randevu hatırlatma e-postaları; veliye durum bildirimlerinin mevcut uygulama içi/push yolları. Bu görevde olmayan yeni iptal/e-posta türleri icat edilmedi.

Yerel gerçek API + PostgreSQL testinde yeni randevu güncel öğretmen profil adresine e-posta üretir; kullanıcı kimliğine bağlı push kuyruğu korunur. Tekrarlanan randevu denemesi ikinci olay oluşturmaz. E-posta sağlayıcı hatası randevuyu geri almaz. Hatırlatma güncel adrese gider ve tekrar üretim kontrolü geçer. Tüm dış sağlayıcılar mock'tur; gerçek e-posta/push teslimatı PASS değildir.

## 5. Paneller, web ve native uyumu

Okul yöneticisi System/Audit menüsü ve render bağlantısı kaldırıldı. Doğrudan audit okuma/silme API'si sıradan okul yöneticisine 403 verir. Platform yöneticisinin mevcut global ve açık hedef-okul audit erişimi korunur. Güvenlik audit üretimi ve platformun mevcut işlemleri durdurulmadı; testler sentetiktir.

Öğretmen/güvenlik kayıt, düzenleme, Excel yönergeleri ve yardım içerikleri yeni akışa uyarlanmıştır. Veli kayıt/reset akışına doğum tarihi güvenlik sorusu eklenmedi. Lisans, WhatsApp bildirim tercihleri, demo giriş/Oracle adresi, mobil “Okulunuza Hoş Geldiniz” ve `04-Mobil.png` korunur.

Web sinematik kaynakları referans arşivden aynen alındı. Native build ayrı boş wrapper'a alias kullanır ve yalnız belirlenmiş `dist/client/welcome` dizinini temizler. Release testleri native pakette video/karşılama referansını reddeder; webde video ve geçişi atlama yerel tarayıcıda sınanır. iOS kayıtlı tercih yoksa açık başlar; manuel tercih korunur. Android sistem çubukları ve tema davranışı değiştirilmedi.

## 6. Migration ve geri dönüş

Yeni dosya: `server/database/migrations/20261031173726_staff_phone_activation.sql`. Supabase CLI yalnız migration dosyası oluşturmak için kullanıldı; canlı bağlantı kurulmadı. Değişiklik yalnız `public.pending_staff.email` NOT NULL zorunluluğunu kaldırır ve açıklama ekler. Öğretmen e-postaları, kullanıcı kimlikleri, randevular, push abonelikleri ve eski güvenlik adresleri silinmez; toplu kimlik backfill'i yoktur.

Yerel eski şemaya geçişin iki kez çalıştırılması, mevcut verinin korunması ve NULL güvenlik kaydı sınandı. `ops/staff-otp/preflight.sql` yalnız sayım/şema kontrollerini; `ops/staff-otp/rollback.sql` korumalı geri dönüşü içerir. NULL kayıt varken NOT NULL geri dönüşü hata ile durur; sahte e-posta üretmez/veri silmez. Tercih additive nullable kolonu korumaktır. Eski auth_version geri yüklenmez, emekli personel parola yolları yeniden açılmaz.

Onay sonrası sıra: ayrı staging/backup → salt-okunur preflight ve çakışan eski kayıtların yetkili incelemesi → migration → backend ve mevcut OTP template/flag/secrets kontrolü → web → kullanıcı tarafından Android/iOS build → gerçek cihaz → kontrollü yayın. Backend geçişi tamamlanmadan yeni native sürüm production'a hazır kabul edilmemelidir.

## 7. Çalıştırılan testler ve kanıt

Çıktılar yerelde `audit/master/` altında; sentetik ekran görüntüleri de buradadır ve Git'e alınmaz. Önceki başarısız denemeler silinmedi; aşağıdaki nihai dosyalar esas alınır.

| Kontrol/komut | Sonuç ve kapsam |
|---|---|
| `npm run lint` | PASS; frontend TypeScript |
| `node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --esModuleInterop --moduleResolution bundler --module esnext --target es2022 --types node server/api.ts server/admin-management.ts server/whatsapp-auth.ts server/staff-session-security.ts` | PASS; genişletilmiş backend kontrolü. Başlangıç commit'inde aynı komutun 20 mevcut hatası temiz arşivde yeniden üretildi ve düzeltildi; kontroller kapatılmadı. |
| `npm run build` | PASS; production web/server build + release artifact taraması. Deploy değildir. |
| `npm run ios:sync:review` / `npm run android:sync:review` | PASS; 56 dosyalık native web paketi, demo API profili; archive/APK/AAB/IPA değildir. |
| `node scripts/verify-ios-web-package.mjs` | PASS; sync dosyaları/kaynak fingerprint/config/gizli bilgi politikası |
| Node 24.17.0 ile `scripts/run-ios-regressions.mjs` | 24/24 regresyon; sıralı izole child süreçler, PGlite ağır testlerinde mevcut güvenli runtime seçeneği korunur. `regressions-complete.log`, `audit/test-results.json`. |
| `node --no-wasm-code-gc --import tsx scripts/test-staff-otp-master.ts` | PASS; 9 bütünleşik grup, gerçek Express/API + embedded PostgreSQL + mock sağlayıcı. `staff-complete.log`. |
| `node --no-wasm-code-gc --import tsx scripts/test-staff-phone-migration.ts` | PASS; migration/veri koruma/rollback reddi |
| WhatsApp, unified login, identity-attempts, push, iOS push testleri | PASS; OTP yarış/yeniden kullanım/süre/deneme, yönetici ikinci faktör, stale push kaydı, bounded logout |
| Öğrenci/randevu e-postası, settings/reminder, staff Excel testleri | PASS; gerçek yerel SQL/API, dış gönderim mock; XLSX şablon byte'ları korunur |
| Review integration/access/client/boundaries | PASS; ayrı JWT anahtarları/tenantlar, dış mesaj engeli, sentetik hesaplar; canlı Oracle doğrulaması değildir |
| Lisans paneli/client UI, help-center | PASS; mock API, açık gönderim onayı, bildirim tercihi; gerçek mesaj yok |
| Theme bootstrap | 40 başlangıç vakası PASS; iOS default light ve manuel tercih |
| Role themes / theme routes | 186 sentetik sahne ve 64 route/tema vakası PASS; ölçülen temel kontrast |
| `node scripts/test-staff-preview-ui.mjs` | 5 gerçek yerel rol × 2 tema × 4 genişlik = 40 görünüm; session/theme reload, çıkış, personel formu, platform ikinci faktörü, bilinmeyen numara negatif akışı ve web video geçişi |
| `node scripts/test-store-review-login.mjs ios` / `android` | PASS; her platformun gerçekten sync edilmiş paketinde giriş, tema ve sinematik yokluğu, Chromium/native bridge fixture |
| Android/iOS shell ve mobil UI testleri | PASS; kaynak/config ve sentetik klavye/safe area/foreground. Gerçek cihaz değildir. |
| Provenance / frozen-source / negatif kaynak kilidi | Exact-hash overlay + Git index kaynak kilidi; temiz index export ve değişiklik reddi ayrıca doğrulanır. Arşiv production manifesti değiştirilmez. |

Playwright modülü yerel runtime'dan `PLAYWRIGHT_MODULE` ile sağlandı. Yerel çalışma Node 24.22.1; 24 regresyon için mevcut CI sabiti Node 24.17.0 kullanıldı. Test fixture'ları geçerli mock WhatsApp istek/doğrulama yolunu kullanır; eski staff password JWT kabul ettirilmedi. Tarihe bağlı demo takvim testi uygun iş gününü seçer; pazar iş kuralı değiştirilmez.

### İstenen 55 senaryo ile eşleme

| Senaryo | Yerel sonuç / sınır |
|---|---|
| 1–7 Öğretmen kayıt/eksik e-posta/ilk ve tekrar OTP/aktivasyon e-postası-kodu-parolası yok | PASS: staff master, unified/WhatsApp, UI; tüm dış gönderimler mock |
| 8–12 Öğretmen e-posta/push/hatırlatma/adres değişimi/mevcut hesap | PASS: API + SQL + kuyruğa/mock sağlayıcıya kadar; gerçek teslimat BLOCKED |
| 13–18 Güvenlik e-postasız kayıt/alan yok/aktivasyon/tekrar/QR/tenant | PASS: staff master, UI, mevcut QR/tenant regresyonları; gerçek kamera BLOCKED |
| 19–21 Kayıtsız numara/yanlış numara hatası/yanlış OTP ekranı | Gönderim ve otomatik ekran engeli PASS; kayıt varlığını açıklayan özel kırmızı mesaj yerine genel dürüst akış; yanlış biçim/kod danger testi PASS |
| 22–28 Yanlış/süresi dolmuş/replay/resend/deneme/eşzamanlılık/sağlayıcı hata | PASS: WhatsApp/identity/unified + staff master, yerel transaction ve mock sağlayıcı |
| 29–32 Devre dışı/silinmiş/telefon değişimi/normalizasyon | PASS: yerel API/SQL; gerçek numara sahipliğinin idari teyidi kapsam dışı |
| 33–40 Tenant/sahiplik/platform/çoklu üyelik/JWT | PASS: API guard ve mevcut regresyonlar; belirsiz kimlik fail-closed, eski tek-okul öğretmen kuralı korunur |
| 41 RLS CRUD | PASS: yerel PostgreSQL'de untrusted roller; hosted Supabase uygulanmış politikaları BLOCKED |
| 42 Eski aktivasyon yolları | PASS: 404/410 ve legacy personel JWT reddi; admin ayrı yollar korunur |
| 43–46 Sistem günlüğü | PASS: sıradan admin menü yok/API403, platform erişimi ve audit üretimi korunur |
| 47 Web giriş/çıkış | PASS: gerçek yerel API ve Chromium |
| 48–49 Android/iOS ortak giriş | PASS: sync paket ve bridge fixture; gerçek native runtime BLOCKED |
| 50 Push kayıt | PASS: yerel sürüm/iptal/tenant kontrolü; APNs/FCM cihaz teslimatı BLOCKED |
| 51 Session persistence | PASS: tarayıcı reload ve native storage fixture; fiziksel Keychain/Keystore/OS kill BLOCKED |
| 52–53 Web sinematik/native video yok | PASS: web tarayıcı ve native paket taraması |
| 54–55 Lisans/okul/randevu/QR | PASS: mevcut 24 regresyon ve ek lisans UI; fiziksel kamera/native izinler BLOCKED |

Nihai otomatik başarısız test bırakılması hedeflenmedi; ilk denemelerdeki timeout/fixture hataları gerçek hatalardır ve nihai tekrar çıktılarıyla ayrıştırılır. Test sayısı native/production doğrulama yerine geçmez.

## 8. Yerel önizleme ve test hesapları

Adres: **http://127.0.0.1:3035/login**. Web sinematik başlangıç: **http://127.0.0.1:3035/**.

| Rol | Yalnız sentetik test telefonu |
|---|---|
| Okul yöneticisi | +905551230001 |
| Öğretmen | +905551230002 |
| Veli | +905551230003 |
| Güvenlik | +905551230004 |
| Platform yöneticisi | +905551230005 |

Telefonla kod isteyin; yalnız yerel **http://127.0.0.1:3035/__local_preview__/state** sayfasından o istek için üretilen mock kodu okuyun, “WhatsApp kodum var” ile doğrulayın. Platform hesabında ayrıca aynı sayfadaki mock e-posta faktörü gerekir. Sabit bypass kodu yoktur. Bunlar Oracle/production hesapları değildir.

Önizleme `scripts/dev-staff-preview.ts` ile ayrı geçici veritabanı, rastgele bellekte sırlar, yalnız loopback ve mock sağlayıcılarla çalışır. Remote DATABASE_URL/production modu reddedilir; client/server release girişlerine import edilmez. Tekrar başlatmak için çalışma klasöründe `node --no-wasm-code-gc --import tsx scripts/dev-staff-preview.ts`; port doluysa önce yalnız bu süreci kapatın. Yeniden başlatma sentetik veriyi sıfırlar. Yerel state endpoint'ini internete açmayın.

## 9. Değişiklik haritası

- Backend: `server/api.ts`, `admin-management.ts`, `auth.ts`, `whatsapp-auth.ts`, yeni `staff-session-security.ts`, `push-notifications.ts`, `repositories/index.ts`, `operations.ts`, `app.ts`, `platform-requests.ts`, yeni `route-param.ts`: personel/OTP/oturum/tenant/audit ve genişletilmiş tip denetimi.
- Veritabanı: schema ve tek additive migration; `ops/staff-otp/preflight.sql`, `rollback.sql`.
- UI: personel/import/yönetim aksiyonları/OperationsCenter, ortak AuthView ve PhoneCentricLoginPanel, AdminView, Navbar, AppContext, types, help-content, staff-form/import yardımcıları.
- Oturum istemcisi: API, api-session-policy, client-preferences, yeni remote-logout.
- Korunan tasarım: App/WebWelcome/css ve dört welcome asset, NativeWebWelcome, Vite alias/prune; iOS index/theme/main/Info.plist/LaunchScreen seçilmiş açık-tema düzeltmesi.
- Testler: yeni staff master/migration/preview; ilgili mevcut fixture ve UI/auth/push/release testleri yeni davranışa uyarlanır, güvenlik assertion'ları kaldırılmaz.
- İzlenebilirlik: `.gitignore`, kaynak overlay üreticisi/provenance doğrulayıcı, `audit/staff-otp-overlay.json`, kaynak kilidi ve bu rapor. Gizli dosyalar, test logları, kişisel veri, node_modules/dist/native binary commit kapsamına alınmaz.

## 10. Kalan riskler ve kullanıcıya bırakılan işler

**BLOCKED / NOT TESTED:** gerçek iPhone/Android/WebView, Xcode/Gradle release derlemesi, kamera/QR izinleri, gerçek klavye ve uygulamanın OS tarafından öldürülmesi, Keychain/Keystore, APNs/FCM, Meta template onayı ve gerçek WhatsApp/e-posta teslimatı; canlı RLS/production uyumu. Tarayıcı safe-area/keyboard testleri gerçek cihaz kanıtı değildir.

Mevcut canlı durum bu görevde sorgulanmadı veya değiştirilmedi. Telefon çakışmaları ve çoklu kimlikler için preflight + yetkili inceleme gereklidir. Genel OTP yanıtında kalan ağ zamanlama riski, offline logout sınırı ve önceden gönderilmiş push iptal sınırı yukarıda açıklandı.

Backend/migration dağıtımı onaylanana ve staging/cihaz kabulü tamamlanana kadar production için **NO-GO**. Yerel kaynak incelemeye hazırdır; commit/push için ayrıca kullanıcı onayı gerekir. Android APK/AAB ve iOS Xcode 26+ uygun SDK ile archive/Codemagic derlemelerini kullanıcı yapacaktır. Bu çalışmada Codemagic, Apple signing, TestFlight veya Google Play işlemi yapılmadı.

Tüm değişiklikler yeni izole geliştirme dalında kalır. `main`, mevcut çalışan iOS/Android dalları ve eski kirli çalışma ağacı değiştirilmedi.

## 11. Nihai yerel teslim kaydı

- 81 staged dosya; commit yok, HEAD başlangıç commit'inde.
- Frozen source **485/485 PASS**; Git index'ten temiz export üzerinde de PASS.
- Negatif testte API dosyasına eklenen içerik overlay tarafından reddedildi; metin ve binary mutasyon testleri PASS. Aktif kaynaklar değiştirilmedi.
- Staged path/secret taraması: yasak dosya yok. Tek imza eşleşmesi release testindeki PRIVATE KEY ret işaretidir; gerçek anahtar değildir.
- Son build: 62 web client + 2 server dosyası. Native paketler 56 dosya; iOS exact parity PASS.
- 24/24 nihai regresyon PASS; personel master 9 grup PASS; UI 40 görünüm PASS.
- Temiz main/iOS/Android dal SHA'ları aynı; eski Android worktree'deki önceden mevcut android/gradle.properties değişikliği aynen bırakıldı.
- Nihai FAIL: yok. Gerçek cihaz, canlı sağlayıcı/hosted RLS ve native release doğrulaması BLOCKED/NOT TESTED olarak kalır.

Tam değişen dosya listesi:

- `.gitignore`
- `audit/ios-source-lock.json`
- `audit/staff-otp-overlay.json`
- `docs/WHATSAPP-STAFF-MASTER-20261031.md`
- `index.html`
- `ios/App/App/Base.lproj/LaunchScreen.storyboard`
- `ios/App/App/Info.plist`
- `ops/staff-otp/preflight.sql`
- `ops/staff-otp/rollback.sql`
- `public/welcome/header-clean.png`
- `public/welcome/login-scene.png`
- `public/welcome/scene.png`
- `public/welcome/transition.mp4`
- `scripts/build-android-client.mjs`
- `scripts/build-ios-client.mjs`
- `scripts/dev-staff-preview.ts`
- `scripts/prune-native-web-only-assets.mjs`
- `scripts/refresh-staff-otp-overlay.mjs`
- `scripts/test-account-deletion.ts`
- `scripts/test-android-login-polish.mjs`
- `scripts/test-appointment-slot-visibility.ts`
- `scripts/test-auth-fixtures.ts`
- `scripts/test-ios-auth-ui.mjs`
- `scripts/test-ios-license-client.mjs`
- `scripts/test-ios-push.ts`
- `scripts/test-phone-centric-web-ui.mjs`
- `scripts/test-release-artifacts.mjs`
- `scripts/test-review-client.mjs`
- `scripts/test-review-integration.ts`
- `scripts/test-school-roster-ui.ts`
- `scripts/test-security-and-tenant-audit.ts`
- `scripts/test-settings-email-reminders.ts`
- `scripts/test-staff-excel-template.ts`
- `scripts/test-staff-otp-master.ts`
- `scripts/test-staff-phone-migration.ts`
- `scripts/test-staff-preview-ui.mjs`
- `scripts/test-store-review-login.mjs`
- `scripts/test-student-removal-and-appointment-email.ts`
- `scripts/test-teacher-appointment-ownership.ts`
- `scripts/test-theme-bootstrap.mjs`
- `scripts/test-theme-ui.mjs`
- `scripts/test-whatsapp-login-ui.ts`
- `scripts/verify-ios-provenance.mjs`
- `scripts/verify-store-review-package.mjs`
- `server/admin-management.ts`
- `server/api.ts`
- `server/app.ts`
- `server/auth.ts`
- `server/database/migrations/20261031173726_staff_phone_activation.sql`
- `server/database/supabase_schema.sql`
- `server/operations.ts`
- `server/platform-requests.ts`
- `server/push-notifications.ts`
- `server/repositories/index.ts`
- `server/route-param.ts`
- `server/staff-session-security.ts`
- `server/whatsapp-auth.ts`
- `src/App.tsx`
- `src/components/AdminView.tsx`
- `src/components/AuthView.tsx`
- `src/components/BulkStaffImport.tsx`
- `src/components/ManagementActions.tsx`
- `src/components/Navbar.tsx`
- `src/components/OperationsCenter.tsx`
- `src/components/PhoneCentricLoginPanel.tsx`
- `src/components/StaffManagement.tsx`
- `src/components/WebWelcome.tsx`
- `src/components/web-welcome.css`
- `src/content/help-content.ts`
- `src/context/AppContext.tsx`
- `src/main.tsx`
- `src/platform/NativeWebWelcome.tsx`
- `src/platform/api-session-policy.ts`
- `src/platform/client-preferences.ts`
- `src/platform/remote-logout.ts`
- `src/platform/theme.ts`
- `src/services/api.ts`
- `src/types.ts`
- `src/utils/staff-form.ts`
- `src/utils/staff-import.ts`
- `vite.config.ts`
