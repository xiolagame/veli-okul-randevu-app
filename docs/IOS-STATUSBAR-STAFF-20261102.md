# iOS durum çubuğu ve güvenlik personeli listesi — 2 Kasım 2026

Çalışma: `C:\Users\XIO\Documents\Codex\veli-staff-otp-master-20261031`, dal `feature/staff-otp-master-20261031`. Başlangıç/son HEAD: `0e305dfb392936bbd510a4c591ec86fe1846344d`. Başlangıçta yalnız `server/api.ts`, `src/index.css`, `src/platform/theme.ts` üzerinde kullanıcının unstaged değişiklikleri vardı. Önce diff incelendi; durum `audit/master/ios-status-staff-before.txt` dosyasına kaydedildi. Bu düzeltmeler geri alınmadı.

## Kök nedenler ve düzeltme

**Personel:** `getSecurityUsers(schoolId)` SQL'i okul üyeliğine sahip kullanıcıları ve o okulun `pending_staff` kayıtlarını zaten birleştiriyor. API bunların üzerine aynı bekleyenleri yeniden ekliyordu. Kullanıcının ikinci eklemeyi kaldıran düzeltmesi doğru; aynen korundu. Frontend'de kayıt gizleyen bir dedup yaması yapılmadı, repository/tenant sorgusu değiştirilmedi.

**iOS:** paylaşılan native yapılandırmada overlay kapalıyken WebView'in dışındaki status bar yüzeyi CSS fotoğrafını gösteremez. Kullanıcının iOS runtime `overlay:true` yaklaşımı korundu. Önceki ikon seçimi yalnız uygulama temasına bakıyordu; açık temadaki koyulaştırılmış giriş fotoğrafı için bu yanlıştı. Ayrıca root safe-area boşluğu üst menünün arka planından ayrı görünüyordu.

`initializeIosThemeChrome()` artık iOS'ta merkezi olarak:

- Overlay'i etkinleştirir; overlay altında etkisiz/yanlış bir düz renk bandı üretmek için `setBackgroundColor` çağırmaz.
- Mevcut ekranın üst yüzeyini, giriş fotoğrafının mevcut iki koyu katmanını, üst menüyü/inceleme bandını ve portal modal katmanlarını dikkate alarak açık/koyu ikon seçer. Capacitor `Style.Dark` açık ikon, `Style.Light` koyu ikon demektir; kurulu plugin'in Swift/TypeScript kaynakları incelendi.
- DOM/tema/sayfa/viewport değişikliklerinde yeniden değerlendirir; native ön plana dönüşte ve `pageshow` olayında overlay'i yeniden uygular. Seri Promise kuyruğu ve tek animation-frame planlaması hızlı tema değişimlerinde eski seçimin kazanmasını önler. Değişmeyen stil için tekrar native çağrı yapılmaz; hata auth akışına taşınmaz. Listener/observer temizliği vardır.

CSS, yeni bir fotoğraf atamaz. Üst menünün veya mevcut demo inceleme bandının **kendi arka planı**, pseudo-element ile üst safe-area içine devam eder. Panel içeriği mevcut tek root inset'inin altında kalır. Girişte root inset kaldırılır, form kendi safe-area'sını uygular; tablet üst boşluğu da korunur. `:has()` desteklemeyen eski iOS CSS motorları için girişte inset'i yalnız bir kez dengeleyen fallback eklendi; eski Safari cihazı test edildiği iddia edilmez.

Tam ekran kayıt/işlem pencerelerinde safe-area'nın hem dışta hem başlıkta iki kez uygulanması önlendi. Test ayrıca eski kapatma düğmesinin `margin-top:-6px` nedeniyle 59 px çentik sınırında y=53 px'e çıktığını gösterdi; yalnız iOS tam ekran pencerelerde bu negatif marj kaldırıldı. İşlem penceresi için yan ve alt güvenli alanlar korundu.

