# Ayrı mağaza inceleme ortamı — dağıtım öncesi plan

Bu dosyalar yerel hazırlıktır. Bu görevde Docker, canlı servis, DB, DNS, TLS, Supabase veya mağaza dağıtımı başlatılmadı. Aşağıdaki dağıtım adımları ayrıca onaylanan operatör işi içindir.

## Topoloji ve dış gönderim sınırı

`compose.yaml`: HTTPS Nginx → review API → yalnız `veli_review` PostgreSQL. API ve DB yalnız `internal: true` ağdadır; host portları yayımlanmaz. Yalnız sabit upstream kullanan Nginx dış ağa bağlıdır. API'nin İnternet çıkışı yoktur. Production sunucusuna veya Supabase projesine bağlanmayın. Host network/extra network/host gateway eklemeyin. `internal` Docker ağının gerçek çalışması hedef Linux host'ta egress negatif testiyle doğrulanmalıdır; Windows'ta yalnız YAML güvenlik yapısı test edildi.

Review process'i, uygulama/provider modülleri yüklenmeden fetch ve Node HTTP/HTTPS istemcilerini reddeder. PostgreSQL TCP/TLS bağlantısı korunur. Bu ikinci katman tüm olası TCP istemcilerinin sandbox'ı değildir; asıl ağ engeli internal container ağıdır. WhatsApp/SMS/e-posta/push sırlarını bağlamayın. Cron veya mesaj worker'ı çalıştırmayın. Sentetik DB'ye bile gerçek e-posta/telefon/device tokenı yazmayın.

Node image 24.17.0'dır. Dağıtımdan önce Node/PostgreSQL/Nginx image erişimi, güvenlik güncellemeleri ve onaylanan digest'ler kaydedilmelidir; bu görevde image pull/build yapılmadı. Dockerfile yalnız açık kaynak klasörlerini kopyalar; `.env`, sertifika, çalışma DB'si, Git ve audit çıktısı image'a kopyalanmaz.

## Operatör hazırlığı

1. Production'dan bağımsız host/proje, DB volume ve yedek alanı seçin. `REVIEW_SECRETS_DIR` ve `REVIEW_AUDIT_DIR` Git checkout dışında olsun. Hiçbir üretim `.env` dosyasını kopyalamayın.
2. Dış secret manager'da en az 48 karakter rastgele review JWT anahtarı; sekiz farklı güçlü reviewer parolası ve yalnız scrypt hash'lerini içeren registry hazırlayın. Gerçek parolaları yalnız mağaza App Access/Review Notes güvenli alanlarında paylaşın. Hash fonksiyonu mevcut `server/passwords.ts`'dedir; test parolalarını kullanmayın.
3. Registry satırları: `review-(apple|google)-(admin|teacher|parent|security)`; `userId=id`, `schoolId=review-apple/review-google`, doğru `store`, `enabled:boolean`, pozitif `version`. Tam sekiz kayıt gerekir. Registry değişimini atomik yapın ve Docker secret file bind'larının yeni inode'u görmesi için API'yi kontrollü yeniden başlatın. enabled=false/version artışı o kimliğin eski JWT'lerini iptal eder.
4. `review-db` hostname SAN'ı olan ayrı DB server sertifikası/anahtarı ile güvenilen CA hazırlayın. `db-tls/server.crt`, `server.key`; anahtar yalnız PostgreSQL UID'sinin okuyabileceği 0600 sahiplikte olsun. Anahtar Git'te bulunmaz. CA sertifikasının base64 karşılığı dış `db-ca-b64` dosyasıdır. Mevcut backend TLS doğrulaması kapatılmaz.
5. Dış secret dosyaları: `db-password` (yalnız DB owner), `database-url` (runtime review_app, host review-db, DB veli_review), `jwt-secret`, `identities.json`, `db-ca-b64`. Başlangıç için geçici owner `admin-database-url` ayrı tutulur; çalışan API'ye bağlanmaz. URL parolası gerektiği gibi encode edilmelidir; URL'yi loglamayın.

   Ayrıca yalnız review ortamında yeni üretilen en az32 karakterlik `auth-code-secret` gerekir. `AUTH_CODE_SECRET_FILE` ile okunur; mevcut activation modülünün production fail-fast kontrolünü karşılar. Bu, OTP bypass veya WhatsApp gönderim izni değildir; normal auth uçları review guard tarafından kapalıdır. Production anahtarını kopyalamayın. Secret bind dosyaları runtime UID/GID1000 için yalnız okuma, audit dosyası yazma iznine sahip olmalıdır; Docker cap_drop=ALL root kullanıcısı başka UID'nin audit dosyasına yazamaz. One-off initializer'ı UID1000 ile, geçici salt-okunur owner URI mount'uyla çalıştırın; owner dosyasını runtime API'ye bağlamayın.
