import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';

type ApiResult = { status: number; body: Record<string, any> };

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) {
    throw new Error('Account deletion tests require local PGlite without DATABASE_URL.');
  }
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'local-account-deletion-test-secret-at-least-32-chars';
  process.env.WHATSAPP_AUTH_ENABLED = 'true';
  process.env.WHATSAPP_PILOT_ENABLED = 'true';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
  process.env.WHATSAPP_ACCESS_TOKEN = 'local-test-access-token';

  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { deleteOwnAccount } = await import('../server/account-deletion');
  const { hashPassword } = await import('../server/passwords');
  const { createToken } = await import('../server/auth');
  const db = await getDb();

  const suffix = crypto.randomUUID();
  const short = suffix.replaceAll('-', '').slice(0, 10);
  const schoolA = `delete-school-a-${suffix}`;
  const schoolB = `delete-school-b-${suffix}`;
  const parentId = `delete-parent-${suffix}`;
  const teacherId = `delete-teacher-${suffix}`;
  const otherId = `delete-other-${suffix}`;
  const sameNameUserId = `delete-same-name-${suffix}`;
  const teacherProfileId = `delete-profile-${suffix}`;
  const studentId = `delete-student-${suffix}`;
  const rosterId = `delete-roster-${suffix}`;
  const appointmentId = `delete-appointment-${suffix}`;
  const platformRequestId = `delete-request-${suffix}`;
  const parentRequestId = crypto.randomUUID();
  const teacherRequestId = crypto.randomUUID();
  const password = `Delete-${short}!`;
  const parentPhone = `+90511${crypto.randomInt(1000000, 9999999)}`;
  const teacherPhone = `+90522${crypto.randomInt(1000000, 9999999)}`;
  const otherPhone = `+90533${crypto.randomInt(1000000, 9999999)}`;
  const sameNamePhone = `+90544${crypto.randomInt(1000000, 9999999)}`;
  const parentEmail = `parent-${short}@example.test`;
  const teacherEmail = `teacher-${short}@example.test`;
  const parentFullName = `Silinecek Veli ${short}`;
  process.env.WHATSAPP_PILOT_ALLOWED_PHONES = parentPhone;
  const [parentFirstName, parentLastName, parentSuffix] = parentFullName.split(' ');
  let checks = 0;
  const equal = (actual: unknown, expected: unknown, message: string) => {
    assert.equal(actual, expected, message);
    checks += 1;
  };
  const check = (condition: unknown, message: string) => {
    assert(condition, message);
    checks += 1;
  };

  const originalFetch = globalThis.fetch;
  let deliveredWhatsappCode = '';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith('https://graph.facebook.com/')) {
      const body = JSON.parse(String(init?.body || '{}')) as { template?: { components?: Array<{ parameters?: Array<{ text?: string }> }> } };
      deliveredWhatsappCode = body.template?.components?.[0]?.parameters?.[0]?.text || '';
      return new Response(JSON.stringify({ messages: [{ id: 'local-message' }] }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;

  async function request(method: string, path: string, token?: string, body?: object): Promise<ApiResult> {
    const response = await originalFetch(baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text || '{}') };
  }

  async function login(phone: string) {
    return request('POST', '/auth/login', undefined, { phone, password });
  }

  try {
    await db.query(
      `INSERT INTO schools(id,name,code,city,district)
       VALUES($1,$2,$3,'Ankara','Çankaya'),($4,$5,$6,'İstanbul','Kadıköy')`,
      [schoolA, `Silme Test Okulu A ${short}`, `DA${short}`.toUpperCase(), schoolB, `Silme Test Okulu B ${short}`, `DB${short}`.toUpperCase()],
    );
    await db.query(
      `INSERT INTO users(id,phone,first_name,last_name,email,is_phone_verified,password_hash)
       VALUES
         ($1,$2,$3,$4,$5,TRUE,$6),
         ($7,$8,'Silinecek','Öğretmen',$9,TRUE,$6),
         ($10,$11,'Korunan','Kullanıcı',$12,TRUE,$6)`,
      [
        parentId, parentPhone, parentFirstName, `${parentLastName} ${parentSuffix}`, parentEmail, hashPassword(password),
        teacherId, teacherPhone, teacherEmail,
        otherId, otherPhone, `other-${short}@example.test`,
      ],
    );
    await db.query(
      `INSERT INTO school_memberships(id,school_id,user_id,role,status)
       VALUES($1,$2,$3,'parent','active'),($4,$2,$5,'teacher','active'),($6,$7,$8,'parent','active')`,
      [`mem-parent-${suffix}`, schoolA, parentId, `mem-teacher-${suffix}`, teacherId, `mem-other-${suffix}`, schoolB, otherId],
    );
    await db.query(
      `INSERT INTO users(id,phone,first_name,last_name,email,is_phone_verified,password_hash)
       VALUES($1,$2,$3,$4,$5,TRUE,$6)`,
      [sameNameUserId, sameNamePhone, parentFirstName, `${parentLastName} ${parentSuffix}`, `same-name-${short}@example.test`, hashPassword(password)],
    );
    await db.query(
      `INSERT INTO school_memberships(id,school_id,user_id,role,status) VALUES($1,$2,$3,'parent','active')`,
      [`mem-same-name-${suffix}`, schoolA, sameNameUserId],
    );
    await db.query(
      `INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch,email,phone)
       VALUES($1,$2,$3,'Silinecek','Öğretmen','Matematik',$4,$5)`,
      [teacherProfileId, schoolA, teacherId, teacherEmail, teacherPhone],
    );
    await db.query(
      `INSERT INTO students(id,school_id,name,class_name,student_number)
       VALUES($1,$2,'Korunacak Öğrenci','5-A',$3)`,
      [studentId, schoolA, short],
    );
    await db.query(
      `INSERT INTO student_parent_relations(id,school_id,student_id,parent_user_id)
       VALUES($1,$2,$3,$4)`,
      [`relation-${suffix}`, schoolA, studentId, parentId],
    );
    await db.query(
      `INSERT INTO school_roster(id,school_id,parent_phone,parent_name,student_name,class_name,student_number,is_claimed)
       VALUES($1,$2,$3,$4,'Korunacak Öğrenci','5-A',$5,TRUE)`,
      [rosterId, schoolA, parentPhone, parentFullName, short],
    );
    await db.query(
      `INSERT INTO availability_slots(id,school_id,teacher_id,day_of_week,start_time,end_time,slot_duration)
       VALUES($1,$2,$3,1,'10:00','11:00',15)`,
      [`slot-${suffix}`, schoolA, teacherProfileId],
    );
    await db.query(
      `INSERT INTO appointments(
         id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,parent_phone,
         student_id,student_name,class_name,date,start_time,end_time,status,entry_code,qr_token,notes,approved_by,checked_in_by
       ) VALUES($1,$2,$3,'Silinecek Öğretmen','Matematik',$4,$5,$6,$7,'Korunacak Öğrenci','5-A','2099-01-04','10:00','10:15','booked','123456',$8,$9,$10,$10)`,
      [appointmentId, schoolA, teacherProfileId, parentId, parentFullName, parentPhone, studentId, `qr-${suffix}`, `Özel veli notu ${parentEmail}`, teacherId],
    );
    await db.query(
      `INSERT INTO notifications(id,school_id,user_id,title,message,date,appointment_id)
       VALUES($1,$2,$3,'Randevu','Kişisel bildirim','2099-01-04',$4)`,
      [`notification-${suffix}`, schoolA, parentId, appointmentId],
    );
    await db.query(
      `INSERT INTO mobile_push_devices(
         id,user_id,auth_version,installation_id,platform,provider,target_kind,provider_target,target_hash,app_id
       ) VALUES($1,$2,0,$3,'ANDROID','FCM','REGISTRATION_TOKEN',$4,$5,'com.velirandevu.app')`,
      [`device-${suffix}`, parentId, crypto.randomUUID(), `fcm-secret-${suffix}`, crypto.createHash('sha256').update(suffix).digest('hex')],
    );
    await db.query(
      `INSERT INTO audit_logs(id,school_id,timestamp,action,actor_name,actor_user_id,details)
       VALUES($1,$2,NOW()::text,'Test İşlemi',$3,$4,$5)`,
      [`audit-${suffix}`, schoolA, parentFullName, parentId, `Kullanıcı ${parentId}, ${parentPhone}, ${parentEmail}`],
    );
    await db.query(
      `INSERT INTO audit_logs(id,school_id,timestamp,action,actor_name,actor_user_id,details)
       VALUES($1,$2,NOW()::text,'Başka Kullanıcı İşlemi',$3,$4,'Başka kullanıcıya ait kayıt')`,
      [`audit-same-name-${suffix}`, schoolA, parentFullName, sameNameUserId],
    );
    await db.query(
      `INSERT INTO invitations(
         id,school_id,token,description,is_active,purpose,target_phone,target_user_id,target_role,code_hash,created_by
       ) VALUES($1,$2,$3,'Kişisel davet',TRUE,'parent_self_registration',$4,$5,'parent','hash',$5)`,
      [`invitation-${suffix}`, schoolA, `token-${suffix}`, parentPhone, parentId],
    );
    await db.query(
      `INSERT INTO otp_verifications(phone,code,expires_at) VALUES($1,'123456',$2)`,
      [parentPhone, Date.now() + 60_000],
    );
    await db.query(
      `INSERT INTO platform_requests(
         id,idempotency_key,school_id,created_by_user_id,source,request_type,school_name_snapshot,
         contact_name_snapshot,email_snapshot,phone_snapshot,subject,message,status,status_updated_by_user_id
       ) VALUES($1,$2,$3,$4,'SCHOOL_ADMIN','SUPPORT',$5,$6,$7,$8,'Kişisel konu','Kişisel destek mesajı','NEW',$4)`,
      [platformRequestId, crypto.randomUUID(), schoolA, parentId, `Silme Test Okulu A ${short}`, parentFullName, parentEmail, parentPhone],
    );
    await db.query(
      `INSERT INTO platform_request_messages(
         id,request_id,sender_user_id,sender_kind,sender_name_snapshot,message,idempotency_key
       ) VALUES($1,$2,$3,'SCHOOL_ADMIN',$4,'Kişisel konuşma içeriği',$5)`,
      [`request-message-${suffix}`, platformRequestId, parentId, parentFullName, crypto.randomUUID()],
    );

    const parentLogin = await login(parentPhone);
    const teacherLogin = await login(teacherPhone);
    const otherLogin = await login(otherPhone);
    equal(parentLogin.status, 200, 'parent fixture logs in');
    equal(teacherLogin.status, 200, 'teacher fixture logs in');
    equal(otherLogin.status, 200, 'other-tenant fixture logs in');
    const parentToken = String(parentLogin.body.token);
    const teacherToken = String(teacherLogin.body.token);
    const otherToken = String(otherLogin.body.token);

    const wrongPassword = await request('POST', '/user/me/deletion', parentToken, {
      password: 'wrong-password', confirmation: 'HESABIMI SİL', requestId: crypto.randomUUID(),
    });
    equal(wrongPassword.status, 403, 'wrong password is rejected');
    equal((await request('GET', '/user/me', parentToken)).status, 200, 'failed deletion keeps session usable');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM mobile_push_devices WHERE user_id=$1', [parentId])).rows[0].count, '1', 'failed deletion keeps push registration');

    const forgedTarget = await request('POST', '/user/me/deletion', otherToken, {
      password, confirmation: 'HESABIMI SİL', requestId: crypto.randomUUID(), targetUserId: parentId, schoolId: schoolA,
    });
    equal(forgedTarget.status, 400, 'another user cannot target an account or tenant through request fields');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM users WHERE id=$1', [parentId])).rows[0].count, '1', 'forged target leaves victim account intact');

    const authVersion = Number((await db.query<{ auth_version: number }>('SELECT auth_version FROM users WHERE id=$1', [parentId])).rows[0].auth_version);
    const phoneCentricToken = createToken({
      userId: parentId,
      phone: parentPhone,
      auth_version: authVersion,
      auth_method: 'phone_centric',
    });
    const phoneCentricMe = await request('GET', '/user/me', phoneCentricToken);
    equal(phoneCentricMe.body.user.deletionVerification, 'whatsapp', 'phone-centric session requires WhatsApp reauthentication');
    const deletionChallenge = await request('POST', '/user/me/deletion/whatsapp-code', phoneCentricToken);
    equal(deletionChallenge.status, 200, 'phone-centric session can request deletion reauthentication despite a legacy password hash');
    check(/^\d{6}$/.test(deliveredWhatsappCode), 'account deletion reauthentication code is delivered through the mocked WhatsApp provider');
    const deletion = await request('POST', '/user/me/deletion', phoneCentricToken, {
      whatsappChallengeId: deletionChallenge.body.challengeId,
      whatsappCode: deliveredWhatsappCode,
      confirmation: 'HESABIMI SİL',
      requestId: parentRequestId,
    });
    equal(deletion.status, 200, 'authenticated self-deletion succeeds');
    equal(deletion.body.completed, true, 'deletion response confirms completion');
    equal((await request('GET', '/user/me', parentToken)).status, 401, 'old JWT is unusable after deletion');
    equal((await login(parentPhone)).status, 401, 'deleted credentials cannot log in again');

    equal((await db.query('SELECT COUNT(*)::text AS count FROM users WHERE id=$1', [parentId])).rows[0].count, '0', 'personal identity row is removed');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM school_memberships WHERE user_id=$1', [parentId])).rows[0].count, '0', 'memberships are removed');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM student_parent_relations WHERE parent_user_id=$1', [parentId])).rows[0].count, '0', 'parent/student link is removed');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM mobile_push_devices WHERE user_id=$1', [parentId])).rows[0].count, '0', 'push registration is removed');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM notifications WHERE user_id=$1', [parentId])).rows[0].count, '0', 'personal notifications are removed');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM invitations WHERE target_user_id=$1 OR target_phone=$2', [parentId, parentPhone])).rows[0].count, '0', 'pending invitations are removed');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM otp_verifications WHERE phone=$1', [parentPhone])).rows[0].count, '0', 'OTP material is removed');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM students WHERE id=$1', [studentId])).rows[0].count, '1', 'institutional student record is preserved');

    const roster = (await db.query<any>('SELECT parent_name,parent_phone,parent_account_deleted_at FROM school_roster WHERE id=$1', [rosterId])).rows[0];
    equal(roster.parent_name, 'Silinmiş Veli', 'roster parent name is anonymized');
    check(String(roster.parent_phone).startsWith('del-') && String(roster.parent_phone).length <= 20, 'roster phone becomes a bounded anonymous marker');
    check(Boolean(roster.parent_account_deleted_at), 'roster records deletion timestamp');
    const appointmentAfterParent = (await db.query<any>('SELECT * FROM appointments WHERE id=$1', [appointmentId])).rows[0];
    equal(appointmentAfterParent.parent_id, null, 'appointment no longer references deleted parent');
    equal(appointmentAfterParent.parent_name, 'Silinmiş Kullanıcı', 'appointment parent snapshot is anonymized');
    equal(appointmentAfterParent.status, 'cancelled', 'future booked appointment is cancelled');
    equal(appointmentAfterParent.notes, null, 'private appointment notes are removed');
    equal(appointmentAfterParent.qr_token, null, 'entry QR token is removed');

    const audit = (await db.query<any>('SELECT actor_name,actor_user_id,details FROM audit_logs WHERE id=$1', [`audit-${suffix}`])).rows[0];
    equal(audit.actor_name, 'Silinmiş Kullanıcı', 'audit actor is anonymized');
    equal(audit.actor_user_id, null, 'audit actor identifier is removed');
    check(![parentId, parentPhone, parentEmail, parentFullName].some((value) => String(audit.details).includes(value)), 'audit detail contains no deleted identity');
    const sameNameAudit = (await db.query<any>('SELECT actor_name,actor_user_id,details FROM audit_logs WHERE id=$1', [`audit-same-name-${suffix}`])).rows[0];
    equal(sameNameAudit.actor_name, parentFullName, 'same-name user audit label is not changed');
    equal(sameNameAudit.actor_user_id, sameNameUserId, 'same-name user audit identity is not detached');
    equal(sameNameAudit.details, 'Başka kullanıcıya ait kayıt', 'same-name user audit detail is not changed');
    const support = (await db.query<any>('SELECT * FROM platform_requests WHERE id=$1', [platformRequestId])).rows[0];
    equal(support.created_by_user_id, null, 'support history no longer references deleted user');
    equal(support.contact_name_snapshot, 'Silinmiş Kullanıcı', 'support contact name is anonymized');
    equal(support.email_snapshot, null, 'support email is removed');
    equal(support.phone_snapshot, null, 'support phone is removed');
    check(Boolean(support.privacy_anonymized_at), 'support history records privacy anonymization');
    const supportMessage = (await db.query<any>('SELECT sender_user_id,sender_name_snapshot,message FROM platform_request_messages WHERE request_id=$1', [platformRequestId])).rows[0];
    equal(supportMessage.sender_user_id, null, 'support message user reference is removed');
    equal(supportMessage.sender_name_snapshot, 'Silinmiş Kullanıcı', 'support message sender is anonymized');
    check(!String(supportMessage.message).includes('Kişisel konuşma'), 'support message body is redacted');

    const receipt = (await db.query<any>('SELECT subject_hash,expires_at>completed_at AS expires_later FROM account_deletion_receipts WHERE request_id=$1', [parentRequestId])).rows[0];
    check(/^[0-9a-f]{64}$/.test(receipt.subject_hash), 'idempotency receipt stores only a keyed subject hash');
    check(!receipt.subject_hash.includes(parentId), 'idempotency receipt does not expose old user id');
    equal(receipt.expires_later, true, 'idempotency receipt is short-lived');
    const repeated = await deleteOwnAccount({ userId: parentId, password, requestId: parentRequestId });
    equal(repeated.alreadyCompleted, true, 'same deletion request is idempotently acknowledged');

    const reusedByOther = await request('POST', '/user/me/deletion', otherToken, {
      password, confirmation: 'HESABIMI SİL', requestId: parentRequestId,
    });
    equal(reusedByOther.status, 409, 'another identity cannot reuse a deletion idempotency key');
    equal((await request('GET', '/user/me', otherToken)).status, 200, 'collision leaves other tenant session intact');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM users WHERE id=$1', [otherId])).rows[0].count, '1', 'other tenant user remains intact');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM school_memberships WHERE user_id=$1 AND school_id=$2', [otherId, schoolB])).rows[0].count, '1', 'other tenant membership remains intact');

    const teacherDeletion = await request('POST', '/user/me/deletion', teacherToken, {
      password, confirmation: 'HESABIMI SİL', requestId: teacherRequestId,
    });
    equal(teacherDeletion.status, 200, 'teacher can delete own login account');
    equal((await request('GET', '/user/me', teacherToken)).status, 401, 'teacher old JWT is revoked');
    const profile = (await db.query<any>('SELECT user_id,first_name,last_name,email,phone,account_deleted_at FROM teacher_profiles WHERE id=$1', [teacherProfileId])).rows[0];
    equal(profile.user_id, null, 'institutional teacher history is detached from login identity');
    equal(`${profile.first_name} ${profile.last_name}`, 'Silinmiş Kullanıcı', 'teacher profile identity is anonymized');
    equal(profile.email, null, 'teacher profile email is removed');
    equal(profile.phone, null, 'teacher profile phone is removed');
    check(Boolean(profile.account_deleted_at), 'teacher profile records deletion timestamp');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM availability_slots WHERE teacher_id=$1', [teacherProfileId])).rows[0].count, '0', 'teacher future availability is removed');
    const appointmentAfterTeacher = (await db.query<any>('SELECT teacher_name,teacher_branch FROM appointments WHERE id=$1', [appointmentId])).rows[0];
    equal(appointmentAfterTeacher.teacher_name, 'Silinmiş Kullanıcı', 'appointment teacher snapshot is anonymized');
    equal(appointmentAfterTeacher.teacher_branch, 'Silinmiş personel', 'appointment teacher branch is generalized');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM students WHERE id=$1', [studentId])).rows[0].count, '1', 'teacher deletion also preserves student record');

    const dialogSource = fs.readFileSync('src/components/DeleteAccountDialog.tsx', 'utf8');
    check(dialogSource.includes('HESABIMI SİL') && dialogSource.includes("type={showPassword ? 'text' : 'password'}"), 'UI requires explicit phrase and current password');
    check(dialogSource.includes('Kalıcı olarak silinecekler') && dialogSource.includes('Anonim olarak korunabilecekler'), 'UI explains deleted and retained data');
    const contextSource = fs.readFileSync('src/context/AppContext.tsx', 'utf8');
    const deletionContextSource = contextSource.slice(contextSource.indexOf('const deleteAccount'));
    const backendAcceptanceIndex = deletionContextSource.indexOf('api.deleteOwnAccount');
    const pushCleanupIndex = deletionContextSource.indexOf('mobilePush.afterSessionInvalidated');
    check(backendAcceptanceIndex >= 0 && pushCleanupIndex > backendAcceptanceIndex, 'client clears session and push only after backend acceptance');
    check(deletionContextSource.indexOf('api.deleteOwnAccount') < deletionContextSource.indexOf('authSession.clearTokenAfterRemoteInvalidation'), 'client does not clear secure token before backend acceptance');
    const helpSource = fs.readFileSync('src/content/help-content.ts', 'utf8');
    check(helpSource.includes('Hesabımı Sil') && helpSource.includes('30 gün'), 'local privacy content documents the real deletion flow and receipt retention');

    check(checks >= 50, `expected at least 50 checks, received ${checks}`);
    console.log(`Account deletion ${checks} security, privacy, tenant and UI contract checks PASS.`);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.query('DELETE FROM account_deletion_receipts WHERE request_id IN ($1,$2)', [parentRequestId, teacherRequestId]);
    await db.query('DELETE FROM platform_requests WHERE id=$1', [platformRequestId]);
    await db.query('DELETE FROM schools WHERE id IN ($1,$2)', [schoolA, schoolB]);
    await db.query('DELETE FROM users WHERE id IN ($1,$2,$3,$4)', [parentId, teacherId, otherId, sameNameUserId]);
  }
}

run().catch((cause: unknown) => {
  console.error('Account deletion test FAILED. No credentials, tokens or personal fixture data are logged.');
  if (cause instanceof Error) console.error(cause.message);
  process.exitCode = 1;
});
