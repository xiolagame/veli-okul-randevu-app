# Google Play demo veritabanı hazırlık planı

Bu belge **plan ve salt okunur inceleme sonucudur**. Migration, tablo/rol oluşturma, seed veya yayın işlemi uygulanmadı. Hedef yalnız kullanıcı tarafından doğrulanan Supabase projesi `wljzgbwlpvyzbkdhzidi` (veli-randevu-play-review). Çalışma klasörü `C:/Users/XIO/Documents/Codex/veli-randevu-play-review-interactive-20261029`.

## 1. Mevcut demo veritabanı durumu

- Doğrulanmış hedef pooler kullanıcı adı ve6543 portu ile, resmî Supabase CA'sı ve hostname doğrulaması açık olarak bağlanıldı. Şifre/tam URI çıktıya veya bu rapora yazılmadı.
- Katalog sorguları tek `BEGIN READ ONLY` transaction'ında çalıştı; `transaction_read_only=on` doğrulandı ve sonunda `ROLLBACK` yapıldı. İş/tablo verileri okunmadı; yalnız şema/tablo/rol/izin/eklenti metadata'sı incelendi.
- PostgreSQL17.11, database `postgres`, current_user `postgres`. Bu yönetim rolü BYPASSRLS/CREATEROLE/CREATEDB/REPLICATION gibi geniş yetkiler taşıyor; runtime servis hesabı olarak kullanılmamalı.
- `public` şemasında0 tablo; hiçbir şemada `review_*` tablosu yok. `review_private` şeması ve özel review rolleri yok. Dolayısıyla istenen7 tablo eksik.
- Mevcut şemalar: auth, extensions, graphql, graphql_public, pgbouncer, public, realtime, storage, vault. Auth27, realtime3, storage8 ve vault1 yönetilen tablosu bulunuyor; bunların satır verileri incelenmedi. Bunlar silinmeyecek veya migration'a dahil edilmeyecek.
-30 mevcut PostgreSQL rolü incelendi. `anon`/`authenticated` LOGIN değil; `service_role` BYPASSRLS taşıyor. Supabase `service_role` ile önerilen özel `review_runtime` PostgreSQL rolü aynı şey değildir.
- Kritik bulgu: postgres/supabase_admin sahiplerine ait `public` tablo default ACL'lerinde anon/authenticated/service_role için geniş izinler var. Bu, şimdi var olmayan review tablolarının yanlışlıkla public'te oluşturulması halinde erişim riski doğurur. Mevcut public RLS policy/tablo grant satırı yok çünkü public'te tablo yok.
-0 foreign server,0 foreign user mapping,0 replication subscription. Kurulu eklentiler pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp. dblink/postgres_fdw/pg_net/pg_cron kurulu değil.

Kanıt: `audit/demo-database-readonly-inspection.json`; UTC kontrol zamanı dosyanın `checkedAt` alanında. Bu dosya bağlantı URI'si, parola veya key içermez.

## 2. Oluşturulacak tablolar, ilişkiler ve kod uyumu

Önerilen yerleşim **review_private**: Data API'ye açılmayan özel şema. Bunlar uygulamanın normal production tablolarının kopyaları değildir. Normal Supabase uygulama schema/seed/migration zinciri bu projede çalıştırılmayacak.

