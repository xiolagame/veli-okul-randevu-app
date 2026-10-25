import crypto from 'node:crypto';
import { hashSetupToken } from './activation-codes';
import { isPlatformAdmin } from './auth';
import { getDb, TransactionClient } from './database/postgres';
import { deliverPlatformPhoneBindingEmail } from './school-admin-email';
import { getTurkishPhoneLookupDigits, normalizeTurkishPhone } from '../src/utils/phone';
import {
  isWhatsAppPilotPhoneAllowed,
  sendWhatsAppAuthenticationCode,
  WhatsAppConfigurationError,
  WhatsAppDeliveryError,
} from './whatsapp-cloud';

const BINDING_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

type BindingRow = {
  id: string;
  user_id: string;
  candidate_phone: string;
  auth_version_at_start: number;
  email_recipient_fingerprint: string;
  email_code_hash: string;
  email_attempts: number;
  email_max_attempts: number;
  email_verified_at: string | null;
  whatsapp_code_hash: string | null;
  whatsapp_attempts: number;
  whatsapp_max_attempts: number;
  whatsapp_expires_at: string | null;
  status: 'EMAIL_CHALLENGE_ISSUED' | 'EMAIL_VERIFIED' | 'WHATSAPP_CHALLENGE_ISSUED' | 'COMPLETED' | 'REVOKED';
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
};

