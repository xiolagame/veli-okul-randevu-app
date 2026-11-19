# Doğrulanmış production tabanı ve Google Play inceleme erişimi

29 Ekim 2026. **Kaynak doğrulaması PASS. İzole yerel, salt okunur review erişimi testleri PASS. Production için NO-GO.** Production demo kimliği veya kalıcı inceleme sırrı oluşturulmadı.

## 1. Güncel deploy ve kaynak kapısı

Görev başlangıcında published deploy 6ae32197a83a6b6d246716d0 idi. İstenen kök klasörde bu sürümün kaynak karşılığı, yalnız license-reminder-api.ts eski response biçimiyle oluşturuldu. Temiz npm ci, TypeScript, web/server build ve iki paketlemede dört ZIP'in SHA-256'sı birebir eşleşti. Bu önceki adli araştırma tekrarlanmadı.

Çalışma sırasında başka bir yayınla published deploy **6ae342e13fc1e501a18f7b31** oldu. Yayın: 2026-10-29T12:58:20.396Z / Türkiye 15:58:20. Başlık: Premium Dashboard and WhatsApp License Reminder UX Final Release. Bu görev yayın yapmadı. Eski kanıt yeni deploy'a taşınmadı; geliştirme duraklatıldı ve yeni published sürüm için ayrı kaynak kapısı çalıştırıldı.

Son yetkili Netlify GET /sites/{siteId}, /deploys/{id}, /deploys/{id}/functions zinciri ve final-production.json güncel ID'yi doğruluyor. Yeni deploy'un dört Function digest'i mevcut hotfix paketleriyle aynıydı. Ardından temiz bağımlılık kurulumuyla alınan **yeni kaynak snapshot'ı yeniden derlenip paketlendi**; iki kaydedilmiş paketlemenin her birinde dört ZIP tam SHA-256 eşitliği elde edildi. Yalnız metadata benzerliği veya frontend hash'i kullanılmadı.

**Aktif doğrulanmış snapshot:**
C:/Users/XIO/Documents/Codex/veli-randevu-production-review-base-20261029/snapshots/6ae342e13fc1e501a18f7b31

İstenen ana klasör C:/Users/XIO/Documents/Codex/veli-randevu-production-review-base-20261029 bir snapshot kabıdır. Kökündeki kaynak, ilk 6ae32197 sürümünün tarihsel baseline'ıdır; GÜNCEL PRODUCTION KAYNAĞI GİBİ KULLANILMAMALIDIR. CURRENT-SNAPSHOT.json güncel alt klasöre işaret eder. İlk baseline sessizce değiştirilmedi.

| Function | Production ve yeniden üretilen SHA-256 | İki paketleme |
|---|---|---|
| api | 54f4898293383ad097c710517fe9ccc7d8eca9f651c74bde45af50ae33a65701 | PASS / PASS |
| appointment-reminders | 333c73069faed36e5972d4f8873295400f36dbb1eac22e117eb4eee460e4ebfa | PASS / PASS |
| license-reminders-background | 78c370459d760c7abaff3e4ec125f0629673088536ce7431d8e9c180789155ae | PASS / PASS |
| license-reminders | d97d0ac0fcbddeb7d2f5bd007f842bf4449c55a84186293633f1353ed9ae079d | PASS / PASS |

Araçlar: Node v24.22.1, Netlify CLI 27.14.2, @netlify/zip-it-and-ship-it 16.5.1, gerçek/junction olmayan node_modules ve değişmeyen lockfile. Node 24.x Functions metadata'sı, V2 stream/background modları ve schedule'lar korunuyor.

Kaynak kökeni ve bütünlük: aktif snapshot audit/source-origin.json. Her dosyanın kökeni/SHA-256'sı kayıtlıdır. audit/source-gate.json üretim digest'i, bağımsız tekrar paketleme digest'i ve PASS sonucunu içerir. audit/typescript.log, build.log, functions.log ve functions-reproduction.log yeniden üretim zincirini gösterir. Snapshot kaynak dosyaları son kontrolde değişmemiştir.

