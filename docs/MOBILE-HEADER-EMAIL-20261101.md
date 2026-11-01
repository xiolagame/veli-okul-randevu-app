# Mobil header, kod e-postaları ve bildirim metinleri

1 Kasım 2026. Çalışma klasörü: `C:\Users\XIO\Documents\Codex\veli-staff-otp-master-20261031`; dal: `feature/staff-otp-master-20261031`; HEAD: `ecbedc4fac7d657fff147d647625736c7be29c05`. Önceki geliştirmeler korundu. Commit/push/merge, production deploy, canlı Supabase/migration, gerçek mesaj, IPA/AAB veya Codemagic/mağaza işlemi yapılmadı.

Production referansı **`6ae6e5ae8705ada49da1aff1` kullanıcı bildirimi olarak esas alındı**. Yerel arşiv manifesti daha eski bir kaynağa aittir; bu görevde canlı production sorgulanmadı ve bu deploy ile byte düzeyinde eşitlik kanıtlanmadı. Git main'in production ile aynı olduğu varsayılmadı.

## Yapılanlar

- Mobil logo, ürün adı ve sağ ikonlar tek satırda. Okul adı logo/yazının altında kısaltılmış görünür; aynı kimlik alanındaki 44 px hedef okul seçimini açar. Tam ad okul penceresinde korunur. Uzun isimler taşmaz. Desktop okul seçimi ve hesap/rol akışları korunur.
- Tema iki buton yerine **tek ikon butonu**: açık temada güneş, koyu temada ay. Erişilebilir etiket sonraki eylemi, tooltip aktif temayı anlatır; klavye Enter ve görünür focus kontrol edildi. `veli.theme` kalıcılığı, iOS varsayılan açık tema ve native status-bar olayları değişmedi.
- Bildirim/güvenlik/hesap ikonları hizalı; büyük okunmamış sayısı görselde `99+`, erişilebilir etikette gerçek sayı olarak kalır. Bildirim callback'leri ve menüler korunur; push içerikleri değiştirilmedi.
- Mobil header iç yüksekliği web/iOS CSS benzetiminde **56 px**, Android'de **60 px**. iOS/web ikon hedefleri 44, Android mobil hedefleri 48 CSS px. Bu ölçüler OS birimleriyle fiziksel cihaz doğrulaması değildir. Sticky header ve yönetim overlay'i safe-area üst boşluğunu birlikte hesaba katar; sentetik 44 px inset ile çakışma testi geçti.
- Ortak e-posta sırası: **logo + kısa başlık → büyük kod → Merhaba/açıklama → süre ve güvenlik → varsa ikincil okul/lisans bilgileri**. HTML ve düz metin kodu açıklamanın üstüne alır. Mevcut 5/6 haneli kod uzunlukları, süreler, HMAC/tek kullanım ve iki faktör bağımsızlığı korunur.
- Gizli preheader HTML'nin başındadır: inline `display:none`, `mso-hide`, sıfır boyut/overflow ve görünmez dolgu kullanılır. Böylece uzun gövdenin önizlemeye taşması azaltılır. İçerik escape edilir; kullanıcı verisi HTML olarak çalışmaz. Mobil tablo genişliği, uzun metin sarma ve 34 px kod okunaklılığı kontrol edildi.
- Eski parola-reset hata logger'ının raw error nesnesi kaldırıldı; genel mesaj kalır. Kod/token/e-posta gövdesi loglanmaz. Sağlayıcı, alıcı, kuyruk/idempotency ve gönderim hata davranışları değiştirilmedi.

## E-posta envanteri

| Mevcut gönderim | Yeni konu / önizleme |
|---|---|
| Okul yöneticisi davet/reset; WhatsApp sonrası yönetici e-posta faktörü; platform login, telefon bağlama ve ilk e-posta doğrulaması; inline yönetici reset | `Doğrulama kodunuz: {kod}`; gizli önizleme de kodla başlar. Gerçek kodlar rapora/loglara yazılmadı. |
| Öğretmene yeni randevu talebi | `Yeni randevu talebiniz var`; kısa talep/inceleme önizlemesi |
| Öğretmene mevcut 30 dakika hatırlatması | `30 dakika sonra randevunuz var`; kısa görüşme hatırlatması |
| Destek yanıtı / yeni mesaj / talep / alındı bildirimi | Kısa, türe özgü konu; önizleme ilk açıklama cümlesinden. Tekrarlanan marka öneki kaldırıldı. |
| Hesap silme tamamlandı bildirimi | `Hesap silme işlemi tamamlandı`; kısa tamamlanma açıklaması |

Kaynakta **randevu onayı/iptali için ayrı e-posta gönderimi yok**. Mevcut uygulama içi/push kanalları vardır; bu görevde yeni e-posta türü veya yeni otomatik gönderim eklenmedi. Tüm mevcut `sendEmail` noktaları ortak şablon üzerinden incelendi; Netlify aynı sunucu kodunu kullanır.

## Testler

