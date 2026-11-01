# Orijinal Yardım tasarımı kurtarma — 1 Kasım 2026

Çalışma yalnız `veli-staff-otp-master-20261031` klasöründe, `feature/staff-otp-master-20261031` dalında yapıldı. HEAD `ecbedc4fac7d657fff147d647625736c7be29c05` değişmedi. Başlangıçtaki 112 staged dosya korundu; ilk durum `audit/master/help-recovery-git-before.txt` dosyasına kaydedildi. Commit, push, deploy, canlı veri işlemi veya native build/sync yapılmadı.

## Neden kaybolmuştu?

Güncel çalışma ağacında `HelpCategoryArt.tsx`, `help-presentation.css`, kategori/rehber `data-help-theme` alanları, konu ikonları ve SVG render bağlantıları yoktu. Orijinal sunum ayrıca eksik `data-web-scene="school"` işaretine ve `web-scene.css` içindeki public-route kurallarına bağlıydı. Mevcut genel koyu tema kuralları da kategori yüzeylerini tek renge dönüştürüyordu.

## Orijinal kaynak ve karşılaştırma

Salt okunur kaynaklar `veli-randevu-production-review-base-20261029` ve `veli-randevu-web-welcome-20261029`; yayın referansı `6ae38881cfce2aeb67c77416`, kullanıcı tarafından sağlanan `veli-yardim-tasarim-kurtarma-6ae38881cfce2aeb67c77416` arşivi.

- İki kaynaktaki SVG yardımcı dosyası aynı; kurtarılan dosya byte düzeyinde eşit. SHA-256: `5ede1204f9df0e27752897984d4b94cef9c820bec3b2968612635f9a3ac03859`.
- Orijinal kategori/rehber CSS kuralları ve media query'ler değişmeden korundu. `web-scene.css` içinden yalnız yardım/iletişimle ilgili bölüm alındı; genel giriş/yönetim kuralları taşınmadı.
- Yeşil/mavi/altın/kırmızı gradyanlar, illüstrasyonlar, konu ikonları, gölge ve 4/2/1 sütun yerleşimi geri geldi.
- Arşivde sonradan eklenmiş `html[data-theme] .help-category[data-help-theme]` kuralı gradyanı düz yüzeyle değiştiriyor. Bu yüzden arşivin bütün CSS çıktısını körlemesine kopyalamak istenen renkleri yine bastırırdı. Kurtarma, orijinal kaynak renklerini esas alır.
- Yerelde açılan arşivle dört SVG'nin DOM çıktısı birebir aynı; 1440 px'de kartların x/y/genişlik/yükseklik ölçüleri 1 px toleransında eşleşti. Her iki sürümün 390/820/1440 px ekran görüntüleri alındı.
- **Tam sayfa piksel eşitliği iddia edilmiyor:** güncel tek ikonlu tema kontrolü, navigasyon ve OTP/hukuki taslak içerikleri korunmuştur. Koyu yüzey uyarlaması mevcut tema sistemi için sınırlı, kategori bazlı bir uyumluluk ekidir; eski kaynaktan alınmış koyu tema olarak sunulmaz.
- Uzak Netlify URL'si bu ortamın web erişiminde açılamadı. Görsel karşılaştırma verilen indirilen yayın arşivinde yapıldı; canlı production davranışı test edilmiş sayılmaz.

## Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `src/components/HelpCategoryArt.tsx` | Orijinal SVG ve konu ikon yardımcısı kurtarıldı. |
| `src/components/help-presentation.css` | Orijinal public-route/kategori/rehber stilleri, güncel koyu tema uyumluluğu. |
| `src/components/HelpCenterPage.tsx` | Kategori teması, SVG ve konu ikon bağlantıları. |
| `src/components/HelpGuidePage.tsx` | Gerçek kategoriye göre rehber teması ve orijinal SVG. |
| `src/components/PublicRequestPage.tsx` | Orijinal CONTACT destek teması geri bağlandı. |
| `src/components/WebWelcome.tsx` | Yalnız web modülüne yardım stil bağımlılığı eklendi; animasyon mantığı değişmedi. |
| `src/main.tsx` | WEB için orijinal `data-web-scene` işareti. |
| `src/index.css` | Orijinal davranış gereği native'de ek web süslerini gizleyen ortak kural. |
| `scripts/test-help-design-recovery.mjs` | Kaynak/arşiv eşitliği, responsive/kontrast/route/form testleri. |
| `scripts/refresh-staff-otp-overlay.mjs` | Yerel kaynak kapsamı açıklamasına yardım kurtarma eklendi. |
| `audit/staff-otp-overlay.json`, `audit/ios-source-lock.json` | İncelenen kaynakların bütünlük metadatası. |
| Bu rapor | Yerel teslim ve sınırlar. |

`PublicRequestSection.tsx`, `help-content.ts`, Navbar, ThemeSwitcher, telefon giriş paneli, tema başlangıcı, CORS, e-posta şablonları ve WhatsApp backend dahil 11 kritik dosyanın görev öncesi/sonrası byte hash'leri aynı. Form doğrulama/API/gönderim mantığı yeniden yazılmadı. Güncel öğretmen/güvenlik/veli ve otomatik aktivasyon açıklamaları ile hukuki taslak uyarıları korundu.

Stiller mevcut `WebWelcome` native alias sınırını kullanır; iOS/Android'e web sahnesi/video eklenmedi. Ortak JSX'deki dekorasyon native'de gizlidir. Native derleme/paket eşleşmesi bu görevde çalıştırılmadı.

## Çalıştırılan kontroller

| Kontrol | Sonuç / kapsam |
|---|---|
| `npm run lint` | **PASS**, TypeScript. |
| `npm run build` | **PASS**, yalnız web client + server; release artifact denetimi 62 client / 2 server dosyası. Mevcut statik/dinamik import uyarısı engelleyici değil. |
| `node scripts/test-help-center.mjs` | **PASS**, güncel içerik, gerçek destek route'u ve hukuki taslak korumaları. |
| `node scripts/test-help-design-recovery.mjs` | **PASS**, 90 görünüm: 5 route × 2 tema × 9 genişlik (320/375/390/430/768/820/1024/1180/1440); taşma yok, örneklenen kategori/rehber metin kontrastı ≥4.5. |
| Aynı test: bağlantı/form/orijinal eşitlik | **PASS**, 13 gerçek konu; rehber kategori teması, klavye focus/back; 6 mock form sonucu (CONTACT/YEARLY_LICENSE × başarılı/kısmi/servis hatası), eksik formun gönderilmemesi, yeni talep sıfırlaması; SVG/CSS ve masaüstü geometri karşılaştırması. |
| `test-platform-requests.ts` | **PASS**, 129 doğrulama/yetki/tenant/idempotency/e-posta/lisans kontrolü. Geçici yerel PGlite, dış ağ engelli ve sağlayıcı mock. |
| `test-support-conversations.ts` | **PASS**, 90 yetki/tenant/lifecycle/hesap silme kontrolü; aynı izolasyon. |
| `node scripts/test-compact-navbar.mjs after` | **PASS**, 270 sentetik rol/genişlik/tema/runtime-CSS görünümü; buton hedefleri, menüler, callback ve safe-area fixture. |
| `node scripts/test-theme-bootstrap.mjs` | **PASS**, 40 başlangıç/kalıcılık senaryosu; iOS varsayılan light korundu. |
| `node scripts/test-theme-ui.mjs` | **PASS**, 64 login/yardım/lisans tema/genişlik görünümü; tercih reload ve tema token kontrastı. |
| `node scripts/test-staff-preview-ui.mjs` | **PASS**, gerçek yerel API üzerinden 5 sentetik rol, 40 görünüm; OTP, ikinci e-posta faktörü, oturum/tema kalıcılığı, kayıtsız numara negatif akışı. |
| `node --no-wasm-code-gc --import tsx scripts/test-staff-otp-master.ts` | **PASS**, 9 entegre grup; WhatsApp/e-posta sağlayıcıları mock. |
| `node --import tsx scripts/test-whatsapp-login-ui.ts` | **PASS**, ortak giriş UI regresyonu. |
| `node --import tsx scripts/test-production-auth-guards.ts` | **PASS**, mevcut auth korumaları. |
| İzole `createExpressApp()` OPTIONS deneyi | **PASS**, açıkça yapılandırılmış web/Capacitor iOS/Android origin'leri için 200 + auth/school header'ları; yabancı origin 403. Veritabanı başlatılmadı. |
| `node scripts/test-ios-release-safety.mjs` | **PASS**, salt kaynak/config güvenlik denetimi; build veya bulut çağrısı değildir. |
| `git diff --check` | **PASS**, görev değişiklikleri. |