consentStatus yeni deploy'da artık production özelliğidir; aktif snapshot ve review geliştirme tabanında korunmuştur. Eski baseline'ın bu alanı içermemesi yalnız tarihsel doğrulama içindir. Ana hotfix klasöründeki geliştirmeler silinmedi.

## 2. İzole geliştirme klasörü ve değişen dosyalar

C:\Users\XIO\Documents\Codex\veli-randevu-play-review-auth-20261029

Geliştirme önce doğrulanan ilk snapshot'ta yapıldı; production değişince yeni snapshot'ın kaynaklarına taşındı ve testler tekrarlandı. Android kaynaklarına dokunulmadı. Yeni paket/bağımlılık eklenmedi, package.json ve lockfile güncel baseline ile aynı.

Mevcut dosyalarda yalnız:

- server/app.ts: JSON parser sonrasında, production veritabanı initialization/routing öncesinde review gateway. Varsayılan normal çalışma yolu korunur; integration testi için middleware enjeksiyon noktası.
- scripts/build-function-package.mjs: yerel server/data, audit, .cache ve scripts klasörlerini NFT paketinden dışlama.
- scripts/test-function-package.mjs: arşivde bu klasörlerin bulunmasını reddeden kontrol.
- netlify.toml: aynı dışlamaların gerçek Netlify paketleme ayarına işlenmesi. Redirect/CORS/runtime/OTP ayarları değiştirilmedi.

Eklenen kaynak/test dosyaları:

- server/review-auth.ts: ayrı review config, bağımsız DB adapter'i, challenge/oturum/limit/audit ve salt okunur veri yüzeyi.
- scripts/review-test-fixture.ts: bellekte sentetik PGlite, veli/öğretmen/güvenlik/okul admin'i. Sırlar her test çalıştırmasında geçici üretilir; yazdırılmaz.
- scripts/test-review-auth.ts: 19 güvenlik senaryosu.
- scripts/test-review-integration.ts: gerçek Express uygulaması, iki route prefix'i, production veri deposuna geçişi yakalayan sentinel.
- scripts/test-review-aab.ts: mevcut AAB'den çıkarılan gerçek HTML/JS/CSS ile tarayıcı testi.

Tam değişiklik manifesti audit/change-manifest.json. server/auth.ts, whatsapp-auth.ts, identity-auth-attempts.ts, normal repositories, provider istemcileri, normal OTP endpoint'leri ve Android kodu değiştirilmedi. Geliştirme klasöründeki audit/.cache/release/dist test ve kanıt çıktılarıdır; istemci/Function'a dahil edilmez.

## 3. Seçilen güvenlik mimarisi

Review trafiği normal production router'ına hiç geçmez. Sadece sunucuda tanımlı kanonik telefon + review userId + schoolId + rol eşlemesi kabul edilir. Kimlikler review- namespace'ine bağlıdır; platform admin kimliği reddedilir. Normal kullanıcı kimlikleri review DB'ye veya review imza anahtarına bağımlı değildir; normal OTP yoluna devam eder.

Ayrı REVIEW_DATABASE_URL, ayrı CA ile doğrulanmış TLS ve bağımsız review tabloları gerekir. Aynı production host/database hedefi reddedilir; production credential veya DB fallback kullanılmaz. Review DB'de synthetic-only ortam işareti/aktiflik ve hesap synthetic bayrağı zorunlu. Gateway production repository/provider modüllerini import etmez.

Tekrar kullanılabilir altı haneli kimlik bilgisi yalnız sunucudaki salt + scrypt hash ile doğrulanır. Ayrı review JWT anahtarı normal JWT_SECRET/AUTH_CODE_SECRET ile aynı olamaz. Normal secret değerleri değiştirilmedi. Runtime yapılandırma ve tablolara ait isimler kodda vardır; herhangi bir gerçek sır değeri veya kalıcı inceleme kodu yoktur.