export class PlatformPhoneBindingError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function generateDistinctCode(excludedCode: string): string {
  let code = generateCode();
  while (code === excludedCode) code = generateCode();
  return code;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function codeHash(bindingId: string, factor: 'email' | 'whatsapp', code: string): string {
  return hashSetupToken(`platform-phone-binding:${bindingId}:${factor}:${code}`);
}

function emailFingerprint(email: string): string {
  return hashSetupToken(`platform-phone-binding-email:${email.trim().toLowerCase()}`);
}

async function withinRateLimit(scope: string, maximum: number, windowMinutes: number): Promise<boolean> {
  const scopeHash = hashSetupToken(`platform-phone-binding-rate:${scope}`);
  const result = await (await getDb()).query<{ attempts: number; blocked_until: string | null }>(
    `INSERT INTO auth_rate_limits(scope_hash,attempts,window_started_at,blocked_until) VALUES($1,1,NOW(),NULL)
     ON CONFLICT(scope_hash) DO UPDATE SET
       attempts=CASE WHEN auth_rate_limits.window_started_at < NOW() - make_interval(mins => $3) THEN 1 ELSE auth_rate_limits.attempts + 1 END,
       window_started_at=CASE WHEN auth_rate_limits.window_started_at < NOW() - make_interval(mins => $3) THEN NOW() ELSE auth_rate_limits.window_started_at END,
       blocked_until=CASE WHEN auth_rate_limits.window_started_at < NOW() - make_interval(mins => $3) THEN NULL
         WHEN auth_rate_limits.attempts + 1 >= $2 THEN NOW() + make_interval(mins => $3) ELSE auth_rate_limits.blocked_until END
     RETURNING attempts,blocked_until`,
    [scopeHash, maximum, windowMinutes],
  );
  const row = result.rows[0];
  return !!row && Number(row.attempts) < maximum && (!row.blocked_until || new Date(row.blocked_until).getTime() <= Date.now());
}

async function assertCandidateAvailable(tx: TransactionClient, candidatePhone: string, userId: string): Promise<void> {
  const digits = getTurkishPhoneLookupDigits(candidatePhone);
  if (!digits) throw new PlatformPhoneBindingError(400, 'Geçerli bir Türkiye GSM numarası girin.');
  const duplicate = await tx.query<{ id: string }>(
    `SELECT id FROM users
     WHERE id<>$1 AND regexp_replace(phone,'[^0-9]','','g') IN ($2,$3,$4)
     LIMIT 1`,
    [userId, ...digits],
  );
  if (duplicate.rows.length) throw new PlatformPhoneBindingError(409, 'Bu telefon başka bir kullanıcı hesabına bağlı.');
}

async function lockBinding(tx: TransactionClient, bindingId: string, userId: string): Promise<BindingRow> {
  const result = await tx.query<BindingRow>(
    `SELECT * FROM platform_phone_bindings WHERE id=$1 AND user_id=$2 FOR UPDATE`,
    [bindingId, userId],
  );
  const binding = result.rows[0];
  if (!binding || binding.consumed_at || binding.revoked_at || new Date(binding.expires_at).getTime() <= Date.now()) {
    throw new PlatformPhoneBindingError(401, 'Doğrulama işlemi geçersiz veya süresi dolmuş.');
  }
  return binding;
}

async function revokeBinding(bindingId: string): Promise<void> {
  await (await getDb()).query(
    `UPDATE platform_phone_bindings SET status='REVOKED',revoked_at=NOW(),updated_at=NOW()
     WHERE id=$1 AND consumed_at IS NULL AND revoked_at IS NULL`,
    [bindingId],
  );
}

export async function getPlatformPhoneBindingStatus(userId: string): Promise<{ phoneConfigured: boolean; emailConfigured: boolean }> {
  if (!isPlatformAdmin(userId)) throw new PlatformPhoneBindingError(403, 'Bu işlem için yetkiniz yok.');
  const result = await (await getDb()).query<{ phone: string; email: string | null; is_phone_verified: boolean }>(
    'SELECT phone,email,is_phone_verified FROM users WHERE id=$1',
    [userId],
  );
  const user = result.rows[0];
  if (!user) throw new PlatformPhoneBindingError(404, 'Platform hesabı bulunamadı.');
  return {
    phoneConfigured: !!normalizeTurkishPhone(user.phone) && user.is_phone_verified,
    emailConfigured: !!user.email?.trim(),
  };
}

export async function startPlatformPhoneBinding(input: {
  userId: string;
  phone: unknown;
  requesterKey: string;
}): Promise<{ bindingId: string; expiresInSeconds: number }> {
  if (!isPlatformAdmin(input.userId)) throw new PlatformPhoneBindingError(403, 'Bu işlem için yetkiniz yok.');
  const phone = normalizeTurkishPhone(input.phone);
  if (!phone) throw new PlatformPhoneBindingError(400, 'Geçerli bir Türkiye GSM numarası girin.');
  if (!isWhatsAppPilotPhoneAllowed(phone)) {
    throw new PlatformPhoneBindingError(403, 'Bu telefon güvenli pilot listesinde bulunmuyor.');
  }
  if (!await withinRateLimit(`${input.requesterKey}:start:${input.userId}`, 4, 30)) {
    throw new PlatformPhoneBindingError(429, 'Çok fazla telefon bağlama isteği gönderildi. Lütfen daha sonra tekrar deneyin.');
  }

  const bindingId = crypto.randomUUID();
  const emailCode = generateCode();
  const prepared = await (await getDb()).transaction(async (tx) => {
    const users = await tx.query<{ phone: string; email: string | null; auth_version: number; first_name: string; last_name: string; is_phone_verified: boolean }>(
      'SELECT phone,email,auth_version,first_name,last_name,is_phone_verified FROM users WHERE id=$1 FOR UPDATE',
      [input.userId],
    );
    const user = users.rows[0];
    if (!user || !isPlatformAdmin(input.userId) || !user.email?.trim()) {
      throw new PlatformPhoneBindingError(409, 'Platform hesabının kayıtlı e-posta doğrulaması hazır değil.');
    }
    if (normalizeTurkishPhone(user.phone) === phone && user.is_phone_verified) {
      throw new PlatformPhoneBindingError(409, 'Bu telefon zaten Platform hesabına bağlı.');
    }
    await assertCandidateAvailable(tx, phone, input.userId);
    await tx.query(
      `UPDATE platform_phone_bindings SET status='REVOKED',revoked_at=NOW(),updated_at=NOW()
       WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL`,
      [input.userId],
    );
    await tx.query(
      `INSERT INTO platform_phone_bindings(
         id,user_id,candidate_phone,auth_version_at_start,email_recipient_fingerprint,email_code_hash,
         email_attempts,email_max_attempts,whatsapp_attempts,whatsapp_max_attempts,status,expires_at
       ) VALUES($1,$2,$3,$4,$5,$6,0,$7,0,$7,'EMAIL_CHALLENGE_ISSUED',NOW()+make_interval(mins => $8))`,
      [bindingId, input.userId, phone, Number(user.auth_version), emailFingerprint(user.email),
        codeHash(bindingId, 'email', emailCode), MAX_ATTEMPTS, BINDING_TTL_MINUTES],
    );
    return {
      email: user.email.trim().toLowerCase(),
      fullName: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
    };
  });

  const sent = await deliverPlatformPhoneBindingEmail(prepared.email, prepared.fullName, emailCode);
  if (!sent) {
    await revokeBinding(bindingId);
    throw new PlatformPhoneBindingError(503, 'E-posta doğrulama kodu gönderilemedi. Lütfen daha sonra tekrar deneyin.');
  }
  return { bindingId, expiresInSeconds: BINDING_TTL_MINUTES * 60 };
}

export async function verifyPlatformPhoneBindingEmail(input: {
  userId: string;
  bindingId: unknown;
  code: unknown;
  requesterKey: string;
}): Promise<{ expiresInSeconds: number }> {
  if (!isPlatformAdmin(input.userId)) throw new PlatformPhoneBindingError(403, 'Bu işlem için yetkiniz yok.');
  const bindingId = typeof input.bindingId === 'string' ? input.bindingId.trim() : '';
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(bindingId) || !/^\d{6}$/.test(code)) {
    throw new PlatformPhoneBindingError(400, 'E-posta doğrulama kodunu kontrol edin.');
  }
  if (!await withinRateLimit(`${input.requesterKey}:email:${input.userId}`, 8, 15)) {
    throw new PlatformPhoneBindingError(429, 'Çok fazla doğrulama denemesi yapıldı. Lütfen daha sonra tekrar deneyin.');
  }

