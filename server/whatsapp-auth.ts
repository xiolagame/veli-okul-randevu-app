import crypto from 'node:crypto';
import { TransactionClient, getDb } from './database/postgres';
import { hashSetupToken, generateStaffCode } from './activation-codes';
import {
  auditLogRepository,
  membershipRepository,
  relationRepository,
  schoolLicenseRepository,
  schoolRepository,
  studentRepository,
  userRepository,
  invitationRepository,
} from './repositories';
import {
  assertWhatsAppDeliveryConfigured,
  isUnifiedWhatsAppLoginEnabled,
  isWhatsAppPilotPhoneAllowed,
  sendWhatsAppAuthenticationCode,
} from './whatsapp-cloud';
import { isPlatformAdmin } from './auth';
import { getTurkishPhoneLookupDigits, normalizeTurkishPhone } from '../src/utils/phone';
import { normalizePersonName } from '../src/utils/person-name';
import { SchoolMembership, User, UserRole } from '../src/types';

export type WhatsAppAuthPurpose = 'login' | 'parent_registration' | 'staff_activation' | 'account_deletion' | 'school_admin_login' | 'school_admin_activation';

type ChallengeTarget = {
  schoolId: string | null;
  userId: string | null;
  role: Extract<UserRole, 'parent' | 'teacher' | 'security' | 'admin'> | null;
  profileId: string | null;
};

type ChallengeRow = {
  id: string;
  school_id: string | null;
  target_phone: string;
  target_user_id: string | null;
  target_role: ChallengeTarget['role'];
  target_profile_id: string | null;
  purpose: WhatsAppAuthPurpose;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  resend_available_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
};

export type WhatsAppAuthResult = {
  user: User & { authVersion: number };
  memberships: SchoolMembership[];
  purpose: Exclude<WhatsAppAuthPurpose, 'account_deletion'>;
};

export type PendingAdminEmail = {
  pendingEmail: true;
  handle: string;
  schoolId: string;
  email: string;
  schoolName: string;
  schoolCode: string;
  licenseCode?: string;
  fullName: string;
  code: string;
};

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RESEND_WAIT_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const ELIGIBLE_LOGIN_ROLES: UserRole[] = ['parent', 'teacher', 'security'];

