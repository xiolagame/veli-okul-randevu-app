# WhatsApp lisans hatırlatmaları — UX ve izin akışı

29 Ekim 2026. Yerel kaynak: `C:/Users/XIO/Documents/Codex/veli-randevu-auth-runtime-hotfix-20261029`.

## Tamamlananlar

- WhatsApp Lisans Hatırlatmaları penceresi 820 px genişlikte, sabit başlık/kapatma alanı ve yalnız içerik bölümünde kaydırma ile düzenlendi. Mobilde iki sütunlu özet kartları ve tek sütunlu lisans planı kullanılıyor.
- Dört özet: aktif yönetici, tekil uygun alıcı, izin kanıtı eksik yönetici ve gerçek son gönderim durumu.
- Lisans bitişi, sonraki zaman, 7/3/1 gün planı ve Türkiye 09.00 saati ayrı bölümde. Backend'in verdiği tarih ve açık/kapalı durumları kullanılıyor.
- Alıcı uygunluğu, eksik izin, açık geri çekilme, telefon değişikliği/doğrulama sorunu ve aynı telefonun tekilleştirilmesi ayrı gösteriliyor. Telefonlar maskeli.
- Geçmiş ve manuel işlem kayıtları açılabilir, klavyeyle erişilebilir bölümlerde. Alıcı bazlı sonuçlar ile işlem bazlı gerçek alıcı sayıları birbirine karıştırılmıyor; sahte geçmiş üretilmiyor.
- API kabulü, işleniyor, teslim edildi, başarısız ve belirsiz durumlar ayrı. Webhook yokluğu açıkça yazıyor; API kabulünden teslimat türetilmiyor.
- Uygun alıcı yoksa gönderim düğmesi pasif ve nedeni görünür. Manuel önizleme ve açık gönderim onayı korunuyor. Bu onay iletişim izni yerine geçmiyor.
- React StrictMode altında mounted-ref sorunu düzeltildi. Önizleme açılınca odak önizlemeye, kapanınca pencere içine dönüyor. Açılabilir summary alanları odak tuzağına dahil. Escape, kapatma ve işlem sürerken kapatma koruması test edildi.

## İzin kazanma yolu

Web okul yöneticisi üst menüdeki **Lisans bildirimleri** düğmesiyle doğrudan kendi Hesabım tercihine erişebilir. Bu düğme veli/öğretmen/güvenlik/Platform Admin veya native Android/iOS için eklenmez.

Hesabım alanında:

- İzin vermek açık **WhatsApp lisans hatırlatmalarına izin ver** eylemiyle yapılır.
- İzin geri çekmek ayrı **İznimi geri çek** eylemidir.
- Önceden işaretlenmiş veya zorunlu onay yoktur; sayfanın açılması kayıt oluşturmaz.
- Geçerli izin tekrar istenmez. Eksik, geri çekilmiş, değişmiş telefon ve geçersiz kanıt durumları ayrılır.
- Kayıt başarısızsa etkinmiş gibi gösterilmez; hata ve yeniden deneme yolu vardır.
- Mevcut kayıt endpoint'i okul/kullanıcı/telefon fingerprint'i, izin zamanı/kaynağı ve audit kaydını zaten tutar. Bunlar değiştirilmedi.
- Mevcut GET cevabına yalnız kullanıcının kendi kaydının `consentStatus` bilgisi eklendi; eski alanlar korunuyor. Başkası adına izin verme yetkisi eklenmedi.

**Yeni yönetici aktivasyonu:** OTP/e-posta/okul kodu ekranına yeni bir checkbox veya zorunlu adım eklenmedi. Yeni yönetici, aktivasyonu tamamlandıktan sonra üst menüdeki aynı tek tıklamalı yolla tercihini isteğe bağlı kaydedebilir. İzin vermemek aktivasyonu veya girişi engellemez. Bu fazda aktivasyon esnasında izin toplama geliştirilmedi; auth davranışı korundu.

Geçerli başka kanaldan gelen izin kanıtını otomatik aktaran ek bir kaynak bulunmadı. Mevcut okul/kullanıcı/telefon kapsamlı tablo ve audit mekanizması kullanılır. Eksik kayıtlar onaylı sayılmadı; geri çekme kayıtları silinmedi veya otomatik açılmadı.

## Korunan güvenlik ve native davranış

`server/license-reminders.ts` ortak alıcı çözümleyicisi byte düzeyinde değişmedi. Manuel/otomatik akışlar aynı doğrulanmış üyelik/telefon/izin kontrollerini, cooldown, idempotency, concurrency ve lisans yenileme korumalarını kullanır. Gönderim, zamanlayıcı, OTP, JWT ve RLS kodu değiştirilmedi.

Yeni tasarım WEB ortamına ayrıldı. `.native.tsx` uyumluluk bileşenleri önceki modal/tercih uygulamasını aynen korur; yalnız export adı farklıdır. Android/iOS runtime fixture testleri eski modal/tercih kontrollerinin açıldığını doğrular. iOS/Android proje dosyaları ve uygulama paketleri değiştirilmedi; gerçek cihaz testi yapılmadı.

Dashboard fotoğrafı/overlay'i, mobil giriş/safe-area CSS'i ve Netlify function paketleme aracı hash karşılaştırmasıyla değişmeden kaldı.

