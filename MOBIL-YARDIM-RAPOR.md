# Mobil Yardım / Lisans İletişim düzeltmesi — 29 Ekim 2026

Çalışma klasörü: C:\Users\XIO\Documents\Codex\veli-mobile-help-fix-20261029

Önceki mobil giriş önizlemesi Git deposu olmadığı için Git durum kontrolü bunu bildirdi. Önceki klasör ve iOS lisans entegrasyonu korunarak bağımsız kaynak kopyası oluşturuldu. Yerel veritabanı klasörü aktarılmadı.

## Değişiklikler

- src/components/HelpCenterPage.tsx: Ortak yardım başlığındaki Brand renderı kaldırıldı. Ana yardım, 12 rehber/bilgilendirme alt sayfası ve bulunamayan sayfa aynı başlığı kullanıyor.
- src/components/PublicRequestPage.tsx: Logo renderı kaldırıldı.
- src/index.css: Yalnız iki sayfa başlığının geri dönüş bağlantısı saf beyaz, oku currentColor ile beyaz; hover/focus/active beyaz ve arka plan transparan. Minimum hedef 48px. Başlık sola hizalı.
- scripts/test-help-mobile.mjs: Tüm ilgili rotalar için tarayıcı testi eklendi.

Global Brand bileşeni ve ana giriş değiştirilmedi. Kullanım metinleri, form alanları/fiyatı, API ve form gönderim mantığı aynı. Kaynak karşılaştırmasında yalnız yukarıdaki üç ürün dosyası farklı. Mevcut safe-area root insetleri korunuyor.

## Testler

- npm run lint: PASS.
- npm run build: PASS, 58 client / 2 server artifact güvenlik kontrolü PASS.
- npm run test:whatsapp-login-ui: PASS.
- node scripts/test-help-center.mjs: PASS.
- node scripts/test-help-mobile.mjs: PASS, 90 rota/viewport kombinasyonu.
- Boyutlar: 320×568, 360×640, 375×667, 390×844, 393×852, 430×932.
- Logo DOM'da yok; geri dönüş yazısı ve ok normal/hover/focus durumlarında rgb(255,255,255); hedef en az 48px; yatay taşma yok; geri dönüş doğru giriş başlığını ve markasını gösteriyor.
- Dikey kaydırma uzun rehber/form içeriği için doğal olarak korunuyor; sabit yükseklik veya içerik kesme eklenmedi.
- Gerçek iOS safe-area/cihaz, Safari ve Android cihaz testi yapılmadı. Testler Windows üzerinde Chrome responsive ölçümleridir.

Ekran görüntüleri: previews/help-390x844.png ve previews/license-390x844.png. Beyaz dış çizgi testte klavye focus durumunun görünür göstergesidir, kalıcı buton çerçevesi değildir.

Önizleme: http://127.0.0.1:3001 — statik production build; form gönderimini canlı servise bağlamaz. Tarayıcı testlerinde tüm API yanıtları mock kullanıldı, gerçek WhatsApp veya form gönderimi yapılmadı.

Yerel önizleme ve kod incelemesine hazır. Production yayını kullanıcı onayı ve fiziksel mobil kontrol sonrası yapılabilir. Deploy/push/TestFlight/veritabanı işlemi yapılmadı.
