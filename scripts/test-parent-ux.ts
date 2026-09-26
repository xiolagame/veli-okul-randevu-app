import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { normalizePersonName } from '../src/utils/person-name';
import { normalizePersonNames } from './normalize-person-names';

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Local PGlite only.');
  for (const [input, expected] of [
    ['ali ışık', 'ALİ IŞIK'], ['çağla içen', 'ÇAĞLA İÇEN'],
    ['özge şahin', 'ÖZGE ŞAHİN'], ['İBRAHİM IŞIK', 'İBRAHİM IŞIK'],
  ]) {
    assert.equal(normalizePersonName(input), expected);
    assert.equal(normalizePersonName(expected), expected);
  }
  const isolated = new PGlite();
  try {
    await isolated.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT);
      CREATE TABLE teacher_profiles(id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT);
      CREATE TABLE students(id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE school_roster(id TEXT PRIMARY KEY, parent_name TEXT, student_name TEXT);
      CREATE TABLE pending_staff(id TEXT PRIMARY KEY, first_name TEXT, last_name TEXT);
      CREATE TABLE appointments(id TEXT PRIMARY KEY, teacher_name TEXT, parent_name TEXT, student_name TEXT);
      CREATE TABLE audit_logs(id TEXT PRIMARY KEY, actor_name TEXT, details TEXT);
      INSERT INTO users VALUES('u','ali','ışık');
      INSERT INTO teacher_profiles VALUES('t','özge','şahin');
      INSERT INTO students VALUES('s','çağla içen');
      INSERT INTO school_roster VALUES('r','ibrahim ışık','çağla içen');
      INSERT INTO pending_staff VALUES('p','özge','şahin');
      INSERT INTO appointments VALUES('a','özge şahin','ali ışık','çağla içen');
      INSERT INTO audit_logs VALUES('l','ali ışık (Yönetici)','Serbest açıklama'),('system','Sistem','Serbest açıklama');`);
    const first = await isolated.transaction(normalizePersonNames);
    assert(Object.values(first).every((count) => count === 1));
    const second = await isolated.transaction(normalizePersonNames);
    assert(Object.values(second).every((count) => count === 0));
    assert.equal((await isolated.query<{ first_name: string }>('SELECT first_name FROM users WHERE id=$1', ['u'])).rows[0].first_name, 'ALİ');
    assert.equal((await isolated.query<{ name: string }>('SELECT name FROM students WHERE id=$1', ['s'])).rows[0].name, 'ÇAĞLA İÇEN');
    assert.equal((await isolated.query<{ actor_name: string }>('SELECT actor_name FROM audit_logs WHERE id=$1', ['l'])).rows[0].actor_name, 'ALİ IŞIK (Yönetici)');
    assert.equal((await isolated.query<{ actor_name: string }>('SELECT actor_name FROM audit_logs WHERE id=$1', ['system'])).rows[0].actor_name, 'Sistem');
  } finally {
    await isolated.close();
  }
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.AUTH_CODE_SECRET = crypto.randomBytes(32).toString('hex');
  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken } = await import('../server/auth');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const db = await getDb();
  assert.equal(db.engineType, 'PostgreSQL (Embedded Persistent Engine)');
  const suffix = crypto.randomUUID();
  const schoolA = `parent-ux-a-${suffix}`;
  const schoolB = `parent-ux-b-${suffix}`;
  const phoneA = `+905${crypto.randomInt(100000000, 999999999)}`;
  const phoneB = `+905${crypto.randomInt(100000000, 999999999)}`;
  const userA = await userRepository.create({ phone: phoneA, firstName: 'ali', lastName: 'ışık' });
  const userB = await userRepository.create({ phone: phoneB, firstName: 'özge', lastName: 'şahin' });
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  try {
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)',
      [schoolA, 'School A', `A${suffix.slice(0, 10)}`, 'Test', 'Test', schoolB, 'School B', `B${suffix.slice(0, 10)}`, 'Test', 'Test']);
    await membershipRepository.createOrActivate({ schoolId: schoolA, userId: userA.id, role: 'parent' });
    await membershipRepository.createOrActivate({ schoolId: schoolA, userId: userB.id, role: 'parent' });
    await membershipRepository.createOrActivate({ schoolId: schoolB, userId: userB.id, role: 'parent' });
    await db.query(`INSERT INTO school_roster(id,school_id,parent_phone,parent_name,student_name,class_name)
      VALUES($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12),($13,$14,$15,$16,$17,$18),($19,$20,$21,$22,$23,$24)`,
      [`rost-a-${suffix}`, schoolA, phoneA, 'ali ışık', 'çağla içen', '5/A',
        `rost-a2-${suffix}`, schoolA, phoneA, 'ali ışık', 'Başka Öğrenci', '6/A',
        `rost-b-${suffix}`, schoolB, phoneB, 'özge şahin', 'Okul B Öğrenci', '8/B',
        `rost-a3-${suffix}`, schoolA, phoneA, 'ali ışık', 'Üçüncü Öğrenci', '10/A']);
    await db.query('INSERT INTO teacher_profiles(id,school_id,first_name,last_name,branch,phone) VALUES($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)',
      [`t-a-${suffix}`, schoolA, 'Ayşe', 'Öztürk', 'Türkçe', phoneA, `t-b-${suffix}`, schoolB, 'Ahmet', 'Kaya', 'Türkçe', phoneB]);
    await db.query(`INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,parent_phone,student_name,class_name,date,start_time,end_time,status,entry_code)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2025-01-01','09:00','09:15','checked_out',$11),
            ($12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'2025-01-01','09:00','09:15','checked_out',$22)`,
      [`apt-a-${suffix}`, schoolA, `t-a-${suffix}`, 'Ayşe Öztürk', 'Türkçe', userA.id, 'ali ışık', phoneA, 'çağla içen', '5/A', `A${suffix.slice(0, 8)}`,
        `apt-b-${suffix}`, schoolB, `t-b-${suffix}`, 'Ahmet Kaya', 'Türkçe', userB.id, 'özge şahin', phoneB, 'Okul B Öğrenci', '8/B', `B${suffix.slice(0, 8)}`]);
    await db.query(`INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,parent_phone,student_name,class_name,date,start_time,end_time,status,entry_code)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'2025-01-01','09:30','09:45','checked_out',$11)`,
      [`apt-b-a-${suffix}`, schoolA, `t-a-${suffix}`, 'Ayşe Öztürk', 'Türkçe', userB.id, 'özge şahin', phoneB, 'Okul B Öğrenci', '5/A', `C${suffix.slice(0, 8)}`]);
    await db.query(`INSERT INTO notifications(id,school_id,user_id,title,message,date) VALUES($1,$2,$3,'Test','Test',$4),($5,$6,$7,'Test','Test',$8),($9,$10,$11,'Test','Test',$12)`,
      [`notif-a-${suffix}`, schoolA, userA.id, new Date().toISOString(), `notif-b-${suffix}`, schoolB, userB.id, new Date().toISOString(),
        `notif-b-a-${suffix}`, schoolA, userB.id, new Date().toISOString()]);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
    const tokenA = createToken({ userId: userA.id, phone: phoneA, auth_version: 0 });
    const tokenB = createToken({ userId: userB.id, phone: phoneB, auth_version: 0 });
    const request = async (path: string, token: string, body?: object) => {
      const response = await fetch(url + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    assert.equal((await request(`/schools/${schoolB}/classes`, tokenA)).status, 403);
    assert.deepEqual((await request(`/schools/${schoolA}/classes`, tokenA)).body.classes, ['5/A', '6/A', '10/A']);
    assert.equal((await request(`/schools/${schoolA}/students/claim`, tokenA, { name: 'çağla içen', className: '8/B' })).status, 403);
    assert.equal((await request(`/schools/${schoolA}/students/claim`, tokenA, { name: 'çağla içen', className: 'SAHTE' })).status, 403);
    assert.equal((await request(`/schools/${schoolA}/students/claim`, tokenA, { name: 'Okul B Öğrenci', className: '5/A' })).status, 403);
    assert.equal((await request(`/schools/${schoolA}/students/claim`, tokenA, { name: 'çağla içen', className: '5/A' })).status, 200);
    assert.equal((await db.query('SELECT name FROM students WHERE school_id=$1', [schoolA])).rows[0].name, 'ÇAĞLA İÇEN');
    assert.equal((await request(`/schools/${schoolA}/appointments`, tokenA)).body.appointments instanceof Array, true);
    assert.equal((await request(`/schools/${schoolA}/appointments/history/clear`, tokenA, {})).status, 200);
    assert.equal(((await request(`/schools/${schoolA}/appointments`, tokenA)).body.appointments as unknown[]).length, 0);
    assert.equal(((await request(`/schools/${schoolA}/appointments`, tokenB)).body.appointments as unknown[]).length, 1);
    assert.equal(((await request(`/schools/${schoolB}/appointments`, tokenB)).body.appointments as unknown[]).length, 1);
    assert.equal((await db.query('SELECT id FROM appointments WHERE id=$1', [`apt-a-${suffix}`])).rows.length, 1);
    assert.equal((await request(`/schools/${schoolA}/notifications/clear`, tokenA, {})).status, 200);
    assert.equal(((await request(`/schools/${schoolA}/notifications`, tokenA)).body.notifications as unknown[]).length, 0);
    assert.equal(((await request(`/schools/${schoolA}/notifications`, tokenB)).body.notifications as unknown[]).length, 1);
    assert.equal(((await request(`/schools/${schoolB}/notifications`, tokenB)).body.notifications as unknown[]).length, 1);
    assert.equal((await db.query('SELECT id FROM notifications WHERE id=$1', [`notif-a-${suffix}`])).rows.length, 1);
    console.log('Parent UX: Turkish names, tenant classes, roster-bound claim and user-scoped visibility PASS.');
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id IN ($1,$2)', [schoolA, schoolB]);
    await db.query('DELETE FROM users WHERE id IN ($1,$2)', [userA.id, userB.id]);
  }
}

run().catch((error) => { console.error('Parent UX test failed:', error instanceof Error ? error.message : 'unknown'); process.exitCode = 1; });
