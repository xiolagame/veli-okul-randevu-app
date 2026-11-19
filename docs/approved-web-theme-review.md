# Veli Randevu — onaylanan tasarım, web temaları ve lisans hatırlatma incelemesi

29 Ekim 2026. Güncel kaynak: `veli-randevu-auth-runtime-hotfix-20261029`. Onaylanan prototip: `veli-randevu-design-prototypes-20261029`. Bu rapor önceki `final-release-review.md` raporunun yerini alır.

## 1. Sonuç ve sınırlar

Onaylanan açık tasarım gerçek Platform Yönetimi, Okul Yönetimi ve WhatsApp modalına entegre edildi. Gerçek API/veri bağlantıları korunuyor; prototip verileri uygulamaya taşınmadı. Web için merkezi ve kalıcı açık/koyu tema eklendi. Lisans tercihi tek açık işlemle açılıp kapatılır; ilk aktivasyon sonrası isteğe bağlı kart gösterilir.

**WEB yerel kontrolleri PASS. Koşulsuz, tüm kapsamı doğrulanmış production GO verilmedi:** bu web release klasöründe `capacitor.config.ts` bulunmadığından iki tam native shell komutu çalışamadı. Bu durum mevcut kaynak eksikliğidir; native dosyalar eklenerek veya eski kaynaklar kopyalanarak gizlenmedi. Native çalışma zamanı/derleme tema dışlama, mobil oturum ve secure storage kontrolleri geçti. İki mevcut orta seviyeli bağımlılık uyarısı ayrıca aşağıda belirtilmiştir.

Production deploy, Git commit/push, production migration, canlı veri yazma, environment/feature flag değişikliği veya gerçek mesaj gönderimi yapılmadı. Test şemaları yalnız izole PGlite ortamlarında kuruldu.

## 2. Onaylanan tasarımın uygulanması

- Platform: mevcut altı navigasyon bölümü korunarak masaüstü sol navigasyon, mobil bölüm düğmeleri, nötr çalışma alanı, gerçek okul tablosu ve özetler kullanıldı. `PlatformOverview` mevcut `getManagedSchools` sonucunu kullanır. Yeni istatistik veya sahte üretim verisi eklenmedi.
- Okul: mevcut sol menü/mobil seçim, okul bilgileri/kod kopyalama, kayıt/personel/randevu işlemleri, Operasyon Merkezi ve Görüşmelerin Durumu korunarak prototip kart ve boşluk sistemine taşındı.
- Prototipteki örnek sayıların yerine mevcut API'nin gerçekten sağladığı sayaçlar gösterilir. API'de olmayan sentetik istatistikler eklenmedi.
- Fotoğraf yönetim ekranlarında yalnız dar karşılama alanındadır. Ana veri yüzeyleri fotoğraftan ayrıdır. Fotoğraf dosyası ve MP4 değiştirilmedi.
- WhatsApp: ilk bakışta lisans bitişi, sonraki zaman, uygun alıcı ve otomatik durum; manuel önizleme ve görünür geçmiş; alıcı/teknik ayrıntılar başlangıçta kapalı. Uygun alıcı yoksa gönderim düğmesi pasiftir ve açıklama görünür. API kabulü teslimat gibi gösterilmez.

## 3. Tema altyapısı ve kalıcılık

`ThemeProvider`, `ThemeToggle`, `data-theme` ve CSS custom properties kullanıldı. Açık tema varsayılandır. `veli-randevu.web-theme` anahtarı yalnız görsel tercihi taşır; auth token, rol veya yetkiyle bağlantılı değildir. Sekmeler storage eventiyle senkronize olur. Depolama engellense de bellek içi tema değişimi çalışır. İşletim sistemi tercihi açık seçimi ezmez.

`public/web-theme-init.js` CSS/React'ten önce tercih niteliğini uygular. Betik native çalışma zamanında işlem yapmaz; Vite Android/iOS HTML dönüşümünde tamamen kaldırılır. Native uygulamaya tema düğmesi veya tema niteliği eklenmez.

