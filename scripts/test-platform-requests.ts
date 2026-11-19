import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import { filterPlatformRequests, getPlatformRequestStatusOptions, isBasicEmailAddress } from '../src/utils/platform-request-ui';
import { getPublicRequestPreset, PUBLIC_REQUEST_PATH } from '../src/utils/public-request-route';
import type { PlatformRequestItem } from '../src/types/platform';

type ResponseResult = { status: number; body: Record<string, unknown> };

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('This test requires local PGlite without DATABASE_URL.');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'local-platform-request-test-secret-at-least-32-chars';
  process.env.AUTH_CODE_SECRET = 'local-platform-request-code-secret-at-least-32-chars';
  process.env.RESEND_API_KEY = 'local-test-key';
  process.env.EMAIL_FROM = 'test@example.test';
  process.env.PLATFORM_REQUEST_NOTIFICATION_EMAIL = 'platform@example.test';

  const emails: Array<{ to: string; subject: string; html: string; text?: string }> = [];
  let emailFailures = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://api.resend.com/emails')) {
      if (emailFailures > 0) { emailFailures--; return new Response('{}', { status: 503 }); }
      const payload = JSON.parse(String(init?.body || '{}')) as { to: string[]; subject: string; html: string; text?: string };
      emails.push({ to: payload.to[0], subject: payload.subject, html: payload.html, text: payload.text });
      return new Response(JSON.stringify({ id: crypto.randomUUID() }), { status: 200 });
    }
    return originalFetch(input, init);
  };

  const { getDb } = await import('../server/database/postgres');
  const { apiRouter } = await import('../server/api');
  const { createToken } = await import('../server/auth');
  const { userRepository, membershipRepository } = await import('../server/repositories');
  const db = await getDb();
  const suffix = crypto.randomUUID();
  const schoolA = `request-school-a-${suffix}`;
  const schoolB = `request-school-b-${suffix}`;
  const schoolCodeA = `RA${crypto.randomBytes(4).toString('hex')}`.toUpperCase();
  const schoolCodeB = `RB${crypto.randomBytes(4).toString('hex')}`.toUpperCase();
  const createdUsers: string[] = [];
  let checks = 0;
  const check = (condition: unknown, message: string) => { assert(condition, message); checks++; };
  const equal = (actual: unknown, expected: unknown, message: string) => { assert.equal(actual, expected, message); checks++; };

  const uiRequest: PlatformRequestItem = {
    id: 'ui-request', schoolId: null, createdByUserId: null, source: 'PUBLIC', requestType: 'CONTACT',
    schoolName: 'UI Test Okulu', contactName: 'UI Test', email: 'ui@example.test', phone: null,
    teacherCount: null, subject: null, message: 'UI filter test', status: 'NEW',
    createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z', resolvedAt: null, archivedAt: null,
  };
  equal(filterPlatformRequests([uiRequest], 'NEW', '').length, 1, 'NEW filter shows NEW request');
  const inProgressUiRequest = { ...uiRequest, status: 'IN_PROGRESS' as const };
  equal(filterPlatformRequests([inProgressUiRequest], 'NEW', '').length, 0, 'NEW to IN_PROGRESS leaves NEW filter');
  equal(filterPlatformRequests([inProgressUiRequest], 'IN_PROGRESS', '').length, 1, 'IN_PROGRESS filter shows request');
  const resolvedUiRequest = { ...uiRequest, status: 'RESOLVED' as const };
  equal(filterPlatformRequests([resolvedUiRequest], 'IN_PROGRESS', '').length, 0, 'resolved request leaves IN_PROGRESS filter');
  equal(filterPlatformRequests([resolvedUiRequest], 'RESOLVED', '').length, 1, 'RESOLVED filter shows resolved request');
  const archivedUiRequest = { ...uiRequest, status: 'ARCHIVED' as const };
  equal(filterPlatformRequests([archivedUiRequest], '', '').length, 0, 'active default hides archived request');
  equal(filterPlatformRequests([archivedUiRequest], 'ARCHIVED', '').length, 1, 'ARCHIVED filter shows archived request');
  equal(filterPlatformRequests([archivedUiRequest], 'ALL', '').length, 1, 'ALL filter includes archived request');
  equal(filterPlatformRequests([{ ...uiRequest, requestType: 'SUPPORT' }], 'ALL', 'CONTACT').length, 0, 'request type filter combines with status filter');
  check(!getPlatformRequestStatusOptions('NEW', 'CONTACT').includes('WAITING_PAYMENT'), 'CONTACT does not offer WAITING_PAYMENT');
  check(!getPlatformRequestStatusOptions('NEW', 'SUPPORT').includes('WAITING_PAYMENT'), 'SUPPORT does not offer WAITING_PAYMENT');
  check(getPlatformRequestStatusOptions('NEW', 'YEARLY_LICENSE').includes('WAITING_PAYMENT'), 'yearly license request offers WAITING_PAYMENT');
  check(getPlatformRequestStatusOptions('NEW', 'MONTHLY_LICENSE').includes('WAITING_PAYMENT'), 'legacy monthly request status management remains available');
  check(!getPlatformRequestStatusOptions('RESOLVED', 'YEARLY_LICENSE').includes('NEW'), 'RESOLVED does not offer NEW');
  check(!isBasicEmailAddress('abc'), 'public frontend rejects invalid email');
  check(isBasicEmailAddress('valid@example.test'), 'public frontend accepts basic valid email');

  const schoolRequestSource = fs.readFileSync('src/components/SchoolRequestCenter.tsx', 'utf8');
  check(/setError\(''\);\s*if \(!currentSchool\) \{\s*setRequests\(\[\]\);\s*setLoading\(false\);\s*return;\s*\}/.test(schoolRequestSource), 'school request load clears stale errors and ends loading without a school');
  const publicRequestSource = fs.readFileSync('src/components/PublicRequestSection.tsx', 'utf8');
  check(publicRequestSource.indexOf('!isBasicEmailAddress(form.email)') < publicRequestSource.indexOf('api.createPublicRequest'), 'public email validation runs before API request');
  const authViewSource = fs.readFileSync('src/components/AuthView.tsx', 'utf8');
  check(!authViewSource.includes('PublicRequestSection'), 'AuthView does not render the public request form');
  check(authViewSource.includes('public-request-cta') && authViewSource.includes('onOpenPublicRequest'), 'AuthView renders compact public request CTA');
  const appSource = fs.readFileSync('src/App.tsx', 'utf8');
  check(appSource.includes('PublicRequestPage') && appSource.includes('window.history.pushState') && appSource.includes("window.addEventListener('popstate'"), 'CTA opens history-aware public page view');
  const publicPageSource = fs.readFileSync('src/components/PublicRequestPage.tsx', 'utf8');
  check(publicPageSource.includes('PublicRequestSection') && publicPageSource.includes('Giriş ekranına dön'), 'public page renders reusable form and back action');
  check(!publicRequestSource.includes('MONTHLY_LICENSE') && !publicRequestSource.includes('Aylık Lisans'), 'public form does not expose monthly license');
  check(publicRequestSource.includes('YEARLY_LICENSE') && publicRequestSource.includes('Yıllık Lisans') && publicRequestSource.includes('İletişim'), 'public form exposes yearly license and contact');
  check(publicRequestSource.includes("initialRequestType = 'YEARLY_LICENSE'"), 'public form defaults to yearly license');
  check(publicRequestSource.includes('api.createPublicRequest'), 'public page form keeps existing API submission');
  check(!publicRequestSource.includes('teacherCount') && !publicRequestSource.includes('Öğretmen Sayısı'), 'public form omits teacher count state, field and payload');
  equal(PUBLIC_REQUEST_PATH, '/lisans-iletisim', 'public request page uses expected URL');
  equal(getPublicRequestPreset('?request=monthly'), 'YEARLY_LICENSE', 'monthly query safely falls back to yearly');
  equal(getPublicRequestPreset('?request=yearly'), 'YEARLY_LICENSE', 'yearly query preset supported');
  equal(getPublicRequestPreset('?request=contact'), 'CONTACT', 'contact query preset supported');
  equal(getPublicRequestPreset('?request=invalid'), 'YEARLY_LICENSE', 'unknown query preset safely falls back to yearly');
  check(authViewSource.includes('Giriş yap') && authViewSource.includes('Veli Hesabı Oluştur') && authViewSource.includes('Personel İlk Giriş') && authViewSource.includes('Okul Yöneticisi İlk Giriş'), 'existing login and activation entry points remain');
  check(authViewSource.includes('Yıllık lisans hakkında bilgi alın veya bize ulaşın.'), 'public CTA describes annual license');
  check(!publicRequestSource.match(/!success[\s\S]*Giriş ekranına dön[\s\S]*Talebi Gönder/), 'normal public form does not render a second back button');
  const schoolRequestSourceForTypes = fs.readFileSync('src/components/SchoolRequestCenter.tsx', 'utf8');
  check(!schoolRequestSourceForTypes.includes('<option value="MONTHLY_LICENSE">') && schoolRequestSourceForTypes.includes('<option value="YEARLY_LICENSE">') && schoolRequestSourceForTypes.includes('<option value="SUPPORT">'), 'school admin create options are support and yearly license only');
  const platformRequestSource = fs.readFileSync('src/components/PlatformRequestCenter.tsx', 'utf8');
  check(platformRequestSource.includes("activeRequestTypes: PlatformRequestType[] = ['YEARLY_LICENSE', 'CONTACT', 'SUPPORT']") && platformRequestSource.includes("MONTHLY_LICENSE: 'Aylık Lisans (Eski)'"), 'platform filters show current products while preserving legacy monthly label');
  check(appSource.indexOf('if (pathname === PUBLIC_REQUEST_PATH)') < appSource.indexOf('if (!currentUser)') && appSource.includes("backLabel={currentUser ? 'Uygulamaya dön' : 'Giriş ekranına dön'}"), 'authenticated help navigation can open the shared public contact page safely');
  const stylesheetSource = fs.readFileSync('src/index.css', 'utf8');
  check(stylesheetSource.includes('.public-request-page-shell { width: min(720px, 100%)') && stylesheetSource.includes('.public-request-page .form-actions { flex-direction: column-reverse; }'), 'public page has bounded desktop width and mobile actions');

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;

  async function request(method: string, path: string, token?: string, body?: object, ip = `198.51.100.${crypto.randomInt(1, 240)}`): Promise<ResponseResult> {
    const response = await originalFetch(baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text || '{}') as Record<string, unknown> };
  }

  function publicPayload(overrides: Record<string, unknown> = {}) {
    return {
      requestToken: crypto.randomUUID(), requestType: 'YEARLY_LICENSE', schoolName: `Public School ${suffix}`,
      contactName: 'Public Yetkili', email: `public-${crypto.randomBytes(3).toString('hex')}@example.test`,
      phone: '0555 123 45 67', message: 'Lisans bilgisi rica ederiz.', companyWebsite: '', ...overrides,
    };
  }

  async function fixture(role: 'admin' | 'teacher' | 'security' | 'parent', schoolId: string, label: string) {
    const user = await userRepository.create({
      phone: `+905${crypto.randomInt(100000000, 999999999)}`,
      firstName: label,
      lastName: 'REQUEST TEST',
      email: `${label.toLowerCase()}-${crypto.randomBytes(3).toString('hex')}@example.test`,
    });
    createdUsers.push(user.id);
    await membershipRepository.createOrActivate({ schoolId, userId: user.id, role });
    const auth = await userRepository.getById(user.id);
    assert(auth);
    return { user, token: createToken({ userId: user.id, phone: user.phone, auth_version: auth.authVersion }) };
  }

  try {
    await db.query('INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)',
      [schoolA, 'Talep Okulu A', schoolCodeA, 'Ankara', 'Çankaya', schoolB, 'Talep Okulu B', schoolCodeB, 'İstanbul', 'Kadıköy']);
    await db.query(`INSERT INTO school_licenses(id,school_id,license_code,status,expires_at)
      VALUES($1,$2,$3,'active',NOW()+INTERVAL '90 days')`, [`lic-${suffix}`, schoolA, `VR-${crypto.randomBytes(5).toString('hex').toUpperCase()}`]);
    const adminA = await fixture('admin', schoolA, 'ADMINA');
    const adminB = await fixture('admin', schoolB, 'ADMINB');
    const teacher = await fixture('teacher', schoolA, 'TEACHER');
    const security = await fixture('security', schoolA, 'SECURITY');
    const parent = await fixture('parent', schoolA, 'PARENT');
    const platform = await fixture('admin', schoolA, 'PLATFORM');
    process.env.PLATFORM_ADMIN_USER_IDS = platform.user.id;

    const licenseBefore = await db.query('SELECT status,expires_at::text AS expires_at FROM school_licenses WHERE school_id=$1', [schoolA]);

    const monthly = await request('POST', '/public/requests', undefined, publicPayload({ requestType: 'MONTHLY_LICENSE' }));
    equal(monthly.status, 400, 'public monthly license create rejected');
    const yearly = await request('POST', '/public/requests', undefined, publicPayload());
    equal(yearly.status, 201, 'valid yearly request');
    check(typeof yearly.body.requestId === 'string', 'public response returns request id');
    const contact = await request('POST', '/public/requests', undefined, publicPayload({ requestType: 'CONTACT' }));
    equal(contact.status, 201, 'valid contact request');
    equal((await request('POST', '/public/requests', undefined, publicPayload({ email: '', phone: '0555 123 45 67' }))).status, 400, 'phone-only forged public request rejected');
    equal((await request('POST', '/public/requests', undefined, publicPayload({ phone: '', email: 'email-only@example.test' }))).status, 400, 'email-only forged public request rejected');
    equal((await request('POST', '/public/requests', undefined, publicPayload({ phone: '', email: '' }))).status, 400, 'missing contact rejected');
    equal((await request('POST', '/public/requests', undefined, publicPayload({ email: 'not-an-email' }))).status, 400, 'invalid email rejected');
    equal((await request('POST', '/public/requests', undefined, publicPayload({ email: '', phone: '123' }))).status, 400, 'invalid phone rejected');
    equal((await request('POST', '/public/requests', undefined, publicPayload({ requestType: 'INVALID' }))).status, 400, 'invalid type rejected');
    equal((await request('POST', '/public/requests', undefined, publicPayload({ requestType: 'SUPPORT' }))).status, 400, 'public support rejected');
    equal((await request('POST', '/public/requests', undefined, publicPayload({ teacherCount: -2 }))).status, 400, 'invalid teacher count rejected');
    equal((await request('POST', '/public/requests', undefined, publicPayload({ companyWebsite: 'https://spam.example' }))).status, 400, 'honeypot rejected');

    const forgedPayload = publicPayload({ status: 'RESOLVED', schoolId: schoolB, createdByUserId: adminB.user.id });
    const forged = await request('POST', '/public/requests', undefined, forgedPayload);
    equal(forged.status, 201, 'public request ignores authority fields');
    const forgedRow = await db.query('SELECT status,school_id,created_by_user_id FROM platform_requests WHERE id=$1', [forged.body.requestId]);
    equal(forgedRow.rows[0].status, 'NEW', 'public cannot set status');
    equal(forgedRow.rows[0].school_id, null, 'public cannot bind school');

    const idempotencyPayload = publicPayload();
    const emailCountBeforeIdempotency = emails.length;
    const firstIdempotent = await request('POST', '/public/requests', undefined, idempotencyPayload);
    const secondIdempotent = await request('POST', '/public/requests', undefined, idempotencyPayload);
    equal(secondIdempotent.status, 200, 'idempotent retry accepted');
    equal(secondIdempotent.body.requestId, firstIdempotent.body.requestId, 'idempotent retry returns same request');
    equal(emails.length, emailCountBeforeIdempotency + 2, 'idempotent retry does not resend email');

    const xssEmailStart = emails.length;
    const xss = await request('POST', '/public/requests', undefined, publicPayload({ message: '<script>alert("x")</script>' }));
    equal(xss.status, 201, 'HTML-like message stored safely');
    check(emails.slice(xssEmailStart).some((email) => email.html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')), 'dynamic email content escaped');
    check(!emails.slice(xssEmailStart).some((email) => email.html.includes('<script>alert("x")</script>')), 'raw script absent from email HTML');

    const rateIp = `203.0.113.${crypto.randomInt(1, 240)}`;
    for (let attempt = 1; attempt <= 9; attempt++) equal((await request('POST', '/public/requests', undefined, publicPayload({ schoolName: `Rate School ${suffix} ${attempt}` }), rateIp)).status, 201, `rate-limit request ${attempt} accepted`);
    equal((await request('POST', '/public/requests', undefined, publicPayload({ schoolName: `Rate School ${suffix} blocked` }), rateIp)).status, 429, 'durable rate limit blocks burst');

    const support = await request('POST', `/schools/${schoolA}/requests`, adminA.token, { requestToken: crypto.randomUUID(), requestType: 'SUPPORT', subject: 'Teknik Sorun', message: 'Panel desteğine ihtiyacımız var.' });
    equal(support.status, 201, 'school admin creates support');
    equal((await request('POST', `/schools/${schoolA}/requests`, adminA.token, { requestToken: crypto.randomUUID(), requestType: 'MONTHLY_LICENSE', message: 'Forged monthly request' })).status, 400, 'school admin monthly license create rejected');
    const supportId = String(support.body.requestId);
    const supportRow = await db.query('SELECT school_id,created_by_user_id,source,status FROM platform_requests WHERE id=$1', [supportId]);
    equal(supportRow.rows[0].school_id, schoolA, 'school id derived from auth');
    equal(supportRow.rows[0].created_by_user_id, adminA.user.id, 'creator derived from auth');
    equal((await request('POST', `/schools/${schoolA}/requests`, adminA.token, { requestToken: crypto.randomUUID(), requestType: 'SUPPORT', subject: 'Teknik Sorun', message: 'Spoof', schoolId: schoolB })).status, 400, 'forged school id rejected');
    equal((await request('POST', `/schools/${schoolB}/requests`, adminA.token, { requestToken: crypto.randomUUID(), requestType: 'SUPPORT', subject: 'Teknik Sorun', message: 'Cross tenant' })).status, 403, 'cross-tenant create blocked');
    for (const role of [teacher, security, parent]) equal((await request('GET', `/schools/${schoolA}/requests`, role.token)).status, 403, `${role.user.firstName} role blocked from school requests`);

    const schoolBLicense = await request('POST', `/schools/${schoolB}/requests`, adminB.token, { requestToken: crypto.randomUUID(), requestType: 'YEARLY_LICENSE', message: 'Yıllık lisans görüşmek istiyoruz.' });
    equal(schoolBLicense.status, 201, 'second tenant request created');
    const schoolAHistory = await request('GET', `/schools/${schoolA}/requests`, adminA.token);
    equal(schoolAHistory.status, 200, 'school admin lists own history');
    check(!(schoolAHistory.body.requests as Array<{ id: string }>).some((item) => item.id === schoolBLicense.body.requestId), 'school A cannot see school B request');

    equal((await request('GET', '/platform/requests', adminA.token)).status, 403, 'school admin blocked from global inbox');
    equal((await request('GET', '/platform/requests', teacher.token)).status, 403, 'teacher blocked from global inbox');
    const globalList = await request('GET', '/platform/requests', platform.token);
    equal(globalList.status, 200, 'platform admin lists requests');
    check((globalList.body.requests as Array<{ id: string }>).some((item) => item.id === supportId), 'platform list includes support request');
    const legacyMonthlyId = `legacy-monthly-${suffix}`;
    await db.query(
      `INSERT INTO platform_requests(id,idempotency_key,source,request_type,school_name_snapshot,contact_name_snapshot,email_snapshot,message,status)
       VALUES($1,$2,'PUBLIC','MONTHLY_LICENSE',$3,$4,$5,$6,'NEW')`,
      [legacyMonthlyId, crypto.randomUUID(), `Legacy Monthly ${suffix}`, 'Legacy Contact', `legacy-${suffix}@example.test`, 'Historical monthly request']
    );
    const legacyMonthlyList = await request('GET', '/platform/requests?requestType=MONTHLY_LICENSE', platform.token);
    equal(legacyMonthlyList.status, 200, 'legacy monthly filter remains readable');
    check((legacyMonthlyList.body.requests as Array<{ id: string }>).some((item) => item.id === legacyMonthlyId), 'historical monthly request remains readable');
    equal((await request('GET', `/platform/requests/${legacyMonthlyId}`, platform.token)).status, 200, 'historical monthly detail remains readable');
    equal((await request('GET', `/platform/requests/${supportId}`, platform.token)).status, 200, 'platform admin views detail');
    equal((await request('PATCH', `/platform/requests/${supportId}/status`, platform.token, { status: 'WAITING_PAYMENT' })).status, 409, 'support cannot wait for payment');
    equal((await request('PATCH', `/platform/requests/${String(contact.body.requestId)}/status`, platform.token, { status: 'WAITING_PAYMENT' })).status, 409, 'contact cannot wait for payment');
    equal((await request('PATCH', `/platform/requests/${supportId}/status`, platform.token, { status: 'IN_PROGRESS' })).status, 200, 'allowed status update works');
    equal((await request('PATCH', `/platform/requests/${supportId}/status`, platform.token, { status: 'NOT_VALID' })).status, 400, 'invalid status rejected');
    equal((await request('PATCH', `/platform/requests/${supportId}/status`, adminA.token, { status: 'RESOLVED' })).status, 403, 'school admin cannot change global status');
    equal((await request('PATCH', `/platform/requests/${String(schoolBLicense.body.requestId)}/status`, platform.token, { status: 'WAITING_PAYMENT' })).status, 200, 'license request can wait for payment');

    const licenseAfter = await db.query('SELECT status,expires_at::text AS expires_at FROM school_licenses WHERE school_id=$1', [schoolA]);
    equal(licenseAfter.rows[0].status, licenseBefore.rows[0].status, 'request does not change license status');
    equal(licenseAfter.rows[0].expires_at, licenseBefore.rows[0].expires_at, 'request does not extend license');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM school_licenses WHERE school_id=$1', [schoolA])).rows[0].count, '1', 'request does not create license');

    check(emails.some((email) => email.to === 'platform@example.test' && email.subject.includes('Yeni')), 'platform notification attempted');
    check(emails.some((email) => email.subject === 'VELİ RANDEVU — Talebiniz Alındı'), 'requester acknowledgement sent when email exists');
    const phoneOnlyEmail = `phone-only-${crypto.randomBytes(3).toString('hex')}@example.test`;
    check(!emails.some((email) => email.to === phoneOnlyEmail), 'no invented acknowledgement recipient');

    emailFailures = 2;
    const failureRequest = await request('POST', '/public/requests', undefined, publicPayload({ email: `failure-${suffix}@example.test` }));
    equal(failureRequest.status, 201, 'email failure does not fail request');
    equal(failureRequest.body.emailNotificationSent, false, 'email failure reported safely');
    equal((await db.query('SELECT COUNT(*)::text AS count FROM platform_requests WHERE id=$1', [failureRequest.body.requestId])).rows[0].count, '1', 'email failure keeps DB request');

    const userHistoryBefore = await db.query(
      `SELECT school_id,school_name_snapshot,contact_name_snapshot,email_snapshot,phone_snapshot,request_type,message,status
       FROM platform_requests WHERE id=$1`, [schoolBLicense.body.requestId]);
    await db.query('DELETE FROM users WHERE id=$1', [adminB.user.id]);
    const userHistoryAfter = await db.query(
      `SELECT school_id,created_by_user_id,school_name_snapshot,contact_name_snapshot,email_snapshot,phone_snapshot,request_type,message,status
       FROM platform_requests WHERE id=$1`, [schoolBLicense.body.requestId]);
    equal(userHistoryAfter.rows.length, 1, 'request history survives creator deletion');
    equal(userHistoryAfter.rows[0].created_by_user_id, null, 'creator foreign key becomes null');
    equal(userHistoryAfter.rows[0].school_id, schoolB, 'independent creator deletion keeps school link');
    for (const field of ['school_name_snapshot', 'contact_name_snapshot', 'email_snapshot', 'phone_snapshot', 'request_type', 'message', 'status']) {
      equal(userHistoryAfter.rows[0][field], userHistoryBefore.rows[0][field], `creator deletion preserves ${field}`);
    }

    const schoolHistoryBefore = await db.query(
      `SELECT school_name_snapshot,contact_name_snapshot,email_snapshot,phone_snapshot,request_type,message,status
       FROM platform_requests WHERE id=$1`, [supportId]);
    equal((await request('PATCH', `/platform/schools/${schoolA}/status`, platform.token, { active: false })).status, 200, 'platform admin disables school before permanent deletion');
    equal((await request('DELETE', `/platform/schools/${schoolA}`, platform.token)).status, 200, 'permanent school deletion succeeds with request history');
    const schoolHistoryAfter = await db.query(
      `SELECT school_id,created_by_user_id,school_name_snapshot,contact_name_snapshot,email_snapshot,phone_snapshot,request_type,message,status
       FROM platform_requests WHERE id=$1`, [supportId]);
    equal(schoolHistoryAfter.rows.length, 1, 'request history survives permanent school deletion');
    equal(schoolHistoryAfter.rows[0].school_id, null, 'school foreign key becomes null');
    equal(schoolHistoryAfter.rows[0].created_by_user_id, null, 'orphan creator foreign key becomes null');
    for (const field of ['school_name_snapshot', 'contact_name_snapshot', 'email_snapshot', 'phone_snapshot', 'request_type', 'message', 'status']) {
      equal(schoolHistoryAfter.rows[0][field], schoolHistoryBefore.rows[0][field], `school deletion preserves ${field}`);
    }

    check(checks >= 32, `expected at least 32 checks, received ${checks}`);
    console.log(`Platform request center ${checks} validation, tenant, authorization, idempotency, email and license-safety checks PASS.`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    await db.query(`DELETE FROM platform_requests WHERE school_name_snapshot LIKE $1 OR school_id IN ($2,$3)`, [`%${suffix}%`, schoolA, schoolB]);
    await db.query('DELETE FROM schools WHERE id IN ($1,$2)', [schoolA, schoolB]);
    for (const userId of createdUsers) await db.query('DELETE FROM users WHERE id=$1', [userId]);
    delete process.env.PLATFORM_ADMIN_USER_IDS;
  }
}

run().catch((cause: unknown) => {
  console.error('Platform request center test FAILED. No credentials, request messages, email addresses or response bodies are logged.');
  if (cause instanceof Error) console.error(cause.message);
  process.exitCode = 1;
});
