# Kayıtsız telefon hatası — yerel düzeltme

31 Ekim 2026. Dal: `feature/staff-otp-master-20261031`. Mevcut staged çalışma korunmuştur. Commit, push, production/demo deploy, canlı veritabanı işlemi ve native release derlemesi yapılmamıştır.

## Uygulanan davranış

- Ortak `/api/auth/phone/request-code` akışında uygun kullanıcı/üyelik veya yetkili bekleyen kayıt bulunamazsa HTTP 400 ve yalnız `error: "Bu numara sisteme kayıtlı değil."` döner. Challenge/identity attempt bilgisi veya oturum dönmez; OTP oluşturulmaz ve WhatsApp çağrısı yapılmaz.
- Ortak React giriş ekranında bu metin telefon alanının hemen altında mevcut kırmızı `danger` bileşeniyle gösterilir. `aria-invalid` ve hata açıklaması input'a bağlanır. Kullanıcı telefon adımında kalır.
- Kayıtlı ve uygun numarada sağlayıcı isteği başarıyla kabul edildikten ve gerçek challenge/attempt oluşturulduktan sonra 6 haneli kod ekranı doğrudan açılır. “WhatsApp kodum var” ara adımı kaldırılmıştır. Sağlayıcının kabulü, telefonun mesajı fiziksel olarak aldığına dair teslimat kanıtı değildir.
- Sağlayıcı hatasında challenge iptal edilir, API 503 hata döndürür; başarı mesajı ve ilk girişte OTP ekranı gösterilmez. Yeniden gönderim hatasında mevcut kod adımındaki hata gösterilir, yeni başarılı gönderim iddia edilmez.
- Devre dışı/silinmiş/uygun olmayan hesap gönderime alınmaz. Ayrıntılı durum veya okul/rol listesi açıklanmaz. Belirsiz telefon kimlikleri genel 409 ile reddedilir. Telefonu olmayan eski/uygunsuz kayıtlar otomatik oluşturulmaz.
- Bekleme süresinde tekrar kod isteği 429 verir; kullanılabilir kod üretmeden başarı dönmez. Telefon/IP ve telefon-geneli limitler, E.164 normalizasyonu, HMAC, süre, tek kullanımlılık, deneme sınırı, tenant guard, ikinci faktörler ve auth_version korunmuştur.
- Kullanıcının açık kararı gereği kayıt varlığını gizleyen önceki ortak giriş davranışı kaldırılmıştır. 8,5 saniyelik eski yanıt maskeleme gecikmesi artık kullanılmaz. Eski ayrı unified endpoint'in mevcut maskeleme davranışı değiştirilmedi; güncel web/iOS/Android ortak ekranı phone-centric endpoint kullanır.
- Veli kayıt doğrulamasında da geçersiz hedef için sahte başarılı gönderim yerine genel hata verilir; yetkili roster kaydıyla gerçek yerel kayıt/aktivasyon testi geçer.

## Değişen dosyalar

- `server/whatsapp-auth.ts`: uygunluk, cooldown ve sağlayıcı sonuçlarını phone-centric çağırana gerçek hata olarak iletme; kullanılabilir challenge olmadan attempt üretmeme.
- `server/api.ts`: gerçek başarı/error yanıtı; belirsiz kimlikte genel hata.
- `src/components/PhoneCentricLoginPanel.tsx`: doğrudan OTP adımı ve telefon altındaki erişilebilir kırmızı hata.
- `scripts/test-staff-otp-master.ts`, `test-identity-auth-attempts.ts`: gerçek yerel API/SQL testleri ve negatif sınır testleri.
- `scripts/test-phone-centric-web-ui.mjs`, `test-whatsapp-login-ui.ts`, `test-staff-preview-ui.mjs`, `test-ios-auth-ui.mjs`, `test-android-login-polish.mjs`, `test-store-review-login.mjs`: yeni davranışın UI/regresyon assertion'ları. Testler atlanmadı.
- Bu rapor, önceki master raporundaki tarihsel davranış notu ve exact-hash kaynak overlay/kilidi güncellendi.

## Testler