Ay/güneş kontrolü ortak üst menüde; üst menüsü olmayan public/giriş sayfalarında sağ üstte; açık modalda modal başlığında erişilebilirdir. Aynı anda gereksiz ikinci düğme gizlenir. Dokunma hedefi 44×44px, eylemi açıklayan aria-label, klavye ve focus desteği vardır. Portal modalları kök temayı devralır. Renk geçişi 180ms; reduced-motion durumunda kaldırılır.

Merkezi palet: açık zemin #F5F7F5, yüzey #FFFFFF, ana yazı #142D26, ikincil #586D63, marka #136B56. Koyu zemin #101816, yüzey #1D2A25, yükseltilmiş yüzey #263630, ana yazı #EFF5F1, ikincil #B7CAC0, aksiyon #48B99A. Ana yazı/ikincil yazı/ana düğme çiftlerinin AA 4.5:1 kontrast kontrolleri PASS; bu tüm sitenin resmi erişilebilirlik sertifikası değildir.

Mevcut CSS'teki renkler web kapsamlı anlamsal değişkenlere bağlandı; native için orijinal değerler fallback olarak korunur. Eski yoğun Dashboard overlay dosyası yeniden yama zinciriyle büyütülmek yerine onaylanan yerleşimle değiştirildi. Invert/brightness filtresi kullanılmadı.

## 4. Web kapsamı ve görsel kontroller

Gerçek React bileşenleriyle 11 ekran (Platform, Okul, WhatsApp modalı, giriş, öğretmen, veli, yardım, Hesabım, güvenlik, lisans/iletişim ve karşılama) iki tema ve yedi viewport'ta test edildi:

1920×1080, 1440×900, 1366×768, 768×1024, 430×932, 390×844, 375×812.

Chromium + WebKit kullanıldı. Yardım rehberlerinin slug'ları ayrıca iki temada dolaşıldı. Veli/öğretmen randevu sekmeleri yoğun sentetik listeyle görüntülendi. Boş geçmiş, yükleniyor ve hata durumları da üretildi. 112 ekran görüntüsü `.cache/approved-theme-review` altındadır. Masaüstü ve mobil örnekler açılarak incelendi; koyu temada açık kalan yardım/giriş/başlık yüzeyleri bu inceleme sırasında düzeltildi. Görseller gerçek üretim kullanıcı verisi içermez.

Fiziksel iPhone/Android testi yapılmadı. WebKit sonucu fiziksel iPhone Safari sonucu olarak sunulmaz. Baz renkler ve başlıca ekranlar doğrulandı; tüm olası kullanıcı verisi ve cihaz kombinasyonları için mutlak görsel kusursuzluk iddia edilmez.

## 5. WhatsApp izin modeli

- Geçerli izin: açık gösterilir, sonraki giriş veya lisans yenilemesinde yeniden onay istenmez.
- İzin yok: kapalı; kendi hesabındaki anahtarla açık olumlu işlem gerekir.
- Geri çekilmiş izin: kapalı kalır; otomatik yeniden açılmaz.
- Telefon/izin kanıtı değişikliği: mevcut backend'in yeniden izin ve telefon uygunluk kontrolleri korunur.
- Platform yöneticisi başkası adına izin oluşturamaz. Alıcılar tenant, aktif üyelik, doğrulanmış telefon, scope ve geri çekme kurallarından geçer.
- Yeni okul yöneticisi: mevcut WhatsApp + e-posta + okul kodu aktivasyonu başarıyla tamamlandıktan sonra isteğe bağlı tercih kartı sunulur. Kartın marker'ı yalnız sunum içindir; auth/izin kanıtı değildir. Kartı atlamak hesabın kullanımını engellemez ve izin vermez. Tamamlanan/geri çekilen/geçersiz kanıtlı tercihler otomatik yeniden sorulmaz.
- İlk aktivasyon marker'ı sessionStorage kullanır. Depolama engelliyse kart atlanır; Hesabım tercihi yine kullanılabilir. Dismissal sunucuya izin kaydı olarak yazılmaz.
- Tercih isteğinin sonucu bağlantı nedeniyle belirsizse değişmediği iddia edilmez; salt okunur durum yenileme sunulur.
- Backend izin/audit tabloları ve API sözleşmesi değiştirilmedi. Mevcut açık işlem, telefon-okul-kapsam ve zaman kanıtı/audit mekanizması kullanılır.

