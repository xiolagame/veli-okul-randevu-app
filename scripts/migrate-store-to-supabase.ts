// ==============================================================================
// VELİ - OKUL RANDEVU SİSTEMİ: IDEMPOTENT MIGRATION SCRIPT (FAZ 13)
// Migrates data from store.json into Supabase PostgreSQL.
// Can be run multiple times safely without duplicating records.
// ==============================================================================

import fs from 'fs';
import path from 'path';
import { getSupabaseClient, getPgPool } from '../server/database/client';

const STORE_PATH = path.join(process.cwd(), 'server', 'data', 'store.json');
const OUTPUT_SQL_PATH = path.join(process.cwd(), 'server', 'database', 'seed_supabase_migration.sql');

export async function runMigration() {
  console.log('--- BAŞLATILIYOR: Supabase PostgreSQL Idempotent Veri Migrationı ---');

  if (!fs.existsSync(STORE_PATH)) {
    console.error(`Kritik Hata: Veri kaynağı bulunamadı: ${STORE_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(STORE_PATH, 'utf-8');
  const store = JSON.parse(raw);

  const supabase = getSupabaseClient();
  const pgPool = getPgPool();

  console.log(`Okunan Veri Özeti:
  - Okullar: ${store.schools?.length || 0}
  - Kullanıcılar: ${store.users?.length || 0}
  - Üyelikler: ${store.schoolMemberships?.length || 0}
  - Kütük Kayıtları: ${store.schoolRoster?.length || 0}
  - Öğrenciler: ${store.students?.length || 0}
  - Öğrenci-Veli İlişkileri: ${store.studentParentRelations?.length || 0}
  - Öğretmenler: ${store.teacherProfiles?.length || 0}
  - Müsaitlik Slotları: ${store.availabilitySlots?.length || 0}
  - Randevular: ${store.appointments?.length || 0}
  - Bildirimler: ${store.notifications?.length || 0}
  - Denetim Logları: ${store.auditLogs?.length || 0}`);

  // Generate an idempotent SQL script file as a tangible, verifiable artifact
  let sqlScript = `-- ==============================================================================
-- VELİ - OKUL RANDEVU SİSTEMİ: İDEMPOTENT SEED & MIGRATION SQL
-- Üretim Tarihi: ${new Date().toISOString()}
-- ==============================================================================

BEGIN;

`;

  // 1. Schools
  for (const s of store.schools || []) {
    sqlScript += `INSERT INTO schools (id, name, code, city, district, settings)
VALUES ('${s.id}', '${s.name.replace(/'/g, "''")}', '${s.code}', '${s.city}', '${s.district}', '${JSON.stringify(s.settings)}'::jsonb)
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  city = EXCLUDED.city,
  district = EXCLUDED.district,
  settings = EXCLUDED.settings,
  updated_at = NOW();\n`;
  }

  // 2. Users
  for (const u of store.users || []) {
    sqlScript += `INSERT INTO users (id, phone, first_name, last_name, is_phone_verified, security_question)
VALUES ('${u.id}', '${u.phone}', '${(u.firstName || '').replace(/'/g, "''")}', '${(u.lastName || '').replace(/'/g, "''")}', ${!!u.isPhoneVerified}, '${(u.securityQuestion || '').replace(/'/g, "''")}')
ON CONFLICT (phone) DO UPDATE SET 
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  is_phone_verified = EXCLUDED.is_phone_verified,
  security_question = EXCLUDED.security_question,
  updated_at = NOW();\n`;
  }

  // 3. School Memberships
  for (const m of store.schoolMemberships || []) {
    sqlScript += `INSERT INTO school_memberships (id, school_id, user_id, role, branch, status, joined_at)
VALUES ('${m.id}', '${m.schoolId}', '${m.userId}', '${m.role}', ${m.branch ? `'${m.branch.replace(/'/g, "''")}'` : 'NULL'}, '${m.status || 'active'}', '${m.joinedAt || new Date().toISOString()}')
ON CONFLICT (school_id, user_id, role) DO UPDATE SET 
  branch = EXCLUDED.branch,
  status = EXCLUDED.status,
  updated_at = NOW();\n`;
  }

  // 4. Students
  for (const stu of store.students || []) {
    sqlScript += `INSERT INTO students (id, school_id, name, class_name, student_number)
VALUES ('${stu.id}', '${stu.schoolId}', '${stu.name.replace(/'/g, "''")}', '${stu.className}', '${stu.studentNumber || ''}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name,
  class_name = EXCLUDED.class_name,
  student_number = EXCLUDED.student_number,
  updated_at = NOW();\n`;
  }

  // 5. Student Parent Relations
  for (const rel of store.studentParentRelations || []) {
    sqlScript += `INSERT INTO student_parent_relations (id, school_id, student_id, parent_user_id, verified_at)