**Paylaşılan `capacitor.config.ts` değiştirilmedi:** `overlaysWebView:false`, Bundle ID ve Android ayarları korunur. Runtime override yalnız `IOS` dalında çalışır. Android'in kendi sistem çubuğu yönetimi, tema seçimi/kalıcılığı, varsayılan iOS light teması, web sinematik geçişi ve OTP bileşeni değiştirilmedi. Cold launch/splash→WebView geçişinin gerçek görünümü fiziksel iPhone testi bekler.

## Rol bazında yerel iOS kapsamı

| Rol/ekran | Yerel sonuç | Fiziksel cihaz |
|---|---|---|
| Giriş / WhatsApp OTP | Fotoğraf viewport üstüne devam ediyor; mobil fotoğrafta her iki temada açık ikon komutu; form tek inset altında | BLOCKED / çalıştırılmadı |
| Veli | Mevcut üst menü yüzeyi uzuyor; tema ile okunabilir ikon seçimi; QR/dialog ve profil yerleşimleri | BLOCKED |
| Öğretmen | Aynı merkezi yüzey/safe-area yönetimi; randevu, müsaitlik ve profil yerleşimleri | BLOCKED |
| Güvenlik / QR | Aynı üst menü yönetimi; kamera izin reddi ve QR görünümü regresyonu | BLOCKED |
| Okul yöneticisi | Gerçek ortak Navbar'ın admin rolü; güvenlik listesi aktif/bekleyen görünümü | BLOCKED |
| Platform yöneticisi | Gerçek Navbar'ın platform rolü ve mevcut platform yönetim ekranı | BLOCKED |
| Modallar / tam ekran kayıt ve işlem pencereleri | Üst/yan/alt inset, kapatma hedefi, modal yüzeyi ve ikon değişimi | BLOCKED |
| Mağaza inceleme bandı / farklı renkli tam ekran yüzey | Kendi yüzeyini izliyor; tema rengini zorlamıyor | BLOCKED |

240 ölçüm, 5 rol × 2 tema × 8 genişlik × 3 üst inset'ten oluşur. Genişlikler 375/390/430/768/820/1024/1180/844 px; inset'ler 20/47/59 px; 844 px senaryosu 390 px yükseklik ve 44 px yan kesik fixture'ı içerir. Çentik/Dynamic Island gerçek donanımı simüle edilmiş değildir; CSS inset değerleri sentetiktir.

## PASS

| Çalıştırılan komut/kontrol | Sonuç |
|---|---|
| `npm run lint` | TypeScript PASS. |
| `npm run build` | Web client + server production build PASS; release artifact güvenliği 62 client / 2 server dosyası. Native derleme değildir. |
| `node --no-wasm-code-gc --import tsx scripts/test-staff-otp-master.ts` | 9 entegre grup PASS; yerel geçici PGlite, mock WhatsApp/e-posta. Aktif, eski bekleyen ve `pending_staff` kaydı birer kez; OTP aktivasyonu sonrasında bekleyen satır yerini tek aktif kayda bırakır. Yabancı okul ve veli 403; diğer okulun aktif/bekleyenleri sızmaz. |
| `node scripts/test-ios-statusbar-surfaces.mjs` | 240 rol/tema/inset görünümü; 8 login+OTP; 6 modal; fallback CSS, inceleme bandı, farklı yüzey renkleri, hızlı tema/route, resume, native hata sonrası tekrar, cleanup ve iOS dışında native çağrı olmaması PASS. Gerçek API testinin yalnız sentetik kullanıcı listesi Web/iOS ortak `StaffManagement` bileşeninde birer kez render edildi. |
| `node scripts/test-ios-auth-ui.mjs` | Gerçekten çalıştırıldı: loading/hata/kapalı servis, parola akışına dönüş engeli, OTP hata/resend/askıya alınmış saat, ikinci e-posta faktörü, session hatası ve sentetik 300 px klavye görünümü PASS. |
| `node scripts/test-mobile-auth-layout.mjs` | Gerçekten çalıştırıldı: 320–430 px altı boyut, fotoğraf, CTA'ya erişim, hedef boyutu, telefon/OTP ve daraltılmış viewport PASS. |
| `node scripts/test-ios-role-layouts.mjs` | Gerçekten çalıştırıldı: 20 sahnede 160 ölçüm, taşma/uncaught error yok; QR, kamera izin reddi, hesap silme hata durumu, menüler, randevu takvimi/saat seçimi PASS. |
| `node scripts/test-compact-navbar.mjs after` | Web/iOS/Android runtime CSS fixture'larında 270 görünüm PASS. |
| `node scripts/test-theme-bootstrap.mjs` | 40 tema başlangıç/manuel tercih/kalıcılık senaryosu PASS; Android/web başlangıcı korunur. |
| `node --import tsx scripts/test-ios-shell.ts` | Native proje/ikon/izin/privacy/secure storage kaynak denetimi PASS; Xcode build değildir. |
| `node scripts/test-ios-release-safety.mjs` | Workflow/release log/OTP focus kaynak denetimi PASS; bulut çağrısı yok. |
| `node --import tsx scripts/test-production-auth-guards.ts` | PASS. |
| `node --import tsx scripts/test-whatsapp-login-ui.ts` | PASS. |
| `git diff --check` | PASS. |

