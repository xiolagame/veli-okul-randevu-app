# Web arka planı ve kart yüksekliği düzeltmesi

Çalışma yalnız `veli-randevu-web-welcome-20261029` yerel kopyasında yapıldı. Production, backend, veritabanı ve gerçek gönderim kullanılmadı.

## Neden ve çözüm

Ortak sahnedeki `#f6f8f7c9` beyaz gradient yaklaşık %79 opaklıkla fotoğrafı solduruyordu. Yalnız `.help-page` veya `.public-request-page` açıkken aynı görsel üzerine `115deg` yönünde `rgba(6,59,33,.70)` ve `rgba(19,32,49,.56)` karartma uygulanır. Görsel dosyasına dokunulmadı. Katman mevcut `.school-background` üzerinde, HTML içeriğinin gerisinde ve pointer-events:none olarak kalır. Karşılama, video, nihai giriş ve oturumlu panellerin mevcut stilleri korunur.

Eski form 720 px genişliğinde, tek sütunlu; kart padding'i 40 px, form boşlukları 20 px idi. Yardım kategorileri iki sütunda iki sıra halinde, her bağlantı en az 64 px ve geniş iç boşluklarla gösteriliyordu. Bu birleşim masaüstü yüksekliğini aşıyordu.

- Lisans/İletişim kartı en fazla 980 px genişliğe alındı; padding 24 px, alan aralığı 12 px, input en az 44 px, font 16 px.
- 740 px üzerinde form iki sütundur: talep/okul, yetkili/e-posta, telefon; mesaj tam genişliktedir. Gönder düğmesi tam genişlikte görünür. Hata bildirimi grid'in ilk tam satırına yerleşir.
- Mesaj başlangıç yüksekliği 88 px; kullanıcı tarafından büyütme korunur.
- Yardım Merkezi 1100 px üzerinde dört sütun, kompakt başlıklar ve en az 56 px bağlantı alanları kullanır. Hiçbir bilgi/link silinmedi.
- Mobil üst logo ve geri düğmesi tek satıra alındı. Form tek sütun kalır; alanlar veya doğrulama davranışı değiştirilmedi. Mobil/zoom/klavye için doğal kaydırma korunur; içerik overflow:hidden ile kesilmez.

## Sayfa kapsamı

- Platformu İncele ve Destek: mevcut `/yardim` sayfası, koyu arka plan + kompakt kategori kartları.
- Lisans Talebi: `/lisans-iletisim`, koyu arka plan + iki sütunlu form.
- İletişim: `/lisans-iletisim?request=contact`, aynı formun mevcut iletişim seçeneği.
- Uzun yardım kılavuzlarının metinleri korunur; bu uzun belgelerin tamamının bir ekrana sığması iddia edilmez.

## Doğrulama

PASS: TypeScript, production build ve release artifact testi; gerçek derlenmiş web sayfalarında 1920×1080, 1440×900, 1366×768, 768 px tablet ve 390 px mobil kontrolleri. Yardım ana sayfası, lisans ve iletişim formu masaüstünde dikey kaydırma gerektirmiyor; hata mesajları gösterildiğinde de bu kontrol PASS. Tüm alanlar ve gönderme düğmesi görünür; hatalı e-posta ve boş okul doğrulandı; POST istek sayısı sıfır.

PASS: mevcut karşılama/video/OTP sentetik UI regresyonu, mobil platform ve production auth guard testleri. Native başlangıçta yeni web arka planı etkinleşmiyor. Gerçek fiziksel cihaz testi yapılmadı.

Masaüstü ve mobil ekran görüntüleri görsel olarak da incelendi. Mobilde bütün formun kaydırmasız sığdığı iddia edilmez; okunabilir tek sütun ve erişilebilir kaydırma korunur. Kullanıcı textarea'yı büyüttüğünde, tarayıcıyı yakınlaştırdığında veya uzun bir yardım kılavuzu açtığında gerektiği kadar kaydırma mümkündür.

Değişen kaynak/test dosyaları: `src/components/web-scene.css`, `scripts/test-web-scene.mjs`. Bu rapor yeni eklendi. AuthView, WebWelcome, video ve resim dosyalarında bu görev kapsamında değişiklik yapılmadı.

## Önce / sonra

- Önce: `.cache/welcome-review/before-dark-compact/shared-yardim-1440.png`, `.cache/welcome-review/before-dark-compact/shared-lisans-iletisim-1440.png`
- Sonra: `.cache/welcome-review/shared-yardim-1366.png`, `.cache/welcome-review/shared-lisans-iletisim-1366.png`, `.cache/welcome-review/shared-lisans-iletisim-390.png`

Önizleme: http://127.0.0.1:4174 (gerçek talep ve OTP gönderimi kapalı).

Commit, push veya deploy yapılmadı.
