import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';
import { displayStoredTurkishPhone } from '../src/utils/phone';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('This test requires local PGlite.');
  process.env.NODE_ENV = 'test';
  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { userRepository, membershipRepository, invitationRepository } = await import('../server/repositories');
  const { hashActivationCode } = await import('../server/activation-codes');
  const db = await getDb();
  const suffix = crypto.randomUUID();
  const schoolId = `parent-auth-${suffix}`;
  const schoolCode = `PA${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const phone = `+905${crypto.randomInt(100000000, 999999999)}`;
  const birthDate = '2015-04-17';
  const password = 'Ab123';
  const replacement = 'Cd456';
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  async function request(method: string, path: string, body?: object, token?: string) {
    const input = body as Record<string, unknown> | undefined;
    const payload = input && typeof input.phone === 'string' && /^\+905\d{9}$/.test(input.phone)
      ? { ...input, phone: displayStoredTurkishPhone(input.phone) } : body;
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  try {
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [schoolId, 'Parent auth test', schoolCode, 'Test', 'Test']);
    await db.query(`INSERT INTO school_roster(school_id,parent_phone,parent_name,student_name,class_name,student_number,birth_date,is_claimed)
      VALUES($1,$2,$3,$4,$5,$6,$7::date,FALSE)`, [schoolId, phone, 'Test Parent', 'Test Student', '5-A', 'PA-1', birthDate]);

    const issueParentCode = async (purpose: 'ACCOUNT_ACTIVATION' | 'PASSWORD_RESET', targetUserId?: string) => {
      const code = String(crypto.randomInt(100000, 1000000));
      await invitationRepository.createAuthCode({
        schoolId,
        targetPhone: phone,
        targetUserId,
        targetRole: 'parent',
        purpose,
        codeHash: hashActivationCode(code),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        token: crypto.randomUUID(),
      });
      return code;
    };

    const generic = 'Bilgiler okul kayıtlarıyla eşleşmedi. Lütfen bilgilerinizi kontrol edin veya okul yönetimiyle iletişime geçin.';
    const activationCode = await issueParentCode('ACCOUNT_ACTIVATION');
    const invalidSchool = await request('POST', '/auth/parent/registration-challenge', { schoolCode: 'NOT-A-SCHOOL', phone, code: activationCode });
    assert.equal(invalidSchool.status, 400);
    assert.equal(invalidSchool.body.error, generic);
    const invalidPhone = await request('POST', '/auth/parent/registration-challenge', { schoolCode, phone: '+12025550123', code: activationCode });
    assert.equal(invalidPhone.status, 400);
    assert.equal(invalidPhone.body.error, generic);
    const phoneOnly = await request('POST', '/auth/parent/registration-challenge', { schoolCode, phone });
    assert.equal(phoneOnly.status, 400);
    assert.equal(phoneOnly.body.error, generic);
    const wrongCode = await request('POST', '/auth/parent/registration-challenge', { schoolCode, phone, code: '000000' });
    assert.equal(wrongCode.status, 400);
    assert.equal(wrongCode.body.error, generic);

    const challengeResponse = await request('POST', '/auth/parent/registration-challenge', { schoolCode, phone: displayStoredTurkishPhone(phone), code: activationCode });
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
    assert.equal((await request('POST', '/auth/parent/registration-complete', { schoolId, phone, challenge:expiredChallenge, password })).status,400);
    const freshActivationCode = await issueParentCode('ACCOUNT_ACTIVATION');
    const freshChallengeResponse = await request('POST', '/auth/parent/registration-challenge', { schoolCode, phone, code: freshActivationCode });
    assert.equal(freshChallengeResponse.status,200);
    const challenge = freshChallengeResponse.body.challenge as string;
    assert.equal((await request('POST', '/auth/parent/registration-complete', { schoolId, phone, challenge, password: 'Ab12' })).status, 400);
    const registered = await request('POST', '/auth/parent/registration-complete', { schoolId, phone: `0${phone.slice(3)}`, challenge, password });
    assert.equal(registered.status, 200);
    assert.equal((await request('POST', '/auth/parent/registration-complete', { schoolId, phone, challenge, password })).status, 400);

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

    const resetCode = await issueParentCode('PASSWORD_RESET', user.id);
    const wrongResetCode = await request('POST', '/auth/parent/reset-challenge', { schoolCode, phone, code: '000000' });
    assert.equal(wrongResetCode.status, 400);
    assert.equal(wrongResetCode.body.error, generic);
    const resetChallengeResponse = await request('POST', '/auth/parent/reset-challenge', { schoolCode, phone: displayStoredTurkishPhone(phone), code: resetCode });
    assert.equal(resetChallengeResponse.status, 200);
    const resetChallenge = resetChallengeResponse.body.challenge as string;
    const reset = await request('POST', '/auth/parent/reset-complete', { schoolId, phone, challenge: resetChallenge, password: replacement });
    assert.equal(reset.status, 200);
    assert.equal((await request('POST', '/auth/parent/reset-complete', { schoolId, phone, challenge: resetChallenge, password: replacement })).status, 400);
    assert.equal((await request('GET', '/user/me', undefined, token)).status, 401);
    assert.equal((await request('POST', '/auth/login', { phone, password })).status, 401);
    const newLogin = await request('POST', '/auth/login', { phone, password: replacement });
    assert.equal(newLogin.status, 200);
    assert.equal((await request('GET', '/user/me', undefined, newLogin.body.token as string)).status, 200);
    console.log('Parent self-service auth: school-issued one-use codes, roster-bound registration, password hashing, parent reset and auth_version invalidation PASS.');
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