- Challenge: rastgele UUID attemptId/challengeId; 5 dakika; hesap, hesap sürümü ve epoch bağı; DB transaction/row lock; atomik tek tüketim; en fazla 5 challenge hatası.
- Hız sınırı: IP ve IP'den bağımsız hesap bazında kalıcı sayaç; request/verify yollarında IP başına 30, hesap başına 20 istek/15 dakika. Hesapta 5 hatalı doğrulama sonrası 15 dakika kilit. Yeniden kod isteme beklemesi 60 saniye. IP değiştirme hesabın sınırını kaldırmaz.
- Oturum: ayrı issuer/audience, ayrı HMAC anahtarı, 15 dakika; DB session kaydı ve her istekte registry, hesap aktifliği/sürümü, tenant/rol, epoch ve revocation kontrolü.
- Audit: hesap ID'si/olay/başarı-zaman/IP hash'i. Kod, token, telefon, ham IP veya DB exception içeriği serialize edilmez. Başarılı/başarısız giriş ve erişim olayları kaydedilir.
- Kill-switch: varsayılan kapalı environment bayrağı; ayrıca review_environment.enabled DB bayrağı her istekte kontrol edilir. DB bayrağı deploy beklemeden durdurur. Yeniden açıldığında eski oturumların da geçersiz kalması için hesap sürümleri artırılmalı veya session kayıtları revoke edilmelidir.

Önemli: Environment değişikliğinin Netlify'daki mevcut Lambda instance'larına anında yansıyacağı varsayılmaz. Acil kesme için DB aktiflik/sürüm/session kontrolleri kullanılmalıdır.

Altı hane düşük entropilidir; güçlü uzun parolayla eşdeğer olduğu iddia edilmez. Koruma, düşük deneme bütçesi, geçici kilit, kısa oturum ve yalnız sentetik/salt okunur etki alanıdır. Dağıtık deneme ve kimlik kilitleme yoluyla hizmet engelleme kalan risktir. Gerçek veri veya ayrıcalık erişimi bu modele eklenmemelidir. Uzun parola/etkileşimli tam sandbox tercih edilirse mevcut istemcide yeni giriş alanı/build gerekebilir.

## 4. Endpoint sözleşmesi ve kesin işlev kapsamı

Mevcut /api/auth/phone/request-code ve verify-code kullanılır. Request aynı phone alanını alır; response success, deliveryStatus=unconfirmed, attemptId, challengeId, expiresInSeconds ve resendAfterSeconds içerir. Verify aynı attemptId/challengeId/phone/code alanlarını alır; aynı token/user/memberships biçimini döndürür. Gerçek WhatsApp gönderimi yoktur.

/api/auth/phone/verify-email normal hesaplar için değiştirilmez; review hesabında gereksiz ikinci doğrulama amacıyla kullanılamaz (403). Normal kullanıcı güvenlik akışına sabit kod istisnası eklenmedi. Yeni yalnız review session revocation endpoint'i POST /api/auth/review/logout; production kullanıcı tokenı bu yolu kullanamaz.

Review tokenı için izinli GET yolları: /user/me, /public/schools, yalnız manageSchools=false döndüren /platform/capabilities ve sabit demo okulun teachers/students/availability/appointments/notifications/settings/classes/info/audit-logs/roster yolları. Rol sınırları ve veri projeksiyonları ayrıca kontrol edilir. Başka tenant/header/query, gerçek veya namespace dışı resource ID'si ve secret taşıyan projection fail-closed reddedilir. Allowlist dışındaki GET ve BÜTÜN iş mutasyonları 403 ile kesilir; gelecekte eklenen normal API rotaları otomatik açılamaz.

**Bu uygulama salt okunur inceleme erişimidir.** Hazır sentetik randevu/öğrenci/öğretmen ekranları gösterilir. Randevu oluşturma/iptal/onay/değiştirme, QR verify, Excel aktarımı, hesap/veri silme, mesaj, lisans işlemleri ve global yönetim açık değildir. Yardımın statik içeriği uygulamadan görülebilir; dinamik gönderimler kapalıdır. Bu sınır tam işlevli mağaza incelemesiyle aynı değildir ve tüm uygulama fonksiyonlarının incelenebildiği iddia edilmez.

