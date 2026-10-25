import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const repositoryRoot = process.cwd();
const migrationPath = path.join(repositoryRoot, 'server/database/migrations/20261024_add_identity_auth_attempts.sql');
const schemaPath = path.join(repositoryRoot, 'server/database/supabase_schema.sql');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');
const schemaSql = fs.readFileSync(schemaPath, 'utf8');
let currentStage = 'migration';

async function verifyMigration() {
  const clean = new PGlite();
  await clean.exec(schemaSql);
  await clean.exec(migrationSql);
  await clean.exec(migrationSql);
  const cleanTable = await clean.query<{ relrowsecurity: boolean }>(
    `SELECT relrowsecurity FROM pg_class WHERE oid='identity_auth_attempts'::regclass`,
  );
  assert.equal(cleanTable.rows[0]?.relrowsecurity, true);
  await clean.close();

  const existing = new PGlite();
  await existing.exec(`
    CREATE ROLE service_role;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE whatsapp_auth_challenges (id TEXT PRIMARY KEY);
  `);
  await existing.exec(migrationSql);
  await existing.exec(migrationSql);
  const columns = await existing.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='identity_auth_attempts' ORDER BY ordinal_position`,
  );
  assert(columns.rows.some((row) => row.column_name === 'email_code_hash'));
  assert(columns.rows.some((row) => row.column_name === 'auth_version_at_start'));
  await existing.close();
}

async function run() {
  await verifyMigration();

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'veli-identity-auth-'));
  fs.mkdirSync(path.join(tempRoot, 'server/database/migrations'), { recursive: true });
  fs.copyFileSync(schemaPath, path.join(tempRoot, 'server/database/supabase_schema.sql'));
  fs.cpSync(path.join(repositoryRoot, 'server/database/migrations'), path.join(tempRoot, 'server/database/migrations'), { recursive: true });

  const originalCwd = process.cwd();
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = process.env.PHONE_CENTRIC_AUTH_ENABLED;
  const originalSecret = process.env.AUTH_CODE_SECRET;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalWhatsAppAuthEnabled = process.env.WHATSAPP_AUTH_ENABLED;
  const originalWhatsAppPilotEnabled = process.env.WHATSAPP_PILOT_ENABLED;
  const originalWhatsAppUnifiedEnabled = process.env.WHATSAPP_UNIFIED_LOGIN_ENABLED;
  const originalWhatsAppAllowedPhones = process.env.WHATSAPP_PILOT_ALLOWED_PHONES;
  const originalWhatsAppPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const originalWhatsAppAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const originalPlatformIds = process.env.PLATFORM_ADMIN_USER_IDS;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalEmailFrom = process.env.EMAIL_FROM;
  process.chdir(tempRoot);
  delete process.env.DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.AUTH_CODE_SECRET = 'local-identity-attempt-secret-at-least-32-characters';
  process.env.JWT_SECRET = crypto.randomBytes(48).toString('base64url');

  const database = await import('../server/database/postgres');
  const service = await import('../server/identity-auth-attempts');
  const phoneAudit = await import('../server/phone-identity-audit');
  const { membershipRepository, userRepository } = await import('../server/repositories');

  try {
    delete process.env.PHONE_CENTRIC_AUTH_ENABLED;
    await assert.rejects(
      () => service.createIdentityAuthAttempt({ phone: '05551234567', flowType: 'USER_LOGIN' }),
      (error: unknown) => error instanceof service.IdentityAuthAttemptError && error.code === 'DISABLED',
    );
    process.env.PHONE_CENTRIC_AUTH_ENABLED = 'true';
    const db = await database.getDb();

    const insertWhatsappChallenge = async (id: string, phone: string) => {
      await db.query(
        `INSERT INTO whatsapp_auth_challenges
         (id,target_phone,purpose,code_hash,max_attempts,expires_at,resend_available_at)
         VALUES($1,$2,'login',$3,5,NOW()+INTERVAL '5 minutes',NOW())`,
        [id, phone, 'a'.repeat(64)],
      );
    };

    const phoneVerifiedAttempt = async (
      flowType: service.IdentityAuthFlowType,
      phone: string,
      targetUserId?: string,
      authVersionAtStart?: number,
    ) => {
      const attempt = await service.createIdentityAuthAttempt({ phone, flowType, targetUserId, authVersionAtStart });
      const challengeId = crypto.randomUUID();
      await insertWhatsappChallenge(challengeId, attempt.canonicalPhone);
      await service.attachPhoneChallenge(attempt.id, challengeId);
      await service.markPhoneVerified(attempt.id, challengeId);
      return { attempt, challengeId };
    };

    const normalized = await service.createIdentityAuthAttempt({ phone: '(0555) 123-45-67', flowType: 'USER_LOGIN' });
    assert.equal(normalized.canonicalPhone, '+905551234567');

    const wrongOrder = await service.createIdentityAuthAttempt({ phone: '5551234568', flowType: 'USER_LOGIN' });
    await assert.rejects(
      () => service.markPhoneVerified(wrongOrder.id, crypto.randomUUID()),
      (error: unknown) => error instanceof service.IdentityAuthAttemptError && error.code === 'INVALID_STATE',
    );

    const expired = await service.createIdentityAuthAttempt({ phone: '5551234569', flowType: 'USER_LOGIN' });
    const expiredChallenge = crypto.randomUUID();
    await insertWhatsappChallenge(expiredChallenge, expired.canonicalPhone);
    await service.attachPhoneChallenge(expired.id, expiredChallenge);
    await db.query(`UPDATE identity_auth_attempts SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`, [expired.id]);
    await assert.rejects(
      () => service.markPhoneVerified(expired.id, expiredChallenge),
      (error: unknown) => error instanceof service.IdentityAuthAttemptError && error.code === 'EXPIRED',
    );
    const expiredRow = await db.query<{ status: string }>('SELECT status FROM identity_auth_attempts WHERE id=$1', [expired.id]);
    assert.equal(expiredRow.rows[0].status, 'EXPIRED');

    const platformA = await phoneVerifiedAttempt('PLATFORM_LOGIN', '5551234570');
    await assert.rejects(
      () => service.consumeAuthenticatedAttempt(platformA.attempt.id),
      (error: unknown) => error instanceof service.IdentityAuthAttemptError && error.code === 'INVALID_STATE',
    );
    const emailA = await service.issueEmailChallenge({
      attemptId: platformA.attempt.id,
      email: 'platform-a@example.test',
      phoneCode: '123456',
    });
    assert.notEqual(emailA.code, '123456');
    const emailRow = await db.query<{ email_code_hash: string; email_recipient_fingerprint: string }>(
      'SELECT email_code_hash,email_recipient_fingerprint FROM identity_auth_attempts WHERE id=$1',
      [platformA.attempt.id],
    );
    assert.match(emailRow.rows[0].email_code_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(emailRow.rows[0].email_code_hash, emailA.code);
    assert.match(emailRow.rows[0].email_recipient_fingerprint, /^[0-9a-f]{64}$/);

    const platformB = await phoneVerifiedAttempt('PLATFORM_LOGIN', '5551234571');
    const emailB = await service.issueEmailChallenge({
      attemptId: platformB.attempt.id,
      email: 'platform-b@example.test',
      phoneCode: '654321',
    });
    await assert.rejects(
      () => service.verifyEmailChallenge({ attemptId: platformA.attempt.id, email: 'platform-a@example.test', code: emailB.code }),
      (error: unknown) => error instanceof service.IdentityAuthAttemptError && error.code === 'INVALID_CODE',
    );
    const afterMixedCode = await db.query<{ email_attempts: number }>('SELECT email_attempts FROM identity_auth_attempts WHERE id=$1', [platformA.attempt.id]);
    assert.equal(Number(afterMixedCode.rows[0].email_attempts), 1);
    await service.verifyEmailChallenge({ attemptId: platformA.attempt.id, email: 'platform-a@example.test', code: emailA.code });
    const authenticatedPlatform = await service.consumeAuthenticatedAttempt(platformA.attempt.id);
    assert.equal(authenticatedPlatform.status, 'AUTHENTICATED');
    await assert.rejects(
      () => service.consumeAuthenticatedAttempt(platformA.attempt.id),
      (error: unknown) => error instanceof service.IdentityAuthAttemptError && error.code === 'INVALID_STATE',
    );

    const ordinary = await phoneVerifiedAttempt('USER_LOGIN', '5551234572');
    const concurrent = await Promise.allSettled([
      service.consumeAuthenticatedAttempt(ordinary.attempt.id),
      service.consumeAuthenticatedAttempt(ordinary.attempt.id),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);

    const identityUser = await userRepository.create({ phone: '+905551234573', firstName: 'Attempt', lastName: 'User' });
    const identityAuth = await userRepository.getById(identityUser.id);
    assert(identityAuth);
    const guarded = await phoneVerifiedAttempt('USER_LOGIN', identityUser.phone, identityUser.id, identityAuth.authVersion);
    await db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [identityUser.id]);
    await assert.rejects(
      () => service.consumeAuthenticatedAttempt(guarded.attempt.id),
      (error: unknown) => error instanceof service.IdentityAuthAttemptError && error.code === 'REVOKED',
    );
    const revoked = await db.query<{ status: string }>('SELECT status FROM identity_auth_attempts WHERE id=$1', [guarded.attempt.id]);
    assert.equal(revoked.rows[0].status, 'REVOKED');

    const duplicateSuffix = crypto.randomInt(100000000, 999999999).toString();
    const canonicalDuplicate = `+905${duplicateSuffix}`;
    const localDuplicate = `05${duplicateSuffix}`;
    await db.query(
      `INSERT INTO users(id,phone,first_name,last_name,is_phone_verified) VALUES($1,$2,'Duplicate','One',TRUE),($3,$4,'Duplicate','Two',TRUE)`,
      [`duplicate-a-${duplicateSuffix}`, canonicalDuplicate, `duplicate-b-${duplicateSuffix}`, localDuplicate],
    );
    await assert.rejects(
      () => userRepository.getByPhone(canonicalDuplicate),
      (error: unknown) => error instanceof phoneAudit.PhoneIdentityAmbiguityError,
    );
    await assert.rejects(
      () => userRepository.getAuthByPhone(localDuplicate),
      (error: unknown) => error instanceof phoneAudit.PhoneIdentityAmbiguityError,
    );
    const collisionAudit = await phoneAudit.auditCanonicalPhoneCollisions(db);
    assert(collisionAudit.totalUsers >= collisionAudit.validCanonicalPhoneRows);
    assert(collisionAudit.collisionGroups >= 1);
    assert(collisionAudit.formatCollisionGroups >= 1);
    assert(collisionAudit.usersInCollisionGroups >= 2);
    assert.equal(collisionAudit.totalUsers, collisionAudit.validCanonicalPhoneRows + collisionAudit.invalidPhoneRows);

    const raceSuffix = crypto.randomInt(100000000, 999999999).toString();
    const racePhone = `+905${raceSuffix}`;
    const racePassword = 'Local-Identity-Test-Password-42!';
    const raceUser = await userRepository.create({ phone: racePhone, firstName: 'Race', lastName: 'Guard', isPhoneVerified: true });
    const { hashPassword } = await import('../server/passwords');
    await userRepository.updatePasswordHash(raceUser.id, hashPassword(racePassword));
    const raceSchoolId = `identity-school-${raceSuffix}`;
    await db.query(
      `INSERT INTO schools(id,name,code,city,district) VALUES($1,'Identity Test School',$2,'Test','Test')`,
      [raceSchoolId, `ID${raceSuffix}`],
    );
    await db.query(
      `INSERT INTO school_licenses(id,school_id,license_code,status,activated_at)
       VALUES($1,$2,$3,'active',NOW())`,
      [`identity-license-${raceSuffix}`, raceSchoolId, `IDENTITY-${raceSuffix}`],
    );
    await membershipRepository.createOrActivate({ schoolId: raceSchoolId, userId: raceUser.id, role: 'parent' });
    const teacherPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
    const securityPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
    const pilotOutsidePhone = `+905${crypto.randomInt(100000000, 999999999)}`;
    const teacherUser = await userRepository.create({ phone: teacherPhone, firstName: 'Pilot', lastName: 'Öğretmen', isPhoneVerified: true });
    const securityUser = await userRepository.create({ phone: securityPhone, firstName: 'Pilot', lastName: 'Güvenlik', isPhoneVerified: true });
    const pilotOutsideUser = await userRepository.create({ phone: pilotOutsidePhone, firstName: 'Eski', lastName: 'Giriş', isPhoneVerified: true });
    await userRepository.updatePasswordHash(pilotOutsideUser.id, hashPassword(racePassword));
    await membershipRepository.createOrActivate({ schoolId: raceSchoolId, userId: teacherUser.id, role: 'teacher' });
    await membershipRepository.createOrActivate({ schoolId: raceSchoolId, userId: securityUser.id, role: 'security' });
    await membershipRepository.createOrActivate({ schoolId: raceSchoolId, userId: pilotOutsideUser.id, role: 'parent' });
    const registrationPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
    const unregisteredPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
    await db.query(
      `INSERT INTO school_roster(id,school_id,parent_phone,parent_name,student_name,class_name,student_number,is_claimed)
       VALUES($1,$2,$3,'Pilot Veli','Pilot Öğrenci','5-A',$4,FALSE)`,
      [`identity-roster-${raceSuffix}`, raceSchoolId, registrationPhone, `REG-${raceSuffix}`],
    );

    process.env.WHATSAPP_AUTH_ENABLED = 'true';
    process.env.WHATSAPP_PILOT_ENABLED = 'true';
    process.env.WHATSAPP_UNIFIED_LOGIN_ENABLED = 'false';
    process.env.PHONE_CENTRIC_AUTH_ENABLED = 'true';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    process.env.WHATSAPP_ACCESS_TOKEN = 'local-test-access-token';
    process.env.RESEND_API_KEY = 'local-test-email-key';
    process.env.EMAIL_FROM = 'test@example.test';
    const platformPhone = `+905${crypto.randomInt(100000000, 999999999)}`;
    const platformUser = await userRepository.create({
      phone: platformPhone,
      firstName: 'Platform',
      lastName: 'İki Faktör',
      email: 'platform-two-factor@example.test',
      isPhoneVerified: true,
    });
    await userRepository.updatePasswordHash(platformUser.id, hashPassword(racePassword));
    process.env.PLATFORM_ADMIN_USER_IDS = platformUser.id;
    process.env.WHATSAPP_PILOT_ALLOWED_PHONES = `${canonicalDuplicate},${racePhone},${platformPhone},${registrationPhone},${unregisteredPhone},${teacherPhone},${securityPhone}`;
    const originalFetch = globalThis.fetch;
    let deliveredCode = '';
    let deliveredEmailCode = '';
    let whatsappDeliveryCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://graph.facebook.com/')) {
        const body = JSON.parse(String(init?.body || '{}')) as { template?: { components?: Array<{ parameters?: Array<{ text?: string }> }> } };
        deliveredCode = body.template?.components?.[0]?.parameters?.[0]?.text || '';
        whatsappDeliveryCount += 1;
        return new Response(JSON.stringify({ messages: [{ id: 'local-message' }] }), { status: 200 });
      }
      if (String(input) === 'https://api.resend.com/emails') {
        const body = JSON.parse(String(init?.body || '{}')) as { html?: string };
        deliveredEmailCode = body.html?.match(/>(\d{6})</)?.[1] || '';
        return new Response(JSON.stringify({ id: 'local-email' }), { status: 200 });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const { apiRouter } = await import('../server/api');
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
    const request = async (path: string, body: object) => {
      try {
        const response = await originalFetch(baseUrl + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      } catch (cause) {
        const detail = cause instanceof Error && cause.cause instanceof Error ? cause.cause.message : 'transport failure';
        throw new Error(`Local API request failed during ${currentStage}: ${detail}`);
      }
    };
    const assertConflictWithoutIdentity = (response: { status: number; body: Record<string, unknown> }) => {
      assert.equal(response.status, 409);
      assert.deepEqual(Object.keys(response.body), ['error']);
      assert.equal('token' in response.body, false);
      assert.equal('user' in response.body, false);
      assert.equal('memberships' in response.body, false);
    };
    try {
      currentStage = 'phone-centric feature flag';
      process.env.PHONE_CENTRIC_AUTH_ENABLED = 'false';
      assert.equal((await request('/auth/phone/request-code', { phone: racePhone })).status, 404);
      process.env.PHONE_CENTRIC_AUTH_ENABLED = 'true';

      currentStage = 'phone-centric parent first registration';
      const deliveriesBeforeRegistration = whatsappDeliveryCount;
      const unauthorizedRegistration = await request('/auth/phone/request-code', {
        phone: unregisteredPhone,
        flow: 'parent_registration',
        schoolCode: `ID${raceSuffix}`,
      });
      assert.equal(unauthorizedRegistration.status, 200);
      assert.equal(whatsappDeliveryCount, deliveriesBeforeRegistration, 'phone possession without an authorized roster must not send or claim');
      const registrationStart = await request('/auth/phone/request-code', {
        phone: registrationPhone,
        flow: 'parent_registration',
        schoolCode: `ID${raceSuffix}`,
      });
      assert.equal(registrationStart.status, 200);
      assert.equal(whatsappDeliveryCount, deliveriesBeforeRegistration + 1);
      const registrationComplete = await request('/auth/phone/verify-code', {
        attemptId: registrationStart.body.attemptId,
        challengeId: registrationStart.body.challengeId,
        phone: registrationPhone,
        code: deliveredCode,
      });
      assert.equal(registrationComplete.status, 200);
      assert.equal(typeof registrationComplete.body.token, 'string');
      assert.equal((registrationComplete.body.user as Record<string, unknown>).deletionVerification, 'whatsapp');
      const registeredIdentity = await userRepository.getByPhone(registrationPhone);
      assert(registeredIdentity);
      assert.equal((await membershipRepository.getActiveMembership(registeredIdentity.id, raceSchoolId))?.role, 'parent');
      assert.equal((await db.query<{ is_claimed: boolean }>(
        'SELECT is_claimed FROM school_roster WHERE id=$1',
        [`identity-roster-${raceSuffix}`],
      )).rows[0].is_claimed, true);
      const registeredLoginStart = await request('/auth/phone/request-code', { phone: registrationPhone });
      const registeredLogin = await request('/auth/phone/verify-code', {
        attemptId: registeredLoginStart.body.attemptId,
        challengeId: registeredLoginStart.body.challengeId,
        phone: registrationPhone,
        code: deliveredCode,
      });
      assert.equal(registeredLogin.status, 200, 'new parent must use the same phone-only flow on later login');

      currentStage = 'phone-centric staff login';
      for (const fixture of [
        { phone: teacherPhone, role: 'teacher' },
        { phone: securityPhone, role: 'security' },
      ]) {
        const start = await request('/auth/phone/request-code', { phone: fixture.phone });
        const verified = await request('/auth/phone/verify-code', {
          attemptId: start.body.attemptId,
          challengeId: start.body.challengeId,
          phone: fixture.phone,
          code: deliveredCode,
        });
        assert.equal(verified.status, 200);
        assert.equal((verified.body.memberships as Array<Record<string, unknown>>)[0]?.role, fixture.role);
      }

      currentStage = 'pilot fallback preserves legacy password login';
      const deliveryCountBeforeOutsidePilot = whatsappDeliveryCount;
      const outsidePilotStart = await request('/auth/phone/request-code', { phone: pilotOutsidePhone });
      assert.equal(outsidePilotStart.status, 200);
      assert.equal(outsidePilotStart.body.legacyFallbackRequired, true);
      assert.equal('attemptId' in outsidePilotStart.body, false);
      assert.equal('challengeId' in outsidePilotStart.body, false);
      assert.equal(whatsappDeliveryCount, deliveryCountBeforeOutsidePilot, 'outside-pilot phone must not receive OTP');
      const outsidePilotPasswordLogin = await request('/auth/login', { phone: pilotOutsidePhone, password: racePassword });
      assert.equal(outsidePilotPasswordLogin.status, 200);
      assert.equal(typeof outsidePilotPasswordLogin.body.token, 'string');

      currentStage = 'phone-centric parent login';
      const parentStart = await request('/auth/phone/request-code', { phone: `05${raceSuffix}` });
      assert.equal(parentStart.status, 200);
      assert.match(deliveredCode, /^\d{6}$/);
      const parentVerified = await request('/auth/phone/verify-code', {
        attemptId: parentStart.body.attemptId,
        challengeId: parentStart.body.challengeId,
        phone: racePhone,
        code: deliveredCode,
      });
      assert.equal(parentVerified.status, 200);
      assert.equal(typeof parentVerified.body.token, 'string');
      assert.equal('pendingEmail' in parentVerified.body, false);

      currentStage = 'phone-centric platform first factor';
      process.env.PHONE_CENTRIC_AUTH_ENABLED = 'false';
      assert.equal((await request('/auth/login', { phone: platformPhone, password: racePassword })).status, 200,
        'legacy platform password endpoint must remain compatible while phone-centric auth is disabled');
      process.env.PHONE_CENTRIC_AUTH_ENABLED = 'true';
      const platformStart = await request('/auth/phone/request-code', { phone: platformPhone });
      assert.equal(platformStart.status, 200);
      const platformPhoneCode = deliveredCode;
      const platformPhoneVerified = await request('/auth/phone/verify-code', {
        attemptId: platformStart.body.attemptId,
        challengeId: platformStart.body.challengeId,
        phone: platformPhone,
        code: platformPhoneCode,
      });
      assert.equal(platformPhoneVerified.status, 200);
      assert.equal(platformPhoneVerified.body.pendingEmail, true);
      assert.equal(platformPhoneVerified.body.requiresSchoolCode, false);
      assert.match(deliveredEmailCode, /^\d{6}$/);
      assert.notEqual(deliveredEmailCode, platformPhoneCode);
      assert.equal('token' in platformPhoneVerified.body, false, 'platform authority requires the email factor');
      assert.equal((await request('/auth/login', { phone: platformPhone, password: racePassword })).status, 401,
        'phone-centric web mode must not permit platform password login');
      currentStage = 'phone-centric platform second factor';
      const platformComplete = await request('/auth/phone/verify-email', {
        attemptId: platformStart.body.attemptId,
        phone: platformPhone,
        emailCode: deliveredEmailCode,
      });
      assert.equal(platformComplete.status, 200);
      assert.equal(typeof platformComplete.body.token, 'string');
      const platformPayload = (await import('../server/auth')).verifyToken(String(platformComplete.body.token));
      assert.equal(platformPayload?.auth_method, 'phone_centric_platform');

      const normalLogin = await request('/auth/login', { phone: `05${raceSuffix}`, password: racePassword });
      assert.equal(normalLogin.status, 200);
      assert.equal(typeof normalLogin.body.token, 'string');

      assertConflictWithoutIdentity(await request('/auth/login', { phone: canonicalDuplicate, password: racePassword }));
      assertConflictWithoutIdentity(await request('/auth/whatsapp/request-code', { purpose: 'login', phone: canonicalDuplicate }));

      const challenge = await request('/auth/whatsapp/request-code', { purpose: 'login', phone: racePhone });
      assert.equal(challenge.status, 200);
      assert.equal(typeof challenge.body.challengeId, 'string');
      assert.match(deliveredCode, /^\d{6}$/);
      await db.query(
        `INSERT INTO users(id,phone,first_name,last_name,is_phone_verified)
         VALUES($1,$2,'Race','Duplicate',TRUE)`,
        [`duplicate-race-${raceSuffix}`, `05${raceSuffix}`],
      );
      assertConflictWithoutIdentity(await request('/auth/whatsapp/verify-code', {
        phone: racePhone,
        challengeId: challenge.body.challengeId,
        code: deliveredCode,
      }));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      globalThis.fetch = originalFetch;
    }

    assert.equal((await import('../server/auth')).canUsePlatformAuthority({
      id: identityUser.id,
      phone: identityUser.phone,
      firstName: identityUser.firstName,
      lastName: identityUser.lastName,
      isPhoneVerified: true,
      authMethod: 'whatsapp_otp',
    }), false);

    console.log('Identity auth attempts: migration idempotency, state order, expiry, replay, concurrency, factor binding, HMAC storage, auth-version revocation and canonical-phone ambiguity PASS.');
  } finally {
    await database.closeDatabase();
    process.chdir(originalCwd);
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
    if (originalFlag === undefined) delete process.env.PHONE_CENTRIC_AUTH_ENABLED; else process.env.PHONE_CENTRIC_AUTH_ENABLED = originalFlag;
    if (originalSecret === undefined) delete process.env.AUTH_CODE_SECRET; else process.env.AUTH_CODE_SECRET = originalSecret;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalJwtSecret;
    if (originalWhatsAppAuthEnabled === undefined) delete process.env.WHATSAPP_AUTH_ENABLED; else process.env.WHATSAPP_AUTH_ENABLED = originalWhatsAppAuthEnabled;
    if (originalWhatsAppPilotEnabled === undefined) delete process.env.WHATSAPP_PILOT_ENABLED; else process.env.WHATSAPP_PILOT_ENABLED = originalWhatsAppPilotEnabled;
    if (originalWhatsAppUnifiedEnabled === undefined) delete process.env.WHATSAPP_UNIFIED_LOGIN_ENABLED; else process.env.WHATSAPP_UNIFIED_LOGIN_ENABLED = originalWhatsAppUnifiedEnabled;
    if (originalWhatsAppAllowedPhones === undefined) delete process.env.WHATSAPP_PILOT_ALLOWED_PHONES; else process.env.WHATSAPP_PILOT_ALLOWED_PHONES = originalWhatsAppAllowedPhones;
    if (originalWhatsAppPhoneNumberId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID; else process.env.WHATSAPP_PHONE_NUMBER_ID = originalWhatsAppPhoneNumberId;
    if (originalWhatsAppAccessToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN; else process.env.WHATSAPP_ACCESS_TOKEN = originalWhatsAppAccessToken;
    if (originalPlatformIds === undefined) delete process.env.PLATFORM_ADMIN_USER_IDS; else process.env.PLATFORM_ADMIN_USER_IDS = originalPlatformIds;
    if (originalResendKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalResendKey;
    if (originalEmailFrom === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = originalEmailFrom;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(`Identity auth attempt test FAILED at ${currentStage}. No phone, email, OTP, token, or response body is logged.`, error instanceof Error ? error.stack : '');
  process.exitCode = 1;
});