## Test sonuçları

| Kontrol | Sonuç |
| --- | --- |
| TypeScript | PASS |
| Production client/server build ve release artifact safety | PASS |
| Dört function ZIP'inin depodan bağımsız açılması ve yüklenmesi | PASS |
| Gerçek frontend + ZIP API capability/health ve 502/retry regresyonu | PASS |
| `test-license-whatsapp-reminders.ts` — sentetik PGlite/sahte sağlayıcı | PASS |
| `test-license-reminder-api.ts` — izin, tenant, self-service, audit ve yeni status alanı | PASS |
| `test-license-reminder-ui.mjs` — Chromium ve WebKit | PASS |
| `test-license-permission-entry-ui.mjs` — web okul yöneticisi erişimi, diğer roller/native hariç | PASS |
| `test-license-reminder-presentation.ts` — gerçek teslimat/API kabulü ayrımı | PASS |
| WhatsApp auth ve production auth guard regresyonları | PASS |
| Identity attempts/iki faktör/replay/concurrency/revocation | PASS |
| Değişen dosyalarda whitespace kontrolü ve korunan dosya hash'leri | PASS |

Modal genişlikleri: 375, 390, 430, 768, 1024, 1440 ve 1920 px; Chromium ve WebKit. Modal viewport içinde, başlık scroll sırasında aynı konumda, içerik scrollable, yatay taşma yok. Klavye odağı ve Escape doğrulandı. İşlem sürerken çift tıklama ikinci gönderim üretmedi. Sıfır alıcıda buton devre dışı ve açıklama görünür. Native fallback testleri ANDROID ve IOS değerleriyle yapıldı.

İlk test çalıştırmalarındaki harness sorunları giderildi: Navbar testinde import.meta.env derleme tanımı, requestAnimationFrame sonrası odak bekleme ve build temizliğiyle paralel asset okuma yarışı. Testler sırasıyla tekrar çalıştırılıp PASS alındı; bunlar production hatası olarak raporlanmıyor.

## Görseller ve önizleme

Ekran görüntüleri sentetik verilerle üretilmiştir; gerçek gönderim sonucu değildir.

- Önce: `.cache/license-ux-before/screenshots/license-whatsapp-1440.png`, `license-whatsapp-390.png`.
- Sonra: `.cache/release-review/license-whatsapp-chromium-1440.png`, `license-whatsapp-chromium-390.png`.
- WebKit: `.cache/release-review/license-whatsapp-webkit-1440.png`, `license-whatsapp-webkit-390.png`.
- Görseller açılarak incelendi.
- Yerel sentetik önizleme: `http://127.0.0.1:4175`. Lisans Yönetimi'ndeki WhatsApp Hatırlatmaları düğmesini açın. Sayfada sentetik önizleme uyarısı vardır; gerçek API/veritabanı/mesaj kullanılmaz.
- Başlatma: `PLAYWRIGHT_MODULE` yerel Playwright modülüne ayarlanarak, `LICENSE_UI_PREVIEW=true` ile `node scripts/test-license-reminder-ui.mjs`.

## Değişen dosyalar

1. `src/components/LicenseWhatsAppPanel.tsx`
2. `src/components/LicenseReminderContent.tsx` (yeni)
3. `src/components/license-whatsapp.css` (yeni, web kapsamlı)
4. `src/components/LicenseWhatsAppPreference.tsx`
5. `src/components/Navbar.tsx`
6. `src/components/LicenseWhatsAppPanel.native.tsx` (mevcut native görünümü koruyan kopya)
7. `src/components/LicenseWhatsAppPreference.native.tsx` (mevcut native davranışı koruyan kopya)
8. `src/services/api.ts`
9. `server/license-reminder-api.ts` (yalnız GET status bilgisi)
10. `scripts/test-license-reminder-ui.mjs`
11. `scripts/test-license-reminder-api.ts`
12. `scripts/test-license-permission-entry-ui.mjs` (yeni)
13. `scripts/test-license-reminder-presentation.ts` (yeni)

## Yayın durumu ve gerekenler

Yerel paket teknik testlerden geçti. `release/client` ve dört `release/functions` ZIP'i birlikte güncellendi; `release/artifact-manifest.json` SHA-256 özetlerini içerir. Eksik serverless-http/pg hatasını yakalayan bağımsız ZIP testleri PASS.

Bu görevde production health salt okunur kontrolde 200/ok/connected döndü. Yeni UX canlıya yayınlanmadı. Yayın için ayrıca onay gerekir. Yeni migration veya toplu izin patch'i gerekmiyor. Yayın sonrasında okul yöneticisinin kendi izin verme/geri çekme akışı, Platform paneli ve maskeli alıcı sayaçları kontrollü olarak doğrulanmalı; gerçek manuel mesaj kullanıcı onayı olmadan gönderilmemeli. Fiziksel iPhone Safari kontrolü ayrıca önerilir; WebKit testi fiziksel cihaz testi değildir.

Production deploy, migration, canlı veri yazma, gerçek WhatsApp gönderimi, feature flag değişikliği, commit veya push yapılmadı. Ana kirli Git worktree korunmuştur.
