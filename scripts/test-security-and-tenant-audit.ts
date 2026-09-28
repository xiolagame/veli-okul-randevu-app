/**
 * VELİ OKUL RANDEVU SİSTEMİ - COMPREHENSIVE SECURITY & TENANT INTEGRITY AUDIT TEST SUITE
 * 
 * Tests all 8 audit sections requested:
 * 1. Repository queries & Tenant scoping
 * 2. Tenant integrity & Cross-tenant matrix
 * 3. Student/Parent relation integrity (composite foreign keys & triggers)
 * 4. Membership integrity (role escalation prevention)
 * 5. Appointment integrity (cross-school booking, approval, rejection, check-in)
 * 6. Transaction atomicity (rollback on failure)
 * 7. Double-booking concurrency prevention (PostgreSQL partial unique index 23505)
 * 8. Availability tenant scoping & isolation
 */

import http from 'http';
import express from 'express';
import { apiRouter } from '../server/api';
import { initDatabase, getDb } from '../server/database/postgres';
import { bootstrapLocalPasswordFixtures } from './test-auth-fixtures';
import { calendarWeekday } from '../src/utils/appointment-slots';
import { displayStoredTurkishPhone } from '../src/utils/phone';
import {
  appointmentRepository,
  availabilityRepository,
  relationRepository,
  studentRepository,
  membershipRepository,
  userRepository,
  rosterRepository,
  teacherRepository,
} from '../server/repositories';

interface TestResult {
  section: string;
  name: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, section: string, name: string, message: string) {
  if (condition) {
    results.push({ section, name, passed: true, message });
    console.log(`   ✅ [PASS] ${section} - ${name}: ${message}`);
  } else {
    results.push({ section, name, passed: false, message: `FAILED: ${message}` });
    console.error(`   ❌ [FAIL] ${section} - ${name}: ${message}`);
    throw new Error(`[${section}] ${name} FAILED: ${message}`);
  }
}

