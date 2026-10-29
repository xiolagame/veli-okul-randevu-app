# İnceleme erişimi ve tema — yerel hazırlık

Bu dal deploy edilmemiştir. Varsayılan web/iOS/Android paketi normal production WhatsApp akışını kullanır. Demo erişim düğmesi yalnız ayrı inceleme API adresi build sırasında VITE_REVIEW_API_ORIGIN ile tanımlanınca görünür.

29 Ekim devam fazında: açık etiketli demo silme simülasyonu, yenilenebilir QR örneği, kalıcı audit dosyası, iki katmanlı egress engeli, offline initialize/reset ve TLS container dosyaları eklendi. Ayrıntılı operatör planı `deploy/review/RUNBOOK.md` dosyasındadır. Dağıtım yapılmadı.

## Ayrı inceleme servisi

Production API'ye review router eklenmez. server/review-service.ts yalnız ayrı dağıtım içindir. Aynı gerçek uygulama route/repository kodunu ayrı sentetik veritabanıyla kullanır.

Gerekli sunucu değişkenleri:

- REVIEW_SERVICE_ENABLED=true
- REVIEW_DATABASE_URL: ayrı PostgreSQL veritabanı, ayrı servis kimliği; production projesi değildir.
- REVIEW_JWT_SECRET: en az 48 karakter rastgele, production anahtarından farklı; secret manager'da tutulur.
- REVIEW_ALLOWED_ORIGINS: açık web origin listesi, capacitor://localhost ve Android için gerekli https://localhost origin'i. Wildcard yasak.
- REVIEW_IDENTITIES_JSON: sekiz kayıt; id/userId=review-apple-admin, review-apple-teacher, review-apple-parent, review-apple-security ve aynı roller için review-google-*; schoolId=review-apple veya review-google. store, passwordHash (scrypt), version ve enabled alanları.

Gerçek parolalar kullanıcı onayıyla güvenli ortamda üretilmeli, registry'de yalnız hash saklanmalı. Bu görevde canlı kimlik bilgisi oluşturulmadı. Örnek test parolaları yalnız test fixture'larıdır.

DATABASE_URL, JWT_SECRET, PLATFORM_ADMIN_USER_IDS ve mesaj/push sağlayıcı anahtarları review dağıtımında bulunamaz. Servis bu koşulları, ayrı DB marker'ını ve iki demo okulunu doğrular. Registry dışındaki kullanıcılar ancak yalnız bu demo okullarına bağlı sentetik yönetim kayıtları olabilir; üyeliği olmayan veya kapsam dışı kullanıcıda başlangıç reddedilir. Registry dışında demo giriş izni verilmez. Paylaşılan sekiz kimlik ve örnek öğrenci için PATCH/DELETE koruması vardır. Ayrı veritabanını sağlamak yine dağıtım operatörünün sorumluluğudur.

Mevcut şema yalnız ayrı review veritabanında ayrıca onayla kurulmalı. server/review-fixtures.ts içindeki seedReviewFixtures, caller'ın transaction'ı içinde iki okul ve sekiz kimlik, sentetik öğrenciler, öğretmen profilleri, üyelikler ve haftalık uygunlukları üretir. Helper migration yapmaz ve otomatik çalıştırılmaz. Ayrı DB şema kurulumu/provisioning bu görevde yapılmadı.

Yerel/özel servis entry point: scripts/start-review-service.ts. Üretim paketi için esbuild ile bu entry point'i Node external-dependencies bundle olarak ayrıca derleyin. Ana production server.ts ve Netlify function dağıtımını değiştirmeyin. Netlify kullanılacaksa yalnız review servis handler'ını yayımlayan ayrı site/function adaptörü gereklidir; bu adaptör henüz yoktur.

## Oturum sınırı

POST /api/review/login güçlü parola ile yalnız registry kimliklerini doğrular. Ayrı anahtarla 1 saatlik JWT üretir. iss=veli-review, aud=veli-review-api, review kimliği/okulu/version kapsamı vardır. Her istekte registry ve auth_version tekrar kontrol edilir. enabled=false veya version artırımı eski oturumları geçersiz kılar.

Mobil API istemcisi demo tokenını yalnız build'de sabitlenen HTTPS review origin'ine yönlendirir. Origin token içinden alınmaz. Normal token production origin'ini kullanmaya devam eder. Aynı native Keychain oturum mekanizması korunur; çıkış mevcut güvenli token temizleme yoludur.

Demo servisinde normal OTP, platform yönetimi ve gerçek mesaj gönderimi kapalıdır. Hesap silme ayrı review işleminde parola/onay ve oturum iptaliyle açıkça simüle edilir; paylaşılan kimlik/okul kayıtları silinmez. Push kaydı sentetik sonuç döndürür, device tokenı saklamaz. Lisans tercihi yalnız demo tablosunda saklanır. Okul kapsamındaki işlemlerde mevcut gerçek tenantGuard ve rol kontrolleri çalışır. Okul dışı kaynaklar ve Apple/Google okulları arası erişim reddedilir.

Rate limit DB'deki auth_rate_limits tablosuyla IP ve kimlik başına 15 dakikalık pencerede uygulanır. Audit önceden oluşturulmuş kalıcı volume dosyasına append+fsync yazar; parola/token kaydetmez. /readyz DB/registry/audit hazır olmasını ölçer. Offline reset eski oturumları iptal ederek sentetik verileri tekrar oluşturur. Gerçek volume/monitor/retention ve container egress kabul testleri dağıtımda yapılmalıdır.

## Mağaza sınırları / NO-GO

Bu sürüm canlı mağaza incelemesine henüz hazır değildir: ayrı servis/DB provision edilmedi, erişim sırları üretilmedi, gerçek iOS/Android end-to-end yapılmadı. Demo silme gerçek veri silme değil açık simülasyondur; dış teslimat yerine sentetik/engellenmiş sonuçlar vardır. Platform yönetimi review kimliklerinin kapsamı dışındadır. Bu sınırları review notes'ta açıkça anlatın; tam canlı özellik veya gerçek teslimat PASS iddiası yapmayın.

Taslak İngilizce review notes:

Güncel İngilizce review notes taslağı `deploy/review/RUNBOOK.md` içindedir; QR yenileme ve silme simülasyonunun sınırlarını açıklar.

Apple'da hesap yerine demo modu seçilecekse 2.1(a) için ön onay değerlendirilmelidir. Google App Access bilgileri tekrar kullanılabilir, İngilizce ve konumdan bağımsız olmalı. Bu fazda konsol ayarı yapılmadı.

## Tema

src/theme.css semantik background/surface/elevated/text/muted/border/accent/input/overlay ve durum tokenlarını tanımlar. Başlangıçta index.html son manuel tercihi veya sistem temasını React'ten önce uygular. LocalStorage yalnız tema tercihini tutar, token veya parola tutmaz. Son seçim web ve WKWebView yeniden açılışında kalır; depolama engelliyse yalnız o oturumda çalışır.

Güneş/ay düğmeleri marka alanında; marka kaldırılmış Yardım ve Lisans sayfalarında üst navigasyondadır. aria-label/aria-pressed ve 44px hedefler kullanılır. Fiziksel Dynamic Type, VoiceOver ve native sistem çubukları ayrıca kontrol edilmelidir.
