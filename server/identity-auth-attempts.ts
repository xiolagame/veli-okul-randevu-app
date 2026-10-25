import crypto from 'node:crypto';
import { hashSetupToken } from './activation-codes';
import { getDb, TransactionClient } from './database/postgres';
import { normalizeTurkishPhone } from '../src/utils/phone';

export type IdentityAuthFlowType =
  | 'USER_LOGIN'
  | 'PARENT_REGISTRATION'
  | 'STAFF_ACTIVATION'
  | 'SCHOOL_ADMIN_LOGIN'
  | 'SCHOOL_ADMIN_ACTIVATION'
  | 'PLATFORM_LOGIN'
  | 'ACCOUNT_RECOVERY';

export type IdentityAuthAttemptStatus =
  | 'CREATED'
  | 'PHONE_CHALLENGE_ISSUED'
  | 'PHONE_VERIFIED'
  | 'EMAIL_CHALLENGE_ISSUED'
  | 'EMAIL_VERIFIED'
  | 'AUTHENTICATED'
  | 'EXPIRED'
  | 'REVOKED';

export interface IdentityAuthAttempt {
  id: string;
  canonicalPhone: string;
  targetUserId: string | null;
  flowType: IdentityAuthFlowType;
  status: IdentityAuthAttemptStatus;
  whatsappChallengeId: string | null;
  phoneVerifiedAt: string | null;
  emailChallengeId: string | null;
  emailAttempts: number;
  emailMaxAttempts: number;
  emailVerifiedAt: string | null;
  authVersionAtStart: number | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
}

type AttemptRow = {
  id: string;
  canonical_phone: string;
  target_user_id: string | null;
  flow_type: IdentityAuthFlowType;
  status: IdentityAuthAttemptStatus;
  whatsapp_challenge_id: string | null;
  phone_verified_at: string | null;
  email_challenge_id: string | null;
  email_recipient_fingerprint: string | null;
  email_code_hash: string | null;
  email_attempts: number;
  email_max_attempts: number;
  email_verified_at: string | null;
  auth_version_at_start: number | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
};

const DEFAULT_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_EMAIL_MAX_ATTEMPTS = 5;
const EMAIL_CODE_PATTERN = /^\d{6}$/;

export class IdentityAuthAttemptError extends Error {
  constructor(public readonly code: 'DISABLED' | 'INVALID_INPUT' | 'INVALID_STATE' | 'EXPIRED' | 'REVOKED' | 'INVALID_CODE') {
    super(code);
  }
}

export function isPhoneCentricAuthEnabled(): boolean {
  return process.env.PHONE_CENTRIC_AUTH_ENABLED?.trim().toLowerCase() === 'true';
}

function assertEnabled(): void {
  if (!isPhoneCentricAuthEnabled()) throw new IdentityAuthAttemptError('DISABLED');
}

function mapAttempt(row: AttemptRow): IdentityAuthAttempt {
  return {
    id: row.id,
    canonicalPhone: row.canonical_phone,
    targetUserId: row.target_user_id,
    flowType: row.flow_type,
    status: row.status,
    whatsappChallengeId: row.whatsapp_challenge_id,
    phoneVerifiedAt: row.phone_verified_at,
    emailChallengeId: row.email_challenge_id,
    emailAttempts: Number(row.email_attempts),
    emailMaxAttempts: Number(row.email_max_attempts),
    emailVerifiedAt: row.email_verified_at,
    authVersionAtStart: row.auth_version_at_start === null ? null : Number(row.auth_version_at_start),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    revokedAt: row.revoked_at,
  };
}

function emailRecipientFingerprint(email: string): string {
  return hashSetupToken(`identity-auth:email-recipient:${email.trim().toLowerCase()}`);
}

