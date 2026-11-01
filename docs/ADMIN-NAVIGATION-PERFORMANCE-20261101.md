# Yönetim sekmeleri — performans ve güvenlik raporu

1 Kasım 2026. Çalışma: `C:\Users\XIO\Documents\Codex\veli-staff-otp-master-20261031`; dal `feature/staff-otp-master-20261031`. Önceki staged geliştirmeler korunmuştur. Bu görevde commit, push, merge, deploy, canlı migration/veri işlemi veya native binary derlemesi yapılmadı.

## Teşhis

Menü tıklaması zaten senkron olarak `activeTab` değiştiriyordu. Ölçüm, başlığın ağ beklemediğini gösterdi. Asıl bekleme öğrenci/personel/genel bakış bileşenlerinin unmount/remount sırasında tekrar veri istemesi, öğrenci arama/filtrelerinin veri gelene kadar gizlenmesi ve personelin her yenilemede listelerini saklamasıydı. Genel bakış okul bilgilerini yeniden yüklüyordu. `Skeleton` kartında sabit `white`, çubuklarda sabit açık renk kullanılıyordu.

AdminView içindeki sekme bileşenleri zaten aynı modülde statik import ediliyor; her sekme için ayrı bir lazy-import waterfall yoktu. App seviyesinde rol modülleri lazy kalır. Staff okumaları zaten `Promise.all` ile paraleldi; bu doğru davranış korunmuştur. Öğrenci sınıf/grup/arama hesapları mevcut `useMemo` ve 25 satırlık sayfalama kullanır; personel filtreleri de referanslara göre memoize edildi. Ölçülmemiş bir veritabanı darboğazı varsayılarak SQL/index/migration değiştirilmedi.

## Önce / sonra ölçümü

Aynı yerel kaynak ve sentetik PostgreSQL/API, Chromium, 1280/dark, 820/light ve 390/dark. Her okul GET yanıtına **yapay 2000 ms ağ beklemesi** eklendi. Her genişlikte Öğrenci → Personel → Genel Bakış → Öğrenci → Personel → Genel Bakış: toplam 18 geçiş; bunların 12'si önceden ziyaret edilmiş sekmelere dönüş. Ölçüm tıklama/seçim başlangıcından başlığın hazır olması ve iki animation-frame sonrasına kadardır. API backend süresi ayrı ölçüldü; 2000 ms gecikmeye dahil değildir.

| Ölçüm | Önce | Sonra |
|---|---:|---:|
| Tüm geçişlerde başlık/ilk görünüm medyanı | 46 ms | 47 ms |
| Tekrar ziyaretlerde başlık/ilk görünüm medyanı | 46 ms | 44 ms |
| 1280 px tekrar ziyaret medyanı | 49,5 ms | 53 ms |
| 820 px tekrar ziyaret medyanı | 52,5 ms | 44 ms |
| 390 px tekrar ziyaret medyanı | 43 ms | 37 ms |
| 12 tekrar ziyarette okul GET sayısı | 30 | **0** |
| 18 geçişte toplam okul GET sayısı | 42 | **9** |
| Tekrar ziyaretlerde görülen skeleton listeleri | 6 | **0** |
| Öğrenci ekranı ilk görünümünde arama/filtre | Gizli | **Hazır** |
| Öğrenci ekranına geri dönüşte ilk görünümde satırlar | Yok | **Hazır** |
| Soğuk öğrenci açılışı: genişlik başına GET | 2 | **1** |
| Soğuk personel açılışı: genişlik başına paralel GET | 2 | 2 |
| Yerel backend yanıt medyanı | 10,7 ms | 8,1 ms |

Başlık zaten hızlıydı; birkaç ms fark anlamlı bir CPU hızlanması iddiası değildir. Kazanç, geri dönüşte yeniden 2 saniyelik ağ yanıtını bekleyen veri alanının hazır gelmesidir. İlk ziyaret hâlâ gerçek veri yanıtını bekler; anında veri üretilmiş gibi gösterilmez. İlk veri yanıtının alt sınırı bu fixture'da 2000 ms + backend'dir; ayrı bir kesin “veri boyandı” ms değeri ölçülmedi. 2250 ms gözlem penceresiyle istekler/satırlar kontrol edilmiştir.

Önceki iki öğrenci isteğinde geliştirme React StrictMode effect tekrarının etkisi vardır; bunu production'da iki istek olduğunun kanıtı olarak sunmuyorum. Return-to-tab tekrar yükleme sorunu ise bileşen mount mantığından da doğrulanır. Bu sayılar canlı production, iPad/WKWebView veya fiziksel Android ölçümü değildir. Tarayıcı ortamındaki yük/derleyici ısınması gerçek cihaz performansını temsil etmez.

Kanıt: `audit/master/navigation-before.json`, `navigation-after.json`, ilgili `.log` dosyaları. Bunlar yalnız yerelde tutulur ve Git'e alınmaz.

## Uygulanan çözüm