VALUES ('${rel.id}', '${rel.schoolId}', '${rel.studentId}', '${rel.parentUserId}', '${rel.verifiedAt || new Date().toISOString()}')
ON CONFLICT (school_id, student_id, parent_user_id) DO UPDATE SET 
  verified_at = EXCLUDED.verified_at;\n`;
  }

  // 6. School Roster
  for (const r of store.schoolRoster || []) {
    sqlScript += `INSERT INTO school_roster (id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed)
VALUES ('${r.id}', '${r.schoolId}', '${r.parentPhone}', '${r.parentName.replace(/'/g, "''")}', '${r.studentName.replace(/'/g, "''")}', '${r.className}', '${r.studentNumber || ''}', ${!!r.isClaimed})
ON CONFLICT (id) DO UPDATE SET 
  parent_name = EXCLUDED.parent_name,
  is_claimed = EXCLUDED.is_claimed,
  updated_at = NOW();\n`;
  }

  // 7. Teacher Profiles
  for (const t of store.teacherProfiles || []) {
    const linkedUserId = t.userId || (store.users.some((u: any) => u.id === t.id) ? t.id : null);
    sqlScript += `INSERT INTO teacher_profiles (id, school_id, user_id, first_name, last_name, branch, email, phone)
VALUES ('${t.id}', '${t.schoolId}', ${linkedUserId ? `'${linkedUserId}'` : 'NULL'}, '${t.firstName.replace(/'/g, "''")}', '${t.lastName.replace(/'/g, "''")}', '${t.branch.replace(/'/g, "''")}', '${t.email || ''}', '${t.phone || ''}')
ON CONFLICT (id) DO UPDATE SET 
  user_id = EXCLUDED.user_id,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  branch = EXCLUDED.branch,
  updated_at = NOW();\n`;
  }

  // 8. Availability Slots
  for (const av of store.availabilitySlots || []) {
    sqlScript += `INSERT INTO availability_slots (id, school_id, teacher_id, day_of_week, start_time, end_time, slot_duration, is_recurring)
VALUES ('${av.id}', '${av.schoolId}', '${av.teacherId}', ${av.dayOfWeek}, '${av.startTime}', '${av.endTime}', ${av.slotDuration || 15}, ${av.isRecurring !== false})
ON CONFLICT (id) DO UPDATE SET 
  day_of_week = EXCLUDED.day_of_week,
  start_time = EXCLUDED.start_time,
  end_time = EXCLUDED.end_time,
  updated_at = NOW();\n`;
  }

  // 9. Appointments
  for (const apt of store.appointments || []) {
    sqlScript += `INSERT INTO appointments (id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone, student_id, student_name, class_name, date, start_time, end_time, status, entry_code, notes, check_in_time, check_out_time)
VALUES ('${apt.id}', '${apt.schoolId}', '${apt.teacherId}', '${apt.teacherName.replace(/'/g, "''")}', '${apt.teacherBranch.replace(/'/g, "''")}', '${apt.parentId}', '${apt.parentName.replace(/'/g, "''")}', '${apt.parentPhone}', ${apt.studentId ? `'${apt.studentId}'` : 'NULL'}, '${apt.studentName.replace(/'/g, "''")}', '${apt.className}', '${apt.date}', '${apt.startTime}', '${apt.endTime}', '${apt.status}', '${apt.entryCode}', '${(apt.notes || '').replace(/'/g, "''")}', ${apt.checkInTime ? `'${apt.checkInTime}'` : 'NULL'}, ${apt.checkOutTime ? `'${apt.checkOutTime}'` : 'NULL'})
ON CONFLICT (id) DO UPDATE SET 
  status = EXCLUDED.status,
  student_id = EXCLUDED.student_id,
  check_in_time = EXCLUDED.check_in_time,
  check_out_time = EXCLUDED.check_out_time,
  updated_at = NOW();\n`;
  }

  // 10. Notifications
  for (const n of store.notifications || []) {
    sqlScript += `INSERT INTO notifications (id, school_id, user_id, title, message, date, read, appointment_id)