function emailCodeHash(attemptId: string, recipientFingerprint: string, code: string): string {
  return hashSetupToken(`identity-auth:email-code:${attemptId}:${recipientFingerprint}:${code}`);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requiresEmailFactor(flowType: IdentityAuthFlowType): boolean {
  return flowType === 'SCHOOL_ADMIN_ACTIVATION' || flowType === 'PLATFORM_LOGIN';
}

async function persistExpiration(attemptId: string): Promise<void> {
  await (await getDb()).query(
    `UPDATE identity_auth_attempts
     SET status='EXPIRED',updated_at=NOW()
     WHERE id=$1 AND expires_at <= NOW()
       AND status NOT IN ('AUTHENTICATED','EXPIRED','REVOKED')`,
    [attemptId],
  );
}

async function lockAttempt(tx: TransactionClient, attemptId: string): Promise<AttemptRow> {
  const result = await tx.query<AttemptRow>(
    `SELECT id,canonical_phone,target_user_id,flow_type,status,whatsapp_challenge_id,phone_verified_at,
            email_challenge_id,email_recipient_fingerprint,email_code_hash,email_attempts,email_max_attempts,
            email_verified_at,auth_version_at_start,created_at,expires_at,consumed_at,revoked_at
     FROM identity_auth_attempts WHERE id=$1 FOR UPDATE`,
    [attemptId],
  );
  const attempt = result.rows[0];
  if (!attempt) throw new IdentityAuthAttemptError('INVALID_INPUT');
  if (attempt.status === 'REVOKED' || attempt.revoked_at) throw new IdentityAuthAttemptError('REVOKED');
  if (attempt.status === 'EXPIRED' || new Date(attempt.expires_at).getTime() <= Date.now()) {
    if (attempt.status !== 'EXPIRED') {
      await tx.query(
        `UPDATE identity_auth_attempts SET status='EXPIRED',updated_at=NOW()
         WHERE id=$1 AND status NOT IN ('AUTHENTICATED','REVOKED')`,
        [attemptId],
      );
    }
    throw new IdentityAuthAttemptError('EXPIRED');
  }
  return attempt;
}

export async function createIdentityAuthAttempt(input: {
  phone: unknown;
  targetUserId?: string | null;
  flowType: IdentityAuthFlowType;
  authVersionAtStart?: number | null;
  ttlMs?: number;
}): Promise<IdentityAuthAttempt> {
  assertEnabled();
  const canonicalPhone = normalizeTurkishPhone(input.phone);
  const ttlMs = input.ttlMs ?? DEFAULT_ATTEMPT_TTL_MS;
  if (!canonicalPhone || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 30 * 60 * 1000 ||
      (input.authVersionAtStart !== undefined && input.authVersionAtStart !== null &&
        (!Number.isSafeInteger(input.authVersionAtStart) || input.authVersionAtStart < 0))) {
    throw new IdentityAuthAttemptError('INVALID_INPUT');
  }
  const id = crypto.randomUUID();
  const result = await (await getDb()).query<AttemptRow>(
    `INSERT INTO identity_auth_attempts
     (id,canonical_phone,target_user_id,flow_type,status,auth_version_at_start,expires_at)
     VALUES($1,$2,$3,$4,'CREATED',$5,$6)
     RETURNING *`,
    [id, canonicalPhone, input.targetUserId || null, input.flowType, input.authVersionAtStart ?? null,
      new Date(Date.now() + ttlMs).toISOString()],
  );
  return mapAttempt(result.rows[0]);
}

export async function getIdentityAuthAttempt(attemptId: string): Promise<IdentityAuthAttempt | null> {
  assertEnabled();
  if (!attemptId) return null;
  await persistExpiration(attemptId);
  const result = await (await getDb()).query<AttemptRow>(
    `SELECT id,canonical_phone,target_user_id,flow_type,status,whatsapp_challenge_id,phone_verified_at,
            email_challenge_id,email_recipient_fingerprint,email_code_hash,email_attempts,email_max_attempts,
            email_verified_at,auth_version_at_start,created_at,expires_at,consumed_at,revoked_at
     FROM identity_auth_attempts WHERE id=$1`,
    [attemptId],
  );
  return result.rows[0] ? mapAttempt(result.rows[0]) : null;
}

export async function attachPhoneChallenge(attemptId: string, whatsappChallengeId: string): Promise<IdentityAuthAttempt> {
  assertEnabled();
  if (!whatsappChallengeId) throw new IdentityAuthAttemptError('INVALID_INPUT');
  await persistExpiration(attemptId);
  return (await getDb()).transaction(async (tx) => {
    const attempt = await lockAttempt(tx, attemptId);
    if (attempt.status !== 'CREATED') throw new IdentityAuthAttemptError('INVALID_STATE');
    const result = await tx.query<AttemptRow>(
      `UPDATE identity_auth_attempts
       SET whatsapp_challenge_id=$2,status='PHONE_CHALLENGE_ISSUED',updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [attemptId, whatsappChallengeId],
    );
    return mapAttempt(result.rows[0]);
  });
}

export async function markPhoneVerified(attemptId: string, whatsappChallengeId: string): Promise<IdentityAuthAttempt> {
  assertEnabled();
  await persistExpiration(attemptId);
  return (await getDb()).transaction(async (tx) => {
    const attempt = await lockAttempt(tx, attemptId);
    if (attempt.status !== 'PHONE_CHALLENGE_ISSUED' || attempt.whatsapp_challenge_id !== whatsappChallengeId) {
      throw new IdentityAuthAttemptError('INVALID_STATE');
    }
    const result = await tx.query<AttemptRow>(
      `UPDATE identity_auth_attempts
       SET status='PHONE_VERIFIED',phone_verified_at=NOW(),updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [attemptId],
    );
    return mapAttempt(result.rows[0]);
  });
}

export function generateDistinctEmailCode(phoneCode: string): string {
  if (!EMAIL_CODE_PATTERN.test(phoneCode)) throw new IdentityAuthAttemptError('INVALID_INPUT');
  let code = phoneCode;
  while (code === phoneCode) code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  return code;
}

export async function issueEmailChallenge(input: {
  attemptId: string;
  email: string;
  phoneCode: string;
  maxAttempts?: number;
}): Promise<{ attempt: IdentityAuthAttempt; code: string }> {
  assertEnabled();
  const email = input.email.trim().toLowerCase();
  const maxAttempts = input.maxAttempts ?? DEFAULT_EMAIL_MAX_ATTEMPTS;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new IdentityAuthAttemptError('INVALID_INPUT');
  }
  const code = generateDistinctEmailCode(input.phoneCode);
  const recipientFingerprint = emailRecipientFingerprint(email);
  const challengeId = crypto.randomUUID();
  await persistExpiration(input.attemptId);
  const attempt = await (await getDb()).transaction(async (tx) => {
    const locked = await lockAttempt(tx, input.attemptId);
    if (locked.status !== 'PHONE_VERIFIED' || !requiresEmailFactor(locked.flow_type)) {
      throw new IdentityAuthAttemptError('INVALID_STATE');
    }
    const result = await tx.query<AttemptRow>(
      `UPDATE identity_auth_attempts
       SET status='EMAIL_CHALLENGE_ISSUED',email_challenge_id=$2,email_recipient_fingerprint=$3,
           email_code_hash=$4,email_attempts=0,email_max_attempts=$5,updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [input.attemptId, challengeId, recipientFingerprint,
        emailCodeHash(input.attemptId, recipientFingerprint, code), maxAttempts],
    );
    return mapAttempt(result.rows[0]);
  });
  return { attempt, code };
}

export async function attachIssuedEmailChallenge(input: {
  attemptId: string;
  email: string;
  code: string;
  challengeId: string;
  maxAttempts?: number;
}): Promise<IdentityAuthAttempt> {
  assertEnabled();
  const email = input.email.trim().toLowerCase();
  const maxAttempts = input.maxAttempts ?? DEFAULT_EMAIL_MAX_ATTEMPTS;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !EMAIL_CODE_PATTERN.test(input.code) ||
      !/^[0-9a-f-]{36}$/i.test(input.challengeId) || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new IdentityAuthAttemptError('INVALID_INPUT');
  }
  const recipientFingerprint = emailRecipientFingerprint(email);
  await persistExpiration(input.attemptId);
  return (await getDb()).transaction(async (tx) => {
    const locked = await lockAttempt(tx, input.attemptId);
    if (locked.status !== 'PHONE_VERIFIED' || !requiresEmailFactor(locked.flow_type)) {
      throw new IdentityAuthAttemptError('INVALID_STATE');
    }
    const result = await tx.query<AttemptRow>(
      `UPDATE identity_auth_attempts
       SET status='EMAIL_CHALLENGE_ISSUED',email_challenge_id=$2,email_recipient_fingerprint=$3,
           email_code_hash=$4,email_attempts=0,email_max_attempts=$5,
           expires_at=NOW()+INTERVAL '10 minutes',updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [input.attemptId, input.challengeId, recipientFingerprint,
        emailCodeHash(input.attemptId, recipientFingerprint, input.code), maxAttempts],
    );
    return mapAttempt(result.rows[0]);
  });
}