Otomatik plan 7/3/1 gün ve 09.00 İstanbul olarak korundu. Manuel önizleme + açık gönderim onayı, ortak uygunluk çözümleyicisi, idempotency, cooldown, concurrency, yenileme ve belirsiz sonuçta otomatik tekrar yapmama kuralları değişmedi. Gerçek gönderim özellik bayrakları okunup değiştirilmedi.

## 6. Test sonuçları

| Kontrol | Sonuç |
|---|---|
| npx tsc --noEmit | PASS |
| npm ci --ignore-scripts; gerçek node_modules | PASS |
| npm run build:production-package | PASS |
| Client/server production build + release artifact safety | PASS |
| Dört ZIP bağımsız modül/runtime + health/capabilities | PASS |
| Gerçek derlenmiş frontend + çıkarılmış API ZIP; 502/retry | PASS |
| test-web-theme-ui.mjs; iki engine, iki tema, yedi viewport | Chromium + WebKit PASS |
| test-web-theme-boundary.ts; erken tema, native dışlama, temel AA | PASS |
| test-premium-dashboard-ui.mjs; navigasyon, modal, drawer, mobil | PASS |
| test-license-reminder-ui.mjs; önizleme, açık onay, çift tık, focus, scroll | Chromium + WebKit PASS |
| test-license-permission-entry-ui.mjs | PASS |
| test-license-reminder-presentation.ts | PASS |
| test-web-background-ui.mjs | Chromium + WebKit PASS |
| test-admin-operations-ui.mjs | PASS |
| test-license-whatsapp-reminders.ts | PASS |
| test-license-reminder-api.ts | PASS |
| test-whatsapp-auth.ts | PASS |
| test-unified-whatsapp-login.ts | PASS |
| test-provisioned-admin-phone-login.ts | PASS |
| test-platform-phone-binding.ts; tekrar çift faktör girişi | PASS |
| test-identity-auth-attempts.ts | PASS |
| test-production-auth-guards.ts | PASS |
| test-security-and-tenant-audit.ts | PASS |
| test-parent-self-service-auth.ts | PASS |
| test-teacher-appointment-ownership.ts | PASS |
| test-appointment-slot-visibility.ts | PASS |
| npm run test:whatsapp-login-ui | PASS |
| npm run test:mobile-platform | PASS |
| npm run test:secure-storage | PASS |
| test-http-parser-safety.mjs | PASS |
| npm run test:android-shell | BLOCKED / komut FAIL: capacitor.config eksik |
| npm run test:ios-shell | BLOCKED / komut FAIL: capacitor.config.ts eksik |
| Scope diff --check / UTF-8 | PASS |

Auth/tenant/izin/randevu testleri `.cache/run-isolated-regression.mjs` üzerinden üretim bağlantısı bulunmayan geçici PGlite klasörlerinde çalıştırıldı. Gerçek sağlayıcı yerine sahte WhatsApp/e-posta sağlayıcıları kullanıldı. Otomatik test sonuçları canlı OTP teslimatı olarak sunulmaz.

## 7. Ek bağımlılık güvenliği

