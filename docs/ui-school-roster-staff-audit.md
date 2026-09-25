# UI, okul bilgileri, personel ve toplu kütük aktarımı

## API ve okul bağlamı

- Mevcut `schools.code` alanı kullanılır; yeni kolon/migration yoktur.
- `GET /api/public/schools` artık authentication gerektirir (anonim istek: 401). Yanıt yalnız kullanıcının aktif üyeliklerinin aktif okullarını içerir. Platform kataloğu platform guard arkasında kalır.
- `GET /api/schools/:schoolId/info` admin ve tenant guard arkasındadır. Okul adı/kodu salt okunur döner. Okul kodu normal admin ayarlarıyla değişmez.
- Platform okul oluşturma: kod verilmezse kilitli transaction içinde benzersiz, büyük harfli 10 karakter üretilir. Mevcut kodlar değiştirilmez.
- Personel ilk girişinde okul kodu kullanılır. Doğrulama yanıtındaki `schoolId`, aynı scope ile activation-complete isteğine aktarılır.
- Öğretmen/güvenlik okul seçicisi kapalıdır; veli ve admin yalnız üyelik okulları arasında geçebilir.

Frontend ve backend birlikte yayımlanmalıdır. Eski anonim okul kataloğu ve sınıfsız bulk request sözleşmelerini kullanan istemciler güncellenmelidir.

## Toplu kayıt

1. Sınıf seçilir/yazılır. Ayrı bir sınıf kataloğu tablosu bulunmadığı için mevcut sınıflar önerilir; yeni sınıf aynı okul bağlamında tanımlanabilir.
2. Beş alanlı manuel satırlar, tab-separated yapıştırma, XLSX veya UTF-8 CSV kullanılır.
3. Sunucuya `{ className, records, preview: true }` gönderilerek önizleme alınır.
4. Açık admin onayında `preview: false` gönderilir; sunucu yeniden doğrular.
5. Aktif okul satırı kilitlenir; yalnız school_roster kayıtları ve PII içermeyen tek audit olayı aynı transaction içinde yazılır.

Sınıf her satır için üst seviye seçimden alınır. İstemcinin kayıt içindeki schoolId/className değerleri kullanılmaz. Hatalı satır varsa tamamı reddedilir. Mevcut kimlikler atlanır; çelişen öğrenci adı/doğum tarihi reddedilir. Aynı velinin kardeş öğrencileri desteklenir. Hesap, üyelik ve veli-öğrenci ilişkisi import sırasında oluşturulmaz; mevcut self-registration bunları oluşturur.

Sınırlar: 500 satır, 2 MB dosya, yalnız bulk endpoint için 1 MB JSON, XLSX ZIP metadata için toplam 20 MB açılmış boyut / 100 girdi, worker için 15 saniye. XLSX yalnız Kayıtlar sayfasındaki beş sabit sütunu okur. Formüller çalıştırılmaz; varsa önceden hesaplanmış düz değerler normal validasyondan geçer. Sonuçsuz formül boş alan sayılır. Bağlantılar takip edilmez. Tarihler gün/ay/yıl bileşenleriyle doğrulanır; locale Date parsing kullanılmaz. Dosya sunucuya yüklenmez veya kalıcı saklanmaz.

`read-excel-file` ve `write-excel-file` yalnız şablon/dosya kullanımında dinamik yüklenir. ExcelJS güvenlik uyarıları nedeniyle kullanılmadı; yeni dependency kurulumu 0 bilinen zafiyet bildirdi. Worker ES modül çıktısı kullanır. Şablon adı: veli-randevu-ogrenci-veli-sablonu.xlsx. DOCX desteklenmez.

## Personel ve audit

Personel formu görev, ad/soyad, telefon ve e-posta gerektirir; yalnız öğretmende branş gönderilir. Mevcut generic staff endpoint, pending teacher/pending_staff, activation mail ve resend mekanizmaları korunur. Gönderim hatasında kayıt listesi yenilenir; pending kayıt için yeniden gönderim yapılabilir.

Audit UI merkezi allowlist üzerinden açıklama üretir. Raw action/details/ID gösterilmez. Bilinmeyen olay güvenli genel açıklamaya düşer. Yalnız doğrulanmış kayıt/randevu sayıları ek açıklamaya alınır. Audit clear yetkilendirmesi değişmez.

## Doğrulama

`npm run test:school-roster-ui`: okul scope/kodları, disable koruması, bulk doğrulama/rollback/duplicate/PII, parent claim, gerçek XLSX tarih hücresi, CSV parser, staff form validation ve audit gösterimi.

Mevcut activation, parent-auth, staff management, admin hardening, teacher ownership, API/Postgres, tenant/security, production guards, admin filtreleri, kamera lifecycle ve migration idempotency testleri de çalıştırıldı.

Chromium üzerinde mock API ile form payloadları, e-posta hatası/yeniden gönderim, XLSX worker/önizleme/import, şablon indirme, kod kopyalama ve audit gizliliği doğrulandı. 375, 390, 430, 768 ve 1440 px görünüm kontrolleri geçti. Gerçek mobil cihaz/Safari testi yapılmadı.

