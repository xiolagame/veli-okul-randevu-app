import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import type { Appointment, UserRole } from '../src/types';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) {
    throw new Error('This test requires local PGlite without DATABASE_URL.');
  }

  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken } = await import('../server/auth');
  const { appointmentRepository, membershipRepository, userRepository } = await import('../server/repositories');
  const db = await getDb();
  assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');

  const suffix = crypto.randomUUID();
  const schoolA = `teacher-owner-a-${suffix}`;
  const schoolB = `teacher-owner-b-${suffix}`;
  const teacherProfileA = `teacher-profile-a-${suffix}`;
  const teacherProfileB = `teacher-profile-b-${suffix}`;
  const teacherProfileForeign = `teacher-profile-foreign-${suffix}`;
  const appointmentA = `teacher-appointment-a-${suffix}`;
  const appointmentB = `teacher-appointment-b-${suffix}`;
  const phones: string[] = [];

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  function createPhone() {
    const phone = `+905${crypto.randomInt(100000000, 999999999)}`;
    phones.push(phone);
    return phone;
  }

  async function createUser(role: UserRole, schoolId: string) {
    const user = await userRepository.create({
      phone: createPhone(),
      firstName: 'Local',
      lastName: 'Teacher Ownership',
    });
    await membershipRepository.createOrActivate({ userId: user.id, schoolId, role });
    const authenticatedUser = await userRepository.getById(user.id);
    assert(authenticatedUser);
    return {
      user,
      token: createToken({
        userId: user.id,
        phone: user.phone,
        auth_version: authenticatedUser.authVersion,
      }),
    };
  }

  async function request(method: string, path: string, token: string, body?: object) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  function appointment(id: string, schoolId: string, teacherId: string, parentId: string): Appointment {
    return {
      id,
      schoolId,
      teacherId,
      teacherName: 'Local Teacher',
      teacherBranch: 'Türkçe',
      parentId,
      parentName: 'Local Parent',
      parentPhone: '+905551234567',
      studentName: 'Local Student',
      className: '5-A',
      date: '2026-09-23',
      startTime: '09:30',
      endTime: '09:45',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  }

  try {
    for (const schoolId of [schoolA, schoolB]) {
      await db.query(
        'INSERT INTO schools (id, name, code, city, district) VALUES ($1, $2, $3, $4, $5)',
        [schoolId, 'Local Teacher Ownership Test', crypto.randomBytes(8).toString('hex'), 'Test', 'Test']
      );
    }

    const teacherA = await createUser('teacher', schoolA);
    const teacherB = await createUser('teacher', schoolA);
    const foreignTeacher = await createUser('teacher', schoolB);
    const parent = await createUser('parent', schoolA);

    assert.notEqual(teacherA.user.id, teacherProfileA);
    assert.notEqual(teacherB.user.id, teacherProfileB);
    await db.query(
      `INSERT INTO teacher_profiles (id, school_id, user_id, first_name, last_name, branch, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7), ($8, $2, $9, $4, $5, $6, $10), ($11, $12, $13, $4, $5, $6, $14)`,
      [
        teacherProfileA, schoolA, teacherA.user.id, 'Local', 'Teacher', 'Türkçe', teacherA.user.phone,
        teacherProfileB, teacherB.user.id, teacherB.user.phone,
        teacherProfileForeign, schoolB, foreignTeacher.user.id, foreignTeacher.user.phone,
      ]
    );

    await appointmentRepository.createAppointment(appointment(appointmentA, schoolA, teacherProfileA, parent.user.id));
    await appointmentRepository.createAppointment(appointment(appointmentB, schoolA, teacherProfileB, parent.user.id));

    const list = await request('GET', `/schools/${schoolA}/appointments`, teacherA.token);
    assert.equal(list.status, 200);
    const appointments = list.body.appointments as Array<Record<string, unknown>>;
    assert.deepEqual(appointments.map((item) => item.id), [appointmentA]);
    assert.equal(appointments[0].qrToken, undefined);

    const ownApproval = await request('POST', `/schools/${schoolA}/appointments/${appointmentA}/approve`, teacherA.token);
    assert.equal(ownApproval.status, 200);
    assert.equal((ownApproval.body.appointment as Record<string, unknown>).id, appointmentA);
    assert.equal((ownApproval.body.appointment as Record<string, unknown>).qrToken, undefined);

    const otherApproval = await request(
      'POST',
      `/schools/${schoolA}/appointments/${appointmentB}/approve`,
      teacherA.token,
      { teacherId: teacherProfileA }
    );
    assert.equal(otherApproval.status, 403);

    const otherRejection = await request(
      'POST',
      `/schools/${schoolA}/appointments/${appointmentB}/reject`,
      teacherA.token,
      { teacherId: teacherProfileA, reason: 'Unauthorized test' }
    );
    assert.equal(otherRejection.status, 403);

    const foreignAccess = await request('POST', `/schools/${schoolA}/appointments/${appointmentA}/approve`, foreignTeacher.token);
    assert.equal(foreignAccess.status, 403);

    console.log('Teacher appointment ownership: profile/user ID separation and tenant guards PASS.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id IN ($1, $2)', [schoolA, schoolB]);
    for (const phone of phones) {
      await db.query('DELETE FROM users WHERE phone = $1', [phone]);
    }
  }
}

run().catch(() => {
  console.error('Teacher appointment ownership test FAILED. No credentials or response bodies are logged.');
  process.exitCode = 1;
});