Veli ve öğretmen AAB UI akışı test edildi. Okul admin/güvenlik kimlikleri yalnız gateway rol/izin testlerinde kullanıldı; tam yönetim ekranlarının AAB işlev testi yapılmadı. Özellikle admin'in bütün management API'leri bu allowlist içinde değildir; bu roller için mağazaya tam kapsam sözü verilmemeli.

## 5. Demo veri ve gerçek tenant izolasyonu

Test review deposu yalnız bellekte PGlite: sentetik okul, ayrı veli/öğretmen/güvenlik/admin kimlikleri, bir sentetik öğrenci, öğretmen, uygunluk ve örnek randevu. Gerçek kayıtlar veya veritabanı dump'ı kullanılmadı. Gerçek kimlik/başka telefon, yabancı tenant yolu/header/query, yetki yükseltme, global route ve yeni bilinmeyen route negatif testleri geçti.

Normal JWT doğrulayıcısı review tokenını reddediyor; normal JWT ile review okuma yüzeyine giriş yapılamıyor. Gateway sadece review DB tablolarını sorgular. Gerçek WhatsApp/e-posta/FCM/provider ve production verisi üzerindeki yollar default-deny kuralı nedeniyle çağrılamaz. Gerçek Express integration testinde production data store başlangıcına geçiş sentinel'i tetiklenmedi.

Provisioning sırasında ayrı DB fiziksel hedefinin, DB kullanıcısının yalnız review tablolarına yetkisinin ve tamamıyla sentetik veri setinin ayrıca doğrulanması gerekir. Hesap telefonlarının normal production kimlikleriyle çakışmaması gelecekte salt okunur provisioning ön kontrolüdür; production kullanıcı tablosu bu görevde sorgulanmadı. Yapılandırma hatasını gerçek kullanıcıyı demo hesabına dönüştürme yoluyla çözmek yasaktır.

## 6. Test sonuçları

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| Güncel production kaynak/build ilişkisi | PASS | Aktif snapshot audit/source-gate.json; 4/4 tam ZIP hash, iki kayıtlı paketleme |
| Baseline kaynak bütünlüğü | PASS | audit/change-manifest.json |
| Review auth/tenant/rate-limit/kilit/replay/eşzamanlılık/iptal/yan etki | PASS 19/19 | audit/review-auth-results.json ve review-auth.log |
| Gerçek Express iki mount ve production veri deposuna geçmeme | PASS | review-integration.log; fs sentinel |
| Normal WhatsApp OTP | PASS | whatsapp-auth.log; mock provider/sentetik veri |
| Unified login / admin ve tenant güvenliği | PASS | unified-login.log |
| Identity state/expiry/replay/concurrency/auth_version | PASS | identity-auth.log |
| Production quick-switch/auth guards | PASS | production-guards.log |
| Native secure storage/oturum mock testleri | PASS | secure-storage.log |
| Lifecycle/network/navigation/oturum sözleşmeleri | PASS | mobile-session.log; cihaz testi değil |
| Mevcut AAB gerçek bundle request/verify/session/restore/logout | PASS, 2 rol | aab-runtime-results.json; Chromium web runtime |
| Client bundle'da review server config bulunmaması | PASS | client-boundary.json; 37 JavaScript dosyası |
| TypeScript ve production web/server build | PASS | typescript.log, build.log; artifact safety dahil |
| Dört Function bağımsız ZIP yükleme/runtime | PASS | function-runtime.log; kaynak node_modules dışında |
| Fiziksel Android/WebView/gerçek Keystore | NOT TESTED | Yeni APK/AAB üretilmedi |
| Gerçek ayrı review PostgreSQL/TLS/Netlify proxy-IP davranışı | NOT TESTED | Dış altyapı kurulmadı |
| Tam etkileşimli randevu/QR/Excel/admin incelemesi | NOT TESTED / kapsam dışı | İş mutasyonları bilinçli olarak 403 |

