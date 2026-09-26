/**
 * VELİ OKUL RANDEVU SİSTEMİ - EXPRESS API & POSTGRESQL INTEGRATION TEST SUITE
 * 
 * Verifies that the Express API routes execute directly against the PostgreSQL engine
 * (all repositories, transactions, concurrency rules, RLS, and tenant isolation)
 * without using store.json in memory.
 */

import http from 'http';
import express from 'express';
import { apiRouter } from '../server/api';
import { initDatabase, getDb } from '../server/database/postgres';
import { bootstrapLocalPasswordFixtures } from './test-auth-fixtures';
import { appointmentRepository, availabilityRepository } from '../server/repositories';
import { calendarWeekday } from '../src/utils/appointment-slots';
import { displayStoredTurkishPhone } from '../src/utils/phone';
import { evaluateSecurityQr } from '../server/appointment-entry';

async function runApiIntegrationTests() {
  console.log('===============================================================');
  console.log('🚀 EXPRESS API → POSTGRESQL FULL INTEGRATION TEST BAŞLIYOR');
  console.log('===============================================================');

  // Step 1: Initialize Database
  console.log('\n[1/10] PostgreSQL Veritabanı başlatılıyor...');
  await initDatabase();
  const db = await getDb();
  const fixturePassword = await bootstrapLocalPasswordFixtures(db);
  console.log('✅ PostgreSQL Veritabanı hazır.');

  // Step 2: Set up real HTTP test server on ephemeral port
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const createdAppointmentIds: string[] = [];
  const createdSlotIds: string[] = [];
  console.log(`✅ Test HTTP sunucusu ${baseUrl} adresinde dinliyor.`);

  // Helper for real HTTP requests
  async function makeRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options?: {
      headers?: Record<string, string>;
      body?: any;
      query?: Record<string, string>;
    }
  ): Promise<{ status: number; body: any }> {
    let url = baseUrl + path;
    if (options?.query) {
      const q = new URLSearchParams(options.query).toString();
      if (q) url += '?' + q;
    }

    const res = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(options?.headers || {}),
      },
      body: options?.body ? JSON.stringify({ ...options.body,
        ...(typeof options.body.phone === 'string' && /^\+905\d{9}$/.test(options.body.phone)
          ? { phone: displayStoredTurkishPhone(options.body.phone) } : {}) }) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (method === 'POST' && path === '/schools/sch-kazan-01/appointments' && res.status === 200 && data.appointment?.id) {
      createdAppointmentIds.push(data.appointment.id);
    }
    return { status: res.status, body: data };
  }

  try {
    // TEST 1: Health Check (PostgreSQL Status)
    console.log('\n[2/10] GET /api/health testi...');
    const healthRes = await makeRequest('GET', '/health');
    if (healthRes.status !== 200 || healthRes.body.status !== 'ok') {
      throw new Error(`Health check failed: ${JSON.stringify(healthRes.body)}`);
    }
    console.log(`✅ Health check başarılı: Engine=${healthRes.body.services.database.engine}, Status=${healthRes.body.services.database.status}`);

    // TEST 2: Public School List & Context
    console.log('\n[3/10] Public School API testleri...');
    const schoolsRes = await makeRequest('GET', '/public/schools');
    if (schoolsRes.status !== 401) throw new Error('Anonymous school enumeration must be denied.');
    console.log('✅ Anonim okul kataloğu erişimi engellendi.');

    const contextRes = await makeRequest('GET', '/public/school-context', { query: { code: 'KAZAN2025' } });
    if (contextRes.status !== 200 || contextRes.body.school?.id !== 'sch-kazan-01') {
      throw new Error(`GET /public/school-context failed: ${JSON.stringify(contextRes.body)}`);
    }
    console.log(`✅ Okul bağlamı çözüldü: ${contextRes.body.school.name} (${contextRes.body.school.code})`);

    // TEST 3: Password Authentication
    console.log('\n[4/10] Password Authentication testi...');
    const phone = '+905559876543'; // Fatma Kaya
    const loginRes = await makeRequest('POST', '/auth/login', { body: { phone, password: fixturePassword } });
    if (loginRes.status !== 200 || !loginRes.body.token || loginRes.body.user?.phone !== phone) {
      throw new Error(`POST /auth/login failed: ${JSON.stringify(loginRes.body)}`);
    }
    if (!loginRes.body.memberships?.some((membership: { schoolId: string; role: string }) => membership.schoolId === 'sch-kazan-01' && membership.role === 'parent')) {
      throw new Error('Password login did not return the expected parent membership.');
    }
    const userToken = loginRes.body.token;
    console.log('✅ Parola doğrulandı. Token üretildi.');

    // TEST 4: Profile /user/me
    console.log('\n[5/10] GET /user/me testi...');
    const meRes = await makeRequest('GET', '/user/me', {
      headers: { authorization: `Bearer ${userToken}` },
    });
    if (meRes.status !== 200 || !meRes.body.user) {
      throw new Error(`GET /user/me failed: ${JSON.stringify(meRes.body)}`);
    }
    console.log('✅ Profil ve okul üyelikleri sorgulandı.');

    // TEST 5: School Protected Endpoints (Teachers & Students)
    console.log('\n[6/10] Okul İçi Korumalı Endpointler (TenantGuard)...');
    const teachersRes = await makeRequest('GET', '/schools/sch-kazan-01/teachers', {
      headers: {
        authorization: `Bearer ${userToken}`,
        'x-school-id': 'sch-kazan-01',
      },
    });
    if (teachersRes.status !== 200 || !Array.isArray(teachersRes.body.teachers)) {
      throw new Error(`GET /schools/:id/teachers failed: ${JSON.stringify(teachersRes.body)}`);
    }
    console.log(`✅ sch-kazan-01 öğretmenleri listelendi: ${teachersRes.body.teachers.length} öğretmen.`);

    const studentsRes = await makeRequest('GET', '/schools/sch-kazan-01/students', {
      headers: {
        authorization: `Bearer ${userToken}`,
        'x-school-id': 'sch-kazan-01',
      },
    });
    if (studentsRes.status !== 200 || !Array.isArray(studentsRes.body.students)) {
      throw new Error(`GET /schools/:id/students failed: ${JSON.stringify(studentsRes.body)}`);
    }
    console.log(`✅ sch-kazan-01 veli öğrencileri listelendi: ${studentsRes.body.students.length} öğrenci.`);

    // TEST 6: Tenant Isolation Block (User in Okul A tries Okul B)
    console.log('\n[7/10] Çapraz Okul İhlali Engelleme Testi (TenantGuard 403 Testi)...');
    const crossTenantRes = await makeRequest('GET', '/schools/sch-ataturk-02/teachers', {
      headers: {
        authorization: `Bearer ${userToken}`,
        'x-school-id': 'sch-ataturk-02', // Fatma Kaya has NO membership in Atatürk Fen Lisesi
      },
    });
    if (crossTenantRes.status !== 403) {
      throw new Error(`Tenant isolation failed! Expected 403 Forbidden, received: ${crossTenantRes.status}`);
    }
    console.log('✅ TenantGuard başarılı: Üyeliksiz okul erişimi 403 Forbidden ile engellendi.');

    // TEST 7: Appointment Booking & Concurrency Double Booking
    console.log('\n[8/10] PostgreSQL Randevu Rezervasyonu ve Double-Booking Engeli...');
    const teacherId = teachersRes.body.teachers[0].id;
    const student = studentsRes.body.students[0];
    const testTime = '09:00';
    const testEndTime = '09:15';
    let testDate = '';
    for (let day = 1; day <= 28; day++) {
      const candidate = `2090-04-${String(day).padStart(2, '0')}`;
      if (calendarWeekday(candidate) !== 0 &&
          !await appointmentRepository.findConflictingAppointment('sch-kazan-01', teacherId, candidate, testTime)) {
        testDate = candidate;
        break;
      }
    }
    if (!testDate) throw new Error('No isolated local test slot available.');
    const availability = await availabilityRepository.createSlot({ schoolId: 'sch-kazan-01', teacherId,
      dayOfWeek: calendarWeekday(testDate)!, startTime: testTime, endTime: testEndTime, slotDurationMinutes: 15 });
    createdSlotIds.push(availability.id);

    // First booking: Should SUCCEED
    const bookRes1 = await makeRequest('POST', '/schools/sch-kazan-01/appointments', {
      headers: {
        authorization: `Bearer ${userToken}`,
        'x-school-id': 'sch-kazan-01',
      },
      body: {
        teacherId,
        studentName: student.name,
        className: student.className,
        date: testDate,
        startTime: testTime,
        endTime: testEndTime,
        notes: 'Test Randevusu 1',
      },
    });

    if (bookRes1.status !== 200 || !bookRes1.body.success) {
      throw new Error(`First appointment booking failed: ${JSON.stringify(bookRes1.body)}`);
    }
    const createdAppointment = bookRes1.body.appointment;
    console.log('✅ 1. Randevu oluşturuldu.');

    // Second booking (Exact same teacher, date, time): MUST BE REJECTED with 409 Conflict
    const bookRes2 = await makeRequest('POST', '/schools/sch-kazan-01/appointments', {
      headers: {
        authorization: `Bearer ${userToken}`,
        'x-school-id': 'sch-kazan-01',
      },
      body: {
        teacherId,
        studentName: student.name,
        className: student.className,
        date: testDate,
        startTime: testTime,
        endTime: testEndTime,
        notes: 'Çakışan Randevu 2',
      },
    });

    if (bookRes2.status !== 409) {
      throw new Error(`Double booking was NOT blocked! Expected 409, received: ${bookRes2.status}`);
    }
    console.log('✅ PostgreSQL Double-Booking engelleme başarılı: 409 Çakışma Hatası döndürüldü.');

    // TEST 8: Teacher Approval & Security Check-In
    console.log('\n[9/10] Randevu Onayı ve Güvenlik Nizamiye Giriş Kontrolü...');
    // Login as admin/teacher to approve
    const adminRes = await makeRequest('POST', '/auth/login', { body: { phone: '+905559998877', password: fixturePassword } });
    if (adminRes.status !== 200 || !adminRes.body.token) {
      throw new Error(`Admin password login failed: ${JSON.stringify(adminRes.body)}`);
    }
    const adminToken = adminRes.body.token;

    const approveRes = await makeRequest('POST', `/schools/sch-kazan-01/appointments/${createdAppointment.id}/approve`, {
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-school-id': 'sch-kazan-01',
      },
    });
    if (approveRes.status !== 200 || approveRes.body.appointment?.status !== 'booked') {
      throw new Error(`Approve appointment failed: ${JSON.stringify(approveRes.body)}`);
    }
    console.log('✅ Randevu öğretmen/yönetici tarafından onaylandı (status: booked).');

    // Security Login and Check-In
    const secRes = await makeRequest('POST', '/auth/login', { body: { phone: '+905550001122', password: fixturePassword } });
    if (secRes.status !== 200 || !secRes.body.token) {
      throw new Error(`Security password login failed: ${JSON.stringify(secRes.body)}`);
    }
    const secToken = secRes.body.token;

    const checkInRes = await makeRequest('POST', '/schools/sch-kazan-01/security/check-in', {
      headers: {
        authorization: `Bearer ${secToken}`,
        'x-school-id': 'sch-kazan-01',
      },
      body: { qrToken: approveRes.body.appointment.qrToken },
    });
    if (checkInRes.status !== 200 || checkInRes.body.allowed !== false || checkInRes.body.decision !== 'TOO_EARLY') {
      throw new Error(`Future appointment check-in was not denied: HTTP ${checkInRes.status}, decision ${checkInRes.body.decision}`);
    }
    const checkedIn = await appointmentRepository.getAppointmentById('sch-kazan-01', createdAppointment.id);
    if (checkedIn?.status !== 'booked') throw new Error('Early check-in changed the appointment status.');
    const permittedAt = new Date(`${testDate}T06:00:00Z`);
    if (evaluateSecurityQr(checkedIn, permittedAt).decision !== 'APPROVED') throw new Error('Valid entry window was not recognized.');
    console.log('✅ Gelecekteki QR giriş reddedildi; geçerli pencere kontrolü doğrulandı.');

    // TEST 9: Test Isolation Runner
    console.log('\n[10/10] PostgreSQL Çoklu Okul İzolasyon Testleri Çalıştırılıyor (/schools/:id/security/test-isolation)...');
    const previousPlatformAdmins = process.env.PLATFORM_ADMIN_USER_IDS;
    process.env.PLATFORM_ADMIN_USER_IDS = adminRes.body.user.id;
    const isoRes = await makeRequest('GET', '/schools/sch-kazan-01/security/test-isolation', {
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-school-id': 'sch-kazan-01',
      },
    });
    if (previousPlatformAdmins === undefined) delete process.env.PLATFORM_ADMIN_USER_IDS;
    else process.env.PLATFORM_ADMIN_USER_IDS = previousPlatformAdmins;
    if (isoRes.status !== 200 || !Array.isArray(isoRes.body.results)) {
      throw new Error(`Test isolation endpoint failed: ${JSON.stringify(isoRes.body)}`);
    }
    console.log(`✅ ${isoRes.body.results.length} izolasyon testi tamamlandı:`);
    for (const r of isoRes.body.results) {
      console.log(`   ${r.passed ? '🟢 PASSED' : '🔴 FAILED'}: ${r.title}`);
      if (!r.passed) {
        throw new Error(`Isolation test failed: ${r.title}`);
      }
    }

    console.log('\n===============================================================');
    console.log('🎉 TEBRİKLER! TÜM EXPRESS API & POSTGRESQL ENTEGRASYON TESTLERİ BAŞARIYLA GEÇTİ!');
    console.log('===============================================================');
  } finally {
    for (const id of createdAppointmentIds) {
      await db.query('DELETE FROM appointments WHERE school_id=$1 AND id=$2', ['sch-kazan-01', id]);
    }
    for (const id of createdSlotIds) await db.query('DELETE FROM availability_slots WHERE school_id=$1 AND id=$2', ['sch-kazan-01', id]);
    server.close();
    if (db && typeof db.close === 'function') {
      await db.close();
    }
  }

  process.exit(0);
}

runApiIntegrationTests().catch((err) => {
  console.error('\n❌ ENTEGRASYON TESTİNDE KRİTİK HATA:', err);
  process.exit(1);
});