Temiz kurulum sonrası audit, mevcut body-parser 2.3.0 için yüksek önem seviyeli sıkıştırılmış istek DoS uyarısı bildirdi. Kilit dosyasında yalnız body-parser 2.4.0 ve qs 6.17.1 güncellendi; Express 5.2.1 ve doğrudan dependency sözleşmeleri değişmedi. Yeni paket eklenmedi. [Güvenlik duyurusu](https://github.com/advisories/GHSA-27r3-jxmh-p828).

Bozuk gzip gövdesi sonrası izole sunucunun çalışmaya devam etmesi ve sonraki health 200 regresyonu PASS. Yeni sürümler API ZIP'inde fiziksel olarak doğrulandı. Son production-dependency audit: yüksek 0, kritik 0, orta 2 (gaxios/uuid). Bu mevcut orta seviye uyarılar için daha geniş Firebase/Google bağımlılık bakımını bu tasarım görevine karıştırmadım; ayrı değerlendirme gerektirir.

## 8. Function paketleri

| Function | Sonuç | Korunan metadata |
|---|---|---|
| api | PASS | serverless-http 4.0.0, pg 8.23.0, body-parser 2.4.0, qs 6.17.1 |
| appointment-reminders | PASS | pg; */5 * * * * |
| license-reminders-background | PASS | pg; background invocation |
| license-reminders | PASS | 0 6 * * *; yalnız worker tetikleyicisi, pg gerektirmez |

ZIP'ler kaynak node_modules olmadan ayrı OS temp klasöründe yüklenerek çalıştırıldı. Yalnız normal build başarısına güvenilmedi. `release/client`, `release/functions`, `release/artifact-manifest.json` ve `.netlify/functions/manifest.json` aynı derlemeden üretildi. SHA-256 ve fiziksel dependency listesi `.cache/approved-function-dependencies.json` içindedir. Sentetik fixture dizeleri client paketine girmedi.

## 9. Değişen dosyalar

- `index.html`
- `package-lock.json`
- `src/index.css`
- `src/main.tsx`
- `src/components/AdminView.tsx`
- `src/components/dashboard-presentation.css`
- `src/components/DashboardIntro.tsx`
- `src/components/help-presentation.css`
- `src/components/license-whatsapp.css`
- `src/components/LicenseReminderContent.tsx`
- `src/components/LicenseReminderWelcome.tsx`
- `src/components/LicenseWhatsAppPanel.tsx`
- `src/components/LicenseWhatsAppPreference.tsx`
- `src/components/Navbar.tsx`
- `src/components/PhoneCentricLoginPanel.tsx`
- `src/components/PlatformOverview.tsx`
- `src/components/SchoolManagement.tsx`
- `src/components/ui.tsx`
- `src/components/web-theme.css`
- `src/components/web-welcome.css`
- `src/context/WebTheme.tsx`
- `public/web-theme-init.js`
- `vite.config.ts`
- `scripts/test-web-theme-ui.mjs`
- `scripts/test-web-theme-boundary.ts`
- `scripts/test-http-parser-safety.mjs`
- `scripts/test-license-reminder-ui.mjs`
- `scripts/test-license-permission-entry-ui.mjs`
- `scripts/test-premium-dashboard-ui.mjs`
- `scripts/test-web-background-ui.mjs`

Backend/server, netlify function kaynakları ve native dosyaların başlangıç SHA-256 koruma kontrolünde fark: 0. Önceki kullanıcının diğer worktree değişiklikleri, AGENTS.md ve codemagic.yaml değiştirilmedi. Bu release klasörü Git checkout değildir; whitespace kontrolü başlangıç snapshot'ı ile no-index diff üzerinden yapıldı.

## 10. Önizleme ve görseller

Yerel gerçek-bileşen önizlemesi: http://127.0.0.1:4178/?mode=platform

Diğer modlar: school, whatsapp, login, teacher, parent, help, account, security, public, welcome. Önizleme yalnız sentetik veri kullanır; gerçek giriş/gönderim/API değildir.

| Ekran | Açık masaüstü | Koyu masaüstü | Açık mobil | Koyu mobil |
|---|---|---|---|---|
| Platform | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/platform-light-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/platform-dark-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/platform-light-chromium-390.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/platform-dark-chromium-390.png) |
| Okul | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/school-light-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/school-dark-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/school-light-chromium-390.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/school-dark-chromium-390.png) |
| WhatsApp | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/whatsapp-light-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/whatsapp-dark-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/whatsapp-light-chromium-390.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/whatsapp-dark-chromium-390.png) |
| Giriş | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/login-light-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/login-dark-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/login-light-chromium-390.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/login-dark-chromium-390.png) |
| Öğretmen | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/teacher-light-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/teacher-dark-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/teacher-light-chromium-390.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/teacher-dark-chromium-390.png) |
| Veli | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/parent-light-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/parent-dark-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/parent-light-chromium-390.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/parent-dark-chromium-390.png) |
| Platformu İncele | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/help-light-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/help-dark-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/help-light-chromium-390.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/help-dark-chromium-390.png) |
| Hesabım | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/account-light-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/account-dark-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/account-light-chromium-390.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/account-dark-chromium-390.png) |
| Karşılama | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/welcome-light-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/welcome-dark-chromium-1440.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/welcome-light-chromium-390.png) | [Görüntü](C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029/.cache/approved-theme-review/welcome-dark-chromium-390.png) |

