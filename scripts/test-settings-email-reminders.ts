import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import { generateAppointmentSlots } from '../src/utils/appointment-slots';
import { normalizeSchoolSettings, validateDefaultSlotMinutes } from '../src/utils/school-settings';
import { renderBrandedEmail } from '../server/email-template';
import { schoolAdminEmail } from '../server/school-admin-email';
import { getPublicOrigin } from '../server/public-origin';

let stage = 'setup';

function istanbulDateTime(minutesFromNow: number) {
  const date = new Date(Date.now() + minutesFromNow * 60_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local database required');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.RESEND_API_KEY = 'local-settings-email-test';
  process.env.EMAIL_FROM = 'local@example.test';
  const originalFetch = globalThis.fetch;
  const emails: Array<{ to: string[]; subject: string; html: string; text?: string; idempotencyKey: string | null }> = [];
  let failReminder = false;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.resend.com/emails')) {
      const payload = JSON.parse(String(init?.body || '{}')) as { to: string[]; subject: string; html: string; text?: string };
      if (failReminder && payload.subject.includes('30 Dakika')) return new Response('{}', { status: 503 });
      emails.push({ ...payload, idempotencyKey: new Headers(init?.headers).get('Idempotency-Key') });
      return new Response(JSON.stringify({ id: 'local-email' }), { status: 200 });
    }
    return originalFetch(input, init);
  };

  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken } = await import('../server/auth');
  const { runAppointmentReminderJob } = await import('../server/appointment-reminders');
  const db = await getDb();
  const suffix = crypto.randomUUID();
  const schoolA = `settings-a-${suffix}`;
  const schoolB = `settings-b-${suffix}`;
  const userIds: string[] = [];
  const teacherA = `teacher-a-${suffix}`;
  const teacherB = `teacher-b-${suffix}`;
  const noEmailTeacher = `teacher-no-email-${suffix}`;
  const phone = () => '+905' + crypto.randomInt(100000000, 999999999);
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;

  async function request(method: string, path: string, token?: string, body?: object) {
    const response = await fetch(base + path, { method, headers: {
      'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
    }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  async function user(role: 'admin' | 'parent' | 'teacher', schoolId: string, email?: string) {
    const id = `user-${crypto.randomUUID()}`;
    const userPhone = phone();
    userIds.push(id);
    await db.query(`INSERT INTO users(id,phone,first_name,last_name,email,password_hash,auth_version)
      VALUES($1,$2,'LOCAL','FIXTURE',$3,'local-nonempty-hash',0)`, [id, userPhone, email || null]);
    await db.query(`INSERT INTO school_memberships(school_id,user_id,role,status) VALUES($1,$2,$3,'active')`, [schoolId, id, role]);
    return { id, phone: userPhone, token: createToken({ userId: id, phone: userPhone, auth_version: 0 }) };
  }

  async function appointment(id: string, teacherId: string, status: string, studentName: string, minutesFromNow = 20, schoolId = schoolA) {
    const start = istanbulDateTime(minutesFromNow);
    const end = istanbulDateTime(minutesFromNow + 20);
    await db.query(`INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_name,parent_phone,
      student_name,class_name,date,start_time,end_time,status,entry_code,qr_token)
      VALUES($1,$2,$3,'LOCAL TEACHER','Türkçe','LOCAL PARENT','+905551112233',$4,'5-A',$5,$6,$7,$8,$9,$10)`,
      [id, schoolId, teacherId, studentName, start.date, start.time, end.time, status, crypto.randomInt(100000, 999999).toString(), `VELIQR1:${crypto.randomBytes(24).toString('base64url')}`]);
  }

  try {
    stage = 'pure duration and template rules';
    assert.deepEqual(generateAppointmentSlots([{ startTime: '09:00', endTime: '10:00' }], 20), [
      { time: '09:00', endTime: '09:20' }, { time: '09:20', endTime: '09:40' }, { time: '09:40', endTime: '10:00' },
    ]);
    assert.deepEqual(generateAppointmentSlots([{ startTime: '09:00', endTime: '09:50' }], 20), [
      { time: '09:00', endTime: '09:20' }, { time: '09:20', endTime: '09:40' },
    ]);
    assert.equal(normalizeSchoolSettings({ slotDuration: 25 }, 'Legacy').defaultSlotMinutes, 25);
    assert.equal(validateDefaultSlotMinutes('', 10), null);
    assert.equal(validateDefaultSlotMinutes(0, 10), null);
    assert.equal(validateDefaultSlotMinutes(25, 10), 25);
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEmailPublicOrigin = process.env.EMAIL_PUBLIC_ORIGIN;
    const originalNetlifyUrl = process.env.URL;
    delete process.env.EMAIL_PUBLIC_ORIGIN;
    delete process.env.URL;
    process.env.NODE_ENV = 'production';
    assert.equal(getPublicOrigin(), 'https://velirandevu.com');
    assert.equal(`${getPublicOrigin()}/branding/veli-randevu-logo.png`, 'https://velirandevu.com/branding/veli-randevu-logo.png');
    assert.equal(`${getPublicOrigin()}/#appointment-review=school.token`, 'https://velirandevu.com/#appointment-review=school.token');
    process.env.NODE_ENV = 'test';
    assert.equal(getPublicOrigin(), 'http://localhost:3000');
    process.env.EMAIL_PUBLIC_ORIGIN = 'https://email.example.test/';
    process.env.URL = 'https://netlify.example.test';
    assert.equal(getPublicOrigin(), 'https://email.example.test');
    delete process.env.EMAIL_PUBLIC_ORIGIN;
    assert.equal(getPublicOrigin(), 'https://netlify.example.test');
    process.env.NODE_ENV = originalNodeEnv;
    if (originalEmailPublicOrigin === undefined) delete process.env.EMAIL_PUBLIC_ORIGIN;
    else process.env.EMAIL_PUBLIC_ORIGIN = originalEmailPublicOrigin;
    if (originalNetlifyUrl === undefined) delete process.env.URL;
    else process.env.URL = originalNetlifyUrl;
    const unsafe = renderBrandedEmail({ subtitle: 'Test', greeting: '<script>alert(1)</script>', intro: ['A&B'] });
    assert(unsafe.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert(!unsafe.html.includes('<script>alert(1)</script>'));
    assert.match(unsafe.html, /<img src="(?:https:\/\/|http:\/\/localhost(?::\d+)?)/);
    assert(unsafe.text.includes('VELİ RANDEVU'));
    const adminEmail = schoolAdminEmail('School <A>', 'ABC123', 'Admin & One', '123456');
    assert(adminEmail.html.includes('School &lt;A&gt;'));
    assert(adminEmail.text.includes('Aktivasyon Kodu: 123456'));
    const adminSource = fs.readFileSync('src/components/AdminView.tsx', 'utf8');
    assert(!adminSource.includes('setDefaultSlotInput(Number(event.target.value))'));
    for (const file of ['server/api.ts', 'server/appointment-email.ts', 'server/school-admin-email.ts', 'server/appointment-reminders.ts']) {
      const source = fs.readFileSync(file, 'utf8');
      assert(source.includes('renderBrandedEmail'), `${file} must use the shared email renderer`);
    }
    assert(fs.readFileSync('server/appointment-email.ts', 'utf8').includes('getPublicOrigin()'));
    const retiredOrigin = ['https://veli', 'rokulrandevu.netlify.app'].join('');
    for (const file of ['server/public-origin.ts', 'server/email-template.ts', 'server/appointment-email.ts']) {
      assert(!fs.readFileSync(file, 'utf8').includes(retiredOrigin), `${file} must not use the retired production origin`);
    }

    stage = 'tenant fixtures';
    await db.query(`INSERT INTO schools(id,name,code,city,district,settings) VALUES
      ($1,'Duration School A',$2,'Test','Test',$3::jsonb),
      ($4,'Duration School B',$5,'Test','Test',$6::jsonb)`, [
      schoolA, `DURA${suffix.slice(0, 8)}`, JSON.stringify({ schoolName: 'Duration School A', appName: 'Veli Randevu', defaultSlotMinutes: 20, minSlotMinutes: 10, maxBookingDaysAhead: 30, allowParentCancel: true }),
      schoolB, `DURB${suffix.slice(0, 8)}`, JSON.stringify({ schoolName: 'Duration School B', appName: 'Veli Randevu', defaultSlotMinutes: 15, minSlotMinutes: 10, maxBookingDaysAhead: 30, allowParentCancel: true }),
    ]);
    const adminA = await user('admin', schoolA);
    const parentA = await user('parent', schoolA);
    const parentB = await user('parent', schoolB);
    const teacherUserA = await user('teacher', schoolA);
    const teacherUserB = await user('teacher', schoolB);
    const reminderTeacher = await user('teacher', schoolA, 'reminder@example.test');
    const noEmailUser = await user('teacher', schoolA);
    await db.query(`INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch,phone,email) VALUES
      ($1,$2,$3,'DURATION','A','Türkçe',$4,NULL),($5,$6,$7,'DURATION','B','Türkçe',$8,NULL),
      ($9,$2,$10,'REMINDER','TEACHER','Matematik',$11,'reminder@example.test'),
      ($12,$2,$13,'NO EMAIL','TEACHER','Fen',$14,NULL)`, [
      teacherA, schoolA, teacherUserA.id, teacherUserA.phone,
      teacherB, schoolB, teacherUserB.id, teacherUserB.phone,
      `reminder-${suffix}`, reminderTeacher.id, reminderTeacher.phone,
      noEmailTeacher, noEmailUser.id, noEmailUser.phone,
    ]);
    const studentA = `student-a-${suffix}`;
    const studentB = `student-b-${suffix}`;
    await db.query(`INSERT INTO students(id,school_id,name,class_name) VALUES($1,$2,'STUDENT A','5-A'),($3,$4,'STUDENT B','5-A')`, [studentA, schoolA, studentB, schoolB]);
    await db.query(`INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES($1,$2,$3),($4,$5,$6)`, [schoolA, studentA, parentA.id, schoolB, studentB, parentB.id]);
    await db.query(`INSERT INTO availability_slots(school_id,teacher_id,day_of_week,start_time,end_time,slot_duration) VALUES
      ($1,$2,1,'09:00','10:00',15),($3,$4,1,'09:00','10:00',15)`, [schoolA, teacherA, schoolB, teacherB]);

    stage = 'settings API and backend duration enforcement';
    assert.equal((await request('PUT', `/schools/${schoolA}/settings`, adminA.token, { defaultSlotMinutes: 0 })).status, 400);
    const saved = await request('PUT', `/schools/${schoolA}/settings`, adminA.token, { defaultSlotMinutes: 20 });
    assert.equal(saved.status, 200);
    assert.equal((saved.body.settings as { defaultSlotMinutes: number }).defaultSlotMinutes, 20);
    const createdWindow = await request('POST', `/schools/${schoolA}/availability`, teacherUserA.token,
      { dayOfWeek: 2, startTime: '10:00', endTime: '11:00', slotDurationMinutes: 15 });
    assert.equal(createdWindow.status, 200);
    assert.equal((createdWindow.body.slot as { slotDurationMinutes: number }).slotDurationMinutes, 20);
    const availabilityA = await request('GET', `/schools/${schoolA}/availability`, parentA.token);
    assert((availabilityA.body.availability as { slotDurationMinutes: number }[]).every((slot) => slot.slotDurationMinutes === 20));
    const bookingA = { teacherId: teacherA, studentName: 'STUDENT A', className: '5-A', date: '2090-01-02', notes: '' };
    assert.equal((await request('POST', `/schools/${schoolA}/appointments`, parentA.token,
      { ...bookingA, startTime: '09:15', endTime: '09:35' })).status, 409);
    assert.equal((await request('POST', `/schools/${schoolA}/appointments`, parentA.token,
      { ...bookingA, startTime: '09:20', endTime: '09:40' })).status, 200);
    assert.equal((await request('POST', `/schools/${schoolA}/appointments`, parentA.token,
      { ...bookingA, startTime: '09:20', endTime: '09:40' })).status, 409);
    const bookingB = { teacherId: teacherB, studentName: 'STUDENT B', className: '5-A', date: '2090-01-02', notes: '' };
    assert.equal((await request('POST', `/schools/${schoolB}/appointments`, parentB.token,
      { ...bookingB, startTime: '09:15', endTime: '09:30' })).status, 200);

    stage = 'reminder eligibility and idempotency';
    const reminderTeacherId = `reminder-${suffix}`;
    const approvedId = `reminder-approved-${suffix}`;
    const pendingId = `reminder-pending-${suffix}`;
    const cancelledId = `reminder-cancelled-${suffix}`;
    const rejectedId = `reminder-rejected-${suffix}`;
    const noEmailId = `reminder-no-email-${suffix}`;
    await appointment(approvedId, reminderTeacherId, 'booked', '<script>STUDENT</script>', 10);
    await appointment(pendingId, reminderTeacherId, 'pending', 'PENDING STUDENT', 15);
    await appointment(cancelledId, reminderTeacherId, 'cancelled', 'CANCELLED STUDENT');
    await appointment(rejectedId, reminderTeacherId, 'rejected', 'REJECTED STUDENT');
    await appointment(noEmailId, noEmailTeacher, 'booked', 'NO EMAIL STUDENT');
    const emailCountBeforeReminder = emails.length;
    const firstRun = await runAppointmentReminderJob({ schoolId: schoolA });
    assert.equal(firstRun.sent, 1);
    assert.equal(emails.length, emailCountBeforeReminder + 1);
    const reminderEmail = emails.at(-1)!;
    assert.equal(reminderEmail.idempotencyKey, `teacher-appointment-reminder-30m/${approvedId}`);
    assert(reminderEmail.text?.includes('Randevunuza 30 dakika kaldı'));
    assert(reminderEmail.html.includes('&lt;script&gt;STUDENT&lt;/script&gt;'));
    assert(!reminderEmail.html.includes('VELIQR1:'));
    assert.equal((await db.query('SELECT status,teacher_reminder_30m_sent_at FROM appointments WHERE id=$1', [approvedId])).rows[0].status, 'booked');
    assert((await db.query('SELECT teacher_reminder_30m_sent_at FROM appointments WHERE id=$1', [approvedId])).rows[0].teacher_reminder_30m_sent_at);
    const secondRun = await runAppointmentReminderJob({ schoolId: schoolA });
    assert.equal(secondRun.sent, 0);
    assert.equal(emails.length, emailCountBeforeReminder + 1);
    for (const id of [pendingId, cancelledId, rejectedId]) {
      assert.equal((await db.query('SELECT teacher_reminder_30m_sent_at FROM appointments WHERE id=$1', [id])).rows[0].teacher_reminder_30m_sent_at, null);
    }

    stage = 'reminder provider failure and retry';
    const retryId = `reminder-retry-${suffix}`;
    await appointment(retryId, reminderTeacherId, 'booked', 'RETRY STUDENT', 25);
    failReminder = true;
    const failedRun = await runAppointmentReminderJob({ schoolId: schoolA });
    failReminder = false;
    assert.equal(failedRun.failed, 1);
    assert.equal((await db.query('SELECT status,teacher_reminder_30m_sent_at FROM appointments WHERE id=$1', [retryId])).rows[0].teacher_reminder_30m_sent_at, null);
    const retryRun = await runAppointmentReminderJob({ schoolId: schoolA });
    assert.equal(retryRun.sent, 1);
    assert((await db.query('SELECT teacher_reminder_30m_sent_at FROM appointments WHERE id=$1', [retryId])).rows[0].teacher_reminder_30m_sent_at);
    console.log('Settings, tenant slot duration, branded emails and appointment reminders PASS.');
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id IN ($1,$2)', [schoolA, schoolB]);
    for (const id of userIds) await db.query('DELETE FROM users WHERE id=$1', [id]);
  }
}

run().catch((cause: unknown) => {
  const location = cause instanceof Error ? cause.stack?.split('\n').find((line) => line.includes('test-settings-email-reminders.ts:'))?.trim() : undefined;
  const detail = cause instanceof Error ? cause.message : 'Unknown assertion failure';
  console.error(`Settings/email/reminder tests FAILED at ${stage}. ${detail} ${location || ''} No credentials or response bodies are logged.`);
  process.exitCode = 1;
});
