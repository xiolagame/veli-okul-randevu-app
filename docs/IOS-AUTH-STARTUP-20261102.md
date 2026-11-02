# iOS giriş ekranı beklemesinin kaldırılması — 2 Kasım 2026

Dal `feature/staff-otp-master-20261031`, çalışma klasörü `C:\Users\XIO\Documents\Codex\veli-staff-otp-master-20261031`. HEAD `0e305dfb392936bbd510a4c591ec86fe1846344d`; commit/push/deploy yapılmadı. Başlangıçtaki dokuz dosyalık iOS/personel çalışması korundu.

## Kanıtlanmış neden

`AuthView` önce `capabilitiesStatus='loading'` ile açılıyor, `getAuthCapabilities()` tamamlanmadan `resolveLoginEntry()` telefon panelinin oluşturulmasına izin vermiyordu. “Giriş seçenekleri yükleniyor…” metni bu render koşulundan geliyordu. Sabit üç saniyelik timer bulunmadı.

İzole Chromium deneyi aynı gerçek `AuthView` koduna 3.000 ms gecikmeli capabilities sağlayıcısı verdi: React başlığı 33 ms'de oluştu, istek yanıtı 3.033 ms'de geldi, telefon alanı ancak 3.035 ms'de oluştu. Dolayısıyla **bu bekleme ekranının görünür süresini uzatan kanıtlanmış neden, formun asenkron capabilities yanıtına bağlanmasıdır**.

Bu, kullanıcının gerçek iPhone'undaki isteğin neden üç saniye sürdüğünü kanıtlamaz. O ağ/native ölçümü yoktur. İncelenen ek zincirler:

- `AppContext` önce güvenli depolamadan session restore yapar. Kayıtlı token varsa kimlik/okul erişimi doğrulanır; `isLoading` bitmeden `AuthView` açılmaz. Bu güvenlik sırası değiştirilmedi.
- Mevcut `veli.startup.secure-storage`, `me`, `school-access` ölçümleri kaynakta zaten var. Gerçek Keychain/Capacitor süreleri bu Windows ortamında alınmadı.
- API istemcisi iOS'ta token store'u okuyabilir; genel istek timeout'u fetch aşamasında 20 saniyedir. Public capabilities handler'ı yalnız feature flag döndürse de mevcut Express middleware API isteklerinden önce database initialization bekleyebilir. Bunların canlı gecikmeye katkısı ölçülmedi; “DB yavaş” veya “Keychain üç saniye” sonucu çıkarılmadı. Backend/middleware değiştirilmedi.

## Düzeltme

Yalnız **iOS'ta**, telefon formunun kabuğu ilk `AuthView` render'ında görünür. Kullanıcı numarasını yazabilir. Arka plandaki `no-store` capabilities kontrolü başarıyla bitip WhatsApp/telefon girişi etkin olduğu doğrulanmadan:

- Gönderim butonu disabled kalır.
- `submit` fonksiyonu çağrı yapmaz; DOM üzerinden `requestSubmit()` denemesi de engellenir.
- Kod isteyen iç fonksiyon ayrıca `requestEnabled` kontrolü yapar; OTP/oturum başarı mesajı üretilmez.

Form görünmesi yetki verilmesi anlamına gelmez. Backend hesabı/rolü/okulu, rate-limit ve OTP doğrulamasını yine kendisi yapar. Capabilities önbelleği veya varsayılan “etkin” sonucu eklenmedi.

502/offline/bozuk yanıtta form korunur, anlaşılır hata ve “Tekrar dene” görünür; girilen numara kaybolmaz. iOS kontrolü sekiz saniyede güvenli hata durumuna geçer. AbortSignal desteklenir; iptal edilemeyen/geç dönen eski istek de `completed/active` kontrolüyle formu yanlışlıkla etkinleştiremez. Retry yeni bir kontrol yapar. WhatsApp kapalıysa mevcut “şu anda kullanılamıyor” mesajı gösterilir ve gönderim açılmaz.