| Kontrol | Sonuç |
|---|---|
| Kayıtsız numara, exact metin, OTP/challenge yok, sağlayıcı yok | PASS — gerçek Express + izole embedded PostgreSQL, mock dış sağlayıcı |
| Kayıtsız telefonda tekrar ve farklı numaralarla IP taraması | PASS — mevcut limitler 429 ile durdurur; limit gevşetilmedi |
| Devre dışı/silinmiş hesap | PASS — gönderim yok, challenge ID yok |
| Kayıtlı öğretmen/güvenlik/veli/okul yöneticisi/platform | PASS — yerel API + mock sağlayıcı; platform bağımsız ikinci faktörü korunur |
| Hatalı telefon biçimi | PASS — frontend ve API doğrulama hatası, OTP yok |
| WhatsApp 503 | PASS — challenge iptal, false success yok |
| Telefon altındaki kırmızı hata ve iki tema | PASS — gerçek yerel API ile Chromium; konum ve hesaplanan renk kontrolü |
| Beş rol × iki tema × dört genişlik | PASS — 40 yerel görünüm, oturum/tema kalıcılığı, çıkış |
| iOS/Android sync paketlerinde kayıtlı ve kayıtsız giriş | PASS — paketler gerçekten okunarak Chromium/Capacitor bridge benzetimi; cihaz değildir |
| iOS klavye/foreground/resend ve Android giriş tasarımı | PASS — sentetik UI/viewport testleri |
| Frontend ve genişletilmiş backend TypeScript | PASS |
| Production web/server build ve release paket taraması | PASS — deploy yok |
| iOS/Android review sync ve iOS exact web package parity | PASS — 56 native web dosyası; APK/AAB/IPA yok |
| Identity attempt güvenlik paketi | PASS — yarış, HMAC, sürüm iptali, replay ve faktör sırası |

Komutlar: `npm run lint`; önceki master raporundaki genişletilmiş backend `tsc` komutu; `npm run build`; `npm run ios:sync:review`; `node scripts/verify-ios-web-package.mjs`; `npm run android:sync:review`; `node --no-wasm-code-gc --import tsx scripts/test-staff-otp-master.ts`; aynı runtime ile `test-identity-auth-attempts.ts`; `node scripts/test-phone-centric-web-ui.mjs`; `node --import tsx scripts/test-whatsapp-login-ui.ts`; Playwright ile ilgili UI testleri ve mevcut Node 24.17.0 regresyon runner'ı.

Çıktılar: `audit/master/phone-fix-*.log`; regresyon ayrıntıları `audit/test-results.json`. İlk tarayıcı denemesindeki load timeout, açık uygulama öğelerinin hazır olmasını bekleyen DOM kontrolüyle yeniden sınandı. Rate-limit testi mevcut sınırın altıncı isteği zaten reddettiğini doğruladı; ürün limiti değiştirilmedi.

## Sınırlar ve teslim

Gerçek WhatsApp/e-posta/push gönderilmedi. Gerçek iPhone/Android/WKWebView/Keychain ve native release derlemesi NOT TESTED. Hosted Supabase veya Oracle demo verisi kullanılmadı/değiştirilmedi. Kaynak bütünlüğü kapatılmadı; yeni exact hash'ler ve temiz index export kontrolüyle güncellendi.

Yerel önizleme: **http://127.0.0.1:3035/login**. Önceki rapordaki sentetik telefonlar geçerlidir; artık kod isteği sonrası doğrudan OTP alanı açılır. İstek için üretilen mock kod yalnız loopback `/__local_preview__/state` sayfasından alınır. Normal kullanıcı güvenliği için genel OTP bypass eklenmedi.

Nihai regresyon sonucu: **24/24 PASS**. Güncel frozen-source kontrolü: **486/486 PASS**; LF/CRLF ve gerçek içerik/binary mutasyon testleri PASS. Temiz Git index export denetimi de geçmiştir.

Mevcut önceki geliştirmeler dahil 82 staged dosya bulunur; yeni commit oluşturulmadı. HEAD hâlâ `ecbedc4fac7d657fff147d647625736c7be29c05` değerindedir. Değişiklikler yalnız yereldedir; kullanıcı onayı beklenir.


## Son giriş metni kontrolü

Ortak bileşendeki eski uygun-numara açıklaması kaldırıldı. Yerine birebir **“Doğrulama kodunuz WhatsApp üzerinden gönderilecektir.”** yazıldı. Kayıtsız numarada **“Bu numara sisteme kayıtlı değil.”** telefon alanının altında kırmızı kalır; OTP ekranı açılmaz.

Üç koşul da webde gerçek yerel API ile; iOS ve Android'de gerçekten sync edilmiş paketleri çalıştıran Chromium/native bridge fixture ile PASS. Metin görünürlüğü/yokluğu, hatanın telefon altındaki konumu ve hesaplanan kırmızı rengi assertion ile doğrulandı. Paket taramasında eski metin bulunmadı, yeni metin iki pakette de bulundu. TypeScript, bileşen testi, production web build/release taraması, iki platform sync ve iOS parity PASS. Çıktılar `audit/master/login-copy-*.log` altında. Gerçek cihaz/native release testi yapılmadı; backend/OTP güvenliği değiştirilmedi. Commit/push/deploy/canlı işlem yapılmadı.