| Tablo | Mevcut kodun beklediği yapı / plan |
|---|---|
| review_environment | id text PK, enabled boolean. Tek `synthetic-only` marker; başlangıçta enabled=false. Runtime yalnız okuyabilir, açma/kapama yalnız operatör |
| review_school_state | school_id text PK, state jsonb NOT NULL. Tek sentetik okulun school/settings/students/teachers/availability/appointments/staff/audit/preferences yapısı. JSON root school.id ile school_id eşitliği, object/required-key kontrolleri ve512KB sınırı |
| review_accounts | id text PK, phone text UNIQUE, school_id text FK→school_state.school_id, role, synthetic, active, version, salt, credential_hash, user_data/school_data/views jsonb, failures/failure_start/locked_until/last_request. İzinli roller yalnız parent/teacher/security/admin; synthetic=true zorunlu |
| review_challenges | id text PK, attempt_id text UNIQUE, account_id FK→accounts.id, version/epoch integer, expires bigint, consumed boolean, tries integer. Kod zamanları Unix milisaniye olarak kullanır |
| review_sessions | id text PK, account_id FK→accounts.id, expires bigint, revoked boolean |
| review_limits | id text PK (hash), count integer, started bigint. IP/hesap/endpoint pencereleri; runtime UPSERT/RETURNING sözleşmesi korunur |
| review_audit | Mevcut6 sütun sırası aynen: id, account_id, event, success, ip_hash, created. Başarılı/başarısız isteklerde kod `account_id='unverified'` yazabildiği için doğrudan FK eklenmez. Hashli IP dahi sınırlı saklanır |

İlave kurallar: school/account/resource ID'leri review-* alanında; role CHECK, version>=1, sayaçlar>=0, salt/hash formatı, JSON object tipleri ve user_data.id/phone ile satır kimliği uyumu. Tek okul için RLS ve account/state CHECK'leri sabit sentetik okul ID'siyle sınırlandırılmalı. `tries<=5` CHECK'i eklenmemeli: mevcut kod aynı challenge için başarısız denemelerde sayacı artırabilir;5 sınırı uygulamadaki doğrulama kuralıdır.

**Uyumluluk uyarıları:**

- `REVIEW_LOCAL_SCHEMA` test kurulum sabitidir; production-ready ve versiyonlu migration dosyası değildir. Mevcut veritabanında tekrar çalıştırmak uygun değildir. Şu an özel review migration dosyaları bulunmuyor.
- `server/review-auth.ts:100,205` ve `server/review-domain.ts:134,136` audit INSERT'lerinde sütun adı olmadan6 VALUES kullanıyor. Migration audit sütun sırasını değiştirmemeli veya ilave sütun eklememeli; aksi halde ayrı onaylı kod uyarlaması gerekir.
- Randevu/öğrenci/öğretmenler ayrı SQL tabloları değil, school_state içindeki JSON dizileridir. Bu iç ID ilişkileri gerçek SQL FK değildir; seed doğrulaması, backend kontrolleri ve transaction kilidiyle korunur. Şema migration'ı bunları ilişkisel randevu tablosuymuş gibi tasarlamamalı.
- FK indeksleri: accounts(school_id,role), challenges(account_id), challenges(expires), sessions(account_id), sessions(expires), limits(started), audit(created), gerekirse audit(account_id,created). PK/UNIQUE tekrar indekslenmez. JSON için şu küçük demo ölçeğinde gereksiz GIN indeksi yok.
- Audit'teki unverified sentinel'i dahil tanımlı olay sözleşmesi korunur. User-data/credential/audit birbirine JSON içinde gömülmez; yalnız accounts salt/hash tutar.

Kaynaklar: `server/review-auth.ts:23`, `server/review-domain.ts:8`, `scripts/review-test-fixture.ts`. Kaynak hash'leri önceki final manifestosuyla aynı; bu görevde iş kodu değiştirilmedi.

## 3. Güvenlik ve en az yetki modeli

### Şema ve sahiplik

Üç ayrı yetki alanı önerilir:

1. **review_owner**: NOLOGIN nesne sahibi; uygulama bu role üye olamaz. DDL/migration yalnız yetkili operatör tarafından, yalnız yeni projede uygulanır.
2. **review_runtime**: LOGIN, NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE/NOCREATEDB/NOREPLICATION; postgres, service_role, authenticator, pg_read_all_data veya owner üyeliği yok. Backend'e özel credential; frontend/AAB'ye gömülmez.
3. **review_maintenance**: Kontrollü operasyon/temizlik; runtime'dan farklı credential ve görev. Gerekli silme/iptal/reset yetkisi sadece review tablolarında. Kimlik/rol değiştiren kurtarma işlemleri ayrı yetkili operatör akışına aittir.