- Küçük ve sınırlı, yalnız bellekte bir read cache eklendi; yeni bağımlılık yok. Mevcut API/AppContext yapısı genişletildi. Aynı anda aynı okuma tek promise kullanır.
- Tazelik 30 saniye; eski snapshot en fazla 5 dakika okunabilir. Süresi geçen snapshot yeniden açılışta hemen gösterilir, güncel okuma arka planda tamamlanır. Süre aşımı tembel temizlenir; ayrıca her bağlam değişiminde fiziksel purge vardır. En fazla 32 veri kaydı tutulur; localStorage/Keychain'e veri cache'i yazılmaz.
- Cache yalnız okul yöneticisi veya açık platform-hedef bağlamındaki izinli GET'lerde çalışır: okul bilgisi, öğretmen/güvenlik listeleri, öğrenciler, yöneticiler, randevular, operasyon özeti ve destek/lisans talep listesi. Audit, QR, OTP, preview/challenge, push, konuşma mesajları ve diğer rollerin mobil yenilemeleri cache dışındadır.
- Kapsam: kimliğe bağlı oturum revision + okul + seçili üyelik rolü + açık platform hedefi; endpoint/query de anahtarın parçasıdır. JWT cache anahtarına kopyalanmaz. Token yenileme/temizleme, 401 iptali, okul/rol/hedef değişimi eski kayıtları temizler. Yeni yetki vermez; backend guard/RLS değişmedi.
- Yazmanın öncesinde ve sonrasında cache temizlenir; hata/sonucu belirsiz yazma da eski snapshot'ı korumaz. Eski in-flight okuma nesil kontrolünde reddedilir; aynı yetki bağlamında bir kez yeniden denenebilir. Farklı bağlamdaki eski yanıt yeni cache'e yazılamaz.
- Öğrenci/okul bilgisi/özet/yönetici/talep bileşenleri cached snapshot ile ilk render yapar. Personel yenilemesi cache varsa listeyi gizlemez. Öğrenci arama ve filtreleri ilk ağ yanıtını beklemez. Randevu ilk yüklemesinde “kayıt yok” yerine gerçek yükleme durumu vardır.
- 503/ağ hatasında eldeki snapshot kaybolmaz ve hata görünür. 401/403 geldiğinde ilgili hassas görüntü verisi bırakılmaz. App seviyesinde yönetim görünümü kullanıcı/okul/rol/platform/oturum anahtarına bağlanır; eski sekme başka bağlam altında tutulmaz. Gizli mount edilmiş panel/portal biriktirme yöntemi kullanılmadı.
- `Skeleton` yüzeyi ve çubukları tema tokenlarından gelir. İlk listede küçük yerel yükleme alanı kullanılır; başlık ve filtreler sabittir. Reduced-motion CSS kuralı korunur. Nicel CLS/heap/React Profiler render sayımı yapılmadı; bunlar PASS olarak sayılmıyor.
- Yönetim kodu oturum açılışından sonra düşük öncelikli hazırlanabilir; save-data/2G durumunda atlanır. Okul/modül verisi prefetch edilmez; bütün okullar indirilmez.

## Test sonuçları

| Test | Sonuç / gerçek kapsam |
|---|---|
| `npm run lint` | PASS |
| `npm run build` | PASS; web/server build + release artifact güvenlik taraması, deploy yok |
| `test-school-read-cache.ts` | PASS: dedup, TTL, stale retention, sınır, kullanıcı/oturum/okul/rol/platform ayrımı, eski yanıt yarışı |
| `test-school-cache-lifecycle.ts` | PASS: gerçek AuthSessionManager yolları ve preference setter'ları cache kayıtlarını fiziksel temizler |
| `test-school-read-api.mjs web/ios/android` | PASS: üç runtime fixture'ında gerçek istemci kodu, CRUD/talep/randevu invalidate, 403 eviction; normal öğretmen mobil okumaları cache edilmez; fetch mock |
| `test-admin-navigation-performance.mjs before/after` | PASS: yukarıdaki 18+18 yerel ölçüm; 2 sn yapay gecikme |
| `test-admin-cache-behaviour.mjs` | PASS: gerçek yerel SQL/API, yavaş stale yenileme, 503'te satır koruma, öğrenci/veli düzenleme, öğretmen ekleme/silme, hızlı sekmeler, 403'te veri kaldırma, çıkış/yeniden giriş, destek sekmesine dönüşte cache |
| `test-staff-preview-ui.mjs` | PASS: beş rol × iki tema × dört genişlik = 40 görünüm; normal admin audit yok, platform ikinci faktörü, oturum/tema ve web sinematik korunur |
| `test-loading-theme.mjs` | PASS: gerçek CSS, koyu yüzey beyaz değil; açık/koyu ve reduced-motion `animation:none` |
| Mevcut Node 24.17.0 `run-ios-regressions.mjs` | **24/24 PASS**: auth/OTP, tenant, randevu/QR, push, hesap silme, release güvenliği |
| `test-support-conversations.ts` | PASS: 90 mevcut yetki/tenant/idempotency/lifecycle kontrolü; dış e-posta mock |
| iOS/Android review sync | PASS; native binary değil, 56 dosyalık web paketleri |
| iOS web-package parity | PASS; kaynak fingerprint + exact dosya eşleşmesi + paket gizli bilgi kontrolü |
| Gerçek sync paketlerinin `test-store-review-login.mjs ios/android` kontrolü | PASS: metinler, kayıtlı/kayıtsız giriş, fotoğraf/tema ve native'de sinematik olmaması; Chromium/native bridge fixture |
| Source provenance / frozen-source / negatif mutasyon | PASS: **494/494**; exact-hash overlay, temiz index export ve gerçek metin/binary mutasyon reddi |