  const whatsappCode = generateDistinctCode(code);
  const verification = await (await getDb()).transaction(async (tx): Promise<{ valid: true; candidatePhone: string } | { valid: false }> => {
    const binding = await lockBinding(tx, bindingId, input.userId);
    if (binding.status !== 'EMAIL_CHALLENGE_ISSUED' || binding.email_attempts >= binding.email_max_attempts) {
      throw new PlatformPhoneBindingError(401, 'Doğrulama işlemi geçersiz veya süresi dolmuş.');
    }
    const current = await tx.query<{ email: string | null; auth_version: number }>(
      'SELECT email,auth_version FROM users WHERE id=$1 FOR UPDATE',
      [input.userId],
    );
    const user = current.rows[0];
    const valid = !!user?.email && Number(user.auth_version) === Number(binding.auth_version_at_start) &&
      safeEqual(binding.email_recipient_fingerprint, emailFingerprint(user.email)) &&
      safeEqual(binding.email_code_hash, codeHash(binding.id, 'email', code));
    if (!valid) {
      const attempts = Number(binding.email_attempts) + 1;
      await tx.query(
        `UPDATE platform_phone_bindings SET email_attempts=$2,
           status=CASE WHEN $2>=email_max_attempts THEN 'REVOKED' ELSE status END,
           revoked_at=CASE WHEN $2>=email_max_attempts THEN NOW() ELSE revoked_at END,updated_at=NOW()
         WHERE id=$1`,
        [binding.id, attempts],
      );
      return { valid: false };
    }
    await tx.query(
      `UPDATE platform_phone_bindings SET status='WHATSAPP_CHALLENGE_ISSUED',email_verified_at=NOW(),
         whatsapp_code_hash=$2,whatsapp_expires_at=NOW()+make_interval(mins => $3),updated_at=NOW()
       WHERE id=$1`,
      [binding.id, codeHash(binding.id, 'whatsapp', whatsappCode), BINDING_TTL_MINUTES],
    );
    return { valid: true, candidatePhone: binding.candidate_phone };
  });

  if (!verification.valid) throw new PlatformPhoneBindingError(401, 'E-posta doğrulama kodu geçersiz veya süresi dolmuş.');

  try {
    await sendWhatsAppAuthenticationCode(verification.candidatePhone, whatsappCode);
  } catch (error) {
    await revokeBinding(bindingId);
    if (error instanceof WhatsAppConfigurationError || error instanceof WhatsAppDeliveryError) {
      throw new PlatformPhoneBindingError(503, 'WhatsApp doğrulama kodu gönderilemedi. Lütfen daha sonra tekrar deneyin.');
    }
    throw error;
  }
  return { expiresInSeconds: BINDING_TTL_MINUTES * 60 };
}