Önizleme sunucusunun CORS listesi kasıtlı olarak yalnız loopback web origin'i içerdiğinden ilk native-origin denemesi orada reddedildi. Uygulama CORS kodu değiştirilmedi; native OPTIONS deneyi ayrı izole sunucuda uygun açık listeyle yapıldı. İlk yeni form testinde iç içe alert rollerinden kaynaklanan test locator belirsizliği düzeltildi; testlerin tamamı sonra başarılı çalıştı. Testler atlanmadı.

Playwright mevcut yerel runtime'dan `PLAYWRIGHT_MODULE` ile kullanıldı; yeni bağımlılık eklenmedi. Kurtarma testi için `HELP_SOURCE_ROOT` ve `HELP_REFERENCE_ROOT` yukarıdaki salt okunur kaynak/arşiv klasörlerine ayarlanır. JSON/PNG çıktıları `audit/help-recovery/`, API test logları `audit/master/help-*.log` altında; Git'e eklenmez.

## Eksikler / sınırlar

- **NOT TESTED:** fiziksel iPhone/iPad/Android, gerçek WKWebView/WebView ve gerçek safe-area/klavye davranışı. Tarayıcı/runtime fixture ölçümleri cihaz testi değildir.
- **NOT TESTED:** canlı Netlify görsel doğrulaması, gerçek e-posta/WhatsApp teslimatı. Gerçek alıcılara mesaj gönderilmedi.
- **ÇALIŞTIRILMADI:** iOS/Android build/sync, IPA/APK/AAB, Codemagic, deploy, canlı Supabase. Bu görev kapsamında yasak olduğu için başlatılmadı.
- Yeni form API veya auth protokolü yok; orijinal referans klasörlerine yazılmadı. Mevcut mobil paketleri güncelleme bu teslimin parçası değildir.

## Önizleme ve onay

- Yardım: http://127.0.0.1:3035/yardim
- Veli rehberi: http://127.0.0.1:3035/yardim/veli
- Lisans: http://127.0.0.1:3035/lisans-iletisim
- İletişim: http://127.0.0.1:3035/lisans-iletisim?request=contact

Bu önizleme yalnız loopback'te, sentetik veriler ve mock sağlayıcılarla çalışır. Değişiklikler yerelde incelemeye hazırdır; commit/push/deploy ve mobil derleme için onay beklenir.

Son bütünlük kontrolü: **502/502 frozen source PASS**; LF/CRLF ve gerçek metin/binary mutasyon negatif testleri PASS. Arşivlenmiş production manifesti değiştirilmeden, incelenen yerel overlay ile provenance PASS. Önceki işler dahil **119 staged dosya** vardır; bu görevde yukarıda listelenen **13 dosya** güncellendi/eklendi. Stage işlemi kaynak kilidini gerçek Git index bloblarıyla eşleştirmek içindir; commit oluşturulmadı.
