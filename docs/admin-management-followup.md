# Admin yönetimi iyileştirmeleri

## Öğretmeni okuldan kaldırma

Okul satırı kilitlenir. Aynı transaction içinde yalnız ilgili öğretmen profilinin ve okulun bugünkü/gelecekteki `pending` ve `booked` randevuları ile açık `checked_in` randevuları iptal edilir. Tarih sınırı Europe/Istanbul kullanır. Geçmişte kalan pending/booked ve tamamlanmış/reddedilmiş/iptal edilmiş kayıtlar değiştirilmez. İptal gerekçesi mevcut not korunarak eklenir; audit kaydı iptal sayısını içerir. Üyelik pasifleştirilir ve kullanılmamış ilgili kodlar iptal edilir. Audit veya başka bir adım hata verirse tamamı geri alınır.

Global kullanıcı silinmez. Bağlantısız ve geçmişsiz bekleyen öğretmen profili önceki davranış gibi silinebilir; geçmişi bulunan bağlantısız profil kayıt bütünlüğü için korunur. Yönetici daha sonra açıkça yeni aktivasyon kodu verebilir. Diğer okul üyelikleri etkilenmez.

## Tarihler ve listeler

Görünür tarihler `src/utils/dates.ts` üzerinden gün/ay/yıl gösterilir; tarih/saatlerde Europe/Istanbul kullanılır. API ve date input değerleri ISO kalır. Bildirim ve audit listelemesinde tarih kaynağı `created_at` alanıdır; eski zaman-only etiketlerden tam tarih tahmini yapılmaz.

Admin randevuları başlangıçta İstanbul bugününe filtrelenir. Öğrenci/veli yönetimi sınıf seçilmeden kart açmaz. Çok çocuklu velide sadece seçili sınıfın çocukları görünür. Bekleyen kütük aynı sınıf filtresini kullanır.

## Platform okul yönetimi ve yetki

Mevcut okul admin rolü platform yetkisi vermez. Sunucuya özel `PLATFORM_ADMIN_USER_IDS`, virgülle ayrılmış mevcut kullanıcı ID allowlist'idir. Varsayılan boştur: hiç kimse okul yönetemez. UI sadece sunucudan dönen yetenek bilgisini görüntüler; tüm platform endpointleri JWT/auth_version doğrulaması ve sunucu allowlist kontrolünü her istekte uygular. Client role, schoolId veya platformAdmin alanları yetki kaynağı değildir.

Yetki ataması uygulama içinden yapılamaz; deployment operatörü bu ortam değişkenini ayrı güvenli süreçle yönetmelidir. ID listesini frontend/VITE değişkeni olarak yayımlamayın. Bu yetki okul oluşturma ve okul erişimini kapatma/açma ile sınırlıdır; mevcut tenant endpointlerini atlamaz. Yeni okulun oluşturucusuna sadece yeni okul için admin üyeliği transaction içinde atanır. Mevcut başka okullara üyelik verilmez.

Hard delete YOK. `schools.disabled_at` dolu olduğunda public okul listesi/context, aktif üyelik çözümü, tenant endpointleri, onboarding ve public aktivasyon/reset erişimi kapanır. Global login kimliği silinmez; diğer okulları ve platform yetkisi çalışmaya devam eder. Üyelik status değerleri, geçmiş, randevular ve settings değişmez. Yeniden etkinleştirme mevcut aktif üyelikleri yeniden kullanılabilir yapar. Kodların kendi expiry/attempt sınırları korunur. Devre dışı bırakılmadan önce zaten yetkilendirilmiş, devam eden istekler için genel bir dağıtık işlem iptal sistemi eklenmemiştir.

Platform yönetimi admin panelinde ve hesap menüsünde açılır; böylece tüm okulları pasif olan yetkili operatör de erişebilir. Yönetim penceresi değişiklikten sonra kapatılırken sayfa yenilenerek okul listesi/üyelikler tekrar sunucudan alınır.

## Production sırası (bu görevde uygulanmadı)

1. Operatör yedek ve rollback hazırlığını doğrular.
2. `server/database/migrations/20260925_add_school_disabled_at.sql` uygulanır. Yalnız nullable kolon ekler; idempotenttir. Mevcut okul verileri/üyelikleri değiştirilmez. Production otomatik migration yoktur.
3. Backend ve frontend birlikte deploy edilir. Yeni kod bu kolon olmadan çalıştırılmamalıdır.
4. Yetkili operatör gerekliyse `PLATFORM_ADMIN_USER_IDS` yapılandırır; herkese açık veya varsayılan ID yoktur.
5. Sağlık, normal okul admininin platform 403 sonucu, yetkili operatör yeteneği ve tenant smoke testleri doğrulanır. Gerçek okulu test amaçlı devre dışı bırakmayın.

