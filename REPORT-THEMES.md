# Açık / koyu mod tasarım ve entegrasyon raporu

29 Ekim 2026. Kaynak teslimi: `C:/Users/XIO/Documents/Codex/veli-randevu-android-themes-20261029`. Bu klasör eski çalışan Android kaynaklarının ayrı kopyasıdır; release klasörü değildir. **Üretim NO-GO**, fiziksel Android/native derleme NOT TESTED. Backend raporundaki güncel production değişimi durma koşulu burada da geçerlidir.

## 1. Tasarım sistemi

Mevcut React/TypeScript, Tailwind/global CSS, Lucide ikonları ve Capacitor8 korundu. Yeni bağımlılık yok. Merkezî semantic CSS token'ları, tip güvenli theme store/useTheme hook'u, tek paylaşılan ThemeControl ve erken HTML bootstrap kullanıldı. Auth/business logic değişmedi. Aynı React kaynakları gelecekte web build'ine verilirse web görünümünü de etkiler; production web'e hiçbir dosya yayınlanmadı.

## 2. Açık mod stratejisi

Canvas #f6f8f7, beyaz/yumuşak yüzeyler, marka yeşili, koyu metin ve #52695d ikincil metin; belirgin alan/kenarlık/focus ayrımı. Kart, buton, form, modal, nav, tablo ve semantik başarı/uyarı/hata/info token'ları merkezî. Eski sınıf renkleri5yeşil/6mavi/7turuncu/8mor korundu ve test edildi.

## 3. Koyu mod stratejisi

Canvas #0b1712, surface #14271f, elevated #1d362a; metin #e9f4ed, ikincil #b2c7ba. Primary #85dfb6 üzerindeki yazı #0b281b. Koyu yüzeyler arasında sınır/hiyerarşi korundu. Fotoğraf/marka arka planı aynı dosya, uygun overlay ile kullanılır; filter invert yok. Mevcut durum metinleri ve ikonları korunur; yalnız renkle yeni durum tanımlanmaz. Eski gradient/palette kullanan lisans panelleri de tema yüzeylerine uyarlandı.

## 4. Ay / güneş kesin davranışı

**Açık modda Moon, aria-label “Koyu modu aç”; tıklama/Enter koyu moda geçer ve Sun görünür. Koyu modda Sun, aria-label “Açık modu aç”; tıklama/Space açık moda geçer ve Moon görünür. PASS.** Lucide vektör ikonları;48px dokunma alanı, focus-visible. Test `scripts/test-themes.ts`, sonuç `audit/theme-results.json`. Tema değişiminde API istek sayısının artmadığı da assert edilir.

## 5. Kontrol yerleşimi

Ekranda tek kontrol: oturum öncesi auth-mobile-brand, oturum sonrası bütün rollerin topbar-actions alanı. Açık dialog varsa aynı control portal ile dialog-heading içine taşınır; ikinci buton üretilmez ve focus trap içinde kullanılabilir. Public iletişim ekranı başlığı desteklenir, uygun slot yoksa güvenli sabit fallback. Kimlik/rol/okul değiştirmek için yeni API akışı eklenmedi.

## 6. Değişen ve eklenen dosyalar

Değişen: `src/main.tsx`, `src/index.css`, `index.html`, `android/app/src/main/java/com/velirandevu/app/MainActivity.java`, `android/app/src/main/res/drawable/launch_screen.xml`, `android/app/src/main/res/values/styles.xml`.

Yeni: `src/theme/theme.ts`, `src/theme/ThemeControl.tsx`, `src/theme/themes.css`, `public/theme-init.js`, `android/app/src/main/java/com/velirandevu/app/NativeThemePlugin.java`, `android/app/src/main/res/values/theme_colors.xml`, `android/app/src/main/res/values-night/theme_colors.xml`, `scripts/test-themes.ts`, `scripts/test-license-theme-ui.mjs`. Audit/raporlar ayrıca eklendi. Hash manifestosu `audit/final-source-verification.json`.

Önceki Android kaynağının405 başlangıç dosyası değişmeden korunuyor. Secure Storage, API/public capabilities, OTP, AppContext, lisans paneli ve bilgilendirme izinlerinin iş kodu aynı; yalnız ortak renk katmanı uygulanıyor. WebWelcome/video/notebook/hover karşılama animasyonu eklenmedi; frontend artifact safety kontrolü geçti. Marka04-Mobil.png kaynağı değiştirilmedi.

## 7. Tercih saklama

