import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Calendar } from 'lucide-react';
import { Metric } from '../src/components/ui';
import { calendarWeekday, intervalsOverlap, slotMatchesAvailability } from '../src/utils/appointment-slots';
import { AvailabilityCalendar } from '../src/components/AvailabilityCalendar';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local PGlite only.');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(32).toString('hex');
  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken } = await import('../server/auth');
  const { hashPassword } = await import('../server/passwords');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const db = await getDb();
  assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  const suffix = crypto.randomUUID();
  const schoolA = `slots-a-${suffix}`;
  const schoolB = `slots-b-${suffix}`;
  const teacherA = `slots-teacher-a-${suffix}`;
  const teacherA2 = `slots-teacher-a2-${suffix}`;
  const teacherB = `slots-teacher-b-${suffix}`;
  const users: string[] = [];
  const passwordHash = hashPassword(crypto.randomBytes(32).toString('base64url'));
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  const request = async (method: string, path: string, token: string, body?: object) => {
    const response = await fetch(base + path, { method, headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json',
    }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const createUser = async (role: 'parent' | 'teacher', schoolId: string) => {
    const phone = `+905${crypto.randomInt(100000000, 999999999)}`;
    const user = await userRepository.create({ phone, firstName: 'Local', lastName: 'Fixture' });
    users.push(user.id);
    await userRepository.updatePasswordHash(user.id, passwordHash);
    await membershipRepository.createOrActivate({ schoolId, userId: user.id, role });
    return { ...user, token: createToken({ userId: user.id, phone, auth_version: 0 }) };
  };
  const addStudent = async (schoolId: string, parentId: string, name: string, className: string) => {
    const id = `slots-student-${crypto.randomUUID()}`;
    await db.query('INSERT INTO students(id,school_id,name,class_name) VALUES($1,$2,$3,$4)', [id, schoolId, name, className]);
    await db.query('INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES($1,$2,$3)', [schoolId, id, parentId]);
  };
  try {
    assert(intervalsOverlap({ startTime: '10:30', endTime: '10:45' }, { startTime: '10:35', endTime: '10:50' }));
    assert(intervalsOverlap({ startTime: '10:30', endTime: '10:45' }, { startTime: '10:30', endTime: '10:45' }));
    assert(!intervalsOverlap({ startTime: '10:30', endTime: '10:45' }, { startTime: '10:45', endTime: '11:00' }));
    const mondaySlot = { dayOfWeek: 1, startTime: '12:30', endTime: '12:45', slotDurationMinutes: 15 };
    assert(slotMatchesAvailability(mondaySlot, '2090-03-13', '12:30', '12:45'));
    assert(!slotMatchesAvailability(mondaySlot, '2090-03-11', '12:30', '12:45'));
    const calendar = renderToStaticMarkup(React.createElement(AvailabilityCalendar, {
      month: '2090-03', selectedDate: '', weekdays: [1, 6], onMonthChange: () => {}, onSelectDate: () => {},
    }));
    assert(calendar.includes('aria-label="11/03/2090"') && calendar.includes('aria-label="13/03/2090"'));
    for (const day of [12, 14, 15, 16, 17]) assert(calendar.includes(`disabled="" aria-label="${day}/03/2090"`));
    for (const day of [11, 13]) assert(!calendar.includes(`disabled="" aria-label="${day}/03/2090"`));
    const parentManagement = fs.readFileSync('src/components/ParentManagement.tsx', 'utf8');
    assert(parentManagement.includes('kind="parent"') && parentManagement.includes('showRemove={false}'));
    const studentActions = parentManagement.match(/<ManagementActions[^>]*kind="student"[^>]*>/)?.[0];
    assert(studentActions && !studentActions.includes('showRemove'));
    const bookingView = fs.readFileSync('src/components/ParentView.tsx', 'utf8');
    const stylesheet = fs.readFileSync('src/index.css', 'utf8');
    assert(bookingView.includes('data-booked={slot.isBooked}') && bookingView.includes('disabled={slot.isBooked'));
    assert(stylesheet.includes('.slot-grid button[data-booked="true"] { text-decoration: line-through; }'));
    const metricMarkup = renderToStaticMarkup(React.createElement(Metric, { label: 'Onay bekleyen', value: 0, icon: Calendar, onClick: () => {} }));
    assert(metricMarkup.includes('<button') && metricMarkup.includes('type="button"') && metricMarkup.includes('randevuları göster'));

    for (const schoolId of [schoolA, schoolB]) await db.query(
      'INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [schoolId, 'Local school', schoolId, 'Test', 'Test']);
    const parentA = await createUser('parent', schoolA);
    const parentA2 = await createUser('parent', schoolA);
    const foreignParent = await createUser('parent', schoolB);
    const teacherUserA = await createUser('teacher', schoolA);
    const teacherUserA2 = await createUser('teacher', schoolA);
    const teacherUserB = await createUser('teacher', schoolB);
    await addStudent(schoolA, parentA.id, 'STUDENT A', '5-C');
    await addStudent(schoolA, parentA2.id, 'STUDENT A2', '6-C');
    await addStudent(schoolB, foreignParent.id, 'STUDENT B', '7-B');
    for (const [id, schoolId, user] of [
      [teacherA, schoolA, teacherUserA], [teacherA2, schoolA, teacherUserA2], [teacherB, schoolB, teacherUserB],
    ] as const) await db.query(
      `INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch,phone)
       VALUES($1,$2,$3,'LOCAL','TEACHER','Türkçe',$4)`, [id, schoolId, user.id, user.phone]);

    const date = '2090-03-09';
    await db.query(`INSERT INTO availability_slots(school_id,teacher_id,day_of_week,start_time,end_time,slot_duration)
      VALUES($1,$2,$3,'09:30','09:45',15)`, [schoolA, teacherA, calendarWeekday(date)]);
    const path = `/schools/${schoolA}/teachers/${teacherA}/occupied-slots?date=${date}`;
    const booking = { teacherId: teacherA, studentName: 'STUDENT A', className: '5-C', date,
      startTime: '09:30', endTime: '09:45' };
    const otherBooking = { ...booking, studentName: 'STUDENT A2', className: '6-C' };
    const bookingPath = `/schools/${schoolA}/appointments`;
    const unavailable = await request('POST', bookingPath, parentA.token, {
      ...booking, date: '2090-03-11', startTime: '12:30', endTime: '12:45',
    });
    assert.equal(unavailable.status, 409, 'Unavailable Saturday must be rejected server-side.');
    await db.query(`INSERT INTO availability_slots(school_id,teacher_id,day_of_week,start_time,end_time,slot_duration)
      VALUES($1,$2,6,'11:00','11:15',15)`, [schoolA, teacherA]);
    const saturday = await request('POST', bookingPath, parentA.token, {
      ...booking, date: '2090-03-11', startTime: '11:00', endTime: '11:15',
    });
    assert.equal(saturday.status, 200, 'Configured Saturday slot must book.');
    assert.deepEqual((await request('GET', path, parentA.token)).body.occupied, []);
    assert.equal((await request('GET', path, foreignParent.token)).status, 403);
    assert.equal((await request('GET', `/schools/${schoolA}/teachers/${teacherB}/occupied-slots?date=${date}`, parentA.token)).status, 404);
    assert.equal((await request('GET', `/schools/${schoolA}/teachers/${teacherA}/occupied-slots?date=bad`, parentA.token)).status, 400);

    const first = await request('POST', bookingPath, parentA.token, booking);
    assert.equal(first.status, 200, 'Initial booking must succeed.');
    const firstId = (first.body.appointment as { id: string }).id;
    assert(firstId);
    const parentList = await request('GET', bookingPath, parentA2.token);
    assert.equal((parentList.body.appointments as unknown[]).length, 0, 'Another parent must not see appointment details.');
    const occupied = await request('GET', path, parentA2.token);
    assert.equal(occupied.status, 200);
    assert.deepEqual(occupied.body.occupied, [{ startTime: '09:30', endTime: '09:45' }]);
    assert.deepEqual(Object.keys(occupied.body), ['occupied'], 'Occupancy must not leak appointment or parent data.');
    assert.deepEqual((await request('GET', `/schools/${schoolA}/teachers/${teacherA2}/occupied-slots?date=${date}`, parentA2.token)).body.occupied, []);
    assert.deepEqual((await request('GET', `/schools/${schoolA}/teachers/${teacherA}/occupied-slots?date=2090-03-10`, parentA2.token)).body.occupied, []);
    const conflict = await request('POST', bookingPath, parentA2.token, otherBooking);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, 'Bu saat az önce başka bir randevu için alındı. Lütfen başka bir saat seçin.');
    assert.equal((await request('POST', bookingPath, parentA2.token, { ...otherBooking, startTime: '09:40', endTime: '09:55' })).status, 409);
    assert.equal((await request('POST', `${bookingPath}/${firstId}/approve`, teacherUserA.token)).status, 200);
    assert.deepEqual((await request('GET', path, parentA2.token)).body.occupied, [{ startTime: '09:30', endTime: '09:45' }]);

    assert.equal((await request('POST', `${bookingPath}/${firstId}/cancel`, parentA.token)).status, 200);
    assert.deepEqual((await request('GET', path, parentA2.token)).body.occupied, []);
    const second = await request('POST', bookingPath, parentA2.token, otherBooking);
    assert.equal(second.status, 200, 'Cancelled slot must be reusable.');
    const secondId = (second.body.appointment as { id: string }).id;
    assert.equal((await request('POST', `${bookingPath}/${secondId}/reject`, teacherUserA.token)).status, 200);
    assert.deepEqual((await request('GET', path, parentA.token)).body.occupied, []);

    const concurrent = await Promise.all([
      request('POST', bookingPath, parentA.token, booking),
      request('POST', bookingPath, parentA2.token, otherBooking),
    ]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
    assert.deepEqual((await request('GET', path, parentA.token)).body.occupied, [{ startTime: '09:30', endTime: '09:45' }]);
    console.log('Appointment occupancy, release, overlap, concurrency, tenant, and UI markup tests PASS.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id IN ($1,$2)', [schoolA, schoolB]);
    for (const id of users) await db.query('DELETE FROM users WHERE id=$1', [id]);
  }
}

run().catch((cause: unknown) => {
  const location = cause instanceof Error ? cause.stack?.split('\n').find((line) => line.includes('test-appointment-slot-visibility.ts:'))?.trim() : undefined;
  console.error(`Appointment slot visibility tests FAILED. ${location || ''} No credentials or response bodies are logged.`);
  process.exitCode = 1;
});
