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

    process.env.WHATSAPP_AUTH_ENABLED = 'true';
    process.env.WHATSAPP_PILOT_ENABLED = 'true';
    process.env.WHATSAPP_UNIFIED_LOGIN_ENABLED = 'true';
    process.env.WHATSAPP_PILOT_ALLOWED_PHONES = `${canonicalDuplicate},${racePhone}`;
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    process.env.WHATSAPP_ACCESS_TOKEN = 'local-test-access-token';
    const originalFetch = globalThis.fetch;
    let deliveredCode = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://graph.facebook.com/')) {
        const body = JSON.parse(String(init?.body || '{}')) as { template?: { components?: Array<{ parameters?: Array<{ text?: string }> }> } };
        deliveredCode = body.template?.components?.[0]?.parameters?.[0]?.text || '';
        return new Response(JSON.stringify({ messages: [{ id: 'local-message' }] }), { status: 200 });
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
      const response = await originalFetch(baseUrl + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const assertConflictWithoutIdentity = (response: { status: number; body: Record<string, unknown> }) => {
      assert.equal(response.status, 409);
      assert.deepEqual(Object.keys(response.body), ['error']);
      assert.equal('token' in response.body, false);
      assert.equal('user' in response.body, false);
      assert.equal('memberships' in response.body, false);
    };
    try {
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
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error('Identity auth attempt test FAILED. No phone, email, OTP, token, or response body is logged.', error instanceof Error ? error.stack : '');
  process.exitCode = 1;
});
