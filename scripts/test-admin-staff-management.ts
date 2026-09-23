import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) {
    throw new Error('This test requires local PGlite without DATABASE_URL.');
  }
  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken } = await import('../server/auth');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const db = await getDb();
  assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  const suffix = crypto.randomUUID();
  const schoolId = `staff-school-${suffix}`;
  const otherSchoolId = `staff-other-${suffix}`;
  const teacherId = `staff-profile-${suffix}`;
  const phones: string[] = [];
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  async function request(method: string, path: string, token?: string, body?: object, headerSchool?: string) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(headerSchool ? { 'x-school-id': headerSchool } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  function phone() {
    const value = `+905${crypto.randomInt(100000000, 999999999)}`;
    phones.push(value);
    return value;
  }
  async function fixture(role: 'admin' | 'parent' | 'teacher' | 'security', school = schoolId) {
    const user = await userRepository.create({ phone: phone(), firstName: 'Local', lastName: 'Staff Test' });
    await membershipRepository.createOrActivate({ userId: user.id, schoolId: school, role });
    const auth = await userRepository.getById(user.id);
    assert(auth);
    return { user, token: createToken({ userId: user.id, phone: user.phone, auth_version: auth.authVersion }) };
  }
  try {
    for (const school of [schoolId, otherSchoolId]) {
      await db.query('INSERT INTO schools (id, name, code, city, district) VALUES ($1, $2, $3, $4, $5)', [school, 'Local Staff Test', crypto.randomBytes(8).toString('hex'), 'Test', 'Test']);
    }
    const admin = await fixture('admin');
    const parent = await fixture('parent');
    const teacher = await fixture('teacher');
    const security = await fixture('security');
    const foreignSecurity = await fixture('security', otherSchoolId);
    const teacherPhone = phone();
    await db.query(
      'INSERT INTO teacher_profiles (id, school_id, first_name, last_name, branch, phone) VALUES ($1, $2, $3, $4, $5, $6)',
      [teacherId, schoolId, 'Local', 'Teacher', 'Türkçe', teacherPhone]
    );
    const path = `/schools/${schoolId}/users?role=security`;
    const list = await request('GET', path, admin.token);
    assert.equal(list.status, 200);
    const users = list.body.users as Array<Record<string, unknown>>;
    assert.equal(users.length, 1);
    assert.equal(users[0].id, security.user.id);
    assert.equal(users[0].accountStatus, 'pending');
    assert.deepEqual(Object.keys(users[0]).sort(), ['accountStatus', 'firstName', 'id', 'lastName', 'phone', 'role']);
    assert.equal((await request('GET', path)).status, 401);
    for (const token of [parent.token, teacher.token, security.token]) {
      assert.equal((await request('GET', path, token)).status, 403);
    }
    assert.equal((await request('GET', `/schools/${otherSchoolId}/users?role=security`, admin.token)).status, 403);
    assert.equal((await request('GET', path, admin.token, undefined, otherSchoolId)).status, 400);
    assert.equal((await request('GET', `/schools/${otherSchoolId}/users?role=security`, admin.token, undefined, schoolId)).status, 400);
    const issuePath = `/schools/${schoolId}/auth-codes`;
    assert.equal((await request('POST', issuePath, admin.token, {
      targetType: 'security', targetId: foreignSecurity.user.id, purpose: 'ACCOUNT_ACTIVATION',
    })).status, 404);

    for (const target of [
      { type: 'teacher', id: teacherId, phone: teacherPhone },
      { type: 'security', id: security.user.id, phone: security.user.phone },
    ]) {
      const password = crypto.randomBytes(24).toString('base64url');
      const issued = await request('POST', issuePath, admin.token, {
        targetType: target.type, targetId: target.id, purpose: 'ACCOUNT_ACTIVATION',
      });
      assert.equal(issued.status, 200);
      assert.equal(typeof issued.body.code, 'string');
      const activation = { schoolId, phone: target.phone, code: issued.body.code, password };
      assert.equal((await request('POST', '/auth/activate-account', undefined, activation)).status, 200);
      assert.equal((await request('POST', '/auth/activate-account', undefined, activation)).status, 400);
      const login = await request('POST', '/auth/login', undefined, { phone: target.phone, password });
      assert.equal(login.status, 200);
      assert((login.body.memberships as Array<{ schoolId: string; role: string }>).some((membership) =>
        membership.schoolId === schoolId && membership.role === target.type));
      assert.equal((await request('GET', path, login.body.token as string)).status, 403);
      assert.equal((await request('POST', issuePath, admin.token, {
        targetType: target.type, targetId: target.id, purpose: 'ACCOUNT_ACTIVATION',
      })).status, 409);
      const reset = await request('POST', issuePath, admin.token, {
        targetType: target.type, targetId: target.id, purpose: 'PASSWORD_RESET',
      });
      assert.equal(reset.status, 200);
      const newPassword = crypto.randomBytes(24).toString('base64url');
      assert.equal((await request('POST', '/auth/reset-password-with-code', undefined, {
        schoolId, phone: target.phone, code: reset.body.code, password: newPassword,
      })).status, 200);
      assert.equal((await request('POST', '/auth/login', undefined, { phone: target.phone, password: newPassword })).status, 200);
      assert.equal((await request('POST', '/auth/login', undefined, { phone: target.phone, password })).status, 401);
    }
    const profiles = await request('GET', `/schools/${schoolId}/teachers`, admin.token);
    const profile = (profiles.body.teachers as Array<Record<string, unknown>>).find((record) => record.id === teacherId);
    assert.equal(profile?.accountStatus, 'active');
    assert.equal(profile?.phone, teacherPhone);
    const linked = await userRepository.getByPhone(teacherPhone);
    assert(linked);
    await db.query("UPDATE school_memberships SET status = 'inactive' WHERE school_id = $1 AND user_id = $2", [schoolId, linked.id]);
    const inactive = await request('GET', `/schools/${schoolId}/teachers`, admin.token);
    assert.equal((inactive.body.teachers as Array<Record<string, unknown>>)[0].accountStatus, 'inactive');
    const activeSecurity = await request('GET', path, admin.token);
    assert.equal((activeSecurity.body.users as Array<Record<string, unknown>>)[0].accountStatus, 'active');
    console.log('Admin staff management: tenant/role guards, safe response, activation and reset PASS.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id IN ($1, $2)', [schoolId, otherSchoolId]);
    for (const value of phones) {
      await db.query('DELETE FROM users WHERE phone = $1', [value]);
    }
  }
}

run().catch(() => {
  console.error('Admin staff management test FAILED. No credentials or response bodies are logged.');
  process.exitCode = 1;
});