Rollback: nullable kolonu bırakın. Allowlist'i boşaltmak platform yönetimini kapatır, pasif okulları açmaz. Eski backend disabled_at kontrolü yapmadığı için pasif okullar varken eski sürüme dönüş erişimi yeniden açabilir; bu durumda rollback yerine ileri düzeltme veya kontrollü bakım tercih edilmelidir.

## Yerel doğrulama

```
npx tsc --noEmit
npm run build
npm run test:activation
npx tsx scripts/test-admin-staff-management.ts
npx tsx scripts/test-teacher-appointment-ownership.ts
npx tsx scripts/test-api-postgres-integration.ts
npx tsx scripts/test-security-and-tenant-audit.ts
npx tsx scripts/test-admin-hardening.ts
npx tsx scripts/test-admin-filters.ts
npx tsx scripts/test-admin-view-filters.ts
npx tsx scripts/test-security-camera-lifecycle.ts
git diff --check
```

DB testleri yalnız yerel PGlite ile, DATABASE_URL ayarlanmadan ve sırayla çalıştırılır. Hardening testi benzersiz fixture okulları kullanır ve kendi oluşturduğu kayıtları temizler. Production ortamında test veya migration çalıştırmayın.

## Teslim kontrolü — 25/09/2026

### Kök nedenler

1. Öğretmen kaldırma endpointi aktif randevu bulunca 409 dönüyordu. Transaction içindeki bu engel, kapsamlı iptal + üyelik pasifleştirme + gerekçeli audit ile değiştirildi.
2. Bileşenler ISO, yerel tarih ve yalnız saat metinlerini ayrı ayrı basıyordu; merkezi gösterim standardı yoktu. Ortak tarih yardımcıları eklendi.
3. Admin randevular sekmesi tüm listeyi doğrudan render ediyordu. İstanbul tarihiyle başlatılan seçili gün state'i ve filtre eklendi.
4. Veli listesi sadece metin aramasına göre süzülüyordu. Hem veli/çocuk hem bekleyen kütük için sınıf seçimi eklendi.
5. Baş harf kutusu StaffManagement içindeki avatar span'iydi; sadece bu span kaldırıldı.
6. Platform yönetimi veya güvenli okul kapatma modeli yoktu. Okul admininden ayrı sunucu allowlist yetkisi ve kayıpsız pasifleştirme eklendi.

### Çalıştırılan kontroller

| Komut | Sonuç | Exit |
|---|---|---|
| `npx tsc --noEmit` | PASS | 0 |
| `npm run build` | BLOCKED/FAIL — sandbox esbuild üst dizin erişimini reddetti; Vite config yüklenemedi | 1 |
| `npx vite build --configLoader runner` | PASS — yalnız frontend production build | 0 |
| `npm run test:activation` | PASS | 0 |
| `npx tsx scripts/test-admin-staff-management.ts` | PASS | 0 |
| `npx tsx scripts/test-teacher-appointment-ownership.ts` | PASS | 0 |
| `npx tsx scripts/test-api-postgres-integration.ts` | PASS — 10/10 | 0 |
| `npx tsx scripts/test-security-and-tenant-audit.ts` | PASS — 8 bölüm | 0 |
| `npx tsx scripts/test-admin-hardening.ts` | PASS | 0 |
| `npx tsx scripts/test-admin-filters.ts` | PASS | 0 |
| `npx tsx scripts/test-admin-view-filters.ts` | PASS — mock hook component testi | 0 |
| `npx tsx scripts/test-security-camera-lifecycle.ts` | PASS — mock kamera lifecycle testi | 0 |
| `git diff --check` | PASS | 0 |

### Pasif okul yetkilendirme düzeltmesi — 25/09/2026

Kök neden: `tenantGuard` doğrudan aktif membership satırına bakıyordu. Okul pasifleştirilirken üyelik kayıtları özellikle korunuyor; dolayısıyla satırın aktif olması okul erişiminin hâlâ açık olduğu anlamına gelmemeliydi. `tenantGuard` artık `requireSchoolMembership` kullanır. Bu ortak helper önce `schoolRepository.getById()` çağırır; bu repository zaten `disabled_at IS NULL` uygular. Okul yoksa veya pasifse membership çözümlemesi yapılmadan `null` döner ve tenant guard 403 verir. `requireSchoolRole` de aynı helper üzerinden fail-closed çalışır. Düşük seviye `membershipRepository.getActiveMembership` kayıt/sorgu API'si değişmeden bırakılmıştır. `/api/platform/*` rotaları `tenantGuard` kullanmaz; JWT doğrulamasından sonra sunucu allowlist'iyle yetkilendirilir ve pasif okulu açabilir.

Bu göreve ait son test koşusu:

| Komut | Sonuç |
|---|---|
| `npx tsc --noEmit` | PASS |
| `git diff --check` | PASS |
| `npm run test:activation` | PASS |
| `npx tsx scripts/test-admin-staff-management.ts` | PASS |
| `npx tsx scripts/test-teacher-appointment-ownership.ts` | PASS |
| `npx tsx scripts/test-api-postgres-integration.ts` | PASS — 10/10 |
| `npx tsx scripts/test-security-and-tenant-audit.ts` | PASS — 8/8 bölüm |
| `npx tsx scripts/test-admin-hardening.ts` | PASS — aktif okul/membership, pasif parent/admin membership 403, üyelik satırı korunması, cross-tenant, platform yeniden etkinleştirme ve allowlist dışı 403 |

`test-admin-hardening.ts` pasifleştirme adımında diğer okul admin ve veli membership satırlarının `active` kaldığını doğrudan SELECT ile doğrular; helper `null`, role helper red, tenant API 403 kontrollerini yapar. Aynı okul tekrar açılınca helper membership'i tekrar çözer ve tenant API 200 verir. Geçici test-runtime preload dosyası temizlendi.

TSX sandbox'ta `os.userInfo()` / `uv_os_get_passwd ENOMEM` hatası verdi. Testler yalnız işletim sistemi kullanıcı bilgisi için geçici preload uyarlamasıyla tekrar çalıştırıldı; uygulama auth/DB kontrolleri bypass edilmedi. Bu geçici dosya teslimden önce silindi. Windows PowerShell'de yukarıdaki standart komutlar tekrar çalıştırılmalıdır. Standart full build başarılı olmadan teslimin build kabul kriteri tamamlanmış sayılmaz.

Yeni testler: öğretmen kaldırmada audit hatası enjeksiyonu ile rollback, aktif randevu iptali, geçmiş ve diğer öğretmen/tenant kayıtlarının korunması; platform varsayılan kapalı yetki, normal rollerin 403 alması, okul oluşturma/default ayarlar, case-insensitive kod mükerrerliği, disable/enable, valid aktivasyon/reset kodlarının pasif okulda credential değiştirememesi, tüm okulları pasif platform yöneticisinin erişimi ve allowlist geri alma kontrolleri. Tarih testleri İstanbul gece yarısı ve leap-day; component testleri gerçek handler'lar üzerinden gün/sınıf seçimi ve çok çocuklu velide yalnız ilgili öğrenci aksiyonlarını doğrular.

### Değişen dosyalar

- `server/admin-management.ts`
- `server/api.ts`
- `server/repositories/index.ts`
- `server/platform-management.ts` (yeni)
- `server/database/supabase_schema.sql`
- `server/database/migrations/20260925_add_school_disabled_at.sql` (yeni)
- `src/App.tsx`
- `src/services/api.ts`
- `src/types/platform.ts` (yeni)
- `src/utils/dates.ts` (yeni)
- `src/utils/admin-filters.ts` (yeni)
- `src/data/mockData.ts`
- `src/components/AdminView.tsx`
- `src/components/ParentManagement.tsx`
- `src/components/ManagementActions.tsx`
- `src/components/StaffManagement.tsx`
- `src/components/SchoolManagement.tsx` (yeni)
- `src/components/Navbar.tsx`
- `src/components/ParentView.tsx`
- `src/components/TeacherView.tsx`
- `src/components/SecurityView.tsx`
- `src/components/QRCodePass.tsx`
- `src/components/NotificationsModal.tsx`
- `src/components/AuditManagement.tsx`
- `scripts/test-admin-hardening.ts`
- `scripts/test-admin-filters.ts` (yeni)
- `scripts/test-admin-view-filters.ts` (yeni)
- `scripts/test-security-camera-lifecycle.ts`
- `docs/admin-management-followup.md` (yeni)

### Kalan doğrulamalar / riskler

- Standart `npm run build` gerçek Windows workspace üzerinde tekrar çalıştırılmalı; frontend-only build sonucu full build yerine geçmez.
- Gerçek tarayıcı/mobil görsel ve fiziksel kamera E2E bu görevde çalıştırılmadı. Component testleri mock hook ortamındadır.
- Öğretmen iptal durumu backend'de hemen geçerlidir; başka kullanıcının açık ekranı mevcut veri yenileme davranışına tabidir. Yeni realtime altyapısı eklenmedi.
- Pasif okulda global kullanıcı login'i devam edebilir; okul üyelikleri erişim vermez. Diğer okullardaki haklar korunur.
- Platform allowlist açıkça yapılandırılmadan okul yönetimi kimseye açılmaz. Eski backend'e rollback uyarısı yukarıdadır.
- Logo/background dosyaları, auth_version, parola hash formatı, 5 haneli kodlar, QR karar contract'ı ve teacher profile/user ayrımı değiştirilmedi.
- Production DB, production ortam değişkenleri ve deployment değiştirilmedi. Commit/push/deploy yapılmadı.
- Son frontend bundle taramasında JWT_SECRET, AUTH_CODE_SECRET, DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY ve PLATFORM_ADMIN_USER_IDS isimleri bulunmadı. Bu kontrol gerçek secret değerlerini okumadan/yazdırmadan yapıldı.