Hassas olmayan `veli.theme.v1` localStorage değeri yalnız light/dark. JWT/token/telefon taşınmaz. Manuel seçim sistemden üstün; storage hatası uygulama/auth'u durdurmaz. Native tarafta yalnız tema seçimi private SharedPreferences'a yansır. Oturum temizliği tema anahtarını silmez. Login/logout/reload testlerinde korundu — PASS.

## 8. İlk açılış / sistem tercihi

Senkron `public/theme-init.js` main uygulamadan önce root data-theme/color-scheme/background/meta theme-color uygular. Öncelik kayıtlı seçim > prefers-color-scheme > light. Kayıtsız kullanıcıda sistem değişimi izlenir; manuel seçim sonradan sistemle ezilmez. İlk light/dark ve sistem değişimi browser testleri PASS. Native ilk OS splash karesi için aynı iddia yapılamaz: values-night sistem tercihini izler, elle seçilmiş tema sistemden farklıysa ilk sistem karesinin davranışı cihazda doğrulanmalı.

## 9. Rol bazında ekran kapsamı

| Ekran grubu | Browser kapsamı |
|---|---|
| Ortak | Giriş/telefon/OTP yanlış kod, capability503-retry, iletişim, yardım, hesap dialog'u; light/dark PASS |
| Veli | Mevcut5nav ekranı, öğrenci/öğretmen/randevu, bookingmodal ve QR kartı PASS |
| Öğretmen | Mevcut4nav ekranı, randevu/uygunluk/profil, reddetme modalı PASS |
| Güvenlik | Ana ekran ve kamera izin durumu PASS; gerçek kamera/native izin NOT TESTED |
| Okul yöneticisi | Öğrenci-veli sınıf kartları/arama/form, kullanıcılar, randevular, ayarlar, audit PASS |
| Platform | Mevcut6nav bölümü, dashboard/istatistik kartları, lisans detay dialog'u, güvenlik/istek/audit görünümleri PASS — yalnız browser visual fixture |
| Lisans/izin | Gerçek LicenseManagement ve LicenseWhatsAppPreference bileşenleri: consent give/revoke, error/retry, masked history, preview/checkbox/onay/pending/school-switch PASS — yalnız mock |

Platform visual fixture sunucuda platform yetkisi vermez; backend global işlemler kapalıdır. Her olası kayıt, filtre, bütün modal varyantları ve uzun veri kombinasyonları test edilmiş sayılmaz. Uygulamada bulunmayan grafik veya ekran icat edilmedi.

## 10. Responsive ve görsel sonuçlar

23 gruplanmış senaryo PASS; iki modda126 capture. Login ve her rol ana ekranı320×568,390×844,768×1024,1440×1000; rol alt ekranları çoğunlukla390px. Lisans bileşen testi375–1440px. Capture'larda yatay overflow yok. Safe-area24px simülasyonu, küçülmüş klavye viewport'u, girişte200% font ve CTA erişimi PASS. Bu testler gerçek Android IME veya OS font ölçeği değildir.

Kanıtlar `audit/theme-screen-coverage.json`, `theme-screenshots/`, `themes.log`, `license-light.log`, `license-dark.log`. Görsel incelemede light okul yönetimi ve dark veli dahil gerçek render'lar değerlendirildi. Tüm screenshot'lar için önceki sürümle pixel-diff baseline bulunmuyor; sayısal pixel regression PASS iddiası yok.

## 11. Erişilebilirlik ve kontrast

Moon/Sun action names, tek kontrol, Enter/Space, görünür focus,48px hedef ve reduced-motion desteği PASS.7semantik metin/zemin çifti her capture'da en az4.5:1. Otomatik hesaplanabilen2.376 görünür metin kontrolünde0 bulgu. OTP geri bağlantısı ve aktif booking adımı dahil bulunan kontrast sorunları düzeltildi.

Otomatik DOM analizi resim/gradient/kompozit arka plan, belirli hero/classcard ve kamera alanlarını ayrı “complexBackgroundText” olarak kaydeder; bunlar PASS'a gizlice dahil edilmez. Sonuç tam WCAG uygunluk sertifikası değildir. Gerçek ekran okuyucu/TalkBack, tüm placeholder/ikon/non-text kontrastı ve bütün renk körlüğü durumları **NOT TESTED**. Hedef [WCAG AA normal metin4.5:1, büyük metin3:1](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).

## 12. Android WebView / native çubuklar

NativeThemePlugin native window, WebView background, status/nav renk ve light-icon bayraklarını günceller. MainActivity başlangıç/onResume/config değişiminde uygular; splash arka planı light/night resources kullanır. Mevcut edge-to-edge/safe-area/klavye/geri tuşu altyapısı korunur. TypeScript/browser testleri Java derlemesi yerine geçmez. Native Java/Gradle derlemesi, Android15+ edge-to-edge sistem çubuğu davranışı ve gerçek splash parlama testi **NOT TESTED**. Bu görevde cap sync/Gradle/APK/AAB yapılmadı.