export async function verifyEmailChallenge(input: {
  attemptId: string;
  email: string;
  code: string;
}): Promise<IdentityAuthAttempt> {
  assertEnabled();
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_CODE_PATTERN.test(input.code) || !email) throw new IdentityAuthAttemptError('INVALID_CODE');
  await persistExpiration(input.attemptId);
  const result = await (await getDb()).transaction(async (tx): Promise<IdentityAuthAttempt | null> => {
    const attempt = await lockAttempt(tx, input.attemptId);
    if (attempt.status !== 'EMAIL_CHALLENGE_ISSUED' || !attempt.email_code_hash ||
        !attempt.email_recipient_fingerprint || attempt.email_attempts >= attempt.email_max_attempts) {
      throw new IdentityAuthAttemptError('INVALID_STATE');
    }
    const recipientFingerprint = emailRecipientFingerprint(email);
    const valid = safeEqual(attempt.email_recipient_fingerprint, recipientFingerprint) &&
      safeEqual(attempt.email_code_hash, emailCodeHash(attempt.id, recipientFingerprint, input.code));
    if (!valid) {
      const exhausted = attempt.email_attempts + 1 >= attempt.email_max_attempts;
      await tx.query(
        `UPDATE identity_auth_attempts
         SET email_attempts=email_attempts+1,status=CASE WHEN $2 THEN 'REVOKED' ELSE status END,
             revoked_at=CASE WHEN $2 THEN NOW() ELSE revoked_at END,updated_at=NOW()
         WHERE id=$1`,
        [attempt.id, exhausted],
      );
      return null;
    }
    const result = await tx.query<AttemptRow>(
      `UPDATE identity_auth_attempts
       SET status='EMAIL_VERIFIED',email_verified_at=NOW(),updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [attempt.id],
    );
    return mapAttempt(result.rows[0]);
  });
  if (!result) throw new IdentityAuthAttemptError('INVALID_CODE');
  return result;
}

export async function consumeAuthenticatedAttempt(attemptId: string): Promise<IdentityAuthAttempt> {
  assertEnabled();
  await persistExpiration(attemptId);
  const result = await (await getDb()).transaction(async (tx) => {
    const attempt = await lockAttempt(tx, attemptId);
    const expectedStatus: IdentityAuthAttemptStatus = requiresEmailFactor(attempt.flow_type) ? 'EMAIL_VERIFIED' : 'PHONE_VERIFIED';
    if (attempt.status !== expectedStatus || attempt.consumed_at) throw new IdentityAuthAttemptError('INVALID_STATE');
    if (attempt.target_user_id && attempt.auth_version_at_start !== null) {
      const user = await tx.query<{ auth_version: number }>('SELECT auth_version FROM users WHERE id=$1 FOR SHARE', [attempt.target_user_id]);
      if (!user.rows[0] || Number(user.rows[0].auth_version) !== Number(attempt.auth_version_at_start)) {
        await tx.query(
          `UPDATE identity_auth_attempts SET status='REVOKED',revoked_at=NOW(),updated_at=NOW()
           WHERE id=$1`,
          [attempt.id],
        );
        return null;
      }
    }
    const result = await tx.query<AttemptRow>(
      `UPDATE identity_auth_attempts
       SET status='AUTHENTICATED',consumed_at=NOW(),updated_at=NOW()
       WHERE id=$1 AND status=$2 AND consumed_at IS NULL RETURNING *`,
      [attempt.id, expectedStatus],
    );
    if (!result.rows[0]) throw new IdentityAuthAttemptError('INVALID_STATE');
    return mapAttempt(result.rows[0]);
  });
  if (!result) throw new IdentityAuthAttemptError('REVOKED');
  return result;
}

export async function revokeIdentityAuthAttempt(attemptId: string): Promise<IdentityAuthAttempt> {
  await persistExpiration(attemptId);
  return (await getDb()).transaction(async (tx) => {
    const attempt = await lockAttempt(tx, attemptId);
    if (attempt.status === 'AUTHENTICATED') throw new IdentityAuthAttemptError('INVALID_STATE');
    const result = await tx.query<AttemptRow>(
      `UPDATE identity_auth_attempts SET status='REVOKED',revoked_at=NOW(),updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [attempt.id],
    );
    return mapAttempt(result.rows[0]);
  });
}

export async function revokePendingIdentityAuthAttemptsForUser(targetUserId: string): Promise<number> {
  if (!targetUserId) throw new IdentityAuthAttemptError('INVALID_INPUT');
  const result = await (await getDb()).query(
    `UPDATE identity_auth_attempts
     SET status='REVOKED',revoked_at=NOW(),updated_at=NOW()
     WHERE target_user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL
       AND status NOT IN ('AUTHENTICATED','EXPIRED','REVOKED')
     RETURNING id`,
    [targetUserId],
  );
  return result.rows.length;
}
