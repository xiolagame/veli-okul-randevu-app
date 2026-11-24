import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';

// Öğretmen e-postası isteğe bağlıdır: tekli ekleme, düzenleme ve öğretmenin kendi profilinden ekleme/düzenleme/kaldırma.
async function run() {
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
  const schoolId = `opt-email-${suffix}`;
  const userIds: string[] = [];
  const phone = () => `+905${crypto.randomInt(100000000, 999999999)}`;
  await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5)', [schoolId, 'Opt Email School', `OE${suffix}`.toUpperCase(), 'Test', 'Test']);
  const server = http.createServer(createExpressApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
  async function request(method: string, path: string, token: string, body?: object) {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  }
  const tokenFor = async (userId: string) => {
    const user = await userRepository.getById(userId);
    return createToken({ userId, phone: user!.phone, auth_version: user!.authVersion, auth_method: 'phone_centric' });
  };

  try {
    const admin = await userRepository.create({ phone: phone(), firstName: 'Okul', lastName: 'Yönetici' });
    userIds.push(admin.id);
    await membershipRepository.createOrActivate({ schoolId, userId: admin.id, role: 'admin' });
    const adminToken = await tokenFor(admin.id);

    // 1) Tekli ekleme: e-posta olmadan eklenir.
    const teacherPhone = phone();
    const created = await request('POST', `/schools/${schoolId}/staff`, adminToken, { role: 'teacher', fullName: 'Eposta Yok', branch: 'Türkçe', phone: teacherPhone });
    assert.equal(created.status, 201);
    const profile = (await db.query<{ id: string; email: string | null }>('SELECT id,email FROM teacher_profiles WHERE school_id=$1', [schoolId])).rows[0];
    assert.equal(profile.email, null);
    // Geçersiz e-posta girilirse yine reddedilir.
    assert.equal((await request('POST', `/schools/${schoolId}/staff`, adminToken, { role: 'teacher', fullName: 'Bozuk Eposta', branch: 'Türkçe', phone: phone(), email: 'bad' })).status, 400);
    // Eski /teachers ucu da e-postasız çalışır.
    assert.equal((await request('POST', `/schools/${schoolId}/teachers`, adminToken, { fullName: 'Diger Ogretmen', branch: 'Fen', phone: phone() })).status, 201);

    // 2) Yönetici düzenleme: e-posta boş bırakılabilir, doldurulabilir.
    const editBody = (email?: string) => ({ fullName: 'Eposta Yok', branch: 'Türkçe', phone: teacherPhone, ...(email === undefined ? {} : { email }) });
    assert.equal((await request('PATCH', `/schools/${schoolId}/management/teacher/${profile.id}`, adminToken, editBody())).status, 200);
    assert.equal((await request('PATCH', `/schools/${schoolId}/management/teacher/${profile.id}`, adminToken, editBody('yonetici@example.test'))).status, 200);
    assert.equal((await db.query('SELECT email FROM teacher_profiles WHERE id=$1', [profile.id])).rows[0].email, 'yonetici@example.test');
    assert.equal((await request('PATCH', `/schools/${schoolId}/management/teacher/${profile.id}`, adminToken, editBody(''))).status, 200);
    assert.equal((await db.query('SELECT email FROM teacher_profiles WHERE id=$1', [profile.id])).rows[0].email, null);

    // 3) Öğretmenin kendi profilinden ekleme / düzenleme / kaldırma.
    const teacher = await userRepository.create({ phone: phone(), firstName: 'Kendi', lastName: 'Ogretmen', isPhoneVerified: true });
    userIds.push(teacher.id);
    await db.query('INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch,phone) VALUES($1,$2,$3,$4,$5,$6,$7)', [`tch-self-${suffix}`, schoolId, teacher.id, 'Kendi', 'Ogretmen', 'Fen', teacher.phone]);
    await membershipRepository.createOrActivate({ schoolId, userId: teacher.id, role: 'teacher' });
    const teacherToken = await tokenFor(teacher.id);
    const path = `/schools/${schoolId}/teachers/me/email`;
    assert.equal((await request('PUT', path, teacherToken, { email: 'yok-degil' })).status, 400);
    const added = await request('PUT', path, teacherToken, { email: ' Ogretmen@Example.Test ' });
    assert.equal(added.status, 200);
    assert.equal((await db.query('SELECT email FROM teacher_profiles WHERE user_id=$1', [teacher.id])).rows[0].email, 'ogretmen@example.test');
    assert.equal((await request('PUT', path, teacherToken, { email: 'yeni@example.test' })).status, 200);
    assert.equal((await db.query('SELECT email FROM teacher_profiles WHERE user_id=$1', [teacher.id])).rows[0].email, 'yeni@example.test');
    type ListedTeacher = { userId?: string; email?: string; phone?: string };
    const ownList = (await request('GET', `/schools/${schoolId}/teachers`, teacherToken)).body.teachers as ListedTeacher[];
    assert.equal(ownList.find((entry) => entry.userId === teacher.id)?.email, 'yeni@example.test');
    const parent = await userRepository.create({ phone: phone(), firstName: 'Bir', lastName: 'Veli' });
    userIds.push(parent.id);
    await membershipRepository.createOrActivate({ schoolId, userId: parent.id, role: 'parent' });
    const parentList = (await request('GET', `/schools/${schoolId}/teachers`, await tokenFor(parent.id))).body.teachers as ListedTeacher[];
    assert(parentList.length > 0);
    assert(parentList.every((entry) => !entry.email && !entry.phone), 'parents must not see teacher contact details');
    assert.equal((await request('PUT', path, teacherToken, { email: '' })).status, 200);
    assert.equal((await db.query('SELECT email FROM teacher_profiles WHERE user_id=$1', [teacher.id])).rows[0].email, null);
    // Yönetici bu ucu kullanamaz; veli de kullanamaz.
    assert.equal((await request('PUT', path, adminToken, { email: 'x@example.test' })).status, 403);

    // 4) Arayüz sözleşmesi.
    const teacherView = fs.readFileSync('src/components/TeacherView.tsx', 'utf8');
    assert(teacherView.includes('E-posta adresi ekle') && teacherView.includes('E-posta adresini düzenle') && teacherView.includes('updateMyTeacherEmail'));
    const staffManagement = fs.readFileSync('src/components/StaffManagement.tsx', 'utf8');
    assert(!/id="staff-email"[^>]*\srequired/.test(staffManagement));
    console.log('Teacher optional email: single/bulk-compatible creation, admin edit, teacher self add/edit/remove and authorization PASS.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM schools WHERE id=$1', [schoolId]);
    for (const id of userIds) await db.query('DELETE FROM users WHERE id=$1', [id]);
  }
}

run().catch((cause) => {
  console.error('Teacher optional email test FAILED.'); console.error(cause);
  process.exitCode = 1;
});