Standart TypeScript kontrolü ve Vite runner build geçti. Standart npm build Windows sandbox/esbuild üst dizin erişim sınırı nedeniyle tamamlanamadı; yerel PowerShell'de yeniden çalıştırılmalıdır. Varsayılan tsconfig yalnız src içerir; ek sunucu typecheck mevcut Express route parametre ve SchoolMembership tip hatalarını gösterir. Bu görev yeni backend typecheck hatası eklememiştir.

Production DB/env, gerçek e-posta, commit, push ve deploy işlemi yapılmadı.

## Çalıştırılan kontroller

Testler yerel PGlite üzerinde çalıştırıldı. Windows sandbox `os.userInfo` ENOMEM hatası için geçici preload kullanıldı; aynı yardımcı gerçek dış ağ isteklerini engelledi. Mevcut e-posta testleri mock kullandı. Yardımcı final değişikliklerden kaldırıldı. Aşağıdaki test komutları yerel tsx CLI üzerinden eşdeğer biçimde çalıştırıldı.

| Kontrol | Sonuç | Exit |
| --- | --- | --- |
| npx tsc --noEmit | PASS | 0 |
| npm run test:activation | PASS | 0 |
| npm run test:parent-auth | PASS | 0 |
| npx tsx scripts/test-admin-staff-management.ts | PASS | 0 |
| npx tsx scripts/test-admin-hardening.ts | PASS | 0 |
| npx tsx scripts/test-teacher-appointment-ownership.ts | PASS | 0 |
| npx tsx scripts/test-api-postgres-integration.ts | PASS | 0 |
| npx tsx scripts/test-security-and-tenant-audit.ts | PASS, 8 bölüm | 0 |
| npm run test:auth:production | PASS | 0 |
| npx tsx scripts/test-admin-filters.ts | PASS | 0 |
| npx tsx scripts/test-admin-view-filters.ts | PASS | 0 |
| npx tsx scripts/test-security-camera-lifecycle.ts | PASS | 0 |
| npx tsx scripts/test-migration-idempotency.ts | PASS | 0 |
| npm run test:school-roster-ui | PASS | 0 |
| Chromium mock UI / responsive | PASS | 0 |
| npx vite build --configLoader runner | PASS | 0 |
| npm run build | BLOCKED: esbuild üst dizin erişimi reddedildi | 1 |
| git diff --check | PASS | 0 |

Ek kapsamlı sunucu typecheck exit 2: değiştirilmeyen route satırlarındaki Express `string|string[]` parametreleri ve SchoolMembership tip uyumsuzlukları sürüyor. Standart proje tsconfig kontrolü PASS; ek sunucu kontrolü PASS sayılmadı.

Üretilen frontend JS dosyalarında RESEND_API_KEY, JWT_SECRET, AUTH_CODE_SECRET, DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, password_hash ve passwordHash işaretleri bulunmadı. Git tarafından takip edilen .env dosyası yok. Bu kontrol gerçek secret değerlerini okumadan/yazdırmadan yapıldı.

Yeni test ayrıca 100 KB'yi aşan 500 satırlık JSON isteğini, 501 satır reddini ve 1 MB istek sınırını doğrular. Bilinmeyen audit action değerleri (prototype isimleri dahil) güvenli genel açıklama verir.

## Değişen dosyalar

- bun.lock
- package.json
- scripts/test-admin-hardening.ts
- scripts/test-admin-view-filters.ts
- scripts/test-api-postgres-integration.ts
- server/api.ts
- server/app.ts
- server/platform-management.ts
- src/components/AdminView.tsx
- src/components/AuditManagement.tsx
- src/components/AuthView.tsx
- src/components/Navbar.tsx
- src/components/SchoolManagement.tsx
- src/components/StaffManagement.tsx
- src/context/AppContext.tsx
- src/index.css
- src/services/api.ts
- vite.config.ts

## Yeni dosyalar

- docs/ui-school-roster-staff-audit.md
- scripts/test-school-roster-ui.ts
- server/roster-import.ts
- src/components/BulkRosterImport.tsx
- src/components/SchoolInfo.tsx
- src/utils/audit-display.ts
- src/utils/roster-files.ts
- src/utils/roster-import.ts
- src/utils/roster-worker.ts
- src/utils/staff-form.ts

`bun.lock` gerçek Bun CLI ile senkronize edildi; package.json'da önceden bulunan qrcode/type dependency kayıtları da lockfile'a dahil edildi. Paket yöneticisi standardı değiştirilmedi. package-lock.json, .npm-cache, dist ve yerel PGlite runtime dosyaları ignore kapsamındadır.

## Yerel son kontrol / dağıtım notu

Windows PowerShell'de `npm run build` yeniden çalıştırılmalıdır. Gerçek Safari/iOS/Android cihaz testi yapılmadı. Frontend/backend birlikte gözden geçirilmelidir: anonim okul kataloğu artık 401 verir; personel ilk girişte okul kodu kullanır; bulk aktarım sınıf ve doğum tarihi ister. Yeni migration gerekmez. Bu çalışma deploy onayı veya production doğrulaması değildir.
