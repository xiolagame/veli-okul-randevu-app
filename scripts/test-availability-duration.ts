import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { bookableDate } from './lib/test-dates';
import { CUSTOM_MEETING_DURATIONS, effectiveMeetingDuration, parseCustomMeetingDuration } from '../src/utils/meeting-duration';
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
  assert.equal(meetingCount('09:00', '12:00', 40), 4);
  assert.equal(unusedMinutes('09:00', '12:00', 40), 20);
  assert.equal(unusedMinutes('09:00', '12:00', 30), 0);

  stage = 'source contracts';
  const form = fs.readFileSync('src/components/AvailabilityForm.tsx', 'utf8');
  assert(form.includes('id="availability-duration"') && form.includes('Okul süresi ({durationMinutes} dk)'));
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
    // Randevu aralığındaki ilk Pazar olmayan gün (Pazar müsaitlik günü değil).
    const date = [1, 2, 3, 4, 5, 6, 7].map(bookableDate).find((candidate) => new Date(`${candidate}T00:00:00Z`).getUTCDay() !== 0)!;
    const bookDay = new Date(`${date}T00:00:00Z`).getUTCDay();
    const path = `/schools/${schoolId}/availability`;

    stage = 'validation';
    for (const bad of [15, 25, 70, 'abc']) {
      const rejected = await request('POST', path, teacher.token, { dayOfWeek: bookDay, startTime: '08:00', endTime: '09:00', customDurationMinutes: bad });
      assert.equal(rejected.status, 400, `süre ${bad} reddedilmeli`);
    }
    assert.equal((await request('POST', path, teacher.token, { dayOfWeek: bookDay, startTime: '08:00', endTime: '08:30', customDurationMinutes: 40 })).status, 400, 'aralığa sığmayan süre');

    stage = 'create custom and school blocks';
    const custom = await request('POST', path, teacher.token, { dayOfWeek: bookDay, startTime: '09:00', endTime: '11:00', customDurationMinutes: 30 });
    assert.equal(custom.status, 200);
    assert.equal(custom.body.slot.customDurationMinutes, 30);
    assert.equal(custom.body.slot.slotDurationMinutes, 30);
    const school = await request('POST', path, teacher.token, { dayOfWeek: bookDay, startTime: '13:00', endTime: '14:00' });
    assert.equal(school.status, 200);
    assert.equal(school.body.slot.customDurationMinutes, null);
    const stringValue = await request('POST', path, teacher.token, { dayOfWeek: bookDay, startTime: '15:00', endTime: '16:00', customDurationMinutes: '60' });
    assert.equal(stringValue.status, 200);
    assert.equal(stringValue.body.slot.customDurationMinutes, 60);
    // Eski kayıt: slot_duration içinde eski okul süresi (20) yazılı, özel süre yok -> okul süresi (15) kullanılmalı.
    await db.query(`INSERT INTO availability_slots(id,school_id,teacher_id,day_of_week,start_time,end_time,slot_duration)
      VALUES($1,$2,$3,$4,'17:00','18:00',20)`, [`slot-legacy-${suffix}`, schoolId, teacherId, bookDay]);
    let constraintCode = '';
    try {
      await db.query(`INSERT INTO availability_slots(id,school_id,teacher_id,day_of_week,start_time,end_time,slot_duration,custom_duration_minutes)
        VALUES($1,$2,$3,$4,'19:00','20:00',25,25)`, [`slot-bad-${suffix}`, schoolId, teacherId, bookDay]);
    } catch (cause) { constraintCode = String((cause as { code?: string }).code || ''); }
    assert.equal(constraintCode, '23514', 'veritabanı izinsiz süreyi reddetmeli');

    stage = 'list returns effective duration';
    const listed = (await request('GET', path, teacher.token)).body.availability as Array<{ startTime: string; slotDurationMinutes: number; customDurationMinutes: number | null }>;
    const byStart = (start: string) => listed.find((slot) => slot.startTime === start)!;
    assert.equal(byStart('09:00').slotDurationMinutes, 30);
    assert.equal(byStart('13:00').slotDurationMinutes, 15);
    assert.equal(byStart('15:00').slotDurationMinutes, 60);
    assert.equal(byStart('17:00').slotDurationMinutes, 15, 'eski kayıt okul süresini izler');

    stage = 'booking uses each block duration';
    const parent = await person('parent', 'VELİ');
    const students = ['BİRİNCİ', 'İKİNCİ', 'ÜÇÜNCÜ'];
    for (const [index, name] of students.entries()) {
      const studentId = `stu-${index}-${suffix}`;
      await db.query('INSERT INTO students(id,school_id,name,class_name,student_number) VALUES($1,$2,$3,$4,$5)', [studentId, schoolId, `${name} ÖĞRENCİ`, '5-A', String(index + 1)]);
      await db.query('INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES($1,$2,$3)', [schoolId, studentId, parent.user.id]);
    }
    const book = (student: string, startTime: string, endTime: string) => request('POST', `/schools/${schoolId}/appointments`, parent.token,
      { teacherId, studentName: `${student} ÖĞRENCİ`, className: '5-A', date, startTime, endTime });
    assert.equal((await book('BİRİNCİ', '09:00', '09:15')).status, 409, '30 dk blokta 15 dk randevu reddedilmeli');
    assert.equal((await book('BİRİNCİ', '09:15', '09:45')).status, 409, '30 dk blokta kaymış başlangıç reddedilmeli');
    assert.equal((await book('BİRİNCİ', '09:30', '10:00')).status, 200, '30 dk blokta doğru randevu');
    assert.equal((await book('İKİNCİ', '13:00', '13:30')).status, 409, 'okul süreli blokta 30 dk reddedilmeli');
    assert.equal((await book('İKİNCİ', '13:15', '13:30')).status, 200, 'okul süreli blokta 15 dk randevu');
    assert.equal((await book('ÜÇÜNCÜ', '17:00', '17:20')).status, 409, 'eski kayıttaki 20 dk artık geçerli değil');
    assert.equal((await book('ÜÇÜNCÜ', '15:00', '16:00')).status, 200, '60 dk blokta tam saatlik randevu');

    console.log('Availability custom meeting duration: allowed values, DB check, effective list duration, legacy rows and per-block booking validation PASS.');
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