Android ve web'in mevcut capability bekleme/legacy rollout politikası değişmedi. `PhoneCentricLoginPanel` yeni guard parametrelerini diğer çağrılarda eski davranışı koruyacak varsayılanlarla alır. Tema, giriş tasarımı, `04-Mobil.png`, safe-area/status bar kodu ve web sinematik geçişi değiştirilmedi.

## Önce / sonra ölçümleri

**Tek kontrollü yerel koşunun gözlemleri; gerçek cihaz, native cold-start veya production ağ ölçümü değildir.** Başlangıç, fixture HTML'inin `performance.now()` referansıdır. React/JS yükleme ve fixture render sürelerini içerir; Keychain/Capacitor/splash başlangıcını içermez. Normal senaryo 50 ms, yavaş senaryo 3.000 ms yapay API gecikmesidir.

| Senaryo / aşama | Önce ms | Sonra ms |
|---|---:|---:|
| Normal — HTML başlangıcı | 0 | 0 |
| Normal — React başlığı | 131 | 134 |
| Normal — capabilities istek başlangıcı | 139 | 143 |
| Normal — capabilities yanıtı | 191 | 194 |
| Normal — telefon alanı DOM'da | **196** | **134** |
| Yavaş — HTML başlangıcı | 0 | 0 |
| Yavaş — React başlığı | 33 | 39 |
| Yavaş — capabilities istek başlangıcı | 32 | 38 |
| Yavaş — capabilities yanıtı | 3033 | 3039 |
| Yavaş — telefon alanı DOM'da | **3035** | **39** |

Yavaş senaryoda görünür form beklemesi yaklaşık 2.996 ms azaldı. Ağ yanıtı hızlandırıldığı iddia edilmiyor: OTP gönderebilme hâlâ yaklaşık 3.039 ms'deki yetkili cevabı bekler. Başlangıçta başlık, effect ve MutationObserver timestamp'leri aynı event-loop çevriminde birkaç ms farklı sıralanabilir. Sayılar bir benchmark garantisi değildir.

Ham kanıtlar `audit/startup/before.json`, `after.json`. Fixture testindeki `useApp` oturum kontrolü tamamlanmış bir giriş ekranını temsil eder; uygulamanın tüm native başlangıç süresi olarak sunulmaz.

## PASS

- `node scripts/test-ios-auth-startup-performance.mjs before/after`: önce/sonra süreler, 50/3000 ms yanıt, erken telefon alanı, beklerken doğrudan form gönderiminin engellenmesi, 502/offline/retry, numaranın korunması, WhatsApp kapalı, bozuk flag, sekiz saniye timeout, iptal edilemeyen geç yanıt, unmount/re-entry'de yeniden doğrulama, web/Android'in erken form göstermemesi.
- `node scripts/test-auth-capabilities-client.mjs`: **gerçek API istemcisi** ile mock fetch; `no-store`, HTTP 502 + JSON olmayan gövde, offline, AbortSignal ve devre dışı yanıt.
- `node scripts/test-review-client.mjs`: production/demo origin ayrımı ve Android public capabilities davranışı, mock fetch.
- `node --import tsx scripts/test-mobile-platform-foundation.ts`: güvenli token store/session restore, mevcut oturum, offline restore, invalidation/logout ve lifecycle sözleşmeleri. Gerçek Keychain/telefon testi değildir.
- `node --import tsx scripts/test-ios-session-expiry.ts`: token süre/signature/401 cleanup. Session mekanizması değiştirilmedi.
- `node --import tsx scripts/test-ios-login-policy.ts`: fail-closed yetkilendirme ve Android rollout policy.
- `node scripts/test-ios-auth-ui.mjs`: OTP, hata, resend, ikinci e-posta faktörü, session hatası/restart, klavye fixture'ı.
- `node scripts/test-android-auth-startup.mjs`: 8 tema/capability senaryosu, malformed/error/retry, doğru tek form ve mağaza inceleme erişimi.
- `node scripts/test-mobile-auth-layout.mjs`: ortak web/mobil layout ve telefon/OTP ekranları.
- `node scripts/test-ios-statusbar-surfaces.mjs`: önceki 240 rol/tema/inset görünümü, login/OTP, modallar, Web/iOS güvenlik listesi, resume ve native hata/cleanup.
- `node --no-wasm-code-gc --import tsx scripts/test-staff-otp-master.ts`: 9 yerel entegre grup; çift personel/aktif-bekleyen/tenant ve otomatik OTP aktivasyonu assertion'ları korunarak tekrar PASS.
- `node --import tsx scripts/test-whatsapp-login-ui.ts`, `test-production-auth-guards.ts`, `node scripts/test-theme-bootstrap.mjs` (40 durum), `node scripts/test-ios-release-safety.mjs`.
- `npm run lint`, `npm run build`: TypeScript ve web client/server production build; release artifact denetimi 62 client / 2 server dosyası PASS.
- `git diff --check` ve önceki çalışma kaynakları için görev öncesi/sonrası byte hash karşılaştırması.