| Kontrol | Sonuç |
|---|---|
| Frontend TypeScript + ilgili backend `tsc` | PASS |
| Production web/server build ve release artifact güvenliği | PASS; son e-posta düzeninden sonra server bundle da yeniden üretildi |
| Header: 5 rol × 9 genişlik × 2 tema × 3 runtime CSS | **270 görünüm PASS**; 320–1440 px, uzun okul/kullanıcı adları, taşma/çakışma yok, hedef boyutları, bildirim/platform callback'i, okul/hesap menüsü, klavye ve kalıcılık |
| Kod e-postası render/gönderim örnekleri | **7 fixture PASS**; mock alıcılar, subject, gizli preheader, HTML/text sırası, süre/tek kullanım ve escape |
| E-posta mobil HTML | **35 görünüm PASS**; 320/375/390/430/768 px, kod ilk viewport'ta ve karşılama üstünde, preheader görünmez, yatay taşma yok |
| Mevcut regresyon paketi | **24/24 PASS**, Node 24.17.0; auth/OTP, roller/tenant, QR/randevu, push ve hesap silme |
| Platform telefon bağlama / tekrar iki faktörlü login | PASS; e-posta ile WhatsApp kodları bağımsız kalır |
| Unified WhatsApp login + identity attempts | PASS; ilk aktivasyon, admin kilidi/race, sonraki login, süre/replay/HMAC/session kontrolleri |
| Öğretmen yeni randevu e-postası / email-review / silme | PASS; gerçek yerel API/SQL, sağlayıcı mock, güncel adres ve yetki zinciri |
| Ayarlar/hatırlatma | PASS; doğru konu/preheader, sadece uygun randevular, tekrar göndermeme, sağlayıcı hata/retry davranışı |
| Destek konuşmaları / talep merkezi | **90 ve 129 kontrol PASS**; tenant, yetki, idempotency ve e-posta davranışı |
| Rol ve tema ekranları | **186 sahne PASS**; ölçülen temel metin kontrastı, role ait paneller/modallar/lisans ekranları |
| Login/Yardım/Lisans temaları | **64 vaka PASS**; tercih saklama/reload |
| Tema bootstrap | **40 vaka PASS**; iOS kayıtlı tercih yoksa light, manuel tercihi koruma, Android/web sistemi koruma |
| iOS/Android sync ve paket UI | PASS; 56 dosyalık web paketleri, iOS exact parity, onaylı giriş tasarımı/tema/OTP ve native'de video olmaması. Binary üretilmedi. |
| Önceden mevcut CORS satırı | PASS; yerel web/iOS/Android OPTIONS 200 ve izin verilen header/origin kontrolleri; veri sorgusu/OTP gönderimi yok |

Komutlar: `npm run lint`, `npm run build`, `npm run build:server`, ilgili backend `tsc`, `node scripts/test-compact-navbar.mjs after`, `node --import tsx scripts/test-email-presentation.ts`, `node scripts/test-email-mobile.mjs`, mevcut `run-ios-regressions.mjs`, ilgili auth/notification testleri, `npm run ios:sync:review`, `verify-ios-web-package.mjs`, `npm run android:sync:review`, `test-store-review-login.mjs ios/android`. Playwright mevcut yerel runtime'dan kullanıldı.

Çıktılar `audit/master/header-*`, `mail-*`; sentetik HTML/PNG'ler `audit/header-mail/` altında. Bu log/artifact dizinleri Git'e alınmaz. İlk eski-test beklentileri (CORS 204 ve emekli personel aktivasyonu) mevcut onaylı davranışa göre düzeltildi; güvenlik assertion'ları atlanmadı. Tek tema butonuyla manuel seçim testi gerçek açık→koyu tıklamaları kullanır. Build temizliğiyle çakışan bir görsel test build sonrasında yeniden çalıştırıldı.

## Değişen dosyalar

- UI: `src/components/Navbar.tsx`, `ThemeSwitcher.tsx`, `ui.tsx`, `src/index.css`, `src/theme.css`.
- E-posta: `server/email-template.ts`, `school-admin-email.ts`, `appointment-email.ts`, `appointment-reminders.ts`, `platform-requests.ts`, `account-deletion.ts`; inline reset ve güvenli logger için `server/api.ts`.
- Yeni testler: `scripts/test-compact-navbar.mjs`, `test-email-presentation.ts`, `test-email-mobile.mjs`.
- Uyarlanan mevcut testler: `test-admin-navigation-performance.mjs`, `test-android-auth-startup.mjs`, `test-review-role-themes.mjs`, `test-theme-ui.mjs`, `test-store-review-login.mjs`, `test-school-roster-ui.ts`, `test-settings-email-reminders.ts`, `test-student-removal-and-appointment-email.ts`, `test-support-conversations.ts`, `test-platform-requests.ts`.
- Kaynak izlenebilirliği: bu rapor, `audit/staff-otp-overlay.json`, `audit/ios-source-lock.json`.
- **Önceden mevcut değişiklik:** `server/app.ts` içindeki `optionsSuccessStatus: 200` satırı değiştirilmeden korundu ve kaynak kilidinin gerçek yerel kaynakla eşleşmesi için incelemeye dahil edildi. Bu görev yeni CORS yetkisi/origin eklemedi.

## Eksikler ve teslim sınırı

**NOT TESTED / BLOCKED:** gerçek Gmail/iPhone Mail ve OS bildirim önizlemesi, fiziksel iPhone/iPad/Android/WKWebView/safe-area, native IPA/AAB ve gerçek push/e-posta teslimatı. HTML/Chromium ve runtime fixture sonuçları gerçek cihaz sonucu değildir. Konu ve preheader optimize edildi; işletim sisteminin yalnız kodu göstereceği garanti edilmez.

Bağımlılık, Bundle ID, imzalama, WhatsApp/prod auth protokolü, lisans/tenant iş kuralları veya yeni bildirim kanalı değiştirilmedi. Yeni anahtar/sertifika/GitHub işlemi yok. Deploy ve gerçek mobil derlemeler için kullanıcı onayı beklenir.

Kaynak bütünlüğü: **498/498 PASS**; exact-hash overlay ve negatif metin/binary mutasyon testleri PASS. Temiz Git index export denetimi de uygulanmıştır. Önceki çalışmalar dahil **112 staged dosya** vardır; yeni commit yok, HEAD değişmedi. Hassas dosya/build çıktısı staging kapsamına alınmadı.