Komutların logları `audit/master/navigation-*` altında. Playwright, `PLAYWRIGHT_MODULE` ile mevcut yerel runtime'dan kullanıldı. Yeni `test-*` dosyaları `node` veya `node --import tsx` ile çalışır. Önizleme `http://127.0.0.1:3035/login`; benchmark da `PREVIEW_URL` ile yalnız sentetik yerel ortamda kullanılabilir. Performans testi cache tazelik penceresi içindeki dönüşleri ölçer; her koşulda sıfır ağ vaadi yoktur.

İlk bağımsız dev-sunucu denemeleri soğuk Vite açılışında tamamlanmadı; nihai test, sentetik olduğu doğrulanan mevcut loopback laboratuvarında çalıştı. Bir denemede gerçek rate-limit devreye girdi; limit/OTP doğrulaması gevşetilmeden pencere yenilendi ve test tekrarlandı. Bunlar uygulamadan kaynaklanan başarılı sonuçlar gibi gizlenmedi. Gerçek hesap/veri, canlı Oracle veya mesaj sağlayıcısı kullanılmadı; değiştirilen test kayıtları yalnız geçici yerel fixture verileridir.

## Değişen dosyalar

- `src/platform/school-read-cache.ts` (yeni): scoped cache ve stale yarış koruması.
- `src/platform/auth-session.ts`, `client-preferences.ts`: cache yaşam döngüsü; mevcut auth protokolü değişmez.
- `src/services/api.ts`: izinli GET birleştirme/tazelik, snapshot, mutation/permission invalidation.
- `src/context/AppContext.tsx`: personel arka plan yenilemesi ve erişim reddinde veri temizleme.
- `src/App.tsx`: bağlam anahtarı ve sınırlı kod ön hazırlığı; giriş/sinematik akışları değişmedi.
- `src/components/AdminView.tsx`, `StudentManagement.tsx`, `StaffManagement.tsx`, `SchoolInfo.tsx`, `SchoolAdminManagement.tsx`, `OperationsCenter.tsx`, `SchoolRequestCenter.tsx`: anında shell/cached veri ve yükleme davranışı.
- `src/index.css`: tema tokenlı skeleton ve küçük yükleme geri bildirimi.
- Yeni testler: `test-admin-navigation-performance.mjs`, `test-admin-cache-behaviour.mjs`, `test-school-read-cache.ts`, `test-school-read-api.mjs`, `test-school-cache-lifecycle.ts`, `test-loading-theme.mjs`.
- `scripts/test-staff-preview-ui.mjs`: opsiyonel yerel önizleme adresi.
- Bu rapor, `audit/staff-otp-overlay.json`, `audit/ios-source-lock.json`: izlenebilirlik; kaynak kontrolü kapatılmadı.

Backend endpoint, SQL, RLS, migration, bağımlılık, Codemagic veya native konfigürasyon bu performans görevi kapsamında değiştirilmedi. Önceki aşamadaki staged backend/tema/OTP çalışmaları aynen korunur.

## Sınırlar ve kalan işler

- **BLOCKED / NOT TESTED:** gerçek iPhone/iPad/Android/WebView, Xcode/Gradle release derlemesi, düşük güç cihazında bellek/pil, canlı production/Netlify/Supabase query profili. Bu ortamların performansı tarayıcı fixture'ından çıkarılmadı.
- 30 saniyelik cache tazelik penceresinde başka cihazdan yapılan değişiklik hemen görünmeyebilir; süre dolunca sekme tekrar açılışında yeniden okunur. Harici yetki iptalini anlık öğrenme iddiası yoktur; sunucudan 401/403 alındığında kayıtlar kaldırılır. Kendi CRUD işlemleri beklemeden invalidation yapar.
- Platformun global okul/lisans yönetimi ve güvenlik açısından taze kalması gereken audit/konuşma/QR akışlarına genel cache uygulanmadı. Bu rapor okul yönetim sekmelerindeki ölçülmüş kazanımları kapsar.
- Production backend'e özgü 2–3 saniye gecikmenin ayrıca log/profil ile doğrulanması ileride gerekir. Yerel ~8–11 ms ölçümü production veritabanı hızı olarak sunulmaz; indeks önerisi için tek başına yeterli değildir.

Tüm değişiklikler yereldir. Önceki HEAD korunur; kullanıcı onayı olmadan commit/push/yayın yapılmaz.

Nihai Git durumu: önceki geliştirmeler dahil **96 staged dosya**; commit yok. HEAD `ecbedc4fac7d657fff147d647625736c7be29c05` olarak korunur. Kalan unstaged/untracked kaynak dosyası yoktur; loglar/build çıktıları ignore edilir.