6. `REVIEW_AUDIT_DIR/access.jsonl` dosyasını önceden oluşturun; node UID1000 yazabilsin, dizini başkaları yazamasın. API regular-file/no-symlink append ve fsync ister. Yedekleme/retention kurun. Disk dolu veya dosya yoksa giriş/ready kontrolü fail-closed olur.
7. Onaylanan HTTPS review hostname'i ve dış sertifikayı `https-tls/fullchain.pem`, `privkey.pem` olarak hazırlayın. TLS yenilemeyi host'ta yapın; API'ye ACME ağ çıkışı açmayın. `VITE_REVIEW_API_ORIGIN` yalnız bu sabit HTTPS origin olmalı; ana production origin'i kullanmayın.
8. `REVIEW_ALLOWED_ORIGINS` yalnız gerçek web origin'i, iOS `capacitor://localhost` ve Android `https://localhost` gibi gereken açık origin'leri içersin. Wildcard vermeyin. API yalnız tek Nginx hop'una güvenecek biçimde ayarlıdır; Nginx X-Forwarded-For'u istemci değerinden değil remote_addr'dan üretir.

## Kurulum sırası — bu görevde çalıştırılmadı

- Önce yalnız ayrı PostgreSQL'i başlatın. Host5432 portu açmayın. Boş `veli_review` dışında DB seçmeyin.
- Ayrı image'ı build edin. İlk kurulumda API'yi başlatmadan, one-off container'da owner URL secret'ını geçici mount edin; `REVIEW_DATABASE_URL_FILE` bu mount'u göstermeli. `NODE_ENV=production`, `REVIEW_SERVICE_ENABLED=true`, `REVIEW_DATABASE_HOST=review-db`, `REVIEW_MAINTENANCE_CONFIRMED=isolated-store-review` ile `node review-dist/review-admin.cjs --initialize-empty-review-db` çalıştırılır.
- Initializer boş olmayan public schema'yı reddeder; mevcut şema ve migration dosyalarını yalnız yeni review DB'ye uygular, marker/receipt/preference tablolarını ve sentetik fixture'ları oluşturur. **Production seed SQL'i çalıştırmaz.** İşlem transaction'dır. Bu komut canlı DB'de bu görevde test edilmedi.
- `least-privilege.sql` runtime `review_app` rolünü NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS oluşturur; gerekli DML yetkileri ve ayrı DB'nin service_role üyeliğini verir. Owner bağlantısında parolayı güvenli etkileşimle atayın; runtime URL dosyasını bu role ayarlayın. Runtime API'ye owner secret'ını vermeyin. Ayrı TLS/DB rolüyle DML/RLS smoke testi yapın.
- Daha sonra API ve HTTPS proxy'yi başlatın. /healthz process; /readyz registry, DB ve kalıcı audit yazımını kontrol eder. Hiçbiri secret döndürmez.
- Onaylanan host'ta ağ testi: API container'ından dış HTTPS/HTTP ve genel TCP443 hedefi başarısız olmalı; DB5432 TLS başarılı olmalı. Bu negatif test geçmeden ortamı incelemeciye açmayın. DB kullanıcı/okul kapsamını kontrol edin; yalnız sentetik review kayıtları bulunmalı.
- Sekiz hesapla uçtan uca: iki okul izolasyonu, yanlış key/token reddi, 429 deneme limiti (farklı istemci IP'leriyle proxy doğrulaması), kalıcı audit, parola/red/iptal, randevu/uygunluk ve QR; gerçek mesaj gönderilmeme kontrolü. Gerçek sağlayıcı sırrı kullanmadan test edin.

## Hesap silme ve QR

Demo silme açıkça **simülasyon** olarak etiketlidir. İnceleme parolası ve HESABIMI SİL onayı gerekir. Yalnız kendi auth_version artırılır ve cihaz kayıtları temizlenir; transaction receipt kalıcıdır. Hesap/okul/diğer roller silinmez; aynı kayıt tekrar giriş yapabilir. Production gerçek hesap silme yolu değişmemiştir. Bu kısıtı mağazaya gizlemeyin; gerçek kullanıcı hesabı silinmiş gibi anlatmayın.

İnceleme bandındaki “Demo QR örneğini yenile” yalnız kendi demo okulunun sentetik booked örneğini İstanbul saatine getirir ve yeni QR üretir. Veli hesabında randevuları yenileyip giriş kartını gösterin; güvenlik hesabıyla kamera üzerinden tarayın. Eski örnek QR geçersiz olur. Normal erken/geç/randevu durum kuralları değişmez; aynı geçerli QR'ın salt-okunur tekrar doğrulanması mevcut iş kuralıdır. Gerçek kamera henüz test edilmedi.

Platform uçları hâlâ kapalıdır; sekiz reviewer kimliğine gerçek veya genel platform-admin yetkisi verilmez. Platform UI görsel testi sahte API ile yapılır, canlı platform demo erişimi anlamına gelmez. İnceleme kapsamına platform rolü ayrıca istenirse onaylanan sınırlı sentetik kapsam gerekir.

## Reset, iptal, süreklilik

- Tam reset: API'yi durdurun/maintenance aralığı duyurun. Aynı ayrı DB'de `REVIEW_MAINTENANCE_CONFIRMED=isolated-store-review` ile `node review-dist/review-admin.cjs --reset-offline-review-only`. Registry'nin kapalı kayıtlarını açmaz. Marker ve yalnız izinli okul/kimlik kapsamını doğrular; kapsam dışı kayıt varsa yazmadan reddeder. Transaction içinde sentetik okulları/fixture'ları yeniden oluşturur. Önceki auth_version+1 korunur, eski JWT'ler reset sonrası canlanmaz. Audit/deletion receipt kayıtları korunur. Planlı reseti inceleme saatinde yapmayın.
- Bir hesabı iptal: registry enabled=false veya version artırımı; mount yenileme/restart; eski token401, diğer kimlikler200 kontrolü. Acil hepsini iptal için JWT anahtarını ayrı secret manager'da değiştirip API'yi yeniden başlatın.
- Audit dosyasını en az süreç/pod yeniden başlaması boyunca kalıcı volume'da tutun. 90 günlük örnek retention süresi operasyon/gizlilik sorumlusu tarafından onaylansın; eski dosyayı rotate ederek API'yi kontrollü yeniden başlatın. Açık FD nedeniyle yalnız dosya yeniden adlandırılması yeterli değildir. DB receipt saklama/temizleme politikasını ayrıca belirleyin.
- Dış uptime monitor /readyz'yi 60sn'de kontrol etsin; ardışık 3 hata alarmı. Host restart, DB disconnect/reconnect, disk dolması, JWT/registry iptali ve sertifika süresi testleri dağıtım kabulünün parçasıdır. Compose restart policy process/host yeniden başlamasını kapsar; yalnız unhealthy durum otomatik restart garantisi değildir. Operatör müdahalesi tanımlayın. Sertifikayı 30/14/7 gün kala izleyin; disk/audit boyutu, 429/401 artışı ve DB volume yedeğini kontrol edin.
- Reviewer hesaplarını inceleme süresince açık ve parolalarını sabit tutun; reset/rotation takvimini inceleme dışında planlayın. Production sistemine health fallback eklemeyin.

## İngilizce review notes taslağı

“On the sign-in screen, choose ‘Mağaza inceleme erişimi’ (Store review access). Use the identity and password supplied separately for your review team; no WhatsApp/SMS is needed. Four roles are available: school administrator, teacher, parent, and security. Apple and Google accounts use separate synthetic schools. No real school or student data is present. The banner explains that external messages are not delivered. Account deletion is explicitly simulated: it signs out that account's sessions and preserves its reusable synthetic identity. To inspect a current QR example, select ‘Demo QR örneğini yenile’, refresh the parent's appointments, open the entry card, and scan it with the security account. Platform administration is outside these review identities' scope.”

Bu taslak gerçek dağıtım ve fiziksel cihaz kabulü sonrası doğrulanarak kullanılmalıdır; mağaza kabulü garantisi değildir. Güncel mağaza form/gereksinim değerlendirmesi ve hesap bilgilerini konsola yazma bu yerel görevin kapsamı dışındadır.
