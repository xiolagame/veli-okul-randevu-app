import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import assert from 'node:assert';

console.log('================================================================');
console.log('TEST: SEED_SUPABASE_MIGRATION.SQL İDEMPOTENCY & INTEGRITY TEST');
console.log('================================================================');

async function testIdempotency() {
  const schemaPath = path.join(process.cwd(), 'server', 'database', 'supabase_schema.sql');
  const migrationSqlPath = path.join(process.cwd(), 'server', 'database', 'seed_supabase_migration.sql');

  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');

  // İzole, sıfır test veritabanı
  const db = new PGlite();

  console.log('\n[ADIM 1] Canlı Schema (supabase_schema.sql) uygulanıyor...');
  await db.exec(schemaSql);
  console.log('  ✓ Schema başarıyla derlendi ve uygulandı.');

  // Tablo sayım fonksiyonu
  const countTables = async () => {
    const tables = [
      'schools',
      'users',
      'school_memberships',
      'school_roster',
      'students',
      'student_parent_relations',
      'teacher_profiles',
      'availability_slots',
      'appointments',
      'notifications',
      'audit_logs',
      'invitations'
    ];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      const res = await db.query<{ count: string }>(`SELECT count(*) as count FROM ${t};`);
      counts[t] = parseInt(res.rows[0].count, 10);
    }
    return counts;
  };

  console.log('\n[ADIM 2] 1. KEZ MIGRATION SQL ÇALIŞTIRILIYOR (Initial Migration)...');
  const t0 = Date.now();
  await db.exec(migrationSql);
  const dur1 = Date.now() - t0;
  console.log(`  ✓ 1. çalıştırma başarıyla tamamlandı (${dur1}ms).`);

  const countsAfterFirst = await countTables();
  console.log('\n  1. Çalıştırma Sonrası Gerçekleşen Kayıt Sayıları:');
  for (const [tbl, cnt] of Object.entries(countsAfterFirst)) {
    console.log(`    - ${tbl.padEnd(25)}: ${cnt}`);
  }

  // İlk Okul: Kahramankazan Şehit Ömer Takdemir Ortaokulu doğrulaması
  console.log('\n[KONTROL] İlk Okul (Kahramankazan) Doğrulaması...');
  const schoolCheck = await db.query<any>(`SELECT * FROM schools WHERE id = 'sch-kazan-01';`);
  assert.strictEqual(schoolCheck.rows.length, 1, 'sch-kazan-01 bulunamadı!');
  assert.strictEqual(
    schoolCheck.rows[0].name,
    'Kahramankazan Şehit Ömer Takdemir Ortaokulu',
    'Okul adı uyuşmuyor!'
  );
  console.log(`  ✓ Okul 1 ID korundu: ${schoolCheck.rows[0].id}`);
  console.log(`  ✓ Okul 1 Adı: ${schoolCheck.rows[0].name}`);
  console.log(`  ✓ Okul 1 Kodu: ${schoolCheck.rows[0].code} (${schoolCheck.rows[0].district}/${schoolCheck.rows[0].city})`);

  // Randevu student_id doğrulaması
  console.log('\n[KONTROL] Randevu student_id Doğrulaması...');
  const aptCheck = await db.query<any>(`SELECT id, student_id, student_name FROM appointments ORDER BY id;`);
  for (const row of aptCheck.rows) {
    console.log(`  - ${row.id}: student_id=${row.student_id ?? 'NULL'}, student_name=${row.student_name}`);
  }

  console.log('\n[ADIM 3] 2. KEZ MIGRATION SQL ÇALIŞTIRILIYOR (Idempotency Testi)...');
  const t1 = Date.now();
  let run2Error: any = null;
  try {
    await db.exec(migrationSql);
  } catch (err: any) {
    run2Error = err;
  }
  const dur2 = Date.now() - t1;

  assert.strictEqual(run2Error, null, `2. çalıştırmada beklenmeyen hata oluştu: ${run2Error?.message}`);
  console.log(`  ✓ 2. çalıştırma 0 hata ile tamamlandı (${dur2}ms).`);

  const countsAfterSecond = await countTables();
  console.log('\n[ADIM 4] DUPLICATE VE TUTARLILIK ANALİZİ:');
  let duplicateCount = 0;
  for (const [tbl, cnt1] of Object.entries(countsAfterFirst)) {
    const cnt2 = countsAfterSecond[tbl];
    const diff = cnt2 - cnt1;
    if (diff !== 0) duplicateCount += diff;
    console.log(`  - ${tbl.padEnd(25)}: 1. Run = ${cnt1} | 2. Run = ${cnt2} | Fark = ${diff} ${diff === 0 ? '✓ (0 Duplicate)' : '✗ DUPLICATE'}`);
  }

  assert.strictEqual(duplicateCount, 0, `İkinci çalıştırma duplicate üretti! Toplam duplicate: ${duplicateCount}`);
  console.log('\n================================================================');
  console.log('✓ TEBRİKLER! TÜM IDEMPOTENCY VE DUPLICATE KONTROLLERİ BAŞARILI!');
  console.log('================================================================\n');

  process.exit(0);
}

testIdempotency().catch((err) => {
  console.error('Test hatası:', err);
  process.exit(1);
});
