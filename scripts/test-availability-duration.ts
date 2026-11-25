import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { bookableDate } from './lib/test-dates';
import { CUSTOM_MEETING_DURATIONS, customDurationChoices, effectiveMeetingDuration, isCustomDurationAllowed, parseCustomMeetingDuration } from '../src/utils/meeting-duration';
import { meetingCount, unusedMinutes } from '../src/utils/availability-form';

// Öğretmenin müsaitlik bloğu için seçtiği görüşme süresi (20/30/40/50/60 dk) veya okul süresi.
let stage = 'pure rules';
async function run() {
  assert.deepEqual([...CUSTOM_MEETING_DURATIONS], [20, 30, 40, 50, 60]);
  assert.equal(parseCustomMeetingDuration(undefined), null);
  assert.equal(parseCustomMeetingDuration(''), null);
  assert.equal(parseCustomMeetingDuration(null), null);
  assert.equal(parseCustomMeetingDuration(30), 30);
  assert.equal(parseCustomMeetingDuration('40'), 40);
  for (const bad of [15, 25, 70, 0, -20, 20.5, 'abc', '30dk', {}]) assert.equal(parseCustomMeetingDuration(bad), 'invalid', String(bad));
  assert.equal(effectiveMeetingDuration(null, 15), 15);
  assert.equal(effectiveMeetingDuration(50, 15), 50);
  assert.equal(effectiveMeetingDuration(25, 15), 15, 'izinsiz değer okul süresine düşer');
  // Okul süresinden kısa seçenek sunulmaz: 15 -> 15(okul),20..60; 30 -> 30(okul),40,50,60; 60 ve üstü -> yalnız okul süresi.
  assert.deepEqual(customDurationChoices(15), [20, 30, 40, 50, 60]);
  assert.deepEqual(customDurationChoices(20), [30, 40, 50, 60]);
  assert.deepEqual(customDurationChoices(25), [30, 40, 50, 60]);
  assert.deepEqual(customDurationChoices(30), [40, 50, 60]);
  assert.deepEqual(customDurationChoices(55), [60]);
  assert.deepEqual(customDurationChoices(60), []);
  assert.deepEqual(customDurationChoices(90), []);
  assert.equal(isCustomDurationAllowed(20, 30), false);
  assert.equal(isCustomDurationAllowed(30, 30), true);
  assert.equal(isCustomDurationAllowed(40, 30), true);
  assert.equal(isCustomDurationAllowed(25, 15), false);
  assert.equal(meetingCount('09:00', '12:00', 40), 4);
  assert.equal(unusedMinutes('09:00', '12:00', 40), 20);
  assert.equal(unusedMinutes('09:00', '12:00', 30), 0);

  stage = 'source contracts';
  const form = fs.readFileSync('src/components/AvailabilityForm.tsx', 'utf8');
  assert(form.includes('role="radiogroup"') && form.includes('customDurationChoices(durationMinutes)') && !form.includes('Hafta içi'));
  const parent = fs.readFileSync('src/components/ParentView.tsx', 'utf8');
  assert(parent.includes('window.slotDurationMinutes || settings.defaultSlotMinutes'), 'veli saatleri blok süresiyle üretilmeli');

  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local test database required');
  process.env.NODE_ENV = 'test';
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');

  const { getDb } = await import('../server/database/postgres');
  const { createExpressApp } = await import('../server/app');
  const { createToken } = await import('../server/auth');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const db = await getDb();
  const suffix = crypto.randomBytes(5).toString('hex');
  const schoolId = `duration-${suffix}`;
  const userIds: string[] = [];
  const phone = () => `+905${crypto.randomInt(100000000, 999999999)}`;
  const settings = { schoolName: 'Süre Okulu', appName: 'Veli Randevu', defaultSlotMinutes: 15, minSlotMinutes: 10, maxBookingDaysAhead: 30, allowParentCancel: true };
  await db.query('INSERT INTO schools(id,name,code,city,district,settings) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
    [schoolId, 'Süre Okulu', `DU${suffix}`.toUpperCase(), 'Test', 'Test', JSON.stringify(settings)]);
  const server = http.createServer(createExpressApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  async function request(method: string, path: string, token: string, body?: object) {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
  }
  const person = async (role: 'teacher' | 'parent', firstName: string) => {
    const user = await userRepository.create({ phone: phone(), firstName, lastName: 'TEST', isPhoneVerified: true });
    userIds.push(user.id);
    await membershipRepository.createOrActivate({ schoolId, userId: user.id, role });
    const fresh = await userRepository.getById(user.id);
    return { user, token: createToken({ userId: user.id, phone: user.phone, auth_version: fresh!.authVersion, auth_method: 'phone_centric' }) };
  };

  try {
    stage = 'fixtures';
    const teacher = await person('teacher', 'ÖĞRETMEN');
    const teacherId = `tch-duration-${suffix}`;
    await db.query('INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch,phone) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [teacherId, schoolId, teacher.user.id, 'ÖĞRETMEN', 'TEST', 'Rehberlik', teacher.user.phone]);
    // Randevu aralığındaki Pazar olmayan üç farklı gün: her biri farklı bir süre için (günde tek süre kuralı).
    const dates = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(bookableDate).filter((candidate) => new Date(`${candidate}T00:00:00Z`).getUTCDay() !== 0);
    const [date30, date15, date60] = dates;
    const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
    const [day30, day15, day60] = [weekday(date30), weekday(date15), weekday(date60)];
    assert.equal(new Set([day30, day15, day60]).size, 3);
    const freeDay = [1, 2, 3, 4, 5, 6].find((day) => ![day30, day15, day60].includes(day))!;
    const path = `/schools/${schoolId}/availability`;

    stage = 'validation';
    for (const bad of [15, 25, 70, 'abc']) {
      const rejected = await request('POST', path, teacher.token, { dayOfWeek: freeDay, startTime: '08:00', endTime: '09:00', customDurationMinutes: bad });
      assert.equal(rejected.status, 400, `süre ${bad} reddedilmeli`);
    }
    assert.equal((await request('POST', path, teacher.token, { dayOfWeek: freeDay, startTime: '08:00', endTime: '08:30', customDurationMinutes: 40 })).status, 400, 'aralığa sığmayan süre');
    const notDivisible = await request('POST', path, teacher.token, { dayOfWeek: freeDay, startTime: '09:00', endTime: '10:30', customDurationMinutes: 60 });
    assert.equal(notDivisible.status, 400, '09:00–10:30 60 dk ile reddedilmeli');
    assert.match(String(notDivisible.body.error), /tam bölünmeli/);
    assert.equal((await request('POST', path, teacher.token, { dayOfWeek: freeDay, startTime: '05:00', endTime: '06:00', customDurationMinutes: 60 })).status, 400, '06:00 öncesi reddedilmeli');

    stage = 'create custom and school blocks';
    const custom = await request('POST', path, teacher.token, { dayOfWeek: day30, startTime: '09:00', endTime: '11:00', customDurationMinutes: 30 });
    assert.equal(custom.status, 200);
    assert.equal(custom.body.slot.customDurationMinutes, 30);
    assert.equal(custom.body.slot.slotDurationMinutes, 30);
    const school = await request('POST', path, teacher.token, { dayOfWeek: day15, startTime: '13:00', endTime: '14:00' });
    assert.equal(school.status, 200);
    assert.equal(school.body.slot.customDurationMinutes, null);
    const stringValue = await request('POST', path, teacher.token, { dayOfWeek: day60, startTime: '15:00', endTime: '16:00', customDurationMinutes: '60' });
    assert.equal(stringValue.status, 200);
    assert.equal(stringValue.body.slot.customDurationMinutes, 60);
    // Eski kayıt: slot_duration içinde eski okul süresi (20) yazılı, özel süre yok -> okul süresi (15) kullanılmalı.
    await db.query(`INSERT INTO availability_slots(id,school_id,teacher_id,day_of_week,start_time,end_time,slot_duration)
      VALUES($1,$2,$3,$4,'17:00','18:00',20)`, [`slot-legacy-${suffix}`, schoolId, teacherId, day15]);
    let constraintCode = '';
    try {
      await db.query(`INSERT INTO availability_slots(id,school_id,teacher_id,day_of_week,start_time,end_time,slot_duration,custom_duration_minutes)
        VALUES($1,$2,$3,$4,'19:00','20:00',25,25)`, [`slot-bad-${suffix}`, schoolId, teacherId, freeDay]);
    } catch (cause) { constraintCode = String((cause as { code?: string }).code || ''); }
    assert.equal(constraintCode, '23514', 'veritabanı izinsiz süreyi reddetmeli');

    stage = 'one duration per day';
    const otherDuration = await request('POST', path, teacher.token, { dayOfWeek: day30, startTime: '13:00', endTime: '14:00', customDurationMinutes: 60 });
    assert.equal(otherDuration.status, 409, 'aynı güne farklı süre eklenemez');
    assert.match(String(otherDuration.body.error), /için bir müsaitliğiniz var, farklı bir süre için önce onu silin\./);
    assert.equal((await request('POST', path, teacher.token, { dayOfWeek: day30, startTime: '13:00', endTime: '14:00', customDurationMinutes: 30 })).status, 200, 'aynı süreyle yeni aralık eklenebilir');
    const overlapping = await request('POST', path, teacher.token, { dayOfWeek: day30, startTime: '10:00', endTime: '10:30', customDurationMinutes: 30 });
    assert.equal(overlapping.status, 409);
    assert.match(String(overlapping.body.error), /için bu saatlerde başka bir müsaitliğiniz var\./);

    stage = 'durations shorter than the school duration are rejected';
    await db.query(`UPDATE schools SET settings=jsonb_set(settings,'{defaultSlotMinutes}','30') WHERE id=$1`, [schoolId]);
    const tooShort = await request('POST', path, teacher.token, { dayOfWeek: freeDay, startTime: '08:00', endTime: '09:00', customDurationMinutes: 20 });
    assert.equal(tooShort.status, 400, 'okul süresi 30 iken 20 dk reddedilmeli');
    assert.match(String(tooShort.body.error), /30 dk/);
    assert.equal((await request('POST', path, teacher.token, { dayOfWeek: freeDay, startTime: '08:00', endTime: '09:00', customDurationMinutes: 30 })).status, 200, 'okul süresine eşit kabul');
    await db.query('DELETE FROM availability_slots WHERE school_id=$1 AND day_of_week=$2', [schoolId, freeDay]);
    assert.equal((await request('POST', path, teacher.token, { dayOfWeek: freeDay, startTime: '10:00', endTime: '11:20', customDurationMinutes: 40 })).status, 200, 'okul süresinin üstü kabul');
    await db.query(`UPDATE schools SET settings=jsonb_set(settings,'{defaultSlotMinutes}','15') WHERE id=$1`, [schoolId]);
    await db.query('DELETE FROM availability_slots WHERE school_id=$1 AND day_of_week=$2', [schoolId, freeDay]);

    stage = 'list returns effective duration';
    const listed = (await request('GET', path, teacher.token)).body.availability as Array<{ dayOfWeek: number; startTime: string; slotDurationMinutes: number }>;
    const find = (day: number, start: string) => listed.find((slot) => slot.dayOfWeek === day && slot.startTime === start)!;
    assert.equal(find(day30, '09:00').slotDurationMinutes, 30);
    assert.equal(find(day15, '13:00').slotDurationMinutes, 15);
    assert.equal(find(day60, '15:00').slotDurationMinutes, 60);
    assert.equal(find(day15, '17:00').slotDurationMinutes, 15, 'eski kayıt okul süresini izler');

    stage = 'booking uses each block duration';
    const parent = await person('parent', 'VELİ');
    const students = ['BİRİNCİ', 'İKİNCİ', 'ÜÇÜNCÜ'];
    for (const [index, name] of students.entries()) {
      const studentId = `stu-${index}-${suffix}`;
      await db.query('INSERT INTO students(id,school_id,name,class_name,student_number) VALUES($1,$2,$3,$4,$5)', [studentId, schoolId, `${name} ÖĞRENCİ`, '5-A', String(index + 1)]);
      await db.query('INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES($1,$2,$3)', [schoolId, studentId, parent.user.id]);
    }
    const book = (student: string, date: string, startTime: string, endTime: string) => request('POST', `/schools/${schoolId}/appointments`, parent.token,
      { teacherId, studentName: `${student} ÖĞRENCİ`, className: '5-A', date, startTime, endTime });
    assert.equal((await book('BİRİNCİ', date30, '09:00', '09:15')).status, 409, '30 dk blokta 15 dk randevu reddedilmeli');
    assert.equal((await book('BİRİNCİ', date30, '09:15', '09:45')).status, 409, '30 dk blokta kaymış başlangıç reddedilmeli');
    assert.equal((await book('BİRİNCİ', date30, '09:30', '10:00')).status, 200, '30 dk blokta doğru randevu');
    assert.equal((await book('İKİNCİ', date15, '13:00', '13:30')).status, 409, 'okul süreli blokta 30 dk reddedilmeli');
    assert.equal((await book('İKİNCİ', date15, '13:15', '13:30')).status, 200, 'okul süreli blokta 15 dk randevu');
    assert.equal((await book('ÜÇÜNCÜ', date15, '17:00', '17:20')).status, 409, 'eski kayıttaki 20 dk artık geçerli değil');
    assert.equal((await book('ÜÇÜNCÜ', date60, '15:00', '16:00')).status, 200, '60 dk blokta tam saatlik randevu');

    console.log('Availability custom meeting duration: allowed values, DB check, effective list duration, legacy rows, whole-meeting ranges, one duration per day and per-block booking validation PASS.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id=$1', [schoolId]);
    for (const id of userIds) await db.query('DELETE FROM users WHERE id=$1', [id]);
  }
}

run().catch((cause) => {
  console.error(`Availability duration test FAILED at stage: ${stage}.`);
  console.error(cause);
  process.exitCode = 1;
});