İlk paket runtime kontrolünde yerel OTP test verilerinin ZIP'e girdiği bulundu. Bu sentetik PGlite data klasörü arşivde hatalı başlatmaya yol açtı; payload üretim için de uygun değildi. Yalnız geliştirme kopyasında dışlama ve arşiv reddetme testi eklendi. Son dört ZIP bu kontrolleri ve bağımsız yüklemeyi geçti. Önceki başarısız denemeler nihai PASS yerine sayılmadı; package-diagnosis.log yalnız tarihsel tanı kaydıdır. Ürün auth kodu bu hata için gevşetilmedi.

## 7. Gerçek AAB uyumluluğu

Korunan dosya: C:/Users/XIO/Documents/Codex/veli-randevu-android-sync-20261029/android/app/release/app-release.aab.

Kimlik: com.velirandevu.app / versionCode 2 / versionName 1.0.0. SHA-256 8b7f215dc0791143a7e9be581b07b5e3bc46d1e268c4d0fe80be11563c8a7b62. Dosya byte düzeyinde korunmuştur; eski çalışan debug APK'nın hash'i de FC2493F44BF6DC305637647DC5E336F5021FBD0AEB35B54CE301D7FFC737A471 olarak korunmuştur.

AAB yeniden derlenmedi. İçindeki gerçek HTML/JS/CSS dosyaları salt okunur çıkarıldı. Gerçek uygulama kodu Chromium'da çalıştırıldı; production URL'lerine gidecek TÜM API istekleri yerel review backend'e yönlendirildi, diğer dış ağ çağrıları kesildi. Telefon/kod alanları, gerçek JSON request/response, rol/okul bootstrap, oturumun reload sonrası devamı ve mevcut hesap menüsünden çıkış doğrulandı. Giriş/yenileme/çıkış sırasında istemci kodu değiştirilmedi.

**AAB bundle API sözleşmesi ve salt okunur veli/öğretmen oturumu uyumu PASS.** Bu, yalnız endpoint metni araması değildir. Tam fiziksel Android uyumu veya Play'e yüklenen dosyanın aynı SHA-256 olduğu iddia edilmez; native WebView/Keystore cihaz testi ve Play artefakt eşliği ayrıca gereklidir. Bu salt okunur erişim için mevcut bundle'da istemci değişikliği gerekmedi. Daha geniş/uzun parola/etkileşimli sandbox tasarımı için aynı sonucu otomatik genellememek gerekir.

Mevcut AAB çıkış akışı client tokenını temizler; yeni review logout endpoint'ini çağırmaz. Tarayıcı testi bu gerçek client davranışını doğrular. Çalınmış bearer tokenın client çıkışıyla anında sunucuda iptal edildiği iddia edilmez; en çok 15 dakikalık süre veya DB session/version/aktiflik iptali sınırdır. Mevcut istemcide ayrıca refresh endpoint'i eklenmedi; süre dolduğunda tekrar giriş gerekir.

## 8. Production'a uygulamak için eksikler

