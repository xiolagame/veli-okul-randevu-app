# Yerel web karşılama çalışması

Kaynak: `veli-randevu-web-welcome-20261029`, mevcut production release kopyası.

## Görseller

- `public/welcome/scene.png`: Kullanıcının ayrıca onayladığı `Güvenli Okul Girişi ve Dijital Randevu (1).png`. İstenen `01-karsilama-ekrani.png` bulunmadığından bu dosya kullanıldı. Masaüstünde değişmeden gösterilir; gerçek HTML butonları ve bağlantıları aynı koordinatlara yerleşir, metinler yeniden basılmaz.
- `public/welcome/transition.mp4`: `02-giris-gecis-videosu.mp4` ile SHA-256 eşleşir; video değiştirilmedi.
- `public/welcome/login-scene.png`: `03-gercek-giris-ekrani-referans.png` üzerinden built-in imagegen ile üretilen temiz dekoratif arka plan. Orijinal referans korunur. İşlem promptu: yalnızca soldaki yeşil UI panelini ve sağdaki beyaz form kartını içlerindeki yazılarla birlikte kaldır; aynı okul bahçesini devam ettir; okul, bayrak, öğrenciler, veli, güvenlik ve turnikeleri mümkün olduğunca koru; yeni form, metin, logo veya kişi ekleme. Arka plandaki örtülü alanlar üretildiğinden birebir piksel kopyası değildir.

## Akış

WebWelcome yalnız WEB ortamında çalışır. Native ortamda doğrudan mevcut AuthView döner. AuthView, API, session ve OTP kaynakları değiştirilmedi. Web CSS yalnız `.welcome-auth` altında uygulanır.

Her iki giriş butonu aynı akışı başlatır. Video başlarken 180 ms opacity karışımı, son 500 ms sırasında gerçek form üzerine çözülme uygulanır. Giriş arka planda hazırlanır ancak geçiş bitene kadar inert durumdadır. Video hatası, play reddi, 8 saniyelik takılma veya reduced-motion durumunda doğrudan giriş açılır. Scroll animasyonu yoktur.

Menüler: Lisans Talebi / İletişim mevcut public talep sayfası; Destek ve Platformu İncele mevcut yardım merkezi. Son kullanıcı talimatıyla Hakkımızda bağlantısı ve sayfa içi tanıtım bölümü kaldırıldı. Yeni route oluşturulmadı.

## Dört ek tasarım düzeltmesi

- Masaüstü tıklama alanları PNG butonlarının sınırlarına hizalandı. Ek hover çizgisi kaldırıldı; klavye focus outline içeride korunur. Ölçekli görseldeki alanı aşan minimum 44 px kuralı masaüstü hotspottan kaldırıldı; 1280 px altı normal, en az 44 px HTML buton düzenini kullanır.
- `public/welcome/header-clean.png`, built-in imagegen ile yalnız üst logo/menü temizliği için hazırlandı. Prompt: üst soldaki KolayOkul kitap logosunu ve yazısını, ortadaki dört menü yazısını kaldır; aynı gökyüzü/yaprak dokusuyla doldur; diğer kompozisyonu değiştirme. Çıktının yalnız iki küçük üst yaması CSS clip-path ile kullanılır. Ana sahne ve butonlar orijinal PNG'den kalır.
- Üst logo `/branding/veli-randevu-logo.png` ve gerçek HTML `VeliRandevu` yazısıdır. Mobilde de aynı mevcut logo kullanılır. MP4 kaynak dosyasına dokunulmadı; videoya gömülü eski marka bu değişikliğin dışındadır.
- `src/main.tsx`, yalnız WEB platformunda `data-web-scene="school"` ekler. `web-scene.css`, mevcut `.school-background`, `.admin-backdrop` ve `.platform-management-page` katmanlarını temiz okul sahnesine bağlar. Mevcut opak kartlar/tablolar korunur. Böylece giriş, yardım/kılavuzlar, lisans/iletişim ve oturum sonrası veli/öğretmen/güvenlik/okul/platform yönetimi aynı kök sistemi kullanır. Gerçek oturumlu her panel için cihaz testi ayrıca gerekir.
- Önceki ekran görüntüleri `.cache/welcome-review/before-four-fixes/`, sonrakiler `.cache/welcome-review/` içindedir.

Ek regresyon: `node scripts/test-web-scene.mjs` gerçek uygulama başlangıcını WEB/ANDROID/IOS için izole test eder; derlenmiş gerçek giriş/yardım/iletişim sayfalarını 390/768/1366/1440/1920 px'de kontrol eder. `test-web-welcome.mjs` gerçek hover/focus ölçümlerini de doğrular.

## Önizleme ve test

`npm run build`

`node scripts/preview-web-welcome.mjs`

Adres: http://127.0.0.1:4174

Bu ayrı yerel tasarım sunucusu yalnız capabilities yanıtını sağlar. Diğer bütün API istekleri 503 ile reddedilir; OTP, JWT veya sahte kullanıcı oluşturmaz. Production paketi bu sunucuyu çalıştırmaz. Gerçek AuthView request/verify/session entegrasyonu `scripts/test-web-welcome.mjs` içinde sentetik API ile test edilir.

Gerçek cihaz Safari/Android Chrome kontrolü ve production görsel onayı ayrı olarak gerekir. Commit/push/deploy yapılmadı.