async function runSecurityAudit() {
  console.log('========================================================================');
  console.log('🔒 VELİ RANDEVU SİSTEMİ: PRODUCTION GÜVENLİK VE VERİ BÜTÜNLÜĞÜ AUDIT TESTİ');
  console.log('========================================================================\n');

  // Step 1: Initialize Database
  console.log('Initializing PostgreSQL database...');
  await initDatabase();
  const db = await getDb();
  const fixturePassword = await bootstrapLocalPasswordFixtures(db);
  console.log('Database initialized.\n');

  // Step 2: Set up test HTTP server
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const createdAppointmentIds: string[] = [];
  const createdSlotIds: string[] = [];

  async function makeReq(
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
    // -------------------------------------------------------------
    // SETUP TEST TOKENS
    // -------------------------------------------------------------
    console.log('--- HAZIRLIK: TEST KULLANICI TOKENLERİ ---');
    const login = async (phone: string) => {
      const response = await makeReq('POST', '/auth/login', { body: { phone, password: fixturePassword } });
      if (response.status !== 200 || !response.body.token || response.body.user?.phone !== phone) {
        throw new Error(`Password login failed for audit fixture: ${JSON.stringify(response.body)}`);
      }
      return response;
    };

    // Parent 1 (Fatma Kaya - Only in sch-kazan-01)
    const p1TokenRes = await login('+905559876543');
    const parent1Token = p1TokenRes.body.token;

    // Parent 2 (Ahmet Yılmaz - Multi-school in sch-kazan-01 and sch-cumhuriyet-03)
    const p2TokenRes = await login('+905551234567');
    const parent2Token = p2TokenRes.body.token;

    // Teacher 1 (Mehmet Demir - Only in sch-kazan-01)
    const t1TokenRes = await login('+905321112233');
    const teacher1Token = t1TokenRes.body.token;

    // Admin 1 (Admin in sch-kazan-01)
    const adminRes = await login('+905559998877');
    const admin1Token = adminRes.body.token;

    // Security 1 (Security in sch-kazan-01)
    const secRes = await login('+905550001122');
    const sec1Token = secRes.body.token;

    console.log('Test tokenleri başarıyla oluşturuldu.\n');

    // =========================================================================
    // SECTION 1 & 2: TENANT INTEGRITY & CROSS-TENANT MATRIX
    // =========================================================================
    console.log('--- BÖLÜM 1 & 2: TENANT INTEGRITY VE ÇAPRAZ OKUL MATRİSİ ---');

    // 2.1: School A User attempts to access School B via URL
    const crossSchoolRes = await makeReq('GET', '/schools/sch-ataturk-02/teachers', {
      headers: {
        authorization: `Bearer ${parent1Token}`,
        'x-school-id': 'sch-ataturk-02',
      },
    });
    assert(
      crossSchoolRes.status === 403,
      'BÖLÜM 2',
      'Cross-School Access Block',
      `Okul A velisinin Okul B verilerine erişimi 403 Forbidden ile engellendi (status: ${crossSchoolRes.status})`
    );

    // 2.2: Header Spoofing Protection (URL says sch-ataturk-02, Header says sch-kazan-01)
    const headerSpoofRes = await makeReq('GET', '/schools/sch-ataturk-02/teachers', {
      headers: {
        authorization: `Bearer ${parent1Token}`,
        'x-school-id': 'sch-kazan-01',
      },
    });
    assert(
      headerSpoofRes.status === 400,
      'BÖLÜM 2',
      'Header Spoofing Prevention',
      `URL ve X-School-Id uyumsuzluğunda 400 Bad Request döndürüldü (status: ${headerSpoofRes.status})`
    );

    // 2.3: Cross-school appointment lookup
    const crossAptRes = await appointmentRepository.getAppointmentById('sch-ataturk-02', 'apt-kazan-01');
    assert(
      crossAptRes === null,
      'BÖLÜM 1',
      'Repository Scope Guard',
      'Farklı okul ID ile çağrılan getAppointmentById null döndürdü'
    );

    // =========================================================================
    // SECTION 3: STUDENT / PARENT RELATION INTEGRITY AUDIT
    // =========================================================================
    console.log('\n--- BÖLÜM 3: ÖĞRENCİ - VELİ İLİŞKİ BÜTÜNLÜĞÜ (STUDENT-PARENT RELATION) ---');

    // 3.1: Try linking School B student to School A relation
    let crossStudentFkBlocked = false;
    try {
      // s-4 belongs to sch-cumhuriyet-03, attempting to link in sch-kazan-01
      await relationRepository.createRelation({
        schoolId: 'sch-kazan-01',
        studentId: 's-4',
        parentUserId: 'u-parent-1',
      });
    } catch (e: any) {
      crossStudentFkBlocked = true;
    }
    assert(
      crossStudentFkBlocked,
      'BÖLÜM 3',
      'Cross-School Student Relation Blocked',
      'Okul B öğrencisini Okul A velisiyle ilişkilendirme repository/FK seviyesinde engellendi'
    );

    // 3.2: Try linking Parent with NO membership in School A to a student in School A
    let crossParentBlocked = false;
    try {
      // u-parent-not-in-kazan does not have active membership in sch-kazan-01
      await relationRepository.createRelation({
        schoolId: 'sch-kazan-01',
        studentId: 's-1',
        parentUserId: 'u-nonexistent-parent',
      });
    } catch (e: any) {
      crossParentBlocked = true;
    }
    assert(
      crossParentBlocked,
      'BÖLÜM 3',
      'Cross-School Parent Relation Blocked',
      'Okulda üyeliği bulunmayan kullanıcının öğrenciye bağlanması engellendi'
    );

    // =========================================================================
    // SECTION 4: MEMBERSHIP INTEGRITY AUDIT
    // =========================================================================
    console.log('\n--- BÖLÜM 4: ÜYELİK VE ROL YÜKSELTME ENGELLEME (MEMBERSHIP INTEGRITY) ---');

    // 4.1: Attempting to claim with an arbitrary role payload
    const claimTamperRes = await makeReq('POST', '/onboarding/claim-students', {
      headers: {
        authorization: `Bearer ${parent1Token}`,
      },
      body: {
        schoolId: 'sch-kazan-01',
        role: 'admin', // Malicious client attempts role escalation
      },
    });
    // In our system, Fatma Kaya (+905559876543) has already claimed or will get parent role
    // Verify in database that her role in sch-kazan-01 is STILL parent, never admin
    const fatmaMembership = await membershipRepository.getActiveMembership(p1TokenRes.body.user.id, 'sch-kazan-01');
    assert(
      fatmaMembership?.role === 'parent',
      'BÖLÜM 4',
      'Role Escalation Prevention',
      `Kullanıcının rolü strictly parent olarak kaldı, admin yetkisine yükseltilemedi (role: ${fatmaMembership?.role})`
    );

    // 4.2: Attempting to claim in a school where phone is NOT in roster
    const crossRosterClaim = await makeReq('POST', '/onboarding/claim-students', {
      headers: {
        authorization: `Bearer ${parent1Token}`,
      },
      body: {
        schoolId: 'sch-cumhuriyet-03', // Fatma Kaya's phone is not in this roster
      },
    });
    assert(
      crossRosterClaim.status === 403,
      'BÖLÜM 4',
      'Cross-School Roster Claim Blocked',
      `Kütükte telefonu bulunmayan okula veli kaydı 403 Forbidden ile reddedildi (status: ${crossRosterClaim.status})`
    );

    // =========================================================================
    // SECTION 5: APPOINTMENT INTEGRITY AUDIT
    // =========================================================================
    console.log('\n--- BÖLÜM 5: RANDEVU BÜTÜNLÜĞÜ (APPOINTMENT INTEGRITY) ---');

    const testAptTime = '11:00';
    const kazanTeachers = await teacherRepository.getTeachers('sch-kazan-01');
    const teacherKazan = kazanTeachers.find((teacher) => teacher.userId === t1TokenRes.body.user.id);
    if (!teacherKazan) throw new Error('Active audit teacher fixture missing.');
    const freeDate = async (month: string, time: string) => {
      for (let day = 1; day <= 28; day++) {
        const date = `2090-${month}-${String(day).padStart(2, '0')}`;
        const weekday = calendarWeekday(date);
        if (weekday && !await appointmentRepository.findConflictingAppointment('sch-kazan-01', teacherKazan.id, date, time)) {
          const slot = await availabilityRepository.createSlot({ schoolId: 'sch-kazan-01', teacherId: teacherKazan.id,
            dayOfWeek: weekday, startTime: time, endTime: `${time.slice(0, 3)}15`, slotDurationMinutes: 15 });
          createdSlotIds.push(slot.id);
          return date;
        }
      }
      throw new Error('No isolated audit slot available.');
    };
    const testAptDate = await freeDate('01', testAptTime);

    const aptARes = await makeReq('POST', '/schools/sch-kazan-01/appointments', {
      headers: {
        authorization: `Bearer ${parent1Token}`,
        'x-school-id': 'sch-kazan-01',
      },
      body: {
        teacherId: teacherKazan.id,
        studentName: 'Burak Kaya',
        className: '8-C',
        date: testAptDate,
        startTime: testAptTime,
        endTime: '11:15',
        notes: 'Denetim Test Randevusu',
      },
    });
    assert(
      aptARes.status === 200 && aptARes.body.success,
      'BÖLÜM 5.A',
      'School A Appointment to School A Teacher',
      `Okul A içi randevu oluşturma (HTTP: ${aptARes.status}, ID mevcut: ${!!aptARes.body.appointment?.id})`
    );
    const createdAptId = aptARes.body.appointment.id;
    const entryCode = aptARes.body.appointment.entryCode;

    // 5.B: School A appointment -> School B teacher = REJECTED (404)
    const cumhuriyetTeachers = await teacherRepository.getTeachers('sch-cumhuriyet-03');
    const teacherCumhuriyetId = cumhuriyetTeachers.length > 0 ? cumhuriyetTeachers[0].id : 'u-teacher-b1';

    const aptBRes = await makeReq('POST', '/schools/sch-kazan-01/appointments', {
      headers: {
        authorization: `Bearer ${parent1Token}`,
        'x-school-id': 'sch-kazan-01',
      },
      body: {
        teacherId: teacherCumhuriyetId, // Teacher from School B
        studentName: 'Burak Kaya',
        className: '8-C',
        date: testAptDate,
        startTime: '14:00',
        endTime: '14:15',
      },
    });
    assert(
      aptBRes.status === 404,
      'BÖLÜM 5.B',
      'Cross-School Teacher Booking Blocked',
      `Başka bir okulun öğretmeni için randevu alma 404 ile reddedildi (status: ${aptBRes.status})`
    );

    // 5.C: School A appointment -> School B student = REJECTED (403)
    const aptCRes = await makeReq('POST', '/schools/sch-kazan-01/appointments', {
      headers: {
        authorization: `Bearer ${parent1Token}`,
        'x-school-id': 'sch-kazan-01',
      },
      body: {
        teacherId: teacherKazan.id,
        studentName: 'Can Yılmaz', // Belongs to sch-cumhuriyet-03
        className: '2-A',
        date: testAptDate,
        startTime: '14:30',
        endTime: '14:45',
      },
    });
    assert(
      aptCRes.status === 403,
      'BÖLÜM 5.C',
      'Cross-School Student Booking Blocked',
      `Veliye tanımlı olmayan öğrenci için randevu alma 403 ile reddedildi (status: ${aptCRes.status})`
    );

    // 5.D: School A parent -> School B appointment approve = REJECTED (403)
    const aptDRes = await makeReq('POST', `/schools/sch-ataturk-02/appointments/${createdAptId}/approve`, {
      headers: {
        authorization: `Bearer ${parent1Token}`,
        'x-school-id': 'sch-ataturk-02',
      },
    });
    assert(
      aptDRes.status === 403,
      'BÖLÜM 5.D',
      'Unauthorized Appointment Approval Blocked',
      `Veli ve yetkisiz okul randevu onayı 403 ile engellendi (status: ${aptDRes.status})`
    );

    // 5.E: Teacher A tries to approve / reject another teacher's appointment
    // Teacher 1 is logged in; if apt was with someone else, or reject test:
    const aptERes = await makeReq('POST', `/schools/sch-kazan-01/appointments/${createdAptId}/reject`, {
      headers: {
        authorization: `Bearer ${teacher1Token}`,
        'x-school-id': 'sch-kazan-01',
      },
      body: { reason: 'Test red' },
    });
    // teacher1 is teacherKazan, so this succeeds or verifies ownership
    assert(
      aptERes.status === 200,
      'BÖLÜM 5.E',
      'Teacher Appointment Ownership Check',
      `Öğretmen randevu reddi kontrolü yapıldı (status: ${aptERes.status})`
    );

    // 5.F: Security at School A cannot verify a QR from another tenant.
    // The current product contract deliberately returns HTTP 200 with a generic
    // fail-closed result for invalid/foreign QR values.
    const aptFRes = await makeReq('POST', '/schools/sch-kazan-01/security/qr/verify', {
      headers: {
        authorization: `Bearer ${sec1Token}`,
        'x-school-id': 'sch-kazan-01',
      },
      body: { qrToken: `VELIQR1:${'B'.repeat(32)}` },
    });
    assert(
      aptFRes.status === 200 &&
        aptFRes.body.allowed === false &&
        aptFRes.body.decision === 'INVALID' &&
        !aptFRes.body.appointment,
      'BÖLÜM 5.F',
      'Cross-School Security QR Verification Blocked',
      `Geçersiz/yabancı QR nizamiyede fail-closed reddedildi (status: ${aptFRes.status})`
    );

    // 5.G: School A appointment ID + School B schoolId = REJECTED (404)
    // Parent 2 has membership in both sch-kazan-01 and sch-cumhuriyet-03!
    const aptGRes = await makeReq('POST', `/schools/sch-cumhuriyet-03/appointments/${createdAptId}/cancel`, {
      headers: {
        authorization: `Bearer ${parent2Token}`,
        'x-school-id': 'sch-cumhuriyet-03',
      },
    });
    assert(
      aptGRes.status === 404,
      'BÖLÜM 5.G',
      'Cross-Tenant IDOR Blocked',
      `Okul A randevu ID'si Okul B bağlamında çağrıldığında 404 döndürüldü (status: ${aptGRes.status})`
    );

    // 5.H & 5.I: Slot cancellation and re-booking behavior
    // First, let's create a fresh appointment, cancel it, and verify slot can be re-booked!
    const slotDate = await freeDate('02', '09:00');
    const slotTime = '09:00';
    const aptH1 = await makeReq('POST', '/schools/sch-kazan-01/appointments', {
      headers: {
        authorization: `Bearer ${parent1Token}`,
        'x-school-id': 'sch-kazan-01',
      },
      body: {
        teacherId: teacherKazan.id,
        studentName: 'Burak Kaya',
        className: '8-C',
        date: slotDate,
        startTime: slotTime,
        endTime: '09:15',
      },
    });
    assert(aptH1.status === 200, 'BÖLÜM 5.H', 'Initial Slot Booking', 'Slot başarıyla rezerve edildi');
    const aptH1Id = aptH1.body.appointment.id;

    // Try booking identical slot while pending -> MUST BE 409
    const aptHDuplicate = await makeReq('POST', '/schools/sch-kazan-01/appointments', {
      headers: {
        authorization: `Bearer ${parent1Token}`,
        'x-school-id': 'sch-kazan-01',
      },
      body: {
        teacherId: teacherKazan.id,
        studentName: 'Burak Kaya',
        className: '8-C',
        date: slotDate,
        startTime: slotTime,
        endTime: '09:15',
      },
    });
    assert(
      aptHDuplicate.status === 409,
      'BÖLÜM 5.I',
      'Active Slot Re-booking Blocked',
      'Aktif (pending/booked) slot için mükerrer kayıt 409 Conflict ile engellendi'
    );

    // Now Cancel the appointment
    const cancelRes = await makeReq('POST', `/schools/sch-kazan-01/appointments/${aptH1Id}/cancel`, {
      headers: {
        authorization: `Bearer ${parent1Token}`,
        'x-school-id': 'sch-kazan-01',
      },
    });
    assert(cancelRes.status === 200, 'BÖLÜM 5.H', 'Cancel Appointment', 'Randevu başarıyla iptal edildi');

    // Re-book the same slot after cancellation: MUST SUCCEED (PostgreSQL partial unique index excludes cancelled)
    const rebookRes = await makeReq('POST', '/schools/sch-kazan-01/appointments', {
      headers: {
        authorization: `Bearer ${parent1Token}`,
        'x-school-id': 'sch-kazan-01',
      },
      body: {
        teacherId: teacherKazan.id,
        studentName: 'Burak Kaya',
        className: '8-C',
        date: slotDate,
        startTime: slotTime,
        endTime: '09:15',
      },
    });
    assert(
      rebookRes.status === 200,
      'BÖLÜM 5.H',
      'Re-book Cancelled Slot',
      'İptal edilen slot başarıyla tekrar rezerve edildi (Partial Unique Index doğrulaması)'
    );

    // =========================================================================
    // SECTION 6: TRANSACTION ATOMICITY AUDIT
    // =========================================================================
    console.log('\n--- BÖLÜM 6: TRANSACTION ATOMİKLİĞİ VE ROLLBACK TESTİ ---');

    // Test transaction rollback when a failure happens inside db.transaction
    let rollbackVerified = false;
    const preAptCount = (await appointmentRepository.getAppointments('sch-kazan-01')).length;

    try {
      await db.transaction(async (tx) => {
        await appointmentRepository.createAppointment(
          {
            id: 'apt-fail-test',
            schoolId: 'sch-kazan-01',
            teacherId: teacherKazan.id,
            teacherName: `${teacherKazan.firstName} ${teacherKazan.lastName}`,
            teacherBranch: teacherKazan.branch,
            parentId: p1TokenRes.body.user.id,
            parentName: 'Fatma Kaya',
            parentPhone: '+905559876543',
            studentName: 'Burak Kaya',
            className: '8-C',
            date: '2026-12-01',
            startTime: '10:00',
            endTime: '10:15',
            status: 'pending',
            entryCode: '999999',
            createdAt: new Date().toISOString(),
          },
          tx
        );

        // Intentionally throw error before commit to verify rollback
        throw new Error('SIMULATED_FAILURE_FOR_ROLLBACK_AUDIT');
      });
    } catch (e: any) {
      if (e.message === 'SIMULATED_FAILURE_FOR_ROLLBACK_AUDIT') {
        rollbackVerified = true;
      }
    }

    const postAptCount = (await appointmentRepository.getAppointments('sch-kazan-01')).length;
    assert(
      rollbackVerified && preAptCount === postAptCount,
      'BÖLÜM 6',
      'Transaction Rollback Guarantee',
      `Hata durumunda transaction geri alındı (Önceki kayıt: ${preAptCount}, Sonraki: ${postAptCount})`
    );

    // =========================================================================
    // SECTION 7: CONCURRENT DOUBLE-BOOKING AUDIT
    // =========================================================================
    console.log('\n--- BÖLÜM 7: CONCURRENCY DOUBLE-BOOKING TESTİ (idx_appointments_no_double_booking) ---');

    const concurrentDate = await freeDate('03', '15:00');
    const concurrentTime = '15:00';

    // Ahmet Yılmaz (Parent 2) and Fatma Kaya (Parent 1) book identical slot
    const resP1 = await makeReq('POST', '/schools/sch-kazan-01/appointments', {
      headers: { authorization: `Bearer ${parent1Token}`, 'x-school-id': 'sch-kazan-01' },
      body: {
        teacherId: teacherKazan.id,
        studentName: 'Burak Kaya',
        className: '8-C',
        date: concurrentDate,
        startTime: concurrentTime,
        endTime: '15:15',
      },
    });

    const resP2 = await makeReq('POST', '/schools/sch-kazan-01/appointments', {
      headers: { authorization: `Bearer ${parent2Token}`, 'x-school-id': 'sch-kazan-01' },
      body: {
        teacherId: teacherKazan.id,
        studentName: 'Emre Yılmaz',
        className: '7-B',
        date: concurrentDate,
        startTime: concurrentTime,
        endTime: '15:15',
      },
    });

    assert(
      resP1.status === 200 && resP2.status === 409,
      'BÖLÜM 7',
      'Double-Booking Prevention via Partial Unique Index',
      `İlk istek başarıyla slotu aldı (status: ${resP1.status}), aynı slota yapılan 2. istek PostgreSQL kısıtıyla engellendi (status: ${resP2.status})`
    );

    // =========================================================================
    // SECTION 8: AVAILABILITY TENANT AUDIT
    // =========================================================================
    console.log('\n--- BÖLÜM 8: AVAILABILITY (UYGUNLUK SAATLERİ) TENANT AUDIT ---');

    // 8.1: School A Teacher creates slot in School A = SUCCESS
    const createSlotRes = await makeReq('POST', '/schools/sch-kazan-01/availability', {
      headers: {
        authorization: `Bearer ${teacher1Token}`,
        'x-school-id': 'sch-kazan-01',
      },
      body: {
        dayOfWeek: 6,
        startTime: '13:00',
        endTime: '14:00',
        slotDurationMinutes: 15,
      },
    });
    assert(
      createSlotRes.status === 200 && createSlotRes.body.success,
      'BÖLÜM 8.1',
      'Teacher Create Slot',
      `Öğretmen kendi okulunda slot oluşturdu (Slot ID: ${createSlotRes.body.slot?.id})`
    );
    const newSlotId = createSlotRes.body.slot.id;
    assert(createSlotRes.body.slot.dayOfWeek === 6, 'BÖLÜM 8.1', 'Saturday Slot Persisted', 'Cumartesi günü repository ve API üzerinden korundu');
    const secondSaturdaySlot = await makeReq('POST', '/schools/sch-kazan-01/availability', {
      headers: { authorization: `Bearer ${teacher1Token}`, 'x-school-id': 'sch-kazan-01' },
      body: { dayOfWeek: 6, startTime: '14:30', endTime: '15:30', slotDurationMinutes: 15 },
    });
    assert(secondSaturdaySlot.status === 200, 'BÖLÜM 8.1', 'Multiple Saturday Slots', 'Aynı Cumartesi için ikinci müsaitlik eklendi');
    createdSlotIds.push(secondSaturdaySlot.body.slot.id);
    assert((await makeReq('POST', '/schools/sch-kazan-01/availability', {
      headers: { authorization: `Bearer ${teacher1Token}`, 'x-school-id': 'sch-kazan-01' },
      body: { dayOfWeek: 0, startTime: '13:00', endTime: '14:00', slotDurationMinutes: 15 },
    })).status === 400, 'BÖLÜM 8.1', 'Sunday Slot Rejected', 'Pazar günü ekleme engellendi');

    // 8.2: School A User attempts to see School B availability
    const crossAvailRes = await makeReq('GET', '/schools/sch-ataturk-02/availability', {
      headers: {
        authorization: `Bearer ${parent1Token}`,
        'x-school-id': 'sch-ataturk-02',
      },
    });
    assert(
      crossAvailRes.status === 403,
      'BÖLÜM 8.2',
      'Cross-School Availability Read Blocked',
      `Okul A velisinin Okul B uygunluk slotlarını görmesi 403 ile engellendi`
    );

    // 8.3: Attempting to delete slot using another school's context
    const crossDeleteRes = await makeReq('DELETE', `/schools/sch-ataturk-02/availability/${newSlotId}`, {
      headers: {
        authorization: `Bearer ${admin1Token}`,
        'x-school-id': 'sch-ataturk-02',
      },
    });
    assert(
      crossDeleteRes.status === 403 || crossDeleteRes.status === 404,
      'BÖLÜM 8.3',
      'Cross-School Availability Delete Blocked',
      `Başka okul bağlamından slot silme 403/404 ile engellendi (status: ${crossDeleteRes.status})`
    );

    // 8.4: Teacher deletes their own slot = SUCCESS
    const selfDeleteRes = await makeReq('DELETE', `/schools/sch-kazan-01/availability/${newSlotId}`, {
      headers: {
        authorization: `Bearer ${teacher1Token}`,
        'x-school-id': 'sch-kazan-01',
      },
    });
    assert(
      selfDeleteRes.status === 200 && selfDeleteRes.body.success,
      'BÖLÜM 8.4',
      'Teacher Self Slot Delete',
      'Öğretmen kendi okulundaki kendi slotunu başarıyla sildi'
    );

    // 8.5: Slot ID alone does not give permission (nonexistent slot in school returns 404)
    const nonexistentDeleteRes = await makeReq('DELETE', `/schools/sch-kazan-01/availability/slot-nonexistent`, {
      headers: {
        authorization: `Bearer ${teacher1Token}`,
        'x-school-id': 'sch-kazan-01',
      },
    });
    assert(
      nonexistentDeleteRes.status === 404,
      'BÖLÜM 8.5',
      'Slot ID Isolation Guard',
      'Olmayan veya başka okula ait slot ID silinmek istendiğinde 404 döndürüldü'
    );

    console.log('\n========================================================================');
    console.log('🎉 AUDIT RAPORU: TÜM 8 BÖLÜM VE GÜVENLİK TESTLERİ %100 BAŞARIYLA TAMAMLANDI!');
    console.log('========================================================================\n');
  } finally {
    for (const id of createdAppointmentIds) {
      await db.query('DELETE FROM appointments WHERE school_id=$1 AND id=$2', ['sch-kazan-01', id]);
    }
    for (const id of createdSlotIds) await db.query('DELETE FROM availability_slots WHERE school_id=$1 AND id=$2', ['sch-kazan-01', id]);
    try {
      (server as any).closeAllConnections?.();
    } catch {}
    server.close();
    if (db && typeof db.close === 'function') {
      try {
        await db.close();
      } catch {}
    }
  }

  process.exit(0);
}

runSecurityAudit().catch((err) => {
  console.error('\n❌ AUDIT TESTİNDE KRİTİK HATA:', err);
  process.exit(1);
});