Playwright yeni kurulmadı; mevcut yerel `C:\Users\XIO\AppData\Local\Temp\veli-playwright-tests\node_modules\playwright\index.mjs` modülü `PLAYWRIGHT_MODULE` ile kullanıldı. Bağımlılık/lockfile güncellemesi yok. Yeni status bar testi için önce staff OTP testi çalıştırılır; o test yalnız sentetik listeyi `audit/master/security-roster-response.json` dosyasına yazar. Token/parola bu dosyaya yazılmaz.

Mobil auth testi eski sabit `3002` adresi yerine varsayılan olarak built web istemcisini geçici loopback sunucusunda açar; API'ler mock, dış origin'ler engelli. Dev-server `networkidle` zaman aşımı böyle giderildi. Onaylı kısa ekran tasarımında dikey kaydırma olabileceği için eski “hiç kaydırma olmasın” beklentisi, kaydırmayla erişim + 44 px hedef + taşma olmaması kontrolüne dönüştürüldü. Uygulama tasarımı bu beklentiye uysun diye küçültülmedi.

Çıktılar `audit/master/status-*.log`, `audit/statusbar/results.json`, `audit/statusbar/*.png`, `audit/phase3a/` ve `previews/` altında; Git'e eklenmez. Status bar köprüsü mock'tur, ekran görüntülerinde gerçek iOS saat/Wi-Fi/pil simgeleri bulunmaz.

## FAIL / test önkoşulu

`node --import tsx scripts/test-android-shell.ts` **başarısız çalıştı**: `Android client must exclude legacy template asset: adaptive-icon.png`. Bu komut `dist/client` altında Android'e özel budanmış bir paket ve eşleşen generated Android assets bekler. Bu görevde `dist/client` web production build çıktısıdır; dolayısıyla paket kontrolünün önkoşulu karşılanmadı. Test kapatılmadı/gevşetilmedi ve Android native paketine PASS verilmedi. Android uygulamasının kaynak UI regresyonları ayrı olarak yukarıda PASS'tir.

İlk yeni fixture denemelerindeki runtime mock çözümleme ve modal hedef hataları düzeltildikten sonra ilgili testler yeniden başarılı çalıştırıldı. Güvenlik assertion'ları atlanmadı.

## BLOCKED / NOT TESTED

