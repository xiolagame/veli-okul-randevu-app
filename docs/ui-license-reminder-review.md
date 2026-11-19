# UI ve lisans hatırlatmaları — yerel kontrol raporu

> Güncelleme: Bu rapordaki izin kayıtlarını yok sayan alıcı kuralı, `license-reminder-consent-safety-review.md` ile düzeltilmiştir. Güncel izin/gönderim değerlendirmesi için yeni rapor geçerlidir; görsel düzeltmeler korunmuştur.

Tarih: 29 Ekim 2026. Çalışma: `C:/Users/XIO/Documents/Codex/veli-randevu-web-welcome-20261029`.
Son yayınlanan web paketinin izole kaynak klasöründe çalışıldı. Bu klasör Git worktree değildir; ana Git worktree, codemagic.yaml ve AGENTS.md düzenlenmedi.

## Nedenler ve düzeltmeler

- `web-scene.css`, okul/yönetim sahnesine `#f6f8f7c9` ve `#f6f8f7d9` beyaz katmanlarını uyguluyordu. Bunlar, 115 derece koyu yeşil/antrasit gradient ile değiştirildi: `rgba(6,59,33,.64)` → `rgba(19,32,49,.52)`. Fotoğraf aynı; kart yüzeyleri beyaz ve opak kaldı. Fotoğraf üzerindeki hızlı işlem düğmeleri ve platform üst başlığı için okunabilir koyu yüzey/beyaz yazı kullanıldı.
- Web kökünün, body'nin ve güvenli alanların arkasındaki temel renk tek değere (`#071b16`) bağlandı. `min-height:100vh` / `100dvh` ve dikey overscroll kontrolü eklendi. Sayfanın doğal kaydırılması, yakınlaştırma ve form erişimi kilitlenmedi.
- Giriş arka planındaki `100% 100%` esnetme kaldırıldı. Görsel, sabit ve tıklamaları engellemeyen ayrı bir pseudo-element üzerinde `cover` ile gösteriliyor. Mobil odak noktası `%65 center`; safe-area iç boşlukları korunuyor. Giriş, video ve OTP mantığı değişmedi.
- Manuel önizleme, onay, otomatik tarama ve gönderim öncesi kontrollerin kullandığı ortak `resolveLicenseRecipients()` artık lisans bildirimi için ayrı izin kaydına bağlı değil. İzin kaydı yokluğu, eski geri çekme kaydı veya eski telefon fingerprint'i lisans alıcısını elemiyor. Güncel telefon fingerprint'i doğrudan güncel telefondan hesaplanıyor; açık önizleme sırasında telefon değişirse işlem yine duruyor.
- Aktif okul yöneticisi üyeliği, doğrulanmış ve normalize edilebilir telefon, Platform Admin hesabının okul alıcısı olmaması, canonical telefon tekilleştirmesi korunuyor. Geçersiz/doğrulanmamış telefonlar hâlâ eleniyor.
- Lisans panelindeki izin sayacı kaldırıldı; uygun yönetici sayacı yeni kurala göre adlandırıldı. Hesabım alanında artık etkisiz bir izin kutusu yerine yeni iş kuralını açıklayan bilgi gösteriliyor.
- Eski tercih API sözleşmesi ve kayıtları geriye dönük uyumluluk için korunuyor. Bu kayıtlar lisans alıcı seçiminde kullanılmıyor; hiçbir tercih kaydı otomatik olarak onaylanmış gibi güncellenmedi. Diğer iletişim tercihleri değişmedi.

## Değişen kaynak ve test dosyaları

1. `src/components/web-scene.css`
2. `src/components/web-welcome.css`
3. `src/components/LicenseWhatsAppPanel.tsx`
4. `src/components/LicenseWhatsAppPreference.tsx`
5. `server/license-reminders.ts`
6. `scripts/test-license-whatsapp-reminders.ts`
7. `scripts/test-license-reminder-api.ts`
8. `scripts/test-license-reminder-ui.mjs`
9. `scripts/test-web-background-ui.mjs` (yeni)

API testi önceden kullanılan PGlite dizinindeki sentetik okul kayıtlarıyla çakıştı. Test, her çalıştırmada boş geçici dizinde kendi şemasını oluşturarak izole çalışacak şekilde düzeltildi. Mevcut yerel veritabanı silinmedi.

