import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('This test requires local PGlite.');
  process.env.NODE_ENV = 'test';
  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const db = await getDb();
  const suffix = crypto.randomUUID();
  const schoolId = `parent-auth-${suffix}`;
  const schoolCode = `PA${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const phone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const birthDate = '2015-04-17';
  const password = crypto.randomBytes(24).toString('base64url');
  const replacement = crypto.randomBytes(24).toString('base64url');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  async function request(method: string, path: string, body?: object, token?: string) {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  try {
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [schoolId, 'Parent auth test', schoolCode, 'Test', 'Test']);
    await db.query(`INSERT INTO school_roster(school_id,parent_phone,parent_name,student_name,class_name,student_number,birth_date,is_claimed)
      VALUES($1,$2,$3,$4,$5,$6,$7::date,FALSE)`, [schoolId, phone, 'Test Parent', 'Test Student', '5-A', 'PA-1', birthDate]);

    const generic = 'Bilgiler okul kayıtlarıyla eşleşmedi. Lütfen bilgilerinizi kontrol edin veya okul yönetimiyle iletişime geçin.';
    const invalidSchool = await request('POST', '/auth/parent/registration-challenge', { schoolCode: 'NOT-A-SCHOOL', phone, birthDate });
    assert.equal(invalidSchool.status, 400);
    assert.equal(invalidSchool.body.error, generic);
    const invalidPhone = await request('POST', '/auth/parent/registration-challenge', { schoolCode, phone: '+12025550123', birthDate });
    assert.equal(invalidPhone.status, 400);
    assert.equal(invalidPhone.body.error, generic);
    const invalidBirthDate = await request('POST', '/auth/parent/registration-challenge', { schoolCode, phone, birthDate: '2014-04-17' });
    assert.equal(invalidBirthDate.status, 400);
    assert.equal(invalidBirthDate.body.error, generic);

    const challengeResponse = await request('POST', '/auth/parent/registration-challenge', { schoolCode, phone: phone.slice(3), birthDate });
    assert.equal(challengeResponse.status, 200);
    const expiredChallenge = challengeResponse.body.challenge as string;
    assert.equal(typeof expiredChallenge, 'string');
    assert.equal(challengeResponse.body.schoolId, schoolId);
    assert.equal(await userRepository.getByPhone(phone), null);
    const storedChallenge = await db.query<{code_hash:string;token:string}>("SELECT code_hash,token FROM invitations WHERE school_id=$1 AND target_phone=$2 AND purpose='parent_self_registration'",[schoolId,phone]);
    assert.equal(storedChallenge.rows.length,1);
    assert.notEqual(storedChallenge.rows[0].code_hash,expiredChallenge);
    assert.notEqual(storedChallenge.rows[0].token,expiredChallenge);
    await db.query("UPDATE invitations SET expires_at=NOW()-INTERVAL '1 second' WHERE school_id=$1 AND target_phone=$2 AND purpose='parent_self_registration'",[schoolId,phone]);
    assert.equal((await request('POST', '/auth/parent/registration-complete', { schoolId, phone, birthDate, challenge:expiredChallenge, password })).status,400);
    const freshChallengeResponse = await request('POST', '/auth/parent/registration-challenge', { schoolCode, phone, birthDate });
    assert.equal(freshChallengeResponse.status,200);
    const challenge = freshChallengeResponse.body.challenge as string;
    const registered = await request('POST', '/auth/parent/registration-complete', { schoolId, phone: `0${phone.slice(3)}`, birthDate, challenge, password });
    assert.equal(registered.status, 200);
    assert.equal((await request('POST', '/auth/parent/registration-complete', { schoolId, phone, birthDate, challenge, password })).status, 400);

    const user = await userRepository.getAuthByPhone(phone);
    assert(user);
    assert(user.passwordHash);
    assert.notEqual(user.passwordHash, password);
    assert.equal((await membershipRepository.getActiveMembership(user.id, schoolId))?.role, 'parent');
    assert.equal((await db.query('SELECT rel.id,s.birth_date::text AS birth_date FROM student_parent_relations rel JOIN students s ON s.school_id=rel.school_id AND s.id=rel.student_id WHERE rel.school_id=$1 AND rel.parent_user_id=$2', [schoolId, user.id])).rows.length, 1);
    const login = await request('POST', '/auth/login', { phone, password });
    assert.equal(login.status, 200);
    const token = login.body.token as string;
    assert.equal((await request('GET', '/user/me', undefined, token)).status, 200);

    const wrongRelation = await request('POST', '/auth/parent/reset-challenge', { schoolCode, phone, birthDate: '2016-01-01' });
    assert.equal(wrongRelation.status, 400);
    assert.equal(wrongRelation.body.error, generic);
    const resetChallengeResponse = await request('POST', '/auth/parent/reset-challenge', { schoolCode, phone: `(${phone.slice(3, 6)}) ${phone.slice(6, 9)}-${phone.slice(9, 11)}-${phone.slice(11)}`, birthDate });
    assert.equal(resetChallengeResponse.status, 200);
    const resetChallenge = resetChallengeResponse.body.challenge as string;
    const reset = await request('POST', '/auth/parent/reset-complete', { schoolId, phone, birthDate, challenge: resetChallenge, password: replacement });
    assert.equal(reset.status, 200);
    assert.equal((await request('POST', '/auth/parent/reset-complete', { schoolId, phone, birthDate, challenge: resetChallenge, password: replacement })).status, 400);
    assert.equal((await request('GET', '/user/me', undefined, token)).status, 401);
    assert.equal((await request('POST', '/auth/login', { phone, password })).status, 401);
    const newLogin = await request('POST', '/auth/login', { phone, password: replacement });
    assert.equal(newLogin.status, 200);
    assert.equal((await request('GET', '/user/me', undefined, newLogin.body.token as string)).status, 200);
    console.log('Parent self-service auth: roster-bound registration, generic failures, one-use challenge, password hashing, parent reset and auth_version invalidation PASS.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id=$1', [schoolId]);
    const user = await userRepository.getByPhone(phone);
    if (user) await db.query('DELETE FROM users WHERE id=$1', [user.id]);
  }
}

run().catch((cause) => {
  console.error('Parent self-service auth test FAILED; no credentials or response bodies are logged.', cause instanceof Error ? cause.stack : '');
  process.exitCode = 1;
});
