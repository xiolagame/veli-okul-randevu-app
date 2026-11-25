import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import http from 'node:http';

// Aynı telefon hem öğretmen hem öğrenci listesinde veli olarak kayıtlıysa (öğretmenin kendi çocuğu okulda):
// giriş öğretmen olarak yapılır, veli rolü aynı hesaba bağlanır. Belirsiz durumlar yine kapalı kalır.
let stage = 'setup';
async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local PGlite is required.');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    AUTH_CODE_SECRET: crypto.randomBytes(32).toString('hex'),
    WHATSAPP_AUTH_ENABLED: 'true',
    WHATSAPP_PILOT_ENABLED: 'true',
    WHATSAPP_UNIFIED_LOGIN_ENABLED: 'true',
    PHONE_CENTRIC_AUTH_ENABLED: 'true',
    WHATSAPP_PHONE_NUMBER_ID: '1234567890',
    WHATSAPP_ACCESS_TOKEN: 'local-test-token-not-a-real-credential',
    WHATSAPP_GRAPH_API_VERSION: 'v25.0',
  });
  const originalFetch = globalThis.fetch;
  const codes: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith('https://graph.facebook.com/')) {
      const payload = JSON.parse(String(init?.body || '{}')) as { template?: { components?: Array<{ parameters?: Array<{ text?: string }> }> } };
      codes.push(payload.template!.components![0].parameters![0].text!);
      return new Response(JSON.stringify({ messages: [{ id: 'local' }] }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { membershipRepository, userRepository } = await import('../server/repositories');
  const db = await getDb();
  const suffix = crypto.randomBytes(5).toString('hex');
  const schoolA = `dual-a-${suffix}`, schoolB = `dual-b-${suffix}`;
  const phone = () => `+905${crypto.randomInt(100000000, 999999999)}`;
  const teacherPhone = phone(), securityPhone = phone(), twoStaffPhone = phone(), existingTeacherPhone = phone(), revokedPhone = phone();
  process.env.WHATSAPP_PILOT_ALLOWED_PHONES = [teacherPhone, securityPhone, twoStaffPhone, existingTeacherPhone, revokedPhone].join(',');
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  let ip = 10;
  async function request(path: string, body: object) {
    const response = await originalFetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${ip++}` }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
  }
  async function login(phoneNumber: string) {
    const before = codes.length;
    const start = await request('/auth/phone/request-code', { phone: phoneNumber });
    if (start.status !== 200) return { start, verified: null };
    assert.equal(codes.length, before + 1, 'kod gönderilmeli');
    const verified = await request('/auth/phone/verify-code', { attemptId: start.body.attemptId, challengeId: start.body.challengeId, phone: phoneNumber, code: codes.at(-1) });
    return { start, verified };
  }
  const roles = async (userId: string, schoolId: string) => (await membershipRepository.getMembershipsByUserId(userId))
    .filter((item) => item.schoolId === schoolId && item.status === 'active').map((item) => item.role).sort();
  const addRoster = (schoolId: string, parentPhone: string, student: string, parentName = 'VELİ') => db.query(
    `INSERT INTO school_roster(school_id,parent_phone,parent_name,student_name,class_name,student_number,is_claimed) VALUES($1,$2,$3,$4,'5-A',$5,FALSE)`,
    [schoolId, parentPhone, parentName, student, String(crypto.randomInt(100, 999))]);
  const addTeacher = (schoolId: string, id: string, phoneNumber: string, first: string, last: string) => db.query(
    `INSERT INTO teacher_profiles(id,school_id,first_name,last_name,branch,phone) VALUES($1,$2,$3,$4,'Fen Bilimleri',$5)`,
    [id, schoolId, first, last, phoneNumber]);

  try {
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)',
      [schoolA, 'Dual School A', `DA${suffix}`.toUpperCase(), 'Test', 'Test', schoolB, 'Dual School B', `DB${suffix}`.toUpperCase(), 'Test', 'Test']);

    stage = 'pending teacher who is also a parent logs in as teacher and gets parent role';
    await addTeacher(schoolA, `tch-merve-${suffix}`, teacherPhone, 'MERVE', 'GÖREN');
    await addRoster(schoolA, teacherPhone, 'MEHMET ENES GÖREN');
    const first = await login(teacherPhone);
    assert.equal(first.start.status, 200, 'öğretmen+veli numarası artık reddedilmemeli');
    assert.equal(first.verified!.status, 200);
    const user = await userRepository.getByPhone(teacherPhone);
    assert(user);
    assert.equal(`${user.firstName} ${user.lastName}`, 'MERVE GÖREN', 'hesap öğretmen adıyla açılmalı');
    assert.deepEqual(await roles(user.id, schoolA), ['parent', 'teacher']);
    assert.equal((await db.query('SELECT user_id FROM teacher_profiles WHERE id=$1', [`tch-merve-${suffix}`])).rows[0].user_id, user.id);
    assert.equal((await db.query('SELECT COUNT(*)::int AS c FROM student_parent_relations WHERE school_id=$1 AND parent_user_id=$2', [schoolA, user.id])).rows[0].c, 1);
    assert.equal((await db.query('SELECT is_claimed FROM school_roster WHERE school_id=$1 AND student_name=$2', [schoolA, 'MEHMET ENES GÖREN'])).rows[0].is_claimed, true);
    const tokenRoles = (first.verified!.body.memberships as Array<{ role: string }>).map((item) => item.role).sort();
    assert.deepEqual(tokenRoles, ['parent', 'teacher'], 'giriş yanıtı iki rolü de döndürmeli');

    stage = 'later login keeps both roles';
    const second = await login(teacherPhone);
    assert.equal(second.verified!.status, 200);
    assert.deepEqual((second.verified!.body.memberships as Array<{ role: string }>).map((item) => item.role).sort(), ['parent', 'teacher']);

    stage = 'already-activated teacher gets a newly imported child on next login';
    await addTeacher(schoolA, `tch-isa-${suffix}`, existingTeacherPhone, 'İSA', 'ÇUBUKÇU');
    assert.equal((await login(existingTeacherPhone)).verified!.status, 200);
    const isa = (await userRepository.getByPhone(existingTeacherPhone))!;
    assert.deepEqual(await roles(isa.id, schoolA), ['teacher']);
    await addRoster(schoolA, existingTeacherPhone, 'MİRAY ÇUBUKÇU');
    assert.equal((await login(existingTeacherPhone)).verified!.status, 200);
    assert.deepEqual(await roles(isa.id, schoolA), ['parent', 'teacher']);

    stage = 'security staff who is also a parent';
    await db.query(`INSERT INTO pending_staff(id,school_id,role,first_name,last_name,phone) VALUES($1,$2,'security','GÜVENLİK','KİŞİ',$3)`, [`sec-${suffix}`, schoolA, securityPhone]);
    await addRoster(schoolA, securityPhone, 'GÜVENLİK ÇOCUĞU');
    assert.equal((await login(securityPhone)).verified!.status, 200);
    const security = (await userRepository.getByPhone(securityPhone))!;
    assert.deepEqual(await roles(security.id, schoolA), ['parent', 'security']);

    stage = 'two staff records stay ambiguous and closed';
    await addTeacher(schoolA, `tch-two-a-${suffix}`, twoStaffPhone, 'İKİ', 'KAYIT');
    await db.query(`INSERT INTO pending_staff(id,school_id,role,first_name,last_name,phone) VALUES($1,$2,'security','İKİ','KAYIT',$3)`, [`sec-two-${suffix}`, schoolB, twoStaffPhone]);
    await addRoster(schoolA, twoStaffPhone, 'BELİRSİZ ÇOCUK');
    const ambiguous = await login(twoStaffPhone);
    assert.notEqual(ambiguous.start.status, 200, 'iki personel kaydı varken giriş açılmamalı');
    assert.equal(await userRepository.getByPhone(twoStaffPhone), null);

    stage = 'revoked parent role is never revived';
    await addTeacher(schoolA, `tch-rev-${suffix}`, revokedPhone, 'KALDIRILMIŞ', 'VELİ');
    assert.equal((await login(revokedPhone)).verified!.status, 200);
    const revoked = (await userRepository.getByPhone(revokedPhone))!;
    await membershipRepository.createOrActivate({ schoolId: schoolA, userId: revoked.id, role: 'parent' });
    await db.query(`UPDATE school_memberships SET status='inactive' WHERE school_id=$1 AND user_id=$2 AND role='parent'`, [schoolA, revoked.id]);
    await addRoster(schoolA, revokedPhone, 'ESKİ ÇOCUK');
    assert.equal((await login(revokedPhone)).verified!.status, 200);
    assert.deepEqual(await roles(revoked.id, schoolA), ['teacher'], 'kaldırılmış veli rolü geri açılmamalı');

    console.log('Dual role login: teacher/security who is also a parent activates as staff and links the parent role; later logins, newly imported children, ambiguity and revoked roles PASS.');
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id IN ($1,$2)', [schoolA, schoolB]);
    for (const p of [teacherPhone, securityPhone, twoStaffPhone, existingTeacherPhone, revokedPhone]) await db.query('DELETE FROM users WHERE phone=$1', [p]);
  }
}

run().catch((cause) => {
  console.error(`Dual role login test FAILED at stage: ${stage}.`);
  console.error(cause);
  process.exitCode = 1;
});