Playwright mevcut yerel modülle çalıştırıldı: `PLAYWRIGHT_MODULE=C:\Users\XIO\AppData\Local\Temp\veli-playwright-tests\node_modules\playwright\index.mjs`. Yeni bağımlılık yok. Testler tüm dış ağ çağrılarını engeller veya mock fetch kullanır. Test kullanıcıları sentetiktir; gerçek OTP, mesaj, e-posta veya push gönderilmez.

## FAIL / BLOCKED

**Son hedefli testlerde açık FAIL yok.** Önceki rapordaki tam Android paket testinin web build/native artifact önkoşulu bu görevde giderilmiş sayılmaz; native paketler yeniden üretilmedi.

**BLOCKED / NOT TESTED:** gerçek iPhone cold launch, Keychain/Capacitor başlangıç süreleri, fiziksel ağda gerçek capabilities latency, gerçek native OTP teslimatı, fiziksel cihaz arka plan/ön plan ve mevcut oturumla açılış/çıkış. Yerel session ve UI lifecycle testleri bunların yerine geçirilmedi. Xcode/IPA, APK/AAB, native sync, Codemagic ve TestFlight çalıştırılmadı. Tam eski 24'lü paket yerine ilgili hedefli regresyonlar çalıştırıldı.

## Değişen dosyalar ve koruma

Bu görevin uygulama değişiklikleri yalnız:

1. `src/components/AuthView.tsx`: iOS erken görünüm, yetkili cevaba bağlı enablement, sınırlı timeout/retry ve stale response koruması.
2. `src/components/PhoneCentricLoginPanel.tsx`: işlem/buton guard'ı ve bekleme durumu.
3. `src/services/api.ts`: capabilities çağrısına optional AbortSignal iletimi; origin/session yöntemi değişmedi.

Yeni testler `scripts/test-ios-auth-startup-performance.mjs`, `scripts/test-auth-capabilities-client.mjs`; bu rapor ve kaynak bütünlüğü için `audit/staff-otp-overlay.json`, `audit/ios-source-lock.json` güncellendi.

Önceki dokuz dosyanın yedi kaynak/test/rapor dosyası byte düzeyinde aynı kaldı; iki integrity manifesti yeni kaynakları kapsamak için yenilendi. `server/api.ts`, `src/index.css`, `src/platform/theme.ts` üzerindeki önceki düzeltmeler değiştirilmedi. Native yapılandırmalar, AppContext/session restore, CORS, backend flag/OTP/rate-limit/tenant ve lisans kuralları, iOS varsayılan light, güçlü platform doğrulaması ve demo altyapısı aynıdır.

HEAD/branch ve gerçek staging alanı korunur; bütünlük manifestleri geçici index ile hazırlanır. Commit, push, merge, deploy, canlı veritabanı veya TestFlight işlemi yoktur.

## TestFlight öncesi

Yerel iOS kaynak düzeltmesi hazırdır; **gerçek cihaz performansı doğrulandı veya TestFlight'a hazır binary üretildi denmez**. Onay sonrası doğru iOS review environment ile web paketi/sync ve native build yenilenmeli; gerçek iPhone'da ilk kurulum, kayıtlı oturum, logout/re-entry, yavaş ağ/çevrimdışı, splash/status bar ve OTP gönderiminin sunucu doğrulamasını beklemesi ölçülmelidir. Native build ve yayın kullanıcı onayına bırakılır.