1. Salt okunur kapsamın mağaza incelemesi için yeterliliğini kullanıcıyla karara bağlamak. Tam işlev gerekirse ayrı bir sentetik etkileşimli API tasarımı, ek iş testleri ve gerekirse yeni istemci gerekir. İş mutasyonlarını normal production router'ına açmak çözüm değildir.
2. Gerçek production DB'den ayrı review veritabanı, ayrı bağlantı/CA ve sınırlı DB rolü. REVIEW_LOCAL_SCHEMA bir şema metnidir; kod production'da otomatik migration çalıştırmaz. Bu görevde yalnız bellekte uygulandı.
3. Tamamen sentetik rol/data projection seti, kayıtların gerçek hesaplarla çakışmadığı ön kontrol. Şu an production demo okul/hesap yok.
4. Yeni review ortam değişkenlerinin ve credential hash'lerinin güvenli provisioning planı. REVIEW_AUTH_ENABLED varsayılan kapalı; REVIEW_ACCOUNT_REGISTRY, REVIEW_AUTH_EPOCH, REVIEW_JWT_SECRET, REVIEW_DATABASE_URL, REVIEW_DATABASE_CA_B64 isimleri gerekir. Değerler bu raporda bulunmaz; hiçbir production env ayarı değiştirilmedi.
5. Denetim/rate-limit/session tabloları için sınırlı retention ve operasyon izlemesi; saldırı kaynaklı geçici kilit açma prosedürü. Netlify'da gerçek kaynak IP'sinin güvenilir elde edilmesi henüz doğrulanmadı; istemcinin serbest X-Forwarded-For başlığına güvenilecek şekilde ayar gevşetilmedi.
6. Ayrı altyapıda PostgreSQL row-lock/TLS ve native Android cihaz testi. Aynı release AAB'nin Play artefaktıyla hash eşliği.
7. Son kaynak/Function paket kontrolü, açık yayın onayı ve ancak sonrasında deployment. Bu görevde onay varmış gibi üretime geçilmedi.

## 9. İncelemeci erişim bilgilerini sağlama yöntemi

Onaylanan modelde her rol için ayrı ön tanımlı demo kimliği. Sır güvenli kanalda rastgele oluşturulur; sunucuda scrypt hash'i/salt saklanır, değer repo/istemci/log/rapora konmaz. Geçici test kodları gerçek mağaza kimlik bilgisi değildir ve kullanılmamalıdır.

Play App access için İngilizce adımlar: verilen review telefonunu mevcut telefon alanına yaz; code request'e bas; gerçek WhatsApp mesajı bekleme, sağlanan review verification credential'ını altı haneli alana gir; sentetik okul ve izin verilen rol ekranlarını incele. Erişimin salt okunur olduğu, gerçek mesaj/finans/global yönetim ve değişiklik işlemlerinin kapalı olduğu açıkça anlatılmalıdır. Normal kullanıcılara verilen auth güvenliği değiştirilmez. Play alanına bu görevde bilgi yazılmadı.

## 10. İptal ve geri alma

En hızlı kapatma: review DB ortam enabled=false; ayrıca hesapları pasifleştir/sürüm artır veya review_sessions kayıtlarını revoke et. Sadece geçici kill-switch'i kapatıp açmak eski tokenı kendi başına kalıcı iptal etmez. Kalıcı sır ifşasında sır hash'i/hesap sürümü ve gerektiğinde ayrı review imza anahtarı döndürülür; normal JWT_SECRET/AUTH_CODE_SECRET'e dokunulmaz.

Environment kill-switch değişiklikleri için Netlify instance/deploy yaşam döngüsü hesaba katılmalıdır. Kod rollback'i gerekirse yalnız doğrulanmış güncel 6ae342e1 baseline'ı esas alınır; 6ae32197 tarihsel kaynakla yeni production consentStatus özelliği kaybettirilmez. Rollback otomatik uygulanmadı.

## 11. Karar ve korumalar

- Kaynak kapısı: **PASS / A — DOĞRULANDI**, güncel 6ae342e13fc1e501a18f7b31 için.
- Yerel sınırlı review prototipi ve AAB bundle sözleşmesi: **PASS**, yukarıdaki salt okunur ve tarayıcı sınırlarıyla.
- Tam etkileşimli mağaza incelemesi ve production: **NO-GO**, kapsam kararı, provisioning, native/dış altyapı doğrulaması ve açık onay olmadan.

Bu görevde Netlify deploy/env değişikliği, production DB kaydı/migration, gerçek OTP/hatırlatma, GitHub push, Android APK/AAB üretimi veya Google Play işlemi yapılmadı. Çalışan Android projesi ve mevcut paketler korundu. Production'ın çalışma sırasında değişmesi bu görev dışındaki yayındır; yeni kaynak doğrulanmadan devam edilmedi. Sonraki üretim adımı için kullanıcı onayı bekleniyor.
