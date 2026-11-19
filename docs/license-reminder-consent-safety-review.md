# WhatsApp lisans hatırlatmaları — son izin güvenliği kontrolü

29 Ekim 2026. Yerel paket: `veli-randevu-web-welcome-20261029`.

Bu rapor, `ui-license-reminder-review.md` içindeki izin kayıtlarını yok sayan yerel iş kuralını güvenlik açısından düzeltir. Önceki raporun bu konudaki davranışı artık geçerli değildir. Dashboard/mobil arka plan düzeltmeleri değiştirilmedi.

## 1. Risk giderildi mi?

Yerel kodda evet. Ortak `resolveLicenseRecipients()` yalnızca ilgili okul ve kullanıcıya bağlı, güncel telefon fingerprint'iyle eşleşen, geçmiş veya şimdiki tarihli, boş olmayan izin referansı taşıyan ve geri çekilmemiş kayıtları kabul eder.

- Kayıt yok: `CONSENT_REQUIRED`.
- Açık geri çekilme: `CONSENT_REVOKED`; eksik izinle aynı durum değildir.
- İleri tarihli/bozuk kanıt: `CONSENT_INVALID`.
- Telefon değişmiş: `PHONE_CONSENT_CHANGED`.
- Telefon doğrulanmamış: `PHONE_NOT_VERIFIED`.
- Aynı okulda aynı telefona bağlı aktif başka bir hesap açıkça iznini geri çekmişse, ikinci hesapla bu engel aşılamaz.

Manuel önizleme, onay, otomatik tarama ve sağlayıcı çağrısı öncesi son kontrol aynı seçiciyi kullanır. Aktif yönetici üyeliği, Platform Admin ayrımı, okul kapsamı, telefon tekilleştirme, cooldown ve kalıcı mükerrer gönderim korumaları korunmuştur. Sağlayıcı çağrısından önce son izin kontrolü transaction içinde yapılır; izin değişikliği de mevcut okul kilidini kullanır.

## 2. Lisans panelinde ek onay gerekiyor mu?

İletişim izni için ek bir kutu yoktur. Geçerli mevcut kanıt tekrar onay gerektirmez. Manuel mesajın kendisi için mevcut açık gönderim onayı korunur; bu iletişim izni yerine geçmez.

## 3. Hangi mevcut sistem kanıtlıyor?

Kodda doğrulanabilen kanonik kaynak `school_license_reminder_recipients`:

- `(school_id,user_id)` ile okul/kullanıcı kapsamı;
- `phone_fingerprint` ile doğrulanmış güncel telefon bağı;
- `consent_at`, `consent_reference`, `revoked_at`;
- Hesabım üzerinden yetkilendirilmiş `/auth/me/license-reminder-preferences/:schoolId` GET/PUT;
- `license.whatsapp_consent_changed` audit kaydı.

Kaynak kodda başka bir iletişim izni sağlayıcısından veya genel tercih sisteminden lisans WhatsApp izni aktaran bir entegrasyon bulunmadı. OTP başarısı, telefon bağlama, okul üyeliği veya e-posta doğrulaması bu amaç için izin kanıtı sayılmadı. Production tablosundaki tekil kayıtlar ve harici belgeler incelenmedi; başka kanalda gerçekten izin alındığı iddia edilmiyor.

Mevcut tabloda güvenilir başka kanala ait, lisans WhatsApp kapsamı doğrulanmış kanıt zaten kayıtlıysa ayrı panel onayı olmadan aynı doğrulama kurallarıyla kullanılabilir. Sentetik testte böyle bir kaynak referansı kullanıldı; bu gerçek dış kanal entegrasyonu veya gerçek belge doğrulaması değildir.

## 4. Güvenli izin kazanma

Kanıt yoksa mesaj gönderilmez. Yeni bir lisans paneli onay kutusu gerekmez: yönetici mevcut Hesabım akışında kendi aktif üyeliği ve doğrulanmış telefonu için WhatsApp lisans bildirimleri tercihini açıkça kaydedebilir. Bu işlem okul/kullanıcı/telefon bağı, tarih, kaynak ve audit kaydı oluşturur; gerçek mesaj göndermez. Aynı yerden geri çekilebilir.