Runtime CONNECT+review_private USAGE; CREATE, schema ownership, TRUNCATE, REFERENCES, TRIGGER, role yönetimi yok. UUID/ID'ler Node'da üretildiğinden sequence veya DB UUID fonksiyonu EXECUTE yetkisi gerekmez. Catalog/built-in metadata erişimi PostgreSQL'in olağan davranışıdır; “yalnız demo tabloları” iş verisi yetkisi anlamındadır. PUBLIC üzerinden miras gelen fonksiyon izinleri ve SECURITY DEFINER kaçışları ayrıca negatif test edilmeden mutlak en az yetki iddiası yapılmamalı.

| Tablo | review_runtime için gereken en dar SQL izinleri |
|---|---|
| environment | SELECT |
| accounts | SELECT; UPDATE yalnız failures,failure_start,locked_until,last_request |
| challenges | SELECT, INSERT; UPDATE yalnız consumed,tries |
| sessions | SELECT, INSERT; UPDATE yalnız revoked |
| limits | SELECT, INSERT; UPDATE yalnız count,started |
| audit | INSERT; runtime SELECT/UPDATE/DELETE yok |
| school_state | SELECT; UPDATE yalnız state; satır INSERT/DELETE yok |

Hesap ekleme/rol/version/active/credential değiştirme, marker açma, state seed etme ve temizlik runtime rolüne verilmez. Kurulumda anon/authenticated/service_role/PUBLIC için review_private USAGE/table/sequence/function erişimi verilmez; owner'ın review_private default privileges'ı açıkça kapatılır. Mevcut Supabase auth/storage/realtime izinleri veya public default ACL'leri topluca değiştirilmez. Data API exposed schemas listesi katalogdan kesin doğrulanamaz; review_private'in oraya eklenmediği deployment kabulünde ayrıca kontrol edilir.

### RLS

Yedi tabloda ENABLE+FORCE RLS; owner/runtime BYPASSRLS'siz. Yalnız gereken role+komuta policy tanımlanır. Sınırlı tek okul için account ve school_state policy'leri sabit demo school_id ve synthetic değerini kontrol eder; UPDATE'de USING ve WITH CHECK birlikte bulunur. Challenges/sessions account bağlantısı sentetik üyelikle sınırlandırılır. Limits sadece kendi review tablosunda; audit runtime yalnız INSERT, maintenance kontrollü okuma/temizlik; environment yalnız synthetic-only marker.

Bu backend Supabase Auth kullanıcı oturumu kullanmıyor; ayrı imzalı review JWT var. Bu nedenle auth.uid()'yi doğrudan mevcut review ID'leriyle eşleştiren policy çalışmaz. Tek DB servis rolü altında RLS bütün dört demo hesabın sunucu erişimini kapsar; veli/öğretmen/güvenlik uygulama rol sınırları mevcut backend kontrolleriyle sağlanır. RLS'nin her son kullanıcıyı SQL düzeyinde ayrı ayrı yetkilendirdiği iddia edilmez. İleride çoklu tenant istenirse transaction başında sunucunun doğruladığı context ve SET LOCAL tabanlı ayrı tasarım/test gerekir; session-global SET transaction pooler'da kullanılmamalı.