WebKit karşılıkları aynı klasörde `webkit` isimleriyle yer alır. Randevu yoğun liste görüntüleri `parent-appointments-*` / `teacher-appointments-*`; yükleniyor/hata durumları `whatsapp-loading-*` / `whatsapp-error-*` adlarını taşır.

## 11. Production tabanı, yayın ve geri dönüş

İlk kontrolün sağlıklı deploy'u `6ae32197a83a6b6d246716d0` idi. Görev sırasında dışarıdan yayımlanmış daha yeni sağlıklı sürüm tespit edildi: **6ae342e13fc1e501a18f7b31**, ready; 29 Ekim 12.58 UTC yayımlanmış, title: Premium Dashboard and WhatsApp License Reminder UX Final Release. Bu yayını ben yapmadım. Git commit_ref null; GitHub main ile eşleştiği varsayılmadı.

Salt okunur son kontrol: /api/health HTTP 200, PostgreSQL/Supabase connected; /api/public/auth-capabilities HTTP 200, WhatsApp/unified/phone-centric true. Bunlar eski çalışan production'ın durumudur; yeni temanın canlıya çıktığını göstermez. Lisans gönderim bayrakları bu görevde production environment üzerinden değiştirilmedi veya yeni değerleri doğrulanmış gibi raporlanmadı.

Yayın sonrası hedefli manuel kontroller: gerçek web oturumunda tema değişimi/çıkış/yeni giriş; okul yöneticisinin kendi tercih aç/kapat akışı; Platform modalı ve alıcı sayıları; farklı tenant; gerçek cihaz Safari/Chrome. Manuel mesaj kullanıcı onayı olmadan gönderilmeyecek.

Aşağıdaki komut yalnız ayrı yayın onayı ve risklerin değerlendirilmesinden sonra çalıştırılmalıdır; **çalıştırılmadı**:

```powershell
Set-Location 'C:\Users\XIO\Documents\Codex\veli-randevu-auth-runtime-hotfix-20261029'
npm run build:production-package
if ($LASTEXITCODE -ne 0) { throw 'Paket doğrulanamadı; yayın durduruldu.' }
netlify deploy --prod --site f15fdc98-3bb3-4f0d-88ca-bb8c685ffaea --dir release/client --functions netlify/functions --no-build --message 'Approved web design, persistent themes and license reminder preferences'
```

CLI'nin --prod, --dir, --functions, --no-build seçenekleri yerel help ile doğrulandı. Dört fonksiyonu dışarıda bırakan çıplak frontend yayını yapılmamalı. Yayından hemen önce aktif deploy yeniden kontrol edilmeli; görev sırasında değiştiği görüldüğünden eski bir ID'ye körlemesine güvenilmemeli.

Rollback: Netlify veliokul → Deploys → son sağlıklı `6ae342e13fc1e501a18f7b31` → Publish deploy. Bu deploy korunmalı. Kritik health/capabilities/auth hatasında yeni yayını ilerletmek yerine bu sürüme dönülmeli. DB/env değişmediğinden bu iş için veritabanı geri yüklemesi veya ters migration gerekmez. Tema tercihi zararsız istemci anahtarıdır; eski sürüm kullanmıyorsa yok sayar.

## 12. Açık doğrulama sınırları

- İki native shell komutu eksik capacitor config nedeniyle başarılı sayılamaz. Eski native kaynak kopyalanmadı ve native dosyalar değiştirilmedi.
- Fiziksel cihaz, gerçek OTP/e-posta veya WhatsApp teslimatı yapılmadı.
- Tüm olası modal/route/veri kombinasyonlarının görsel olarak elle incelendiği iddia edilmez; ortak tokens, otomatik ekran/rehber kapsamı ve seçilmiş gerçek render incelemesi kullanıldı.
- İki mevcut orta seviye transitive dependency uyarısı açık.
- Yeni production deploy ve gerçek hesapla smoke kontrolleri ayrıca onaylı yayın sonrası gerekir.