İzole kopyaya gizli imzalama dosyaları, google-services.json ve makineye özel local.properties taşınmadı. Gelecekte build öncesi bunlar yetkili yerel yapılandırmadan güvenli şekilde bağlanmalı; Firebase dosyası tahmin edilmemeli.

## 13. Açık kalanlar / test sonuçları

| Kontrol | Sonuç |
|---|---|
| TypeScript | PASS — audit/typescript.log |
| Android frontend Vite build ve artifact safety | PASS — audit/android-frontend.log; Android paket build'i değildir |
| Tema23/23, light/dark lisans UI | PASS |
| Secure Storage / session migration /401/race | PASS — audit/test-native-secure-storage.log |
| Lifecycle/network/navigation/back contracts | PASS — audit/test-mobile-platform-foundation.log |
| Normal WhatsApp/unified/identity/production guard | PASS — audit/test-*.log; sentetik/mock |
| Eski Android shell testi | **FAIL** — test versionCode1 bekliyor, korunan kaynak2. Sürüm/test zorla değiştirilmedi; audit/test-android-shell.log |
| Gerçek cihaz, native compile, gerçek kamera, TalkBack | NOT TESTED |
| Aktif yeni production kaynakla entegrasyon | NOT VERIFIED; değişiklik kapısı nedeniyle duruldu |

Android shell testi ilk eski assert'te kesildiğinden sonraki kontrol adımları da tamamlanmış sayılmaz. Bu failure güvenli depolama/mobile foundation PASS sonuçlarını ortadan kaldırmaz; kendi başına açık test borcudur. Hiçbir test üretim verisine, OTP sağlayıcısına veya gerçek WhatsApp gönderimine gitmedi.

## 14. Mevcut AAB hash kanıtı

Orijinal `C:/Users/XIO/Documents/Codex/veli-randevu-android-sync-20261029/android/app/release/app-release.aab` değişmedi. SHA256 **8b7f215dc0791143a7e9be581b07b5e3bc46d1e268c4d0fe80be11563c8a7b62**,13.139.809byte. `audit/protected-artifacts.json`. Eski çalışan APK hash'i de FC2493F44BF6DC305637647DC5E336F5021FBD0AEB35B54CE301D7FFC737A471 olarak korundu. İmzalama/applicationId/versionCode dosyaları değiştirilmedi.

## 15. Gelecek AAB / versionCode planı

Demo backend eskiAAB2 ile yerel sözleşme testlerini geçer. **Yeni tema eskiAAB'de yoktur ve kendiliğinden eklenmez.** İleride ayrı onayla güncel production kaynağıyla uzlaştırma, native compile/cap sync ve fiziksel test, yetkili release signing, o tarihte Play'deki en yüksek koddan büyük versionCode ile yeni AAB gerekir. Şimdi versionCode artırılmadı, yeni APK/AAB üretilmedi, Play'e yükleme yapılmadı.

## 16. Fiziksel cihaz durumu

**NOT TESTED.** Browser responsive testi fiziksel Android testi olarak sunulmaz. Öncelik: küçük/büyük cihaz, manuel tema ile OS temasının farklı olduğu cold-start, TalkBack/fontscale, OTP klavye, arka plan/geri dönüş, kamera QR, status/navigation contrast ve offline session restore.

## 17. GO / NO-GO

İzole görsel kaynak incelemesine hazır; **üretim ve Android release için NO-GO**. Güncel Netlify6ae35d... kaynağı tam doğrulanmadı. Native derleme/fiziksel kontroller yapılmadı, eski shell testinin versionCode varsayımı açık. Son production ayrıca tema içeren başka bir yayına geçtiği için gelecekte iki tema uygulaması körlemesine birleştirilmemeli; önce gerçek yeni kaynak farkları incelenmeli.

## 18. Geri alma / mevcut sürüm koruma

Eski Android klasörü ve imzalıAAB değişmeden durur; hash manifestosu kanıttır. Tema ayrı klasörde ve backend ayrı değişiklik grubundadır. Gerekirse bu yeni klasör kullanılmaz, mevcut imzalı sürüm çalışmaya devam eder. İleride onaylı bir entegrasyonda yalnız listelenen tema/native dosyaları kontrollü geri alınır; auth/backend/production veri değişikliği gerekmez. Tema tercih anahtarı hassas veri taşımaz. Bu görevde reset/clean/restore, deploy, commit/push, migration veya mağaza işlemi yapılmadı.