## Son test sonuçları

| Kontrol | Sonuç |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run build` (client + server + release artifact safety) | PASS |
| `npx tsx scripts/test-license-whatsapp-reminders.ts` | PASS |
| `npx tsx scripts/test-license-reminder-api.ts` | PASS |
| `node scripts/test-license-reminder-ui.mjs` | PASS |
| `node scripts/test-web-background-ui.mjs` — Chromium ve WebKit | PASS |
| `node scripts/test-web-scene.mjs` | PASS |
| `node scripts/test-web-welcome.mjs` | PASS |
| `scripts/test-whatsapp-auth.ts` — boş izole PGlite dizini | PASS |
| `scripts/test-production-auth-guards.ts` — yerel HTTP sunucusu | PASS |
| `scripts/test-school-license.ts` — boş izole PGlite dizini | PASS |
| `npx tsx scripts/test-identity-auth-attempts.ts` | PASS |
| `npm run test:mobile-platform` | PASS |
| Snapshot karşılaştırmasında `git diff --no-index --check` (CRLF destekli) | PASS |

Lisans testlerinde ayrı izin kaydı olmayan yöneticiye hem otomatik hem manuel SAHTE sağlayıcı gönderimi, eski kapalı tercih, güncel telefon, önizleme sonrası telefon değişikliği, yeni/pasif yöneticiler, tekil telefon, tenant/aktör ayrımı, lisans yenileme, cooldown, çift onay, eşzamanlı görev ve belirsiz sonuçta tekrar göndermeme doğrulandı. API kabulü teslimat olarak gösterilmiyor.

Görsel testler: 1920×1080, 1440×900, 1366×768, 768×1024, 430×932, 390×844 ve 375×667. Klavye için daraltılmış 390×480 viewport'ta form düğmesine erişim de test edildi. Gerçek AdminView sentetik okul/API ile render edildi. Chromium ve WebKit ekran görüntüleri açılıp incelendi.

## Önizleme ve kanıtlar

- Yerel adres: `http://127.0.0.1:4174/login`
- Yerel komut: proje klasöründe `node scripts/preview-web-welcome.mjs`
- Bu sunucu gerçek OTP gönderimini ve veritabanı erişimini kapatır. Dashboard/panel testleri sentetik fixture üzerinden yapılır.
- Görseller: `.cache/ui-reminder-review/dashboard-chromium-1366.png`, `dashboard-webkit-390.png`, `login-webkit-390.png`.
- Build ve regresyon logları: `.cache/ui-reminder-review/`.

## Canlıya geçmeden önce

- Migration veya production veri patch'i gerekmiyor. Yeni alıcı kuralı backend güncellemesiyle çalışacak; frontend tek başına yayınlanırsa sayaçlar düzelmez.
- Mevcut üç gönderim bayrağı bu görevde değiştirilmedi. Canlı bayraklar açık olduğundan yeni backend yayınlandığında daha önce ayrı izin kaydı bulunmayan yöneticiler de alıcı olabilir. Bu genişleyen alıcı kapsamı yayın öncesi değerlendirilmelidir.
- WhatsApp Business Messaging Policy, iletişim izni ve iletişimi durdurma taleplerine uyulmasını ister: https://whatsappbusiness.com/policy/ . Panelde ayrıca lisans onayı istememek, izinlerin başka uygun bir yolla alınmış olduğunu tek başına kanıtlamaz. Özellikle eski geri çekme kayıtlarının yeni iş kuralında engel olmaması canlıya geçiş öncesi değerlendirilmelidir. Bu çalışma mevzuat veya sağlayıcı uyumluluğu onayı değildir.
- Gerçek iPhone Safari'de adres çubuğu açılıp kapanması, fiziksel bounce/safe-area ve ekran klavyesi testi hâlâ gereklidir. WebKit testi fiziksel cihaz testi olarak raporlanmadı.
- Build'de mevcut statik/dinamik API import uyarısı var; build engeli değil.

Production bağlantısı, environment değişikliği, deploy, commit, push, migration uygulaması veya gerçek WhatsApp/e-posta gönderimi yapılmadı.