export async function completePlatformPhoneBinding(input: {
  userId: string;
  bindingId: unknown;
  code: unknown;
  requesterKey: string;
}): Promise<void> {
  if (!isPlatformAdmin(input.userId)) throw new PlatformPhoneBindingError(403, 'Bu işlem için yetkiniz yok.');
  const bindingId = typeof input.bindingId === 'string' ? input.bindingId.trim() : '';
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(bindingId) || !/^\d{6}$/.test(code)) {
    throw new PlatformPhoneBindingError(400, 'WhatsApp doğrulama kodunu kontrol edin.');
  }
  if (!await withinRateLimit(`${input.requesterKey}:whatsapp:${input.userId}`, 8, 15)) {
    throw new PlatformPhoneBindingError(429, 'Çok fazla doğrulama denemesi yapıldı. Lütfen daha sonra tekrar deneyin.');
  }

  const completed = await (await getDb()).transaction(async (tx): Promise<boolean> => {
    await tx.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const binding = await lockBinding(tx, bindingId, input.userId);
    if (binding.status !== 'WHATSAPP_CHALLENGE_ISSUED' || !binding.email_verified_at ||
        !binding.whatsapp_code_hash || !binding.whatsapp_expires_at ||
        new Date(binding.whatsapp_expires_at).getTime() <= Date.now() ||
        binding.whatsapp_attempts >= binding.whatsapp_max_attempts) {
      throw new PlatformPhoneBindingError(401, 'Doğrulama işlemi geçersiz veya süresi dolmuş.');
    }
    const current = await tx.query<{ auth_version: number; first_name: string; last_name: string }>(
      'SELECT auth_version,first_name,last_name FROM users WHERE id=$1 FOR UPDATE',
      [input.userId],
    );
    const user = current.rows[0];
    if (!user || Number(user.auth_version) !== Number(binding.auth_version_at_start) || !isPlatformAdmin(input.userId)) {
      throw new PlatformPhoneBindingError(401, 'Platform oturumu artık geçerli değil.');
    }
    const valid = safeEqual(binding.whatsapp_code_hash, codeHash(binding.id, 'whatsapp', code));
    if (!valid) {
      const attempts = Number(binding.whatsapp_attempts) + 1;
      await tx.query(
        `UPDATE platform_phone_bindings SET whatsapp_attempts=$2,
           status=CASE WHEN $2>=whatsapp_max_attempts THEN 'REVOKED' ELSE status END,
           revoked_at=CASE WHEN $2>=whatsapp_max_attempts THEN NOW() ELSE revoked_at END,updated_at=NOW()
         WHERE id=$1`,
        [binding.id, attempts],
      );
      return false;
    }
    await assertCandidateAvailable(tx, binding.candidate_phone, input.userId);
    await tx.query(
      `UPDATE users SET phone=$2,is_phone_verified=TRUE,auth_version=auth_version+1,updated_at=NOW()
       WHERE id=$1`,
      [input.userId, binding.candidate_phone],
    );
    await tx.query(
      `UPDATE identity_auth_attempts SET status='REVOKED',revoked_at=NOW(),updated_at=NOW()
       WHERE target_user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL
         AND status NOT IN ('AUTHENTICATED','EXPIRED','REVOKED')`,
      [input.userId],
    );
    await tx.query(
      `UPDATE whatsapp_auth_challenges SET revoked_at=NOW()
       WHERE target_user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL`,
      [input.userId],
    );
    await tx.query(
      `UPDATE platform_phone_bindings SET status='COMPLETED',consumed_at=NOW(),updated_at=NOW()
       WHERE id=$1`,
      [binding.id],
    );
    await tx.query(
      `INSERT INTO audit_logs(id,school_id,timestamp,action,actor_name,actor_user_id,details,audit_scope)
       VALUES($1,NULL,$2,'platform.phone_bound',$3,$4,$5,'PLATFORM')`,
      [`log-${crypto.randomUUID()}`, new Date().toISOString(),
        `${user.first_name || ''} ${user.last_name || ''} (Platform Yönetimi)`.trim(), input.userId,
        JSON.stringify({ authVersionInvalidated: true, verification: ['email_otp', 'whatsapp_otp'] })],
    );
    return true;
  });
  if (!completed) throw new PlatformPhoneBindingError(401, 'WhatsApp doğrulama kodu geçersiz veya süresi dolmuş.');
}