VALUES ('${n.id}', '${n.schoolId}', '${n.userId}', '${n.title.replace(/'/g, "''")}', '${n.message.replace(/'/g, "''")}', '${n.date}', ${!!n.read}, ${n.appointmentId ? `'${n.appointmentId}'` : 'NULL'})
ON CONFLICT (id) DO UPDATE SET 
  read = EXCLUDED.read;\n`;
  }

  // 11. Audit Logs
  for (const l of store.auditLogs || []) {
    sqlScript += `INSERT INTO audit_logs (id, school_id, timestamp, action, actor_name, details)
VALUES ('${l.id}', '${l.schoolId}', '${l.timestamp}', '${l.action.replace(/'/g, "''")}', '${l.actorName.replace(/'/g, "''")}', '${l.details.replace(/'/g, "''")}')
ON CONFLICT (id) DO NOTHING;\n`;
  }

  // 12. Invitations
  sqlScript += `INSERT INTO invitations (id, school_id, token, description, is_active)
VALUES 
  ('inv-kazan-qr', 'sch-kazan-01', 'QR-KAZAN-2025', 'Kahramankazan Veli Giriş QR Daveti', true),
  ('inv-ataturk-qr', 'sch-ataturk-02', 'QR-ATATURK-2025', 'Atatürk Fen Lisesi Veli Giriş QR Daveti', true),
  ('inv-cumhuriyet-qr', 'sch-cumhuriyet-03', 'QR-CUMHURIYET-2025', 'Cumhuriyet İlkokulu Veli Giriş QR Daveti', true)
ON CONFLICT (id) DO UPDATE SET 
  is_active = EXCLUDED.is_active,
  description = EXCLUDED.description;\n`;

  sqlScript += `\nCOMMIT;\n`;

  // Write SQL script
  fs.writeFileSync(OUTPUT_SQL_PATH, sqlScript, 'utf-8');
  console.log(`[BAŞARILI] İdempotent SQL Migration Dosyası Oluşturuldu: ${OUTPUT_SQL_PATH}`);

  // If live PG connection pool is available, execute the script
  if (pgPool) {
    console.log('Canlı PostgreSQL veritabanına bağlanılıyor ve migration uygulanıyor...');
    const client = await pgPool.connect();
    try {
      await client.query(sqlScript);
      console.log('[BAŞARILI] Tüm veriler canlı PostgreSQL veritabanına aktarıldı.');
    } catch (err: any) {
      console.error('PostgreSQL migration hatası:', err.message);
      throw err;
    } finally {
      client.release();
    }
  } else if (supabase) {
    console.log('Supabase istemcisi mevcut, tablolar senkronize ediliyor...');
    // Supabase JS upserts
    await supabase.from('schools').upsert(store.schools.map((s: any) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      city: s.city,
      district: s.district,
      settings: s.settings
    })));
    console.log('[BAŞARILI] Supabase okullar senkronize edildi.');
  } else {
    console.log('Bilgi: Canlı veritabanı bağlantısı bulunamadı (SUPABASE_URL / DATABASE_URL henüz atanmadı).');
    console.log(`Migration scripti ${OUTPUT_SQL_PATH} yolunda hazırlandı. Canlıya çıkışta Supabase SQL Editor veya psql ile tek tıkla çalıştırılabilir.`);
  }

  return { success: true, sqlPath: OUTPUT_SQL_PATH };
}

// Allow standalone execution via `tsx scripts/migrate-store-to-supabase.ts`
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('migrate-store-to-supabase')) {
  runMigration()
    .then(() => {
      console.log('Migration işlemi tamamlandı.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration başarısız oldu:', err);
      process.exit(1);
    });
}
