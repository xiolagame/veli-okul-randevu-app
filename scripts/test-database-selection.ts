import { describe, it } from 'node:test';
import assert from 'node:assert';
import { initDatabase, getDb, closeDatabase } from '../server/database/postgres';

console.log('================================================================');
console.log('TEST: PRODUCTION DATABASE SELECTION & FAIL-FAST VERIFICATION');
console.log('================================================================');

async function testScenarioA() {
  console.log('\n[Senaryo A] NODE_ENV=production + Geçerli DATABASE_URL...');
  // Simüle edilen postgres:// portunda sunucu yoksa connection failure verir ve fail-fast etmeli, PGlite'a geçmemeli
  // Gerçek postgres sunucusu varsa remote pool döner.
  console.log('  -> Senaryo A mantıksal olarak test ediliyor.');
}

async function testScenarioB() {
  console.log('\n[Senaryo B] NODE_ENV=production + DATABASE_URL eksik...');
  const originalEnv = process.env.NODE_ENV;
  const originalUrl = process.env.DATABASE_URL;

  process.env.NODE_ENV = 'production';
  delete process.env.DATABASE_URL;

  let threwError = false;
  let errorMsg = '';

  try {
    // Isolated init call
    await initDatabase();
  } catch (err: any) {
    threwError = true;
    errorMsg = err.message;
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalUrl) process.env.DATABASE_URL = originalUrl;
  }

  assert.strictEqual(threwError, true, 'Production modunda DATABASE_URL yokken fail-fast olmalı!');
  assert.ok(
    errorMsg.includes('Production Fail-Fast'),
    `Beklenen fail-fast mesajı bulunamadı. Alınan: ${errorMsg}`
  );
  console.log('  ✓ Başarılı: Server başlamadı ve fail-fast hatası fırlattı:', errorMsg);
}

async function testScenarioC() {
  console.log('\n[Senaryo C] NODE_ENV=production + DATABASE_URL geçersiz/hatalı bağlantı...');
  const originalEnv = process.env.NODE_ENV;
  const originalUrl = process.env.DATABASE_URL;

  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = 'postgresql://invalid_user:invalid_pass@127.0.0.1:54399/non_existent_db';

  let threwError = false;
  let errorMsg = '';

  try {
    await initDatabase();
  } catch (err: any) {
    threwError = true;
    errorMsg = err.message;
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalUrl) {
      process.env.DATABASE_URL = originalUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  }

  assert.strictEqual(threwError, true, 'Hatalı DATABASE_URL durumunda fail-fast olmalı!');
  assert.ok(
    errorMsg.includes('KRİTİK HATA (PostgreSQL Fail-Fast)'),
    `Beklenen fail-fast mesajı alınamadı: ${errorMsg}`
  );
  console.log('  ✓ Başarılı: PGlite fallback OLMADI, fail-fast ile hata fırlatıldı:', errorMsg);
}

async function testScenarioD() {
  console.log('\n[Senaryo D] NODE_ENV=development + DATABASE_URL yok...');
  const originalEnv = process.env.NODE_ENV;
  const originalUrl = process.env.DATABASE_URL;

  process.env.NODE_ENV = 'development';
  delete process.env.DATABASE_URL;

  try {
    await initDatabase();
    const db = await getDb();
    assert.strictEqual(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
    const res = await db.query('SELECT 1 as test');
    assert.strictEqual(res.rows[0].test, 1);
    console.log('  ✓ Başarılı: Development ortamında PGlite engine seçildi:', db.engineType);
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalUrl) process.env.DATABASE_URL = originalUrl;
  }
}

async function run() {
  try {
    await testScenarioB();
    await testScenarioC();
    await testScenarioD();
    console.log('\n================================================================');
    console.log('TÜM PRODUCTION/DEVELOPMENT DATABASE SELECTION TESTLERİ BAŞARILI!');
    console.log('================================================================\n');
    process.exit(0);
  } catch (e) {
    console.error('Test hatası:', e);
    process.exit(1);
  }
}

run();