Harici bir izin belgesi varsa önce kimlik, telefon, okul, mesaj kanalı ve lisans bildirimi kapsamı, tarih ve geri çekilme durumu yetkili kişi tarafından doğrulanmalıdır. Kodda bu belgeleri içeri alan ayrı bir araç bulunmadığından otomatik içeri alma veya toplu etkinleştirme yapılmadı. Eldeki belirsiz kayıtlar onaylanmış sayılmadı.

## 5. Testler

| Test | Sonuç |
| --- | --- |
| `npx tsx scripts/test-license-whatsapp-reminders.ts` | PASS |
| `npx tsx scripts/test-license-reminder-api.ts` | PASS |
| `node scripts/test-license-reminder-ui.mjs` | PASS |
| `npx tsc --noEmit` | PASS |
| `npm run build` (client/server ve release artifact safety) | PASS |
| `test-whatsapp-auth.ts` — boş izole PGlite dizini | PASS |
| `test-production-auth-guards.ts` — yerel sunucu | PASS |
| Snapshot `git diff --no-index --check` — 7 dosya, CRLF destekli | PASS |
| İki tamamlanmış CSS dosyasının SHA-256 karşılaştırması | PASS, değişmedi |

Sahte sağlayıcı/PGlite üzerinden: geçerli izin, eksik izin, açık geri çekme, ileri tarihli kanıt, telefon değişikliği, doğrulanmamış telefon, aynı canonical telefon, aynı telefonda geri çekmeyi başka hesapla aşamama, farklı okul kapsamı, manuel/otomatik gönderim, eşzamanlı görev, çift onay ve cooldown test edildi. Geri çekilme önizleme sonrası, kuyruk sonrası ve kalıcı claim ile sağlayıcı çağrısı arasında deterministik biçimde uygulanarak gönderimin durduğu doğrulandı. Gerçek gönderim yapılmadı.

Panel testi uygun/engellenmiş yönetici, eksik izin, geri çekilmiş izin ve güncel olmayan kanıt sayaçlarını doğrular. Hesabım izin verme/geri çekme akışı korunur. API, ileri tarihli kanıtı hesap ekranında da etkin göstermez.

## 6. Production bayrakları

Yetkili Netlify API üzerinden yalnızca üç ilgili değişken salt okunur okundu. Site: `veliokul`; kontrol anındaki Published deploy: `6ae2f0c2acab961ff0876214`.

| Production değişkeni | Değer | Functions kapsamı |
| --- | --- | --- |
| `WHATSAPP_LICENSE_REMINDERS_ENABLED` | `true` | Evet |
| `WHATSAPP_LICENSE_REMINDERS_MANUAL_ENABLED` | `true` | Evet |
| `WHATSAPP_LICENSE_REMINDERS_AUTO_ENABLED` | `true` | Evet |

Bu, mevcut Netlify yapılandırmasının doğrudan doğrulamasıdır. İşleyici gerçek mesaj üretme riski nedeniyle elle tetiklenmedi; bu yeni yerel kodun production'da çalıştığı anlamına gelmez. Değişkenler değiştirilmedi.

## 7. Değişen dosyalar ve yayın kararı

Bu güvenlik kontrolünde değişen 7 kod/test dosyası:

1. `server/license-reminders.ts`
2. `server/license-reminder-api.ts`
3. `src/components/LicenseWhatsAppPanel.tsx`
4. `src/components/LicenseWhatsAppPreference.tsx`
5. `scripts/test-license-whatsapp-reminders.ts`
6. `scripts/test-license-reminder-api.ts`
7. `scripts/test-license-reminder-ui.mjs`

Yerel kod/test paketi teknik olarak hazırdır. Yeni migration gerekmez. Gerçek alıcı kayıtlarının kanıtları ve belge kapsamları doğrulanmadığından tüm yöneticilere gerçek gönderim için koşulsuz GO verilmez. Kanıtsız veya geri çekilmiş kullanıcılar bu paketle güvenli biçimde engellenir; bu nedenle uygun alıcı sayısı sıfır kalabilir ve sayı yapay olarak artırılmamalıdır.

Production dağıtımı, migration, veri yazma, toplu izin etkinleştirme, environment değişikliği, gerçek mesaj, commit veya push yapılmadı. Ana kirli Git worktree'ye dokunulmadı.