- Gerçek iPhone/WKWebView durum çubuğu, Dynamic Island, native overlay geometrisi, fotoğrafın gerçek OS simgeleriyle kontrastı, splash geçişi ve fiziksel klavye/arka plan davranışı.
- Gerçek iPad ve Android cihaz/WebView; gerçek push, WhatsApp veya e-posta teslimatı.
- Xcode archive/IPA, Android APK/AAB ve Codemagic/TestFlight. Çalıştırılmadı.
- Güncel native web paket eşleşmesi: bu görevde iOS/Android sync yapılmadı. Tam Android paket kontrolü doğru native build/sync sonrasında tekrar gerekir.
- Tüm uygulamanın her sayfa/iş akışı cihaz üzerinde denenmiş değildir; merkezi mekanizma ve belirtilen ekran/fixture kapsamı doğrulandı. Tam 24'lü eski regresyon paketi bu dar görevde yeniden çalıştırılmadı; ilgili auth/personel/rol/QR/UI testleri çalıştırıldı.

## Değişen dosyalar ve Git

- `server/api.ts`: kullanıcının çift eklemeyi kaldıran mevcut düzeltmesi aynen korundu.
- `src/index.css`: kullanıcının login photo extension yaklaşımı korundu ve tüm iOS üst yüzeyleri/tam ekran sheet safe-area'sı için tamamlandı.
- `src/platform/theme.ts`: kullanıcının iOS overlay çağrısı korundu; merkezi yüzey/ikon ve lifecycle yönetimi.
- `scripts/test-staff-otp-master.ts`: aktif/bekleyen/aktivasyon/tenant tekil kayıt assertion'ları ve sentetik UI fixture çıktısı.
- `scripts/test-mobile-auth-layout.mjs`: yerel statik harness, güvenli origin sınırı, kısa ekran erişilebilirliği ve kaynak temizliği.
- `scripts/test-ios-statusbar-surfaces.mjs`: yeni sentetik native bridge + rendered CSS regresyonları.
- Bu rapor, `audit/staff-otp-overlay.json`, `audit/ios-source-lock.json`: izlenebilirlik/bütünlük.

Native klasörleri, `capacitor.config.ts`, Android sistem çubuğu yönetimi, normal WhatsApp endpoint'leri, CORS, lisans/tenant kuralları, AuthView/telefon paneli, web sinematik geçişi, iOS varsayılan light ayarı ve tema tercih anahtarı değişmedi. Yeni migration, plugin veya bağımlılık yok.

Kaynak kilidi normal Git index'ini değiştirmeden geçici index üzerinden güncellendi; temiz index export ve negatif mutasyon testleri geçti. Commit/push/merge yapılmaz. Production, Supabase, Oracle ve canlı kullanıcı/mesaj sistemlerine işlem yapılmaz.

## TestFlight kararı

**Yerel kaynak hazırlığı tamam; doğrudan TestFlight yayını için GO verilmez.** Önce kullanıcı onayıyla doğru review build environment'ı altında iOS web paketini yeniden üretip sync etmek, gerçek Xcode/Codemagic derlemesini almak ve fiziksel iPhone'da şu kabul testlerini yapmak gerekir: soğuk açılış/splash, login→OTP→rol paneli→modal geçişleri, açık/koyu tema, 20/47/59 px sınıflarındaki cihazlar, yatay konum, klavye ve arka plan/ön plan. Gerçek cihazda fotoğraf/ikon kontrastı ayrıca gözle kontrol edilmelidir.

Bu görev hiçbir bulut build, upload veya yayın başlatmaz. Değişiklikler yerelde onay bekler.

Son bütünlük sonucu: **504/504 PASS**; temiz index export PASS; status bar kaynağına kontrollü mutasyon denemesi beklenen şekilde reddedildi. LF/CRLF ve binary negatif testleri PASS. Normal Git index hash'i değişmedi, staged dosya yok. Arşiv production manifesti korunarak yerel overlay provenance kontrolü PASS. Toplam 9 yerel dosya değişikliği/yeni dosya vardır; commit oluşturulmadı.
