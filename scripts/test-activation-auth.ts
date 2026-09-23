import express from 'express';
import http from 'http';
import { AuthTokenPayload, createToken } from '../server/auth';
import { apiRouter } from '../server/api';
import { generateActivationCode, hashActivationCode } from '../server/activation-codes';
import { getDb, initDatabase } from '../server/database/postgres';
import { invitationRepository, membershipRepository, rosterRepository, userRepository } from '../server/repositories';
import { bootstrapLocalPasswordFixtures, createTestPassword } from './test-auth-fixtures';
import { normalizeTurkishPhone } from '../src/utils/phone';

type HttpResult = { status: number; body: Record<string, unknown> };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function phoneFormats(canonicalPhone: string): string[] {
  const subscriberNumber = canonicalPhone.slice(3);
  return [
    canonicalPhone,
    canonicalPhone.slice(1),
    `0${subscriberNumber}`,
    subscriberNumber,
    `(${subscriberNumber.slice(0, 3)}) ${subscriberNumber.slice(3, 6)}-${subscriberNumber.slice(6, 8)}-${subscriberNumber.slice(8)}`,
  ];
}

async function run() {
  await initDatabase();
  const db = await getDb();
  const fixturePassword = await bootstrapLocalPasswordFixtures(db);
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('net').AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  async function request(path: string, body: Record<string, unknown>, token?: string, schoolId?: string): Promise<HttpResult> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(schoolId ? { 'x-school-id': schoolId } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  async function getProtected(path: string, token: string): Promise<HttpResult> {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  try {
    const schoolId = 'sch-kazan-01';
    const otherSchoolId = 'sch-ataturk-02';
    const activationPassword = createTestPassword();
    const replacementPassword = createTestPassword();
    const racePasswordA = createTestPassword();
    const racePasswordB = createTestPassword();
    const expiredPassword = createTestPassword();
    const weakPassword = 'x'.repeat(7);
    const adminPhone = '+905559998877';
    assert(normalizeTurkishPhone('0555 123 45 67') === '+905551234567', 'Local phone format must normalize.');
    assert(normalizeTurkishPhone('5551234567') === '+905551234567', 'Subscriber phone format must normalize.');
    assert(normalizeTurkishPhone('123') === null, 'Invalid phone format must be rejected.');

    for (const format of phoneFormats(adminPhone).slice(0, 4)) {
      const formatLogin = await request('/auth/login', { phone: format, password: fixturePassword });
      assert(formatLogin.status === 200 && formatLogin.body.user && (formatLogin.body.user as { id: string }).id === 'u-admin-1', 'Every supported phone format must log in as the same user.');
    }

    const adminLogin = await request('/auth/login', { phone: adminPhone, password: fixturePassword });
    assert(adminLogin.status === 200 && typeof adminLogin.body.token === 'string', 'Admin password login must succeed.');
    const adminToken = adminLogin.body.token as string;

    const phone = `+905598${Date.now().toString().slice(-6)}`;
    await rosterRepository.bulkUpload(schoolId, [{ parentPhone: phone, parentName: 'Activation Test', studentName: 'Test Student', className: '5-A' }]);
    const rosterEntry = (await rosterRepository.checkPhone(schoolId, phone))[0];
    assert(rosterEntry, 'Test roster entry must exist.');

    const codeResponse = await request('/schools/:schoolId/auth-codes'.replace(':schoolId', schoolId), { rosterId: rosterEntry.id, purpose: 'ACCOUNT_ACTIVATION' }, adminToken, schoolId);
    assert(codeResponse.status === 200 && typeof codeResponse.body.code === 'string', 'Admin must create an activation code.');
    const activationCode = codeResponse.body.code as string;
    assert(!JSON.stringify(codeResponse.body).includes('codeHash'), 'Admin response must not expose a code hash.');

    const invalidPhone = await request('/auth/activate-account', { schoolId, phone: '123', code: activationCode, password: activationPassword });
    assert(invalidPhone.status === 400, 'Invalid phone number must be rejected before activation.');
    const wrongSchool = await request('/auth/activate-account', { schoolId: otherSchoolId, phone, code: activationCode, password: activationPassword, role: 'admin' });
    assert(wrongSchool.status === 400, 'Activation code must be school scoped and ignore role input.');
    const wrongPhone = await request('/auth/activate-account', { schoolId, phone: `${phone}1`, code: activationCode, password: activationPassword });
    assert(wrongPhone.status === 400, 'Activation code must be phone scoped.');
    const wrongPurpose = await request('/auth/reset-password-with-code', { schoolId, phone, code: activationCode, password: activationPassword });
    assert(wrongPurpose.status === 400, 'Activation code must not authorize password reset.');
    const weakPasswordResponse = await request('/auth/activate-account', { schoolId, phone, code: activationCode, password: weakPassword });
    assert(weakPasswordResponse.status === 400, 'Backend must reject a weak activation password.');

    const activated = await request('/auth/activate-account', { schoolId, phone: `0${phone.slice(3)}`, code: activationCode, password: activationPassword });
    assert(activated.status === 200, 'Valid activation must succeed.');
    const activatedUser = await userRepository.getAuthByPhone(phone);
    assert(activatedUser?.passwordHash && activatedUser.passwordHash !== activationPassword, 'Activation must store only a password hash.');
    const memberships = await membershipRepository.getMembershipsByUserId(activatedUser.id);
    assert(memberships.some((membership) => membership.schoolId === schoolId && membership.role === 'parent'), 'Activation must derive the parent membership server-side.');
    for (const format of phoneFormats(phone)) {
      const activationLogin = await request('/auth/login', { phone: format, password: activationPassword });
      assert(activationLogin.status === 200, 'Activated password must allow normal login with every supported phone format.');
      assert(!JSON.stringify(activationLogin.body).match(/password(Hash|_hash)?/i), 'Login response must not expose password data.');
    }
    const preResetLogin = await request('/auth/login', { phone, password: activationPassword });
    assert(preResetLogin.status === 200 && typeof preResetLogin.body.token === 'string', 'Pre-reset password login must succeed.');
    const preResetToken = preResetLogin.body.token as string;
    assert((await getProtected('/user/me', preResetToken)).status === 200, 'Pre-reset token must access protected endpoints before reset.');

    const legacyToken = createToken({ userId: activatedUser.id, phone: activatedUser.phone } as AuthTokenPayload);
    assert((await getProtected('/user/me', legacyToken)).status === 401, 'Legacy tokens without auth_version must be rejected.');
    const forgedVersionToken = createToken({ userId: activatedUser.id, phone: activatedUser.phone, auth_version: activatedUser.authVersion + 1 });
    assert((await getProtected('/user/me', forgedVersionToken)).status === 401, 'Tokens with a mismatched auth_version must be rejected.');
    const reusedActivation = await request('/auth/activate-account', { schoolId, phone, code: activationCode, password: createTestPassword() });
    assert(reusedActivation.status === 400, 'Consumed activation code must not be reusable.');

    const resetResponse = await request(`/schools/${schoolId}/auth-codes`, { rosterId: rosterEntry.id, purpose: 'PASSWORD_RESET' }, adminToken, schoolId);
    assert(resetResponse.status === 200 && typeof resetResponse.body.code === 'string', 'Admin must create a reset code for an activated user.');
    const resetCode = resetResponse.body.code as string;
    const beforeWrongReset = (await userRepository.getAuthByPhone(phone))!;
    const previousHash = beforeWrongReset.passwordHash;
    const weakReset = await request('/auth/reset-password-with-code', { schoolId, phone, code: resetCode, password: weakPassword });
    assert(weakReset.status === 400, 'Weak reset password must fail.');
    assert((await userRepository.getAuthByPhone(phone))!.authVersion === beforeWrongReset.authVersion, 'Password policy failure must not increment authVersion.');
    const wrongTenantReset = await request('/auth/reset-password-with-code', { schoolId: otherSchoolId, phone, code: resetCode, password: replacementPassword });
    assert(wrongTenantReset.status === 400, 'A reset code must not work in another tenant.');
    assert((await userRepository.getAuthByPhone(phone))!.authVersion === beforeWrongReset.authVersion, 'Cross-tenant reset attempt must not increment authVersion.');
    const wrongReset = await request('/auth/reset-password-with-code', { schoolId, phone, code: 'WRONG-CODE', password: replacementPassword });
    assert(wrongReset.status === 400, 'Wrong reset code must fail.');
    const afterWrongReset = (await userRepository.getAuthByPhone(phone))!;
    assert(afterWrongReset.passwordHash === previousHash, 'Wrong reset code must preserve the current hash.');
    assert(afterWrongReset.authVersion === beforeWrongReset.authVersion, 'Wrong reset code must not increment authVersion.');
    const reset = await request('/auth/reset-password-with-code', { schoolId, phone: phone.slice(1), code: resetCode, password: replacementPassword });
    assert(reset.status === 200, 'Valid reset code must update the password.');
    const afterReset = (await userRepository.getAuthByPhone(phone))!;
    assert(afterReset.authVersion === beforeWrongReset.authVersion + 1, 'Valid reset must increment authVersion exactly once.');
    assert((await getProtected('/user/me', preResetToken)).status === 401, 'Pre-reset token must be invalidated immediately after reset.');
    assert((await getProtected('/user/me', adminToken)).status === 200, 'Resetting one user must not invalidate another user token.');
    assert((await request('/auth/login', { phone, password: activationPassword })).status === 401, 'Old password must fail after reset.');
    const postResetLogin = await request('/auth/login', { phone, password: replacementPassword });
    assert(postResetLogin.status === 200 && typeof postResetLogin.body.token === 'string', 'New password must succeed after reset.');
    assert((await getProtected('/user/me', postResetLogin.body.token as string)).status === 200, 'Post-reset token must access protected endpoints.');

    const raceResponse = await request(`/schools/${schoolId}/auth-codes`, { rosterId: rosterEntry.id, purpose: 'PASSWORD_RESET' }, adminToken, schoolId);
    const raceCode = raceResponse.body.code as string;
    const beforeConcurrentReset = (await userRepository.getAuthByPhone(phone))!.authVersion;
    const raceResults = await Promise.all([
      request('/auth/reset-password-with-code', { schoolId, phone, code: raceCode, password: racePasswordA }),
      request('/auth/reset-password-with-code', { schoolId, phone, code: raceCode, password: racePasswordB }),
    ]);
    assert(raceResults.filter((result) => result.status === 200).length === 1, 'Concurrent code consumption must allow exactly one success.');
    assert((await userRepository.getAuthByPhone(phone))!.authVersion === beforeConcurrentReset + 1, 'Concurrent reset must increment authVersion exactly once.');

    const expiredCode = generateActivationCode();
    await invitationRepository.createAuthCode({
      schoolId,
      targetPhone: phone,
      targetUserId: activatedUser.id,
      purpose: 'PASSWORD_RESET',
      codeHash: hashActivationCode(expiredCode),
      createdBy: activatedUser.id,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      token: `test-${Date.now()}`,
    });
    const beforeExpiredReset = (await userRepository.getAuthByPhone(phone))!.authVersion;
    assert((await request('/auth/reset-password-with-code', { schoolId, phone, code: expiredCode, password: expiredPassword })).status === 400, 'Expired code must fail.');
    assert((await userRepository.getAuthByPhone(phone))!.authVersion === beforeExpiredReset, 'Expired reset code must not increment authVersion.');

    const revokedResponse = await request(`/schools/${schoolId}/auth-codes`, { rosterId: rosterEntry.id, purpose: 'PASSWORD_RESET' }, adminToken, schoolId);
    const revokedCode = revokedResponse.body.code as string;
    const replacementResponse = await request(`/schools/${schoolId}/auth-codes`, { rosterId: rosterEntry.id, purpose: 'PASSWORD_RESET' }, adminToken, schoolId);
    assert(replacementResponse.status === 200, 'Replacement reset code must be created.');
    const beforeRevokedReset = (await userRepository.getAuthByPhone(phone))!.authVersion;
    assert((await request('/auth/reset-password-with-code', { schoolId, phone, code: revokedCode, password: createTestPassword() })).status === 400, 'Revoked reset code must fail.');
    assert((await userRepository.getAuthByPhone(phone))!.authVersion === beforeRevokedReset, 'Revoked reset code must not increment authVersion.');

    const storedCodes = await db.query<{ code_hash: string }>('SELECT code_hash FROM invitations WHERE school_id = $1 AND target_phone = $2 AND code_hash IS NOT NULL;', [schoolId, phone]);
    assert(storedCodes.rows.every((storedCode) => storedCode.code_hash !== activationCode && storedCode.code_hash !== resetCode), 'Plaintext auth codes must not be stored.');

    console.log('Activation and password reset security tests passed.');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
