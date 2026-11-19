# WhatsApp giriş ekranı — masaüstü yerleşim düzeltmesi

29 Ekim 2026. Yalnız yerel kaynakta uygulandı; deploy/commit/push/migration/gerçek mesaj yok.

## 1. Kök neden

`.welcome-auth .auth-layout` tüm viewport'a yakın genişlikte 49/51 kolon kullanıyordu. Sol panel neredeyse tam ekran yüksekliğindeyken sağ kart 450px ile sınırlıydı. Ortak tema kuralı sağ alanı opak beyaz yapıyor, ortak fotoğraf da 20px dış boşluklardan parça parça görünüyordu. Sonuç, baskın hero ve boş beyaz alan içinde küçük karttı.

## 2. Değişen dosyalar

- `src/components/login-desktop.css`: yeni, yalnız WEB ve en az 1100px genişlikte çalışan yerleşim.
- `src/main.tsx`: bu stilin import'u.
- `scripts/test-login-desktop-layout.mjs`: gerçek derlenmiş `/login` üzerinden önce/sonra, responsive, tema ve bağlantı regresyonu.
- Bu rapor.

AuthView, PhoneCentricLoginPanel, WebWelcome, mevcut tema CSS'i, auth/API kodu, paketleme scriptleri ve lockfile koruma SHA-256 kontrolünde fark 0. Native dosyalar değiştirilmedi.

## 3. Yeni kompozisyon

- Birleştirilmiş, en fazla 1240px genişlikte çerçeve; sol/sağ oranı 42/58. Giriş alanına bilinçli olarak daha fazla yer verildi.
- Sağ alanda mevcut tema değişkenleriyle hafif nötr gradient; kart 450px yerine 520px, 18px köşe, kontrollü padding ve ince sınır.
- Hero başlığı 66px'e kadar büyüyen yapı yerine en fazla 44px; dar satır uzunluğu, okunaklı açıklama ve daha sade adımlar.
- Marka metni hero içinde iki temada da beyaz ve okunabilir.
- Fotoğraf dış kenarlardan kaldırılarak hero içinde tek `cover` yüzeyine taşındı; crop 61% center. Overlay başlangıcı rgba(13,53,40,.90), bitişi rgba(9,38,32,.78). Görsel dosyası değiştirilmedi/esnetilmedi.
- Kısa desktop viewport'ları için padding azaltılır. Sabit maksimum kart yüksekliği veya içeriği keserek küçültme kullanılmaz; uzun doğrulama/hata içerikleri gerektiğinde büyüyebilir.
- Geri dönüş, yardım/yasal bilgiler ve lisans/iletişim işlemleri korunur.

## 4. Açık/koyu görseller

Dosyalar `.cache/login-desktop-review/before` ve `after` içinde.

- Önce açık: `before/chromium-light-1440.png`
- Sonra açık: `after/chromium-light-1440.png`
- Önce koyu: `before/chromium-dark-1440.png`
- Sonra koyu: `after/chromium-dark-1440.png`
- Chromium/WebKit için 1920, 1440, 1366 ve 390px son görüntüler ayrıca üretildi.

Açık/koyu masaüstü görüntüleri açılarak incelendi. Test verileri yok; giriş boş form üzerinden görüntülendi. Telefon testi yalnız izole tarayıcı alanına sentetik değer yazar, OTP isteği göndermez.

## 5. Responsive ve işlev testi

Chromium ve WebKit, açık/koyu temalar: 1920×1080, 1440×900, 1366×768, 1024×768, 768×1024, 430×932, 390×844, 375×812 — PASS.

1024px ve altındaki 20 geometri örneği başlangıçla birebir aynı. 390px'deki dört mobil PNG (iki tema × iki engine) başlangıç SHA-256 değerleriyle birebir aynı. Yatay taşma yok. Desktop çerçeve ve kart oranları ölçülerek doğrulandı.

Tema değişirken telefon alanının içeriği ve `/login` route'u korunuyor. Yardım ve Lisans/İletişim butonları gerçek sayfalarını açıyor. Sıfır HTTP yazma/OTP isteği, sıfır browser runtime hatası.

## 6. Teknik sonuçlar

| Kontrol | Sonuç |
|---|---|
| npx tsc --noEmit | PASS |
| npm run build:production-package | PASS |
| Client/server build ve release artifact safety | PASS |
| Dört bağımsız Function ZIP runtime testi | PASS |
| Paketlenmiş API + gerçek frontend, capability/502/retry | PASS |
| npm run test:whatsapp-login-ui | PASS |
| test-web-theme-boundary.ts | PASS |
| Masaüstü yerleşim testi, Chromium/WebKit | PASS |
| Tablet/mobil önce-sonra eşitliği | PASS |
| Korunan auth/tema/paketleme dosyalarının SHA-256 kontrolü | PASS |

API, appointment-reminders, license-reminders-background ve license-reminders ZIP SHA-256 değerleri önceki doğrulanmış paketle aynı kaldı. serverless-http/pg paketleme mekanizması değişmedi; ZIP'ler yeniden izole olarak çalıştırıldı.

## 7. Yayın hazırlığı

Bu masaüstü UI düzeltmesi yerel kontroller açısından hazır. Production'a gönderilmedi. Önceki release raporundaki bağımsız uyarılar (web kaynağında eksik native shell config'i, iki mevcut orta seviye bağımlılık uyarısı ve fiziksel cihaz doğrulaması) bu görevde çözülmüş sayılmaz.

Gerçek derlenmiş giriş için yerel önizleme: http://127.0.0.1:4179/login . Yalnız capability yanıtı taklit edilir; gerçek OTP/production API kullanılmaz.

## 8. Güvenli PowerShell yayın komutu

Yalnız ayrıca yayın onayı alındıktan sonra; bu görevde çalıştırılmadı:

```powershell
Set-Location 'C:\Users\XIO\Documents\Codex\veli-randevu-auth-runtime-hotfix-20261029'
npm run build:production-package
if ($LASTEXITCODE -ne 0) { throw 'Paket doğrulanamadı; yayın durduruldu.' }
netlify deploy --prod --site f15fdc98-3bb3-4f0d-88ca-bb8c685ffaea --dir release/client --functions netlify/functions --no-build --message 'Balance desktop WhatsApp login layout'
```

Bu komut aynı release klasöründeki önceki yerel entegrasyonları da içerir; sadece iki CSS değişikliğini otomatik ayıklayan bir deploy değildir. Yayın öncesi güncel production ile tüm paket kapsamı ayrıca teyit edilmelidir. Son doğrulanan sağlıklı production ID'si önceki raporda 6ae342e13fc1e501a18f7b31; bu görevde yeni deploy yapılmadı.
