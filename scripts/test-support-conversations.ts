import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';

type ResponseResult = { status: number; body: Record<string, unknown> };

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('This test requires local PGlite without DATABASE_URL.');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'local-support-conversation-test-secret-at-least-32-chars';
  process.env.AUTH_CODE_SECRET = 'local-support-conversation-code-secret-at-least-32-chars';
  process.env.RESEND_API_KEY = 'local-test-key';
  process.env.EMAIL_FROM = 'test@example.test';
  process.env.PLATFORM_REQUEST_NOTIFICATION_EMAIL = 'platform-support@example.test';

  const emails: Array<{ to: string; subject: string; html: string }> = [];
  let emailFailures = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.resend.com/emails')) {
      if (emailFailures > 0) { emailFailures--; return new Response('{}', { status: 503 }); }
      const payload = JSON.parse(String(init?.body || '{}')) as { to: string[]; subject: string; html: string };
      emails.push({ to: payload.to[0], subject: payload.subject, html: payload.html });
      return new Response(JSON.stringify({ id: crypto.randomUUID() }), { status: 200 });
    }
    return originalFetch(input, init);
  };

  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken } = await import('../server/auth');
  const { membershipRepository, userRepository } = await import('../server/repositories');
  const db = await getDb();
  const suffix = crypto.randomUUID();
  const schoolA = `support-school-a-${suffix}`;
  const schoolB = `support-school-b-${suffix}`;
  const createdUsers: string[] = [];
  let checks = 0;
  const equal = (actual: unknown, expected: unknown, message: string) => { assert.equal(actual, expected, message); checks++; };
  const check = (condition: unknown, message: string) => { assert(condition, message); checks++; };

  const schoolUiSource = fs.readFileSync('src/components/SchoolRequestCenter.tsx', 'utf8');
  const platformUiSource = fs.readFileSync('src/components/PlatformRequestCenter.tsx', 'utf8');
  const conversationUiSource = fs.readFileSync('src/components/SupportConversation.tsx', 'utf8');
  const stylesheetSource = fs.readFileSync('src/index.css', 'utf8');
  check(schoolUiSource.includes('Destek Geçmişi') && schoolUiSource.includes('api.getSchoolSupportThread'), 'school admin UI exposes school-scoped support history');
  check(schoolUiSource.includes('api.sendSchoolSupportMessage') && schoolUiSource.includes('createRequestToken'), 'school reply UI uses idempotent request tokens');
  check(schoolUiSource.includes('api.hideSchoolSupportRequest') && schoolUiSource.includes('yalnızca sizin görünümünüzden'), 'school hide UI explains side-specific removal');
  check(schoolUiSource.includes('Lisans Talepleri') && schoolUiSource.includes("item.requestType !== 'SUPPORT'"), 'annual license UI remains separate from support threads');
  check(conversationUiSource.includes('maxLength={4000}') && conversationUiSource.includes("item.senderKind === 'PLATFORM_ADMIN'"), 'conversation UI enforces length and trusted sender presentation');
  check(stylesheetSource.includes('.support-message { width: min(78%, 700px)') && stylesheetSource.includes('.support-message { width: 94%; }'), 'conversation layout has bounded desktop and mobile widths');
  check(platformUiSource.includes('api.getPlatformSupportThread') && platformUiSource.includes('api.sendPlatformSupportMessage'), 'platform UI opens and replies to support threads');
  check(platformUiSource.includes('api.hidePlatformSupportRequest') && platformUiSource.includes('yalnızca Platform Yönetimi görünümünden'), 'platform hide UI explains side-specific removal');

  async function fixture(role: 'admin' | 'teacher' | 'security' | 'parent', schoolId: string, label: string) {
    const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(3).toString('hex')}@example.test`;
    const user = await userRepository.create({
      phone: `+905${crypto.randomInt(100000000, 999999999)}`,
      firstName: label,
      lastName: 'SUPPORT TEST',
      email,
    });
    createdUsers.push(user.id);
    await membershipRepository.createOrActivate({ schoolId, userId: user.id, role });
    const stored = await userRepository.getById(user.id);
    assert(stored);
    return { user, email, token: createToken({ userId: user.id, phone: user.phone, auth_version: stored.authVersion }) };
  }

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;

  async function request(method: string, path: string, token?: string, body?: object): Promise<ResponseResult> {
    const response = await fetch(baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text || '{}') as Record<string, unknown> };
  }

  const createSupport = (schoolId: string, token: string, message: string) => request('POST', `/schools/${schoolId}/requests`, token, {
    requestToken: crypto.randomUUID(), requestType: 'SUPPORT', subject: 'Teknik Sorun', message,
  });

  try {
    await db.query(
      'INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)',
      [schoolA, `Support A ${suffix}`, `SA${crypto.randomBytes(4).toString('hex')}`.toUpperCase(), 'Ankara', 'Çankaya',
        schoolB, `Support B ${suffix}`, `SB${crypto.randomBytes(4).toString('hex')}`.toUpperCase(), 'İstanbul', 'Kadıköy'],
    );
    await db.query(
      `INSERT INTO school_licenses(id,school_id,license_code,status,expires_at)
       VALUES($1,$2,$3,'active',NOW()+INTERVAL '90 days'),($4,$5,$6,'active',NOW()+INTERVAL '90 days')`,
      [`support-lic-a-${suffix}`, schoolA, `VR-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
        `support-lic-b-${suffix}`, schoolB, `VR-${crypto.randomBytes(5).toString('hex').toUpperCase()}`],
    );
    const adminA = await fixture('admin', schoolA, 'ADMIN A');
    const adminA2 = await fixture('admin', schoolA, 'ADMIN A2');
    const adminB = await fixture('admin', schoolB, 'ADMIN B');
    const teacher = await fixture('teacher', schoolA, 'TEACHER');
    const security = await fixture('security', schoolA, 'SECURITY');
    const parent = await fixture('parent', schoolA, 'PARENT');
    const platform = await fixture('admin', schoolA, 'PLATFORM');
    process.env.PLATFORM_ADMIN_USER_IDS = platform.user.id;

    const created = await createSupport(schoolA, adminA.token, 'İlk destek mesajı.');
    equal(created.status, 201, 'school A admin creates support');
    const supportId = String(created.body.requestId);

    const ownThread = await request('GET', `/schools/${schoolA}/requests/${supportId}/messages`, adminA.token);
    equal(ownThread.status, 200, 'creator admin views support thread');
    equal((ownThread.body.messages as Array<Record<string, unknown>>).length, 1, 'legacy request message is first thread message');
    equal((ownThread.body.messages as Array<Record<string, unknown>>)[0].initial, true, 'legacy first message is marked initial');
    equal((await request('GET', `/schools/${schoolA}/requests/${supportId}/messages`, adminA2.token)).status, 200, 'second active school admin views school thread');
    equal((await request('GET', `/schools/${schoolB}/requests/${supportId}/messages`, adminB.token)).status, 404, 'school B forged thread GET is hidden');
    equal((await request('POST', `/schools/${schoolB}/requests/${supportId}/messages`, adminB.token, { requestToken: crypto.randomUUID(), message: 'forged' })).status, 404, 'school B forged thread POST is hidden');
    const schoolBSupport = await createSupport(schoolB, adminB.token, 'School B destek talebi.');
    equal(schoolBSupport.status, 201, 'school B support fixture is created');
    equal((await request('GET', `/schools/${schoolA}/requests/${String(schoolBSupport.body.requestId)}/messages`, adminA.token)).status, 404, 'school A cannot infer foreign support request type');
    for (const actor of [teacher, security, parent]) {
      equal((await request('POST', `/schools/${schoolA}/requests/${supportId}/messages`, actor.token, { requestToken: crypto.randomUUID(), message: 'forbidden' })).status, 403, `${actor.user.firstName} cannot post support messages`);
    }
    equal((await request('POST', `/schools/${schoolA}/requests/${supportId}/messages`, undefined, { requestToken: crypto.randomUUID(), message: 'public' })).status, 401, 'public cannot post support messages');

    equal((await request('GET', `/platform/requests/${supportId}/messages`, platform.token)).status, 200, 'platform admin views support thread');
    equal((await request('GET', `/platform/requests/${supportId}/messages`, adminA.token)).status, 403, 'school admin cannot use platform thread endpoint');
    const platformMessageToken = crypto.randomUUID();
    const platformReply = await request('POST', `/platform/requests/${supportId}/messages`, platform.token, {
      requestToken: platformMessageToken,
      message: 'Platform yanıtı.',
      senderKind: 'SCHOOL_ADMIN',
      senderUserId: adminB.user.id,
      schoolId: schoolB,
      senderNameSnapshot: 'Sahte Gönderen',
    });
    equal(platformReply.status, 201, 'platform admin sends first reply');
    equal((platformReply.body.request as Record<string, unknown>).status, 'IN_PROGRESS', 'first platform reply moves NEW to IN_PROGRESS');
    const storedPlatformMessage = await db.query(
      'SELECT sender_user_id,sender_kind,sender_name_snapshot FROM platform_request_messages WHERE request_id=$1 AND idempotency_key=$2',
      [supportId, platformMessageToken],
    );
    equal(storedPlatformMessage.rows[0].sender_user_id, platform.user.id, 'sender user id derives from authenticated platform user');
    equal(storedPlatformMessage.rows[0].sender_kind, 'PLATFORM_ADMIN', 'sender kind cannot be forged');
    equal(storedPlatformMessage.rows[0].sender_name_snapshot, 'Veli Randevu Destek', 'platform sender snapshot is product support identity');
    equal(platformReply.body.emailNotificationSent, true, 'platform reply sends school notification');
    check(emails.some((email) => email.to === adminA.email && email.subject.includes('Yanıt Geldi')), 'school notification uses server-side request email snapshot');

    const emailCountBeforeDuplicate = emails.length;
    const duplicateReply = await request('POST', `/platform/requests/${supportId}/messages`, platform.token, { requestToken: platformMessageToken, message: 'Platform yanıtı.' });
    equal(duplicateReply.status, 200, 'idempotent duplicate is accepted safely');
    equal(duplicateReply.body.duplicate, true, 'idempotent duplicate is reported');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM platform_request_messages WHERE request_id=$1', [supportId])).rows[0].count, '1', 'duplicate token creates one message');
    equal(emails.length, emailCountBeforeDuplicate, 'duplicate token does not resend notification email');

    const schoolReplyToken = crypto.randomUUID();
    equal((await request('POST', `/schools/${schoolA}/requests/${supportId}/messages`, adminA2.token, {
      requestToken: schoolReplyToken, message: 'Okul yönetimi yanıtı.', senderKind: 'PLATFORM_ADMIN', senderUserId: platform.user.id,
    })).status, 201, 'second school admin replies');
    const storedSchoolMessage = await db.query(
      'SELECT sender_user_id,sender_kind FROM platform_request_messages WHERE request_id=$1 AND idempotency_key=$2',
      [supportId, schoolReplyToken],
    );
    equal(storedSchoolMessage.rows[0].sender_user_id, adminA2.user.id, 'school sender user derives from auth');
    equal(storedSchoolMessage.rows[0].sender_kind, 'SCHOOL_ADMIN', 'school sender kind cannot be forged');
    check(emails.some((email) => email.to === 'platform-support@example.test' && email.subject.includes('Yeni Mesaj')), 'school reply notifies configured platform recipient');
    const platformThread = await request('GET', `/platform/requests/${supportId}/messages`, platform.token);
    equal((platformThread.body.messages as Array<Record<string, unknown>>).length, 3, 'platform sees initial and both replies');
    equal((await request('GET', `/schools/${schoolA}/requests/${supportId}/messages`, adminA.token)).status, 200, 'school sees platform reply');

    equal((await request('POST', `/schools/${schoolA}/requests/${supportId}/messages`, adminA.token, { requestToken: 'malformed', message: 'test' })).status, 400, 'malformed UUID rejected');
    equal((await request('POST', `/schools/${schoolA}/requests/${supportId}/messages`, adminA.token, { requestToken: crypto.randomUUID(), message: '   ' })).status, 400, 'blank message rejected');
    equal((await request('POST', `/schools/${schoolA}/requests/${supportId}/messages`, adminA.token, { requestToken: crypto.randomUUID(), message: 'x'.repeat(4001) })).status, 400, 'over-limit message rejected');
    const secondSupport = await createSupport(schoolA, adminA.token, 'İkinci destek talebi.');
    const secondSupportId = String(secondSupport.body.requestId);
    equal((await request('POST', `/schools/${schoolA}/requests/${secondSupportId}/messages`, adminA.token, { requestToken: schoolReplyToken, message: 'Anahtar tekrar kullanımı.' })).status, 409, 'idempotency token cannot cross request boundaries');
    equal((await request('DELETE', `/schools/${schoolA}/requests/${supportId}`, adminA.token)).status, 409, 'school cannot hide active support');
    equal((await request('DELETE', `/platform/requests/${supportId}`, platform.token)).status, 409, 'platform cannot hide active support');
    emailFailures = 1;
    const persistedDuringEmailFailure = await request('POST', `/schools/${schoolA}/requests/${secondSupportId}/messages`, adminA.token, { requestToken: crypto.randomUUID(), message: 'E-posta hatasında kalıcı mesaj.' });
    equal(persistedDuringEmailFailure.status, 201, 'email failure does not fail message request');
    equal(persistedDuringEmailFailure.body.emailNotificationSent, false, 'email failure is reported safely');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM platform_request_messages WHERE request_id=$1', [secondSupportId])).rows[0].count, '1', 'email failure does not roll back message');

    const annual = await request('POST', `/schools/${schoolA}/requests`, adminA.token, { requestToken: crypto.randomUUID(), requestType: 'YEARLY_LICENSE', message: 'Yıllık lisans talebi.' });
    equal(annual.status, 201, 'annual license flow remains available');
    equal((await request('GET', `/schools/${schoolA}/requests/${String(annual.body.requestId)}/messages`, adminA.token)).status, 400, 'annual license is not a thread');
    const schoolBAnnual = await request('POST', `/schools/${schoolB}/requests`, adminB.token, { requestToken: crypto.randomUUID(), requestType: 'YEARLY_LICENSE', message: 'School B yıllık lisans talebi.' });
    equal(schoolBAnnual.status, 201, 'school B annual license fixture is created');
    equal((await request('GET', `/schools/${schoolA}/requests/${String(schoolBAnnual.body.requestId)}/messages`, adminA.token)).status, 404, 'school A cannot infer foreign annual request type');
    const contactId = `support-contact-${suffix}`;
    await db.query(
      `INSERT INTO platform_requests(id,idempotency_key,source,request_type,school_name_snapshot,contact_name_snapshot,email_snapshot,message,status)
       VALUES($1,$2,'PUBLIC','CONTACT',$3,'Public Contact','public@example.test','Contact message','NEW')`,
      [contactId, crypto.randomUUID(), `Contact ${suffix}`],
    );
    equal((await request('GET', `/platform/requests/${contactId}/messages`, platform.token)).status, 400, 'public contact is not a thread');
    const schoolBContactId = `support-school-contact-${suffix}`;
    await db.query(
      `INSERT INTO platform_requests(id,idempotency_key,source,request_type,school_id,school_name_snapshot,contact_name_snapshot,email_snapshot,message,status)
       VALUES($1,$2,'SCHOOL_ADMIN','CONTACT',$3,$4,'School B Contact','school-b-contact@example.test','Contact message','NEW')`,
      [schoolBContactId, crypto.randomUUID(), schoolB, `Contact B ${suffix}`],
    );
    equal((await request('GET', `/schools/${schoolA}/requests/${schoolBContactId}/messages`, adminA.token)).status, 404, 'school A cannot infer foreign contact request type');
    equal((await request('PATCH', `/platform/requests/${supportId}/status`, platform.token, { status: 'WAITING_PAYMENT' })).status, 409, 'support cannot wait for payment');

    equal((await request('PATCH', `/platform/requests/${supportId}/status`, platform.token, { status: 'RESOLVED' })).status, 200, 'platform resolves support');
    equal((await request('POST', `/schools/${schoolA}/requests/${supportId}/messages`, adminA.token, { requestToken: crypto.randomUUID(), message: 'resolved reply' })).status, 409, 'resolved thread is read-only for school');
    equal((await request('POST', `/platform/requests/${supportId}/messages`, platform.token, { requestToken: crypto.randomUUID(), message: 'resolved reply' })).status, 409, 'resolved thread is read-only for platform');
    equal((await request('PATCH', `/platform/requests/${supportId}/status`, platform.token, { status: 'IN_PROGRESS' })).status, 409, 'resolved support cannot be reopened');

    const schoolHide = await createSupport(schoolA, adminA.token, 'School hide talebi.');
    const schoolHideId = String(schoolHide.body.requestId);
    await request('PATCH', `/platform/requests/${schoolHideId}/status`, platform.token, { status: 'RESOLVED' });
    equal((await request('DELETE', `/schools/${schoolA}/requests/${schoolHideId}`, adminA.token)).status, 200, 'school hides resolved support');
    equal((await request('GET', `/schools/${schoolA}/requests/${schoolHideId}/messages`, adminA.token)).status, 404, 'school hidden support leaves school detail');
    equal((await request('GET', `/platform/requests/${schoolHideId}/messages`, platform.token)).status, 200, 'school hide preserves platform history');
    equal((await request('GET', `/platform/requests/${schoolHideId}`, platform.token)).status, 200, 'school hide preserves platform generic detail');

    const platformHide = await createSupport(schoolA, adminA.token, 'Platform hide talebi.');
    const platformHideId = String(platformHide.body.requestId);
    await request('PATCH', `/platform/requests/${platformHideId}/status`, platform.token, { status: 'RESOLVED' });
    equal((await request('DELETE', `/platform/requests/${platformHideId}`, platform.token)).status, 200, 'platform hides resolved support');
    equal((await request('GET', `/platform/requests/${platformHideId}`, platform.token)).status, 404, 'platform hidden support leaves generic detail');
    equal((await request('GET', `/platform/requests/${platformHideId}/messages`, platform.token)).status, 404, 'platform hidden support leaves platform detail');
    equal((await request('POST', `/platform/requests/${platformHideId}/messages`, platform.token, { requestToken: crypto.randomUUID(), message: 'hidden reply' })).status, 404, 'platform hidden support rejects new platform messages');
    equal((await request('PATCH', `/platform/requests/${platformHideId}/status`, platform.token, { status: 'ARCHIVED' })).status, 404, 'platform hidden support rejects status updates');
    equal((await request('DELETE', `/platform/requests/${platformHideId}`, platform.token)).status, 404, 'platform hidden support rejects repeated hide mutation');
    equal((await request('GET', `/schools/${schoolA}/requests/${platformHideId}/messages`, adminA.token)).status, 200, 'platform hide preserves school history');
    const schoolList = await request('GET', `/schools/${schoolA}/requests`, adminA.token);
    check(!(schoolList.body.requests as Array<Record<string, unknown>>).some((item) => item.id === schoolHideId), 'school list excludes school-hidden support');
    check((schoolList.body.requests as Array<Record<string, unknown>>).some((item) => item.id === platformHideId), 'school list retains platform-hidden support');
    const globalList = await request('GET', '/platform/requests?status=ALL', platform.token);
    check(!(globalList.body.requests as Array<Record<string, unknown>>).some((item) => item.id === platformHideId), 'platform list excludes platform-hidden support');
    check((globalList.body.requests as Array<Record<string, unknown>>).some((item) => item.id === schoolHideId), 'platform list retains school-hidden support');

    const migrationSource = fs.readFileSync('server/database/migrations/20261002_add_platform_request_messages.sql', 'utf8');
    check(migrationSource.includes('ON DELETE CASCADE') && migrationSource.includes('ON DELETE SET NULL'), 'migration preserves request cascade and deleted-sender history');
    check(migrationSource.includes('ENABLE ROW LEVEL SECURITY') && migrationSource.includes('TO service_role'), 'message table uses backend-only RLS pattern');
    const auditRows = await db.query<{ action: string; details: string }>(
      `SELECT action,details FROM audit_logs WHERE school_id=$1 AND action IN ('support.message_sent','support.resolved','support.hidden')`,
      [schoolA],
    );
    check(auditRows.rows.some((row) => row.action === 'support.message_sent'), 'support message is audited');
    check(auditRows.rows.some((row) => row.action === 'support.resolved'), 'support resolution is audited');
    check(auditRows.rows.some((row) => row.action === 'support.hidden'), 'support hide is audited');
    check(!auditRows.rows.some((row) => row.details.includes('Platform yanıtı') || row.details.includes('Okul yönetimi yanıtı')), 'audit metadata excludes message bodies');

    equal((await request('PATCH', `/platform/schools/${schoolA}/status`, platform.token, { active: false })).status, 200, 'school disabled before permanent deletion');
    equal((await request('DELETE', `/platform/schools/${schoolA}`, platform.token)).status, 200, 'permanent school deletion succeeds with support messages');
    const historyAfterDelete = await request('GET', `/platform/requests/${supportId}/messages`, platform.token);
    equal(historyAfterDelete.status, 200, 'platform reads support history after school deletion');
    const historyMessages = historyAfterDelete.body.messages as Array<Record<string, unknown>>;
    check(historyMessages.some((message) => message.senderKind === 'SCHOOL_ADMIN' && message.senderUserId === null), 'deleted school sender FK becomes null');
    check(historyMessages.some((message) => message.senderKind === 'SCHOOL_ADMIN' && typeof message.senderName === 'string'), 'deleted sender snapshot remains readable');
    check(historyMessages.some((message) => message.senderKind === 'PLATFORM_ADMIN' && message.senderUserId === platform.user.id), 'platform sender remains linked');
    check(await userRepository.getById(platform.user.id), 'platform admin is preserved by school deletion');
    equal(await userRepository.getById(adminA.user.id), null, 'school-only creator can be orphan-cleaned despite message history');

    check(checks >= 50, `expected at least 50 checks, received ${checks}`);
    console.log(`Support conversation ${checks} authorization, tenant, idempotency, lifecycle, hide and deletion checks PASS.`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    await db.query('DELETE FROM platform_requests WHERE school_name_snapshot LIKE $1 OR id=$2', [`%${suffix}%`, `support-contact-${suffix}`]);
    await db.query('DELETE FROM schools WHERE id IN ($1,$2)', [schoolA, schoolB]);
    for (const userId of createdUsers) await db.query('DELETE FROM users WHERE id=$1', [userId]);
    delete process.env.PLATFORM_ADMIN_USER_IDS;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.PLATFORM_REQUEST_NOTIFICATION_EMAIL;
  }
}

run().catch((cause: unknown) => {
  console.error('Support conversation tests FAILED. No credentials, message bodies, email addresses or response bodies are logged.');
  if (cause instanceof Error) console.error(cause.message);
  process.exitCode = 1;
});