function codeHash(challengeId: string, phone: string, purpose: WhatsAppAuthPurpose, code: string): string {
  return hashSetupToken(`whatsapp:${challengeId}:${phone}:${purpose}:${code}`);
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function withinRateLimit(scope: string, maximum: number, windowMinutes: number): Promise<boolean> {
  const scopeHash = hashSetupToken(`whatsapp-rate:${scope}`);
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

async function eligibleMemberships(userId: string, client?: TransactionClient): Promise<SchoolMembership[]> {
  const memberships = await membershipRepository.getMembershipsByUserId(userId, client);
  const eligible: SchoolMembership[] = [];
  for (const membership of memberships) {
    if (!ELIGIBLE_LOGIN_ROLES.includes(membership.role)) continue;
    if (await schoolLicenseRepository.isAccessAllowed(membership.schoolId, client)) eligible.push(membership);
  }
  return eligible;
}

async function resolveTarget(input: {
  purpose: WhatsAppAuthPurpose;
  phone: string;
  schoolCode?: string;
  authenticatedUserId?: string;
}): Promise<ChallengeTarget | null> {
  const db = await getDb();
  const user = await userRepository.getByPhone(input.phone);
  if (input.purpose === 'account_deletion') {
    return user && input.authenticatedUserId === user.id
      ? { schoolId: null, userId: user.id, role: null, profileId: null }
      : null;
  }
  if (input.purpose === 'login') {
    if (!user || !(await eligibleMemberships(user.id)).length) return null;
    return { schoolId: null, userId: user.id, role: null, profileId: null };
  }
  const school = input.schoolCode ? await schoolRepository.getByCode(input.schoolCode) : null;
  if (!school) return null;
  const digits = getTurkishPhoneLookupDigits(input.phone);
  if (!digits) return null;

  if (input.purpose === 'parent_registration') {
    if (user && (await membershipRepository.getMembershipsByUserId(user.id)).some((entry) => entry.schoolId === school.id && entry.role === 'parent')) return null;
    const roster = await db.query<{ parent_name: string }>(
      `SELECT parent_name FROM school_roster
       WHERE school_id=$1 AND is_claimed=FALSE AND parent_account_deleted_at IS NULL
         AND regexp_replace(parent_phone,'[^0-9]','','g') IN ($2,$3,$4)`,
      [school.id, ...digits],
    );
    const names = new Set(roster.rows.map((row) => normalizePersonName(row.parent_name)));
    if (!roster.rows.length || names.size !== 1) return null;
    return { schoolId: school.id, userId: user?.id || null, role: 'parent', profileId: null };
  }

  const teacher = await db.query<{ id: string; user_id: string | null }>(
    `SELECT id,user_id FROM teacher_profiles
     WHERE school_id=$1 AND account_deleted_at IS NULL
       AND regexp_replace(phone,'[^0-9]','','g') IN ($2,$3,$4)`,
    [school.id, ...digits],
  );
  const security = await db.query<{ id: string }>(
    `SELECT id FROM pending_staff
     WHERE school_id=$1 AND role='security'
       AND regexp_replace(phone,'[^0-9]','','g') IN ($2,$3,$4)`,
    [school.id, ...digits],
  );
  if (teacher.rows.length === 1 && !teacher.rows[0].user_id && security.rows.length === 0) {
    return { schoolId: school.id, userId: user?.id || null, role: 'teacher', profileId: teacher.rows[0].id };
  }
  if (security.rows.length === 1 && teacher.rows.length === 0) {
    return { schoolId: school.id, userId: user?.id || null, role: 'security', profileId: security.rows[0].id };
  }
  return null;
}

async function resolveUnifiedTarget(phone: string): Promise<{ purpose: WhatsAppAuthPurpose; target: ChallengeTarget } | null> {
  const db = await getDb();
  const user = await userRepository.getByPhone(phone);
  if (user && isPlatformAdmin(user.id)) return null;

  if (user) {
    const memberships = (await membershipRepository.getMembershipsByUserId(user.id))
      .filter((item) => item.status === 'active');
    const valid: SchoolMembership[] = [];
    for (const item of memberships) {
      if (await schoolRepository.getById(item.schoolId) && await schoolLicenseRepository.isAccessAllowed(item.schoolId)) {
        valid.push(item);
      }
    }
    const roles = new Set(valid.map((item) => item.role));
    if (roles.has('admin') && roles.size > 1) return null;
    if (roles.has('admin')) {
      const adminMemberships = valid.filter((item) => item.role === 'admin');
      if (adminMemberships.length !== 1) return null;
      return {
        purpose: 'school_admin_login',
        target: { schoolId: adminMemberships[0].schoolId, userId: user.id, role: 'admin', profileId: null },
      };
    }
    if (valid.some((item) => ELIGIBLE_LOGIN_ROLES.includes(item.role))) {
      return { purpose: 'login', target: { schoolId: null, userId: user.id, role: null, profileId: null } };
    }
    if (memberships.length) return null;
  }

  const digits = getTurkishPhoneLookupDigits(phone);
  if (!digits) return null;
  const candidates: { purpose: WhatsAppAuthPurpose; target: ChallengeTarget }[] = [];
  const adminInvites = await db.query<{ school_id: string; target_user_id: string }>(
    `SELECT DISTINCT i.school_id,i.target_user_id FROM invitations i
     JOIN schools s ON s.id=i.school_id AND s.disabled_at IS NULL
     JOIN users u ON u.id=i.target_user_id
     WHERE i.purpose='school_admin_activation' AND i.target_role='admin'
       AND i.target_user_id IS NOT NULL AND u.email IS NOT NULL AND u.email<>''
       AND i.is_active=TRUE AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>NOW()
       AND regexp_replace(i.target_phone,'[^0-9]','','g') IN ($1,$2,$3)`,
    digits,
  );
  for (const entry of adminInvites.rows) {
    if (user && user.id !== entry.target_user_id) continue;
    if (!await schoolLicenseRepository.isAccessAllowed(entry.school_id)) continue;
    candidates.push({
      purpose: 'school_admin_activation',
      target: { schoolId: entry.school_id, userId: entry.target_user_id, role: 'admin', profileId: null },
    });
  }

  const parentRows = await db.query<{ school_id: string; parent_name: string }>(
    `SELECT sr.school_id,sr.parent_name FROM school_roster sr
     JOIN schools s ON s.id=sr.school_id AND s.disabled_at IS NULL
     WHERE sr.is_claimed=FALSE AND sr.parent_account_deleted_at IS NULL
       AND regexp_replace(sr.parent_phone,'[^0-9]','','g') IN ($1,$2,$3)`,
    digits,
  );
  const parentNames = new Map<string, Set<string>>();
  for (const entry of parentRows.rows) {
    if (!parentNames.has(entry.school_id)) parentNames.set(entry.school_id, new Set());
    parentNames.get(entry.school_id)!.add(normalizePersonName(entry.parent_name));
  }
  for (const [schoolId, names] of parentNames) {
    if (names.size !== 1 || !await schoolLicenseRepository.isAccessAllowed(schoolId)) continue;
    candidates.push({ purpose: 'parent_registration', target: { schoolId, userId: user?.id || null, role: 'parent', profileId: null } });
  }

  const teachers = await db.query<{ id: string; school_id: string }>(
    `SELECT tp.id,tp.school_id FROM teacher_profiles tp JOIN schools s ON s.id=tp.school_id AND s.disabled_at IS NULL
     WHERE tp.user_id IS NULL AND tp.account_deleted_at IS NULL
       AND regexp_replace(tp.phone,'[^0-9]','','g') IN ($1,$2,$3)`,
    digits,
  );
  for (const item of teachers.rows) {
    if (await schoolLicenseRepository.isAccessAllowed(item.school_id)) {
      candidates.push({ purpose: 'staff_activation', target: { schoolId: item.school_id, userId: user?.id || null, role: 'teacher', profileId: item.id } });
    }
  }

  const security = await db.query<{ id: string; school_id: string }>(
    `SELECT ps.id,ps.school_id FROM pending_staff ps JOIN schools s ON s.id=ps.school_id AND s.disabled_at IS NULL
     WHERE ps.role='security' AND regexp_replace(ps.phone,'[^0-9]','','g') IN ($1,$2,$3)`,
    digits,
  );
  for (const item of security.rows) {
    if (await schoolLicenseRepository.isAccessAllowed(item.school_id)) {
      candidates.push({ purpose: 'staff_activation', target: { schoolId: item.school_id, userId: user?.id || null, role: 'security', profileId: item.id } });
    }
  }

  return candidates.length === 1 ? candidates[0] : null;
}

export async function requestWhatsAppAuthChallenge(input: {
  purpose: WhatsAppAuthPurpose | 'auto';
  phone: unknown;
  schoolCode?: unknown;
  authenticatedUserId?: string;
  requesterKey: string;
}): Promise<{ challengeId: string; expiresInSeconds: number; resendAfterSeconds: number }> {
  if (input.purpose === 'auto' && !isUnifiedWhatsAppLoginEnabled()) {
    throw new WhatsAppAuthError(404, 'Bu giriş yöntemi kullanılamıyor.');
  }
  assertWhatsAppDeliveryConfigured();
  const phone = normalizeTurkishPhone(input.phone);
  const schoolCode = typeof input.schoolCode === 'string' ? input.schoolCode.trim() : undefined;
  const requesterAllowed = phone && await withinRateLimit(`${input.requesterKey}:${input.purpose}:requester`, 30, 15);
  const targetAllowed = phone && await withinRateLimit(`${input.requesterKey}:${input.purpose}:${phone}`, 6, 15);
  if (!phone || !requesterAllowed || !targetAllowed) {
    throw new WhatsAppAuthError(429, 'Doğrulama isteği şu anda tamamlanamadı. Lütfen daha sonra tekrar deneyin.');
  }
  const dummyId = crypto.randomUUID();
  if (!isWhatsAppPilotPhoneAllowed(phone)) {
    return { challengeId: dummyId, expiresInSeconds: 300, resendAfterSeconds: 60 };
  }
  const resolved = input.purpose === 'auto' ? await resolveUnifiedTarget(phone) : null;
  const purpose: WhatsAppAuthPurpose = input.purpose === 'auto' ? (resolved?.purpose || 'login') : input.purpose;
  const target = input.purpose === 'auto' ? (resolved?.target || null) : await resolveTarget({
    purpose,
    phone,
    schoolCode,
    authenticatedUserId: input.authenticatedUserId,
  });
  if (!target) return { challengeId: dummyId, expiresInSeconds: 300, resendAfterSeconds: 60 };

  const challengeId = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const db = await getDb();
  let cooldownMasked = false;
  await db.transaction(async (tx) => {
    await tx.query('LOCK TABLE whatsapp_auth_challenges IN SHARE ROW EXCLUSIVE MODE');
    const recent = await tx.query<{ resend_available_at: string }>(
      `SELECT resend_available_at FROM whatsapp_auth_challenges
       WHERE target_phone=$1 AND purpose=$2 AND school_id IS NOT DISTINCT FROM $3
         AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [phone, purpose, target.schoolId],
    );
    if (recent.rows[0] && new Date(recent.rows[0].resend_available_at).getTime() > Date.now()) {
      if (input.purpose === 'auto') {
        cooldownMasked = true;
        return;
      }
      throw new WhatsAppAuthError(429, 'Yeni kod istemeden önce kısa süre bekleyin.');
    }
    await tx.query(
      `UPDATE whatsapp_auth_challenges SET revoked_at=NOW()
       WHERE target_phone=$1 AND purpose=$2 AND school_id IS NOT DISTINCT FROM $3
         AND consumed_at IS NULL AND revoked_at IS NULL`,
      [phone, purpose, target.schoolId],
    );
    await tx.query(
      `INSERT INTO whatsapp_auth_challenges
       (id,school_id,target_phone,target_user_id,target_role,target_profile_id,purpose,code_hash,max_attempts,expires_at,resend_available_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [challengeId, target.schoolId, phone, target.userId, target.role, target.profileId, purpose,
        codeHash(challengeId, phone, purpose, code), MAX_ATTEMPTS,
        new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(), new Date(Date.now() + RESEND_WAIT_MS).toISOString()],
    );
  });
  if (cooldownMasked) return { challengeId: dummyId, expiresInSeconds: 300, resendAfterSeconds: 60 };
  try {
    await sendWhatsAppAuthenticationCode(phone, code);
  } catch (error) {
    await db.query('UPDATE whatsapp_auth_challenges SET revoked_at=NOW() WHERE id=$1 AND consumed_at IS NULL', [challengeId]);
    if (input.purpose === 'auto') return { challengeId: dummyId, expiresInSeconds: 300, resendAfterSeconds: 60 };
    throw error;
  }
  return { challengeId, expiresInSeconds: 300, resendAfterSeconds: 60 };
}

async function readAndValidateChallenge(
  tx: TransactionClient,
  input: { challengeId: string; phone: string; code: string; expectedPurpose?: WhatsAppAuthPurpose },
): Promise<ChallengeRow | null> {
  const result = await tx.query<ChallengeRow>(
    `SELECT id,school_id,target_phone,target_user_id,target_role,target_profile_id,purpose,code_hash,
            attempts,max_attempts,expires_at,resend_available_at,consumed_at,revoked_at
     FROM whatsapp_auth_challenges WHERE id=$1 FOR UPDATE`,
    [input.challengeId],
  );
  const row = result.rows[0];
  const validContext = !!row && row.target_phone === input.phone && (!input.expectedPurpose || row.purpose === input.expectedPurpose)
    && !row.consumed_at && !row.revoked_at && new Date(row.expires_at).getTime() > Date.now() && row.attempts < row.max_attempts;
  if (!validContext || !row || !safeHashEqual(row.code_hash, codeHash(row.id, input.phone, row.purpose, input.code))) {
    if (row && !row.consumed_at && !row.revoked_at && new Date(row.expires_at).getTime() > Date.now()) {
      await tx.query(
        `UPDATE whatsapp_auth_challenges SET attempts=attempts+1,
           revoked_at=CASE WHEN attempts+1>=max_attempts THEN NOW() ELSE revoked_at END
         WHERE id=$1`,
        [row.id],
      );
    }
    return null;
  }
  return row;
}

async function activateParent(tx: TransactionClient, challenge: ChallengeRow): Promise<User & { authVersion: number }> {
  if (!challenge.school_id || challenge.target_role !== 'parent') throw new Error('INVALID_WHATSAPP_CHALLENGE');
  const digits = getTurkishPhoneLookupDigits(challenge.target_phone);
  if (!digits) throw new Error('INVALID_WHATSAPP_CHALLENGE');
  const school = await tx.query('SELECT id FROM schools WHERE id=$1 AND disabled_at IS NULL FOR SHARE', [challenge.school_id]);
  if (!school.rows.length || !await schoolLicenseRepository.isAccessAllowed(challenge.school_id, tx)) throw new Error('INVALID_WHATSAPP_CHALLENGE');
  const roster = await tx.query<{
    id: string; parent_name: string; student_name: string; class_name: string; student_number: string | null; birth_date: string | null;
  }>(
    `SELECT id,parent_name,student_name,class_name,student_number,birth_date::text AS birth_date
     FROM school_roster WHERE school_id=$1 AND is_claimed=FALSE AND parent_account_deleted_at IS NULL
       AND regexp_replace(parent_phone,'[^0-9]','','g') IN ($2,$3,$4) FOR UPDATE`,
    [challenge.school_id, ...digits],
  );
  const names = new Set(roster.rows.map((row) => normalizePersonName(row.parent_name)));
  if (!roster.rows.length || names.size !== 1) throw new Error('INVALID_WHATSAPP_CHALLENGE');
  const nameParts = roster.rows[0].parent_name.trim().split(/\s+/);
  const existing = await userRepository.getByPhone(challenge.target_phone, tx);
  const created = existing || await userRepository.create({
    phone: challenge.target_phone,
    firstName: nameParts[0] || 'Veli',
    lastName: nameParts.slice(1).join(' '),
    isPhoneVerified: true,
  }, tx);
  await userRepository.verifyPhone(created.id, tx);
  await membershipRepository.createOrActivate({ schoolId: challenge.school_id, userId: created.id, role: 'parent' }, tx);
  for (const entry of roster.rows) {
    const student = await studentRepository.findOrCreateStudent(challenge.school_id, {
      name: entry.student_name,
      className: entry.class_name,
      studentNumber: entry.student_number || undefined,
      birthDate: entry.birth_date ? String(entry.birth_date).slice(0, 10) : undefined,
    }, tx);
    await relationRepository.createRelation({ schoolId: challenge.school_id, studentId: student.id, parentUserId: created.id }, tx);
    await tx.query(
      `UPDATE school_roster SET is_claimed=TRUE,claimed_at=NOW(),updated_at=NOW()
       WHERE school_id=$1 AND id=$2 AND is_claimed=FALSE`,
      [challenge.school_id, entry.id],
    );
  }
  await auditLogRepository.createAuditLog({
    schoolId: challenge.school_id,
    action: 'parent_whatsapp_activation_completed',
    actorName: 'Sistem',
    details: `Veli hesabı ${created.id} WhatsApp doğrulamasıyla etkinleştirildi.`,
  }, tx);
  const user = await userRepository.getById(created.id, tx);
  if (!user) throw new Error('INVALID_WHATSAPP_CHALLENGE');
  return user;
}

async function activateStaff(tx: TransactionClient, challenge: ChallengeRow): Promise<User & { authVersion: number }> {
  if (!challenge.school_id || !challenge.target_profile_id || !challenge.target_role || challenge.target_role === 'parent') {
    throw new Error('INVALID_WHATSAPP_CHALLENGE');
  }
  const digits = getTurkishPhoneLookupDigits(challenge.target_phone);
  if (!digits) throw new Error('INVALID_WHATSAPP_CHALLENGE');
  const activeSchool = await tx.query('SELECT id FROM schools WHERE id=$1 AND disabled_at IS NULL FOR SHARE', [challenge.school_id]);
  if (!activeSchool.rows.length || !await schoolLicenseRepository.isAccessAllowed(challenge.school_id, tx)) throw new Error('INVALID_WHATSAPP_CHALLENGE');
  await tx.query('LOCK TABLE teacher_profiles IN SHARE ROW EXCLUSIVE MODE');
  const existing = await userRepository.getByPhone(challenge.target_phone, tx);
  let userId: string;
  if (challenge.target_role === 'teacher') {
    const conflictingPhone = await tx.query(
      `SELECT id FROM teacher_profiles WHERE school_id<>$1 AND account_deleted_at IS NULL
       AND regexp_replace(phone,'[^0-9]','','g') IN ($2,$3,$4) LIMIT 1`,
      [challenge.school_id, ...digits],
    );
    if (conflictingPhone.rows.length) throw new WhatsAppAuthError(409, 'Bu öğretmen başka bir okulda kayıtlı.');
    const profile = await tx.query<{ id: string; first_name: string; last_name: string; branch: string; email: string | null; user_id: string | null }>(
      `SELECT id,first_name,last_name,branch,email,user_id FROM teacher_profiles
       WHERE school_id=$1 AND id=$2 AND account_deleted_at IS NULL
         AND regexp_replace(phone,'[^0-9]','','g') IN ($3,$4,$5) FOR UPDATE`,
      [challenge.school_id, challenge.target_profile_id, ...digits],
    );
    if (!profile.rows[0] || profile.rows[0].user_id) throw new Error('INVALID_WHATSAPP_CHALLENGE');
    if (existing) {
      const occupied = await tx.query(
        `SELECT 1 FROM teacher_profiles WHERE user_id=$1 AND school_id<>$2
         UNION ALL SELECT 1 FROM school_memberships WHERE user_id=$1 AND school_id<>$2 AND role='teacher' AND status='active' LIMIT 1`,
        [existing.id, challenge.school_id],
      );
      if (occupied.rows.length) throw new WhatsAppAuthError(409, 'Bu öğretmen başka bir okulda kayıtlı.');
    }
    const created = existing || await userRepository.create({
      phone: challenge.target_phone,
      firstName: profile.rows[0].first_name,
      lastName: profile.rows[0].last_name,
      email: profile.rows[0].email || undefined,
      isPhoneVerified: true,
    }, tx);
    const linked = await tx.query(
      `UPDATE teacher_profiles SET user_id=$3,updated_at=NOW()
       WHERE school_id=$1 AND id=$2 AND user_id IS NULL RETURNING id`,
      [challenge.school_id, challenge.target_profile_id, created.id],
    );
    if (!linked.rows.length) throw new Error('INVALID_WHATSAPP_CHALLENGE');
    await membershipRepository.createOrActivate({
      schoolId: challenge.school_id,
      userId: created.id,
      role: 'teacher',
      branch: profile.rows[0].branch,
    }, tx);
    userId = created.id;
  } else {
    const pending = await tx.query<{ id: string; first_name: string; last_name: string; email: string }>(
      `SELECT id,first_name,last_name,email FROM pending_staff
       WHERE school_id=$1 AND id=$2 AND role='security'
         AND regexp_replace(phone,'[^0-9]','','g') IN ($3,$4,$5) FOR UPDATE`,
      [challenge.school_id, challenge.target_profile_id, ...digits],
    );
    if (!pending.rows[0]) throw new Error('INVALID_WHATSAPP_CHALLENGE');
    const created = existing || await userRepository.create({
      phone: challenge.target_phone,
      firstName: pending.rows[0].first_name,
      lastName: pending.rows[0].last_name,
      email: pending.rows[0].email,
      isPhoneVerified: true,
    }, tx);
    await membershipRepository.createOrActivate({ schoolId: challenge.school_id, userId: created.id, role: 'security' }, tx);
    await tx.query('DELETE FROM pending_staff WHERE school_id=$1 AND id=$2', [challenge.school_id, challenge.target_profile_id]);
    userId = created.id;
  }
  await userRepository.verifyPhone(userId, tx);
  await auditLogRepository.createAuditLog({
    schoolId: challenge.school_id,
    action: 'staff_whatsapp_activation_completed',
    actorName: 'Sistem',
    details: `${challenge.target_role} hesabı ${userId} WhatsApp doğrulamasıyla etkinleştirildi.`,
  }, tx);
  const user = await userRepository.getById(userId, tx);
  if (!user) throw new Error('INVALID_WHATSAPP_CHALLENGE');
  return user;
}

async function queueAdminEmailAfterPhoneVerification(tx: TransactionClient, challenge: ChallengeRow): Promise<PendingAdminEmail> {
  if (!challenge.school_id || !challenge.target_user_id || challenge.target_role !== 'admin') throw new Error('INVALID_ADMIN_ACTIVATION');
  if (isPlatformAdmin(challenge.target_user_id)) throw new Error('INVALID_ADMIN_ACTIVATION');
  const school = await tx.query<{ name: string; code: string; license_code: string | null }>(
    `SELECT s.name,s.code,sl.license_code FROM schools s LEFT JOIN school_licenses sl ON sl.school_id=s.id
     WHERE s.id=$1 AND s.disabled_at IS NULL FOR SHARE OF s`,
    [challenge.school_id],
  );
  if (!school.rows[0] || !await schoolLicenseRepository.isAccessAllowed(challenge.school_id, tx)) {
    throw new Error('INVALID_ADMIN_ACTIVATION');
  }
  const user = await tx.query<{ first_name: string; last_name: string; email: string | null }>(
    'SELECT first_name,last_name,email FROM users WHERE id=$1 AND phone=$2 FOR UPDATE',
    [challenge.target_user_id, challenge.target_phone],
  );
  if (!user.rows[0]?.email) throw new Error('INVALID_ADMIN_ACTIVATION');
  const memberships = await membershipRepository.getMembershipsByUserId(challenge.target_user_id, tx);
  if (memberships.length) throw new Error('INVALID_ADMIN_ACTIVATION');
  const invitation = await tx.query<{ id: string }>(
    `SELECT id FROM invitations WHERE school_id=$1 AND target_user_id=$2 AND target_role='admin'
     AND purpose='school_admin_activation' AND is_active=TRUE AND consumed_at IS NULL AND revoked_at IS NULL
     AND expires_at>NOW() FOR UPDATE`,
    [challenge.school_id, challenge.target_user_id],
  );
  if (invitation.rows.length !== 1) throw new Error('INVALID_ADMIN_ACTIVATION');
  const code = generateStaffCode();
  const handle = crypto.randomUUID();
  await invitationRepository.createAuthCode({
    schoolId: challenge.school_id,
    targetPhone: challenge.target_phone,
    targetUserId: challenge.target_user_id,
    targetRole: 'admin',
    purpose: 'school_admin_activation_setup',
    codeHash: hashSetupToken(`unified-admin-email:${user.rows[0].email.trim().toLowerCase()}:${code}`),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    token: handle,
  }, tx);
  await tx.query('UPDATE whatsapp_auth_challenges SET consumed_at=NOW() WHERE id=$1 AND consumed_at IS NULL', [challenge.id]);
  return {
    pendingEmail: true,
    handle,
    schoolId: challenge.school_id,
    email: user.rows[0].email,
    schoolName: school.rows[0].name,
    schoolCode: school.rows[0].code,
    licenseCode: school.rows[0].license_code || undefined,
    fullName: `${user.rows[0].first_name} ${user.rows[0].last_name}`.trim(),
    code,
  };
}

export async function completeUnifiedAdminEmailActivation(input: {
  handle: unknown;
  phone: unknown;
  emailCode: unknown;
  requesterKey: string;
}): Promise<WhatsAppAuthResult | null> {
  if (!isUnifiedWhatsAppLoginEnabled()) return null;
  const handle = typeof input.handle === 'string' ? input.handle.trim() : '';
  const phone = normalizeTurkishPhone(input.phone);
  const emailCode = typeof input.emailCode === 'string' ? input.emailCode.trim() : '';
  if (!phone || !/^[0-9a-f-]{36}$/i.test(handle) || !/^\d{6}$/.test(emailCode)) return null;
  if (!await withinRateLimit(`${input.requesterKey}:admin-email:${phone}`, 6, 15)) {
    throw new WhatsAppAuthError(429, 'Çok fazla deneme yapıldı.');
  }
  if (!isWhatsAppPilotPhoneAllowed(phone)) return null;

  return (await getDb()).transaction(async (tx) => {
    const row = await tx.query<{ school_id: string; target_user_id: string; target_phone: string }>(
      `SELECT school_id,target_user_id,target_phone FROM invitations WHERE token=$1
       AND purpose='school_admin_activation_setup' AND target_role='admin' AND is_active=TRUE
       AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE`,
      [handle],
    );
    const record = row.rows[0];
    if (!record || record.target_phone !== phone || isPlatformAdmin(record.target_user_id)) return null;

    const recipient = await tx.query<{ email: string | null }>(
      'SELECT email FROM users WHERE id=$1 AND phone=$2 FOR UPDATE',
      [record.target_user_id, phone],
    );
    const candidateEmail = recipient.rows[0]?.email?.trim().toLowerCase();
    if (!candidateEmail) return null;

    const match = await invitationRepository.consumeAuthCode({
      schoolId: record.school_id,
      targetPhone: phone,
      targetUserId: record.target_user_id,
      targetRole: 'admin',
      purpose: 'school_admin_activation_setup',
      codeHash: hashSetupToken(`unified-admin-email:${candidateEmail}:${emailCode}`),
    }, tx);
    if (!match) {
      await invitationRepository.recordFailedAuthCodeAttempt(record.school_id, phone, 'school_admin_activation_setup', tx);
      return null;
    }

    const school = await tx.query('SELECT id FROM schools WHERE id=$1 AND disabled_at IS NULL FOR SHARE', [record.school_id]);
    if (!school.rows.length || !await schoolLicenseRepository.isAccessAllowed(record.school_id, tx)) {
      throw new Error('INVALID_ADMIN_ACTIVATION');
    }

    await tx.query('LOCK TABLE school_memberships IN SHARE ROW EXCLUSIVE MODE');
    const platformAdminIds = (process.env.PLATFORM_ADMIN_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
    const activeAdmins = await tx.query(
      `SELECT user_id FROM school_memberships
       WHERE school_id=$1 AND role='admin' AND status='active'
         AND NOT (user_id=ANY($2::text[])) LIMIT 1`,
      [record.school_id, platformAdminIds],
    );
    if (activeAdmins.rows.length) throw new WhatsAppAuthError(409, 'Bu okulda etkin bir okul yöneticisi bulunuyor.');

    const originalInvite = await tx.query(
      `SELECT id FROM invitations WHERE school_id=$1 AND target_user_id=$2
       AND target_role='admin' AND purpose='school_admin_activation' AND is_active=TRUE
       AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE`,
      [record.school_id, record.target_user_id],
    );
    if (originalInvite.rows.length !== 1) throw new Error('INVALID_ADMIN_ACTIVATION');
    const otherMemberships = await membershipRepository.getMembershipsByUserId(record.target_user_id, tx);
    if (otherMemberships.length) throw new Error('INVALID_ADMIN_ACTIVATION');

    await userRepository.verifyPhone(record.target_user_id, tx);
    await membershipRepository.createOrActivate({ schoolId: record.school_id, userId: record.target_user_id, role: 'admin' }, tx);
    await tx.query(
      `UPDATE invitations SET is_active=FALSE,revoked_at=NOW()
       WHERE school_id=$1 AND target_user_id=$2 AND purpose='school_admin_activation'
         AND is_active=TRUE AND consumed_at IS NULL`,
      [record.school_id, record.target_user_id],
    );
    await auditLogRepository.createAuditLog({
      schoolId: record.school_id,
      action: 'school_admin_whatsapp_email_activation',
      actorName: 'Sistem',
      details: `Okul yöneticisi ${record.target_user_id} çift kanallı doğrulamayla etkinleştirildi.`,
    }, tx);
    const user = await userRepository.getById(record.target_user_id, tx);
    if (!user) throw new Error('INVALID_ADMIN_ACTIVATION');
    return {
      user,
      memberships: await membershipRepository.getMembershipsByUserId(user.id, tx),
      purpose: 'school_admin_activation',
    };
  });
}

export async function verifyWhatsAppAuthChallenge(input: {
  challengeId: unknown;
  phone: unknown;
  code: unknown;
  requesterKey: string;
}): Promise<WhatsAppAuthResult | PendingAdminEmail | null> {
  assertWhatsAppDeliveryConfigured();
  const challengeId = typeof input.challengeId === 'string' ? input.challengeId.trim() : '';
  const phone = normalizeTurkishPhone(input.phone);
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (!challengeId || !phone || !/^\d{6}$/.test(code)) return null;
  if (!await withinRateLimit(`${input.requesterKey}:verify:${phone}`, 8, 15)) {
    throw new WhatsAppAuthError(429, 'Çok fazla doğrulama denemesi yapıldı. Lütfen daha sonra tekrar deneyin.');
  }
  if (!isWhatsAppPilotPhoneAllowed(phone)) return null;
  return (await getDb()).transaction(async (tx) => {
    const challenge = await readAndValidateChallenge(tx, { challengeId, phone, code });
    if (!challenge || challenge.purpose === 'account_deletion') return null;
    if (challenge.target_user_id) {
      const currentIdentity = await userRepository.getByPhone(challenge.target_phone, tx);
      if (!currentIdentity || currentIdentity.id !== challenge.target_user_id) return null;
    }
    if ((challenge.purpose === 'school_admin_login' || challenge.purpose === 'school_admin_activation')
      && !isUnifiedWhatsAppLoginEnabled()) return null;
    if (challenge.purpose === 'school_admin_activation') return queueAdminEmailAfterPhoneVerification(tx, challenge);
    let user: (User & { authVersion: number }) | null = null;
    if (challenge.purpose === 'school_admin_login') {
      if (!challenge.target_user_id || !challenge.school_id || isPlatformAdmin(challenge.target_user_id)) return null;
      const activeSchool = await tx.query('SELECT id FROM schools WHERE id=$1 AND disabled_at IS NULL FOR SHARE', [challenge.school_id]);
      if (!activeSchool.rows.length) return null;
      const adminMemberships = await membershipRepository.getMembershipsByUserId(challenge.target_user_id, tx);
      if (adminMemberships.some((membership) => membership.status === 'active' && membership.role !== 'admin')) return null;
      if (!adminMemberships.some((membership) => membership.schoolId === challenge.school_id && membership.role === 'admin' && membership.status === 'active')
        || !await schoolLicenseRepository.isAccessAllowed(challenge.school_id, tx)) return null;
      await userRepository.verifyPhone(challenge.target_user_id, tx);
      user = await userRepository.getById(challenge.target_user_id, tx);
    } else if (challenge.purpose === 'login') {
      user = challenge.target_user_id ? await userRepository.getById(challenge.target_user_id, tx) : null;
    } else if (challenge.purpose === 'parent_registration') {
      user = await activateParent(tx, challenge);
    } else {
      user = await activateStaff(tx, challenge);
    }
    if (!user) return null;
    const memberships = challenge.purpose === 'school_admin_login'
      ? (await membershipRepository.getMembershipsByUserId(user.id, tx)).filter((membership) =>
        membership.role === 'admin' && membership.status === 'active' && membership.schoolId === challenge.school_id)
      : await eligibleMemberships(user.id, tx);
    if (!memberships.length) return null;
    await tx.query('UPDATE whatsapp_auth_challenges SET consumed_at=NOW() WHERE id=$1 AND consumed_at IS NULL', [challenge.id]);
    return { user, memberships, purpose: challenge.purpose };
  });
}

export async function consumeAccountDeletionWhatsAppChallenge(
  tx: TransactionClient,
  input: { challengeId: string; phone: string; code: string; userId: string },
): Promise<boolean> {
  const phone = normalizeTurkishPhone(input.phone);
  if (!phone || !/^\d{6}$/.test(input.code)) return false;
  if (!isWhatsAppPilotPhoneAllowed(phone)) return false;
  const challenge = await readAndValidateChallenge(tx, {
    challengeId: input.challengeId,
    phone,
    code: input.code,
    expectedPurpose: 'account_deletion',
  });
  if (!challenge || challenge.target_user_id !== input.userId) return false;
  const consumed = await tx.query(
    `UPDATE whatsapp_auth_challenges SET consumed_at=NOW()
     WHERE id=$1 AND consumed_at IS NULL AND revoked_at IS NULL RETURNING id`,
    [challenge.id],
  );
  return consumed.rows.length === 1;
}

export class WhatsAppAuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}