[Supabase RLS rehberi](https://supabase.com/docs/guides/database/postgres/row-level-security), [rol rehberi](https://supabase.com/docs/guides/database/postgres/roles).

### Şu an giderilmemiş backend uyarlamaları

**P0 — yanlış production ayrımı:** `server/review-auth.ts:222-223` host+database path eşitliğinde bağlantıyı reddediyor; Supabase shared pooler host'u ve `/postgres` farklı projelerde aynı olabilir. Project ref kullanıcı adının parçasıdır. Bu guard farklı projeyi yanlış reddedebilir; farklı hosttaki aynı projeyi de yeterince doğrulamaz. Onaylı düzeltmede beklenen review Project ID fail-closed allowlist'i, pooler/custom-role kimliği ve production project ref karşılaştırması gerekir. Production'a bağlanarak test edilmez.

**P0 — özel şema çözümlemesi:** Şu an bütün SQL isimleri şemasız, mevcut search_path public/extensions içeriyor. Yalnız private tablo oluşturmak çalıştırmaya yetmez. Tercih: review SQL'lerini sabit `review_private.` adıyla nitelemek; kullanıcı girdisinden schema üretmemek. Session-level search_path'a veya pooler session durumuna güvenilmemeli. Bu, endpoint/normal OTP sözleşmesini değiştirmeyen fakat ayrıca onaylanması gereken backend değişikliğidir.

**P1 — RLS/migration uyarlaması:** Column grants/FOR UPDATE/UPSERT RETURNING ve policies gerçek restricted-role bağlantısıyla sınanmalı. Bu görevde servis rolü, policy veya kod oluşturulmadı.

## 4. Tamamen sentetik veri ve işlev planı

İlk seed tek transaction'da hazırlanmalı; gerçek production dump/hesap/öğrenci/veli verisi kullanılmaz.

| Nesne | Plan |
|---|---|
| Okul | review-school; “Veli Randevu Sentetik İnceleme Okulu”, kurgusal şehir/ilçe, REVIEW kodu; gerçek lisans/school record yok |
| Veli | review-parent, role=parent; user_data/school_data/views ID'leri ve registry bire bir uyumlu |
| Öğretmen | review-teacher; profile review-teacher-profile, userId=review-teacher; Matematik, sentetik ad |
| Güvenlik | review-security, role=security; ayrı credential; istenirse state.staff içinde bu hesaba bağlı aktif sentetik profil |
| Okul yöneticisi | review-admin, role=admin; yalnız aynı demo okul |
| Öğrenci | review-student; sentetik ad,5-A, parentId=review-parent. İstenirse6/7/8 sınıflı tamamen kurgusal ek öğrenciler |
| Uygunluk | Pazartesi–Cumartesi08:00–17:00,15dk; min5dk/max booking30gün, parent cancel açık. Mevcut fixture sözleşmesiyle aynı |
| Başlangıç randevusu | Gelecekte uygun bir okul gününde pending; ayrı booked sentetik örnek isteğe bağlı. QR mevcut review-qr-UUID biçiminde, gerçek okul QR'ı yok |

Telefonlar yalnız review registry için kullanılacak kanonik demo giriş tanımlayıcılarıdır; fixture numaralarını “gerçek dünyada kesin sahipsiz” varsaymayın. Gerçek kişiden bilgi kopyalanmaz; değer seçimi kontrollü ve sağlayıcıya gönderim tamamen engelli olmalı. Bu raporda telefon/inceleme kodu üretilmedi veya yayımlanmadı. Her hesaba ayrı review credential; plaintext sadece yetkili kasada, DB'de benzersiz salt+scrypt hash. JWT key ve AUTH_CODE_SECRET paylaşılmaz.

Başlangıçta environment.enabled=false/accounts.active=false; seed ve yetki testleri geçtikten sonra yalnız ayrı onayla açılır. Okul JSON'u accounts.school_data/views ile tutarlı olmalı: eski readonly moda dönüşte eski/yanlış veri gösterilmemeli. Öğretmen.userId/öğrenci.parentId/state.staff.userId varsa accounts ile doğrulanır; JSON ID ilişkileri bağımsız seed doğrulayıcısıyla kontrol edilir.

**İşlev → endpoint → veri eşleşmesi:**

- Veli GET school students/teachers/availability/appointments: kendi öğrenci/randevuları; POST appointments → state.appointments pending; POST appointments/:id/cancel → yalnız kendi pending/booked kaydı cancelled.
- Öğretmen GET appointments ve POST availability/DELETE availability/:id; POST appointments/:id/approve → booked, /reject → rejected; kendi profile ID'si şart.
- Güvenlik POST security/qr/verify → yalnız review-qr token araması; `evaluateSecurityQr` İstanbul tarih/erken-geç zaman ve durum denetimi; audit kaydı. Bu endpoint gerçek check-in mutasyonu yapmaz. Doğru QR bile zamanı dışında TOO_EARLY/EXPIRED olabilir; seed'i her zaman geçer göstermek için saat güvenliği kapatılmaz.
- Admin settings PUT, staff oluştur/düzenle, manuel roster/bulk-upload, student-records ve tek öğrenci kaldırma: sadece state. Personel oluşturma pending sentetik kayıttır; otomatik yeni review giriş hesabı açılmaz. E-posta simülasyonu emailSent=false.
- Bilgilendirme izni GET/PUT auth/me/license-reminder-preferences/:schoolId → state.preferences; scheduler/WhatsApp gönderimi yok.
- Platform admin rolü oluşturulmaz; global yönetim/lisans/ödeme/FCM/quick-switch kapalı. Asenkron Excel job/destek/hesap yaşam döngüsü ve toplu sınıf silme hazır sayılmaz.

## 5. Migration ve kabul sırası

Bu maddeler **uygulama emri değil**, onaya sunulan sıradır. Şu aşamada .sql migration dosyası üretilmedi ve çalıştırılmadı.

1. Hedef Project ID/TLS tekrar doğrulanır; yalnız demo katalog baseline'ı korunur. İki P0 backend uyarlaması ayrı değişiklik grubu olarak hazırlanır; normal OTP/production auth değişmez. Güncel production source uyumu bu DB planından ayrı kalan önceki yayın kapısıdır.
2. Yerel izole test DB'sinde private schema/owner/runtime/maintenance tasarımı ve SQL hazırlanır. Versiyonlu migration dosyaları o aşamada Supabase migration tooling ile oluşturulur; genel uygulama migration diziniyle karıştırılmaz.
3. Kullanıcının ayrıca onayıyla yalnız yeni demo projesinde owner/schema ve scope'u kapalı default privileges hazırlanır. LOGIN credential operatör tarafından güvenli üretilir; çıktı/commit olmaz. Public/managed şemalara dokunulmaz.
4. Tablo sırası: environment → school_state → accounts → challenges → sessions → limits → audit. FK/check/index'ler ve RLS/policies/grant'ler aynı kontrollü transaction setinde, erişim açılmadan uygulanır. Kurulum başarısızsa rollback; kill-switch kapalı kalır.
5. Sonraki açık seed onayıyla marker(false) → okul state → dört hesap → JSON referans/snapshot doğrulaması. Challenge/session/limits/audit seed edilmez; ilk kullanımda üretilir. Auth.users'a Supabase kullanıcı oluşturulmaz. Version/credential/registry kontrollü eşleştirilir.
6. Restricted-role bağlantısıyla izin/RLS/normal OTP ve gerçek çok bağlantılı PostgreSQL yarış testleri; negatif anon/authenticated/service_role/direct SQL erişim testleri. Bu testler yazacağı için bu görevde yapılmadı ve ayrıca izin gerektirir.
7. Salt okunur kabul raporu; ardından yalnız ayrı aktivasyon onayı. Netlify/env/deploy onayı bu planın veya demo DB kurulum onayının parçası sayılmaz.

### Transaction ve temizleme tasarımı

Mevcut domain account FOR UPDATE → school_state FOR UPDATE sırasıyla kilit alır; tenant satırı bütün randevu değişikliklerini serileştirir. Auth challenge/account kilidi ve consumed=false koşullu UPDATE replay/yarışı sınırlar. Transaction pooler'da aynı transaction tek checked-out client üzerinde yürütülmeli; named prepared statement/session-state kullanılmamalı. Mevcut wrapper BEGIN/COMMIT/ROLLBACK yapısını korur. Connection pool max3 her instance içindir, bulut toplamını sınırlamaz.

Kill-switch/oturum aktifliği gateway'de kontrol edildikten sonra domain transaction'ı hesabı yeniden kontrol eder; önceden başlayan istek kill-switch veya session revoke anında mutlaka iptal olur garantisi yoktur. Operasyonel shutdown/drain ve gerekirse transaction içinde tekrar doğrulama tasarımı kabul edilmeli; mevcut test sadece sonraki isteğin durduğunu gösterir.

Temizlik uygulaması henüz yok; test fixture.reset yalnız test içindir. Öneri: yalnız review_maintenance kullanan, production credential taşımayan ayrı kontrollü görev. Süresi geçmiş challenge/session için24saatlik inceleme tamponu; limits.started için en az15dk pencereyi geçtikten sonra24saat saklama; review_audit için30gün önerilen retention. Aktif challenge/session/hesap kilidi veya pencere sayaçları sıfırlanmaz. Silme küçük batch'lerle; runtime'a DELETE verilmez. Kaynak kapasiteleri300 öğrenci/randevu,512KB state ve son500 JSON audit kaydıdır; review_audit SQL tablosu sınırsız büyümemeli. Günlük aktiflik/kapasite izlenir. Eski terminal randevular için7gün sonrası kontrollü arşiv/temizlik veya oturumlar bittikten sonra audit'li reset önerilir; incelemeci işlemi sürerken zorunlu reset yapılmaz. Takvim örnekleri uygun okul gününe taşınır, QR zaman kontrolü bypass edilmez.

[Supabase pooler rehberi](https://supabase.com/docs/guides/database/connecting-to-postgres), [PostgreSQL transaction-local SET](https://www.postgresql.org/docs/17/sql-set.html).

## 6. Test kapsamı, riskler ve production izolasyon kanıtının sınırı

`audit/interactive-results.json`15/15 PASS; bu görevde yeniden koşturulmadı. Mevcut kaynak hash'leri son manifestoyla eşleşiyor. Kanıtlar PGlite/yerel sentetik fixture'a aittir; Supabase restricted role/RLS/gerçek çok bağlantılı transaction için PASS değildir.

1. parent book/list/cancel and student ownership — kayıtlı sonuç PASS.
2. teacher approve/reject and availability create/delete — kayıtlı sonuç PASS.
3. same slot concurrent booking one success one conflict — kayıtlı sonuç PASS.
4. concurrent different accounts serialize same slot and foreign parent cannot cancel — kayıtlı sonuç PASS.
5. same appointment concurrent decisions cannot overwrite terminal state — kayıtlı sonuç PASS.
6. parent cannot approve or edit another principal resource — kayıtlı sonuç PASS.
7. wrong tenant/header/resource and injected parent role are rejected — kayıtlı sonuç PASS.
8. synthetic QR obeys production decision evaluator and never checks in — kayıtlı sonuç PASS.
9. school admin student import/edit/remove uses only preconfigured synthetic parent — kayıtlı sonuç PASS.
10. school admin settings/staff edits and simulated activation never send — kayıtlı sonuç PASS.
11. school operations are admin only; global platform/licensing/payment stays denied — kayıtlı sonuç PASS.
12. teacher cannot approve foreign teacher appointment or delete foreign slot — kayıtlı sonuç PASS.
13. mutations survive new role session and are audited without secrets — kayıtlı sonuç PASS.
14. kill-switch and revoked account prevent writes — kayıtlı sonuç PASS.
15. no external provider or production pool call occurred — kayıtlı sonuç PASS.

Ek önceki kanıtlar: disk PGlite yeniden açılma kalıcılığı `audit/persistence-results.json`; eski19 güvenlik testi `review-auth-results.json`; gerçek AAB JS/CSS dört rol sözleşmesi `aab-interactive-results.json`. Bunlar da yeni Supabase şemasında çalıştırılmış sayılmaz. Fiziksel Android NOT TESTED.

**Yeni kabul testleri (henüz yapılmadı):** runtime şema/tablo CREATE/DROP/TRUNCATE/rol üyeliği reddi; account role/active/version/credential UPDATE reddi; audit read/update/delete reddi; school_state INSERT/DELETE reddi; public/managed tablo ve privileged function erişim reddi; RLS yanlış tenant/JSON root reddi; accounts hash sızıntısı olmadan login; iki gerçek pg bağlantısında slot/approve-reject yarışı; rollback/audit bütünlüğü; pooler ardışık transaction context sızıntısı; timeout/kopma; bakımın aktif oturumları koruması; kill-switch/revocation ve eski AAB sözleşmesi.

**Production ayrımı:** Bu inceleme yalnız belirtilen yeni projeye bağlandı. Production'a bağlantı/SQL yok. Demo kataloglarında foreign server/mapping/subscription ve normal iş tabloları bulunmadı; yerel domain yalnız enjekte edilen ReviewDb'yi kullanıyor, sağlayıcı/production repository import etmiyor. Önceki15 testte productionPoolCalls=0 ve externalProviderCalls=0.

Bununla birlikte bu kanıt “gelecekteki bütün bulut runtime'ları fiziksel olarak production'a erişemez” demek değildir. Mevcut `server/app.ts:66-69` review isteğini normal DB init/router'dan önce keser; aynı uygulama süreci normal backend ve production environment'ını yine barındırabilir. `server.ts:14` normal DB'yi başlangıçta init eder; gerçek credential bulunan ortamda inceleme için çalıştırılmamalı. Ayrı review-only runtime/secret ve network sınırı henüz kurulup test edilmedi. Netlify env/egress, Data API exposed-schema ayarı, upstream pooler→DB TLS ve diğer cloud entegrasyonları bu salt okunur katalog incelemesinde doğrulanmadı. İstemci→pooler CA/hostname doğrulaması bunların yerine geçmez.

Başlıca riskler: yanlış public grant, postgres/service_role kullanımı, şemasız sorgu, hatalı project guard, JSON iç referansların SQL FK olmaması, ortak servis credential'ının bütün demo state'e yetmesi, audit/rate tablosu büyümesi, Free proje duraklaması ve stale pool bağlantıları, test fixture'ın gerçek seed/migration gibi çalıştırılması. Free proje sürekliliği operasyonel izleme ister; inceleme sırasında erişilebilirlik varsayılmaz.

PG17.11 changelog incelendi: ltree/btree_gist/custom operator ve legacy pgcrypto PGP değişiklikleri bu yedi yeni tablo planında kullanılmıyor; yeni extension/reindex veya crypto migration önerilmedi. [Resmî değişiklik kaydı](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

## 7. Uygulamaya geçmek için gereken onay

**Plan hazır; kurulum ve yayın için NO-GO / onay bekleniyor.**

İstenen sonraki kapsam açıkça şu olmalı: yalnız bu demo projesi için private-schema/least-privilege migration dosyaları ve iki P0 backend uyarlamasının izole hazırlanması; yerel testten sonra demo DB'de schema/roller/RLS/grant uygulaması için ayrı onay. Dört sentetik hesabın credential/seed oluşturulması ve veri yazan kabul testleri de açıkça onaylanmalı. İstenirse bu izinler tek bir kontrollü demo kurulum onayında birleştirilebilir; production/Netlify/env/deploy/GitHub/gerçek mesaj gönderimi kapsam dışında kalır.

Bu görevde değişen yalnız yerel rapor `DATABASE-PREPARATION-PLAN.md` ve metadata kanıtı `audit/demo-database-readonly-inspection.json`. İş kodu, migration, veritabanı nesnesi, rol, hesap, environment veya production kaynağı değiştirilmedi.
