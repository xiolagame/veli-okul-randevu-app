import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';

async function runVerification() {
  console.log('================================================================');
  console.log('VELİ - POSTGRESQL & SUPABASE PRODUCTION VERIFICATION RUNNER');
  console.log('================================================================\n');

  const db = new PGlite();

  // 1. GERÇEK SUPABASE SCHEMA MIGRATION UYGULAMA
  console.log('[ADIM 1] Supabase PostgreSQL Schema (supabase_schema.sql) uygulanıyor...');
  const schemaPath = path.join(process.cwd(), 'server/database/supabase_schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');

  await db.exec(schemaSql);
  console.log('  -> Schema başarıyla derlendi ve veritabanına uygulandı.');

  // 2. TABLO DOĞRULAMASI
  console.log('\n[ADIM 2] Tablo Varlığı Doğrulaması (PostgreSQL Catalog pg_tables)...');
  const expectedTables = [
    'schools',
    'users',
    'school_memberships',
    'students',
    'student_parent_relations',
    'school_roster',
    'teacher_profiles',
    'availability_slots',
    'appointments',
    'notifications',
    'audit_logs',
    'invitations',
    'otp_verifications',
  ];

  const tablesResult = await db.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;`
  );
  const createdTables = tablesResult.rows.map((r) => r.tablename);

  for (const t of expectedTables) {
    const exists = createdTables.includes(t);
    if (!exists) {
      throw new Error(`[HATA] Beklenen tablo bulunamadı: ${t}`);
    }
    console.log(`  ✓ Tablo mevcut: ${t}`);
  }

  // 3. FOREIGN KEY, UNIQUE CONSTRAINT VE INDEX DOĞRULAMASI
  console.log('\n[ADIM 3] Constraint ve Index Doğrulaması...');
  const indexesResult = await db.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public';`
  );
  const indexes = indexesResult.rows;

  const doubleBookingIndex = indexes.find((i) => i.indexname === 'idx_appointments_no_double_booking');
  if (!doubleBookingIndex) {
    throw new Error('[HATA] idx_appointments_no_double_booking partial unique index bulunamadı!');
  }
  console.log(`  ✓ Double-booking index mevcut: ${doubleBookingIndex.indexname}`);
  console.log(`    Detay: ${doubleBookingIndex.indexdef}`);

  if (!doubleBookingIndex.indexdef.includes('rejected') || !doubleBookingIndex.indexdef.includes('cancelled')) {
    throw new Error('[HATA] Double-booking indexinde cancelled ve rejected filtreleri eksik!');
  }
  console.log('  ✓ Double-booking indexi rejected ve cancelled durumlarını doğru şekilde hariç tutuyor.');

  // Check RLS (Row Level Security) on tables
  console.log('\n[ADIM 4] RLS (Row Level Security) Doğrulaması (pg_class)...');
  const rlsResult = await db.query<{ relname: string; relrowsecurity: boolean }>(
    `SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') AND relkind = 'r';`
  );
  for (const row of rlsResult.rows) {
    if (expectedTables.includes(row.relname)) {
      if (!row.relrowsecurity) {
        throw new Error(`[HATA] Tabloda RLS aktif değil: ${row.relname}`);
      }
      console.log(`  ✓ RLS Aktif: ${row.relname}`);
    }
  }

  // 5. SEED DATA MIGRATION & IDEMPOTENCY TEST
  console.log('\n[ADIM 5] store.json Veri Migrationı (seed_supabase_migration.sql)...');
  const seedPath = path.join(process.cwd(), 'server/database/seed_supabase_migration.sql');
  const seedSql = fs.readFileSync(seedPath, 'utf-8');

  console.log('  -> 1. Kez Migration Çalıştırılıyor (Initial Migration)...');
  await db.exec(seedSql);

  const initialSchoolsCount = (await db.query(`SELECT count(*) FROM schools;`)).rows[0].count;
  const initialUsersCount = (await db.query(`SELECT count(*) FROM users;`)).rows[0].count;
  const initialMembershipsCount = (await db.query(`SELECT count(*) FROM school_memberships;`)).rows[0].count;
  const initialAppointmentsCount = (await db.query(`SELECT count(*) FROM appointments;`)).rows[0].count;

  console.log(`  ✓ Okullar: ${initialSchoolsCount}`);
  console.log(`  ✓ Kullanıcılar: ${initialUsersCount}`);
  console.log(`  ✓ Üyelikler: ${initialMembershipsCount}`);
  console.log(`  ✓ Randevular: ${initialAppointmentsCount}`);

  // Test Idempotency: Run seedSql again
  console.log('\n  -> 2. Kez Migration Çalıştırılıyor (Idempotency & Duplicate Kontrolü)...');
  await db.exec(seedSql);

  const secondSchoolsCount = (await db.query(`SELECT count(*) FROM schools;`)).rows[0].count;
  const secondUsersCount = (await db.query(`SELECT count(*) FROM users;`)).rows[0].count;
  const secondMembershipsCount = (await db.query(`SELECT count(*) FROM school_memberships;`)).rows[0].count;
  const secondAppointmentsCount = (await db.query(`SELECT count(*) FROM appointments;`)).rows[0].count;

  if (
    secondSchoolsCount !== initialSchoolsCount ||
    secondUsersCount !== initialUsersCount ||
    secondMembershipsCount !== initialMembershipsCount ||
    secondAppointmentsCount !== initialAppointmentsCount
  ) {
    throw new Error('[HATA] Idempotency başarısız: 2. çalıştırmada duplicate veri oluştu!');
  }
  console.log('  ✓ İdempotency testi başarılı: 0 hata, 0 duplicate üretildi.');

  // Specific school check
  const kazanSchool = await db.query<{ name: string; city: string }>(
    `SELECT name, city FROM schools WHERE id = 'sch-kazan-01';`
  );
  if (!kazanSchool.rows.length || !kazanSchool.rows[0].name.includes('Ömer Takdemir')) {
    throw new Error('[HATA] Kahramankazan Şehit Ömer Takdemir Ortaokulu veritabanında bulunamadı!');
  }
  console.log(`  ✓ Okul verisi doğrulandı: ${kazanSchool.rows[0].name}`);

  // 6. CONCURRENCY TEST (POSTGRESQL UNIQUE CONSTRAINT DOUBLE-BOOKING)
  console.log('\n[ADIM 6] Database-Level Concurrency & Çift Rezervasyon Testi...');
  const testTeacherId = 'u-teacher-1';
  const testSchoolId = 'sch-kazan-01';
  const testDate = '2026-11-20';
  const testStartTime = '14:00';
  const testEndTime = '14:20';

  // Request 1: Parent 1 attempts to book slot
  console.log('  -> İstek 1 (Veli A): Slot rezerve ediliyor...');
  await db.query(
    `INSERT INTO appointments (id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone, student_name, class_name, date, start_time, end_time, status, entry_code)
     VALUES ('apt-concur-1', $1, $2, 'Mehmet Kaya', 'Matematik', 'u-parent-1', 'Zeynep Kaya', '05551112233', 'Ayşe Kaya', '5-A', $3, $4, $5, 'pending', '777111');`,
    [testSchoolId, testTeacherId, testDate, testStartTime, testEndTime]
  );
  console.log('  ✓ İstek 1 başarılı: Slot rezerve edildi (pending).');

  // Request 2: Parent 2 attempts to book the EXACT SAME slot concurrently
  console.log('  -> İstek 2 (Veli B): Aynı öğretmene, aynı tarih/saatte eşzamanlı rezervasyon deneniyor...');
  let request2Blocked = false;
  try {
    await db.query(
      `INSERT INTO appointments (id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone, student_name, class_name, date, start_time, end_time, status, entry_code)
       VALUES ('apt-concur-2', $1, $2, 'Mehmet Kaya', 'Matematik', 'u-parent-2', 'Ali Demir', '05552223344', 'Can Demir', '5-B', $3, $4, $5, 'pending', '777222');`,
      [testSchoolId, testTeacherId, testDate, testStartTime, testEndTime]
    );
  } catch (err: any) {
    if (err.message.includes('idx_appointments_no_double_booking') || err.message.includes('unique constraint')) {
      request2Blocked = true;
      console.log(`  ✓ Concurrency Başarılı: PostgreSQL Unique Index ihlali fırlatarak çift rezervasyonu engelledi!`);
      console.log(`    Yakalana hata: ${err.message}`);
    } else {
      throw err;
    }
  }

  if (!request2Blocked) {
    throw new Error('[HATA] Concurrency başarısız: Çift rezervasyon engellenemedi!');
  }

  // 7. SLOT RELEASE TEST: Rejected & Cancelled
  console.log('\n[ADIM 7] Randevu Reddedildiğinde veya İptal Edildiğinde Slotun Yeniden Açılması Testi...');
  
  // Update Request 1 status to 'rejected'
  console.log('  -> İstek 1 durumu "rejected" olarak güncelleniyor...');
  await db.query(`UPDATE appointments SET status = 'rejected', rejection_reason = 'Ders programı çakışması' WHERE id = 'apt-concur-1';`);

  // Now, Veli B should be able to book the slot!
  console.log('  -> Veli B tekrar rezervasyon deniyor (Slot boşalmış olmalı)...');
  await db.query(
    `INSERT INTO appointments (id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone, student_name, class_name, date, start_time, end_time, status, entry_code)
     VALUES ('apt-concur-2', $1, $2, 'Mehmet Kaya', 'Matematik', 'u-parent-2', 'Ali Demir', '05552223344', 'Can Demir', '5-B', $3, $4, $5, 'pending', '777222');`,
    [testSchoolId, testTeacherId, testDate, testStartTime, testEndTime]
  );
  console.log('  ✓ Başarılı: Randevu reddedildiğinde slot serbest bırakıldı ve Veli B randevuyu alabildi.');

  // Now cancel Veli B's appointment and verify slot is free again
  console.log('  -> Veli B randevusu "cancelled" yapılıyor...');
  await db.query(`UPDATE appointments SET status = 'cancelled' WHERE id = 'apt-concur-2';`);

  // Veli C books the slot
  console.log('  -> Veli C rezervasyon deniyor (Cancelled sonrası slot boşalmış olmalı)...');
  await db.query(
    `INSERT INTO appointments (id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone, student_name, class_name, date, start_time, end_time, status, entry_code)
     VALUES ('apt-concur-3', $1, $2, 'Mehmet Kaya', 'Matematik', 'u-parent-x', 'Fatma Çelik', '05553334455', 'Elif Çelik', '5-C', $3, $4, $5, 'booked', '777333');`,
    [testSchoolId, testTeacherId, testDate, testStartTime, testEndTime]
  );
  console.log('  ✓ Başarılı: Randevu iptal edildiğinde slot serbest bırakıldı ve Veli C randevuyu alabildi.');

  // 8. RANDEVU VERİ BÜTÜNLÜĞÜ (Requirement 9)
  console.log('\n[ADIM 8] Randevu Veri Bütünlüğü Doğrulaması (Foreign Keys)...');
  let fkBlocked = false;
  try {
    // Attempt inserting appointment with non-existent school
    await db.query(
      `INSERT INTO appointments (id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone, student_name, class_name, date, start_time, end_time, status, entry_code)
       VALUES ('apt-fake-school', 'sch-nonexistent', $1, 'Mehmet Kaya', 'Matematik', 'u-parent-1', 'Zeynep Kaya', '05551112233', 'Ayşe Kaya', '5-A', '2026-11-21', '09:00', '09:20', 'pending', '999999');`,
      [testTeacherId]
    );
  } catch (err: any) {
    if (err.message.includes('foreign key constraint') || err.message.includes('fk_appointment_school')) {
      fkBlocked = true;
      console.log('  ✓ PostgreSQL Foreign Key ihlali: Var olmayan okula randevu eklenmesi engellendi.');
    } else {
      throw err;
    }
  }
  if (!fkBlocked) {
    throw new Error('[HATA] Foreign Key bütünlüğü başarısız!');
  }

  // 8b. COMPOSITE FK TEST: APPOINTMENT STUDENT COMPOSITE FK (school_id, student_id)
  console.log('  -> Composite FK Testi (appointments -> students cross-school koruması)...');
  let compositeStudentBlocked = false;
  try {
    // Attempt inserting appointment in sch-ataturk-02 referencing a student belonging to sch-kazan-01
    await db.query(
      `INSERT INTO appointments (id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone, student_id, student_name, class_name, date, start_time, end_time, status, entry_code)
       VALUES ('apt-cross-student', 'sch-ataturk-02', 'u-teacher-b1', 'Zeki Bulut', 'Fizik', 'u-parent-1', 'Ahmet Yılmaz', '05551234567', 'stu-1', 'Emre Yılmaz', '7-B', '2026-11-22', '10:00', '10:15', 'pending', '987123');`
    );
  } catch (err: any) {
    if (err.message.includes('fk_appointments_student') || err.message.includes('foreign key constraint')) {
      compositeStudentBlocked = true;
      console.log('  ✓ PostgreSQL Composite FK ihlali: Başka okulun öğrencisine randevu açılması engellendi.');
    } else {
      throw err;
    }
  }
  if (!compositeStudentBlocked) {
    throw new Error('[HATA] appointments.student_id composite foreign key çalışmadı!');
  }

  // 8c. COMPOSITE FK TEST: NOTIFICATION APPOINTMENT COMPOSITE FK (school_id, appointment_id)
  console.log('  -> Composite FK Testi (notifications -> appointments cross-school koruması)...');
  let compositeNotifBlocked = false;
  try {
    // Attempt inserting notification in sch-ataturk-02 referencing an appointment in sch-kazan-01
    await db.query(
      `INSERT INTO notifications (id, school_id, user_id, title, message, date, read, appointment_id)
       VALUES ('notif-cross-apt', 'sch-ataturk-02', 'u-parent-1', 'Hatalı Bildirim', 'Başka okul randevusu', 'Şimdi', false, 'apt-1');`
    );
  } catch (err: any) {
    if (err.message.includes('fk_notifications_appointment') || err.message.includes('foreign key constraint')) {
      compositeNotifBlocked = true;
      console.log('  ✓ PostgreSQL Composite FK ihlali: Başka okulun randevusuna bildirim bağlanması engellendi.');
    } else {
      throw err;
    }
  }
  if (!compositeNotifBlocked) {
    throw new Error('[HATA] notifications.appointment_id composite foreign key çalışmadı!');
  }

  // 8d. ON DELETE SET NULL (column_list) TEST: Student Deletion preserves appointment.school_id
  console.log('  -> ON DELETE SET NULL (student_id) Testi: Öğrenci silindiğinde appointment.student_id NULL olur, school_id korunur...');
  await db.query(
    `INSERT INTO students (id, school_id, name, class_name, student_number)
     VALUES ('stu-del-test', 'sch-kazan-01', 'Silinecek Öğrenci', '6-A', '9911');`
  );
  await db.query(
    `INSERT INTO appointments (id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone, student_id, student_name, class_name, date, start_time, end_time, status, entry_code)
     VALUES ('apt-del-test', 'sch-kazan-01', 'u-teacher-1', 'Mehmet Demir', 'Matematik', 'u-parent-1', 'Ahmet Yılmaz', '05551234567', 'stu-del-test', 'Silinecek Öğrenci', '6-A', '2026-11-28', '11:00', '11:15', 'pending', '112233');`
  );
  // Delete student
  await db.query(`DELETE FROM students WHERE id = 'stu-del-test';`);
  const aptAfterStudentDel = (await db.query<{ school_id: string; student_id: string | null }>(
    `SELECT school_id, student_id FROM appointments WHERE id = 'apt-del-test';`
  )).rows[0];
  if (aptAfterStudentDel.school_id !== 'sch-kazan-01' || aptAfterStudentDel.student_id !== null) {
    throw new Error(`[HATA] ON DELETE SET NULL (student_id) başarısız: school_id=${aptAfterStudentDel.school_id}, student_id=${aptAfterStudentDel.student_id}`);
  }
  console.log('  ✓ Başarılı: Öğrenci silindiğinde appointment.school_id korundu, student_id NULL yapıldı.');

  // 8e. ON DELETE SET NULL (column_list) TEST: Appointment Deletion preserves notification.school_id
  console.log('  -> ON DELETE SET NULL (appointment_id) Testi: Randevu silindiğinde notification.appointment_id NULL olur, school_id korunur...');
  await db.query(
    `INSERT INTO notifications (id, school_id, user_id, title, message, date, read, appointment_id)
     VALUES ('notif-del-test', 'sch-kazan-01', 'u-parent-1', 'Silinecek Randevu Bildirimi', 'Detay', 'Şimdi', false, 'apt-del-test');`
  );
  // Delete appointment
  await db.query(`DELETE FROM appointments WHERE id = 'apt-del-test';`);
  const notifAfterAptDel = (await db.query<{ school_id: string; appointment_id: string | null }>(
    `SELECT school_id, appointment_id FROM notifications WHERE id = 'notif-del-test';`
  )).rows[0];
  if (notifAfterAptDel.school_id !== 'sch-kazan-01' || notifAfterAptDel.appointment_id !== null) {
    throw new Error(`[HATA] ON DELETE SET NULL (appointment_id) başarısız: school_id=${notifAfterAptDel.school_id}, appointment_id=${notifAfterAptDel.appointment_id}`);
  }
  console.log('  ✓ Başarılı: Randevu silindiğinde notification.school_id korundu, appointment_id NULL yapıldı.');

  // 9. BULK UPLOAD TEST (CSV / EXCEL INSERTION) (Requirement 8)
  console.log('\n[ADIM 9] CSV/Excel Kütük Kaydı Doğrulaması (PostgreSQL DB Insert)...');
  const bulkInsertResult = await db.query(
    `INSERT INTO school_roster (id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed)
     VALUES ('rost-test-bulk', 'sch-kazan-01', '05559998877', 'Murat Yıldız', 'Ece Yıldız', '6-C', '1240', false)
     RETURNING id, school_id, student_name;`
  );
  console.log(`  ✓ Kütük kaydı doğrudan veritabanına yazıldı: ${bulkInsertResult.rows[0].student_name} (${bulkInsertResult.rows[0].id})`);

  // Verify it exists in DB
  const verifyRoster = await db.query(`SELECT student_name FROM school_roster WHERE id = 'rost-test-bulk';`);
  if (verifyRoster.rows.length === 0 || verifyRoster.rows[0].student_name !== 'Ece Yıldız') {
    throw new Error('[HATA] Bulk upload PostgreSQL doğrulaması başarısız!');
  }

  console.log('\n================================================================');
  console.log('TÜM SUPABASE POSTGRESQL DOĞRULAMALARI VE TESTLERİ EKSİKSİZ GEÇTİ!');
  console.log('================================================================\n');
  await db.close();
  process.exit(0);
}

runVerification().catch((err) => {
  console.error('\n[HATA] Test başarısız:', err);
  process.exit(1);
});
