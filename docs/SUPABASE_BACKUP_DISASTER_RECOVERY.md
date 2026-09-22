# VELİ - Okul Randevu Sistemi
## Supabase PostgreSQL Backup & Disaster Recovery (DR) Kılavuzu

Bu doküman, VELİ çok kiracılı (multi-tenant) randevu ve okul yönetim platformunun Supabase PostgreSQL veritabanı için yedekleme, felaket kurtarma (Disaster Recovery), PITR (Point-in-Time Recovery) ve snapshot yönetim prosedürlerini belgeler.

---

### 1. RPO ve RTO Hedefleri

| Metrik | Hedef Değer | Açıklama |
| :--- | :--- | :--- |
| **RPO (Recovery Point Objective)** | < 1 dakika (PITR ile) / < 24 saat (Daily Snapshot) | Veri kaybı toleransı |
| **RTO (Recovery Time Objective)** | < 15 dakika | Sistemin ayağa kaldırılma ve trafiğe açılma süresi |
| **İzolasyon Kriteri** | Çok Kiracılı Bütünlük | Yedek ve geri yükleme işlemlerinde tenant (`school_id`) ilişkileri bozulmaz |

---

### 2. Supabase Automated Daily Backups

Supabase Cloud altyapısında:
- **Otomatik Günlük Snapshot**: Her 24 saatte bir tüm veritabanı kümesinin (cluster) tutarlı fiziksel yedeği alınır.
- **Saklama Süresi (Retention)**: Pro planlarda varsayılan 7 gün, Enterprise planlarda 30 güne kadar saklanır.
- **Şifreleme**: Tüm yedekler AWS S3 / GCP Cloud Storage üzerinde AES-256 ile bekleyen veri (at-rest) şifrelemesine tabidir.
- **Erişim**: Supabase Dashboard -> **Database** -> **Backups** sekmesinden geçmiş günlük yedekler doğrudan görüntülenebilir ve tek tıkla yeni bir projeye veya mevcut projeye geri yüklenebilir.

---

### 3. Point-In-Time Recovery (PITR)

Veri tabanı düzeyinde kazara silme, bozulma veya SQL hatası durumunda saniye hassasiyetinde geçmişe dönmeyi sağlar.

1. **Çalışma Prensibi**: WAL (Write-Ahead Log) arşivleme teknolojisi ile PostgreSQL her işlemi anlık olarak günlüğe kaydeder.
2. **Aktifleştirme**:
   - Supabase Dashboard -> **Project Settings** -> **Add-ons** -> **Point in Time Recovery (PITR)** etkinleştirilir.
3. **Kurtarma Adımları**:
   - Supabase Dashboard -> **Database** -> **Backups** -> **Point in Time Recovery**.
   - Olayın gerçekleştiği kesin zaman dilimi seçilir (örneğin: `2026-09-20 14:32:15 UTC`).
   - "Restore to this point" onaylanır. Sistem belirtilen saniyeye kadar olan tüm işlemleri replay eder.

---

### 4. Manuel Dump ve Export Alma Adımları

#### Yöntem A: pg_dump ile Doğrudan PostgreSQL Dökümü Alma (Tavsiye Edilen)

Supabase PostgreSQL doğrudan bağlantı dizesi (`DATABASE_URL`) ile:

```bash
# 1. Tüm Şema ve Veriyi Sıkıştırılmış Özel Format Olarak Alma (.dump)
pg_dump "postgresql://postgres.[PROJECT-REF]:[DB-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --verbose \
  --file="veli_prod_backup_$(date +%Y%m%d_%H%M%S).dump"

# 2. Sadece DDL Şemasını Alma (.sql)
pg_dump "postgresql://postgres.[PROJECT-REF]:[DB-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres" \
  --schema-only \
  --file="veli_schema_backup_$(date +%Y%m%d).sql"

# 3. Belirli Bir Okulun (Tenant) Verisini Export Etme
pg_dump "postgresql://postgres.[PROJECT-REF]:[DB-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres" \
  --data-only \
  --table=appointments \
  --table=users \
  --file="veli_appointments_data.sql"
```

#### Yöntem B: Supabase CLI ile Yedekleme

```bash
# Supabase CLI kurulumu ve oturum açma
npm install -g supabase
supabase login

# Projeyi bağlama
supabase link --project-ref [YOUR-PROJECT-REF]

# Uzak veritabanını yerel migration ve schema olarak dökme
supabase db dump --data-only -f supabase_prod_data.sql
supabase db dump -f supabase_prod_full_schema.sql
```

---

### 5. Geri Yükleme (Restore Prosedürü)

Alınan bir `.dump` dosyasını yeni bir Supabase veya PostgreSQL instance'ına aktarmak için:

```bash
# 1. Hedef veritabanına pg_restore çalıştırma
pg_restore -v \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -d "postgresql://postgres.[NEW-PROJECT-REF]:[NEW-DB-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres" \
  veli_prod_backup_YYYYMMDD_HHMMSS.dump

# 2. RLS Politikalarını ve İndeksleri Doğrulama
# scripts/verify-supabase-postgres.ts komutu çalıştırılarak tüm kısıtlamalar doğrulanır:
npx tsx scripts/verify-supabase-postgres.ts
```

---

### 6. Disaster Recovery (Felaket Senaryosu ve Aksiyon Planı)

**Senaryo**: Supabase ana veri merkezi kesintisi veya kritik bir insan hatası (örn. yanlışlıkla tablo düşürülmesi).

1. **Trafik Kesme ve Bakım Modu**:
   - Cloudflare / Nginx ters vekili bakım sayfasına (`503 Maintenance`) yönlendirilir.
2. **Yedek Doğrulama**:
   - En güncel PITR noktası veya en son S3 günlük dump dosyası tespit edilir.
3. **Yeni Veritabanı Kümesi Açma**:
   - Alternatif bölgede (Örn: Frankfurt -> Londra veya GCP -> AWS) yeni Supabase projesi oluşturulur.
4. **Şema ve Veri Basma**:
   - `server/database/supabase_schema.sql` uygulanır.
   - Son dump veya `server/database/seed_supabase_migration.sql` aktarılır.
5. **Environment Variable Güncelleme**:
   - Sunucu tarafında `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` ve `DATABASE_URL` yeni veritabanı adresine güncellenir.
6. **Doğrulama ve Canlıya Alma**:
   - `/api/health` sorgulanarak veritabanı yanıt süresi kontrol edilir.
   - `npx tsx scripts/verify-supabase-postgres.ts` ile double-booking ve RLS testleri koşturulur.
   - Bakım modu kapatılarak trafik yönlendirilir.
