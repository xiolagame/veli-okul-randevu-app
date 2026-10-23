import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { authMiddleware, tenantGuard, AuthenticatedRequest } from './auth';
import { getDb, TransactionClient } from './database/postgres';
import { auditLogRepository, invitationRepository, userRepository } from './repositories';
import { getTurkishPhoneLookupDigits, normalizeTurkishPhone, normalizeUserPhoneInput } from '../src/utils/phone';
import { normalizePersonName } from '../src/utils/person-name';
import { isPlatformAdmin } from './auth';
import { parseBirthDateInputToIso } from '../src/utils/birth-date';
import { generateStaffCode, hashActivationCode } from './activation-codes';
import { deliverSchoolAdminCode } from './school-admin-email';

class ManagementError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function textField(value: unknown, max: number): string {
  if (typeof value !== 'string') throw new ManagementError(400, 'Zorunlu alanları doldurun.');
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text.length > max) throw new ManagementError(400, 'Alan uzunluğunu kontrol edin.');
  return text;
}

async function revokeCodes(tx: TransactionClient, schoolId: string, phone: string, role: string) {
  const digits = getTurkishPhoneLookupDigits(phone);
  if (!digits) return;
  await tx.query(`UPDATE invitations SET is_active = FALSE, revoked_at = NOW()
    WHERE school_id = $1 AND target_role = $2
      AND regexp_replace(target_phone, '[^0-9]', '', 'g') IN ($3,$4,$5)
      AND consumed_at IS NULL AND revoked_at IS NULL`, [schoolId, role, ...digits]);
}

export const adminManagementRouter = Router({ mergeParams: true });
adminManagementRouter.use(authMiddleware, tenantGuard(['admin']));

adminManagementRouter.get('/parents', async (req: AuthenticatedRequest, res) => {
  try {
    const db = await getDb();
    const result = await db.query<{ id: string; fullName: string; phone: string; status: string }>(
      `SELECT u.id, concat_ws(' ',u.first_name,u.last_name) AS "fullName", u.phone, sm.status
       FROM users u JOIN school_memberships sm ON sm.user_id = u.id
       WHERE sm.school_id = $1 AND sm.role = 'parent' ORDER BY u.id`, [req.membership!.schoolId]);
    const students = await db.query<{ id: string; parentId: string; name: string; className: string; studentNumber: string; birthDate?: string }>(
      `SELECT s.id, r.parent_user_id AS "parentId", s.name, s.class_name AS "className",
         COALESCE(s.student_number,'') AS "studentNumber", s.birth_date::text AS "birthDate"
       FROM students s JOIN student_parent_relations r ON r.school_id = s.school_id AND r.student_id = s.id
       WHERE s.school_id = $1 ORDER BY s.id`, [req.membership!.schoolId]);
    res.json({ parents: result.rows.map((parent) => ({ ...parent, fullName: normalizePersonName(parent.fullName), students: students.rows.filter((student) => student.parentId === parent.id).map((student) => ({ ...student, name: normalizePersonName(student.name) })) })) });
  } catch { res.status(500).json({ error: 'Veli bilgileri alınamadı.' }); }
});

type ManagedAdmin = {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  status: 'active' | 'pending';
};

function emailField(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) {
    throw new ManagementError(400, 'Geçerli bir e-posta adresi girin.');
  }
  return email;
}

function adminIdentity(body: Record<string, unknown>) {
  const fullName = normalizePersonName(textField(body.fullName, 150));
  const parts = fullName.split(' ');
  if (parts.length < 2) throw new ManagementError(400, 'Ad ve soyad girin.');
  const firstName = parts.shift()!;
  const lastName = parts.join(' ');
  const phone = normalizeUserPhoneInput(body.phone);
  if (!phone) throw new ManagementError(400, 'Geçerli bir Türkiye GSM numarası girin.');
  return { fullName, firstName, lastName, phone, email: emailField(body.email) };
}

adminManagementRouter.get('/admins', async (req: AuthenticatedRequest, res) => {
  const schoolId = req.membership!.schoolId;
  try {
    const db = await getDb();
    const result = await db.query<ManagedAdmin>(`SELECT u.id,concat_ws(' ',u.first_name,u.last_name) AS "fullName",
        u.phone,COALESCE(u.email,'') AS email,'active'::text AS status
      FROM school_memberships sm JOIN users u ON u.id=sm.user_id
      WHERE sm.school_id=$1 AND sm.role='admin' AND sm.status='active'
      UNION ALL
      SELECT pending.id,pending."fullName",pending.phone,pending.email,'pending'::text AS status FROM (
        SELECT DISTINCT ON (u.id) u.id,concat_ws(' ',u.first_name,u.last_name) AS "fullName",
          u.phone,COALESCE(u.email,'') AS email,i.created_at
        FROM invitations i JOIN users u ON u.id=i.target_user_id
        WHERE i.school_id=$1 AND i.purpose='school_admin_activation' AND i.target_role='admin'
          AND i.consumed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM school_memberships sm WHERE sm.school_id=$1 AND sm.user_id=u.id
            AND sm.role='admin' AND sm.status='active')
        ORDER BY u.id,i.created_at DESC,i.id DESC
      ) pending
      ORDER BY status,"fullName",id`, [schoolId]);
    const admins = result.rows.filter((entry) => !isPlatformAdmin(entry.id)).map((entry) => ({
      ...entry, fullName: normalizePersonName(entry.fullName), status: entry.status as 'active' | 'pending',
    }));
    return res.json({ admins });
  } catch {
    return res.status(500).json({ error: 'Okul yöneticileri yüklenemedi.' });
  }
});

adminManagementRouter.post('/admins', async (req: AuthenticatedRequest, res) => {
  const schoolId = req.membership!.schoolId;
  let identity: ReturnType<typeof adminIdentity>;
  try { identity = adminIdentity(req.body || {}); }
  catch (cause) { return res.status(cause instanceof ManagementError ? cause.status : 400).json({ error: cause instanceof Error ? cause.message : 'Bilgileri kontrol edin.' }); }
  const code = generateStaffCode();
  try {
    const db = await getDb();
    const target = await db.transaction(async (tx) => {
      const school = await tx.query<{ name: string; code: string }>('SELECT name,code FROM schools WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [schoolId]);
      if (!school.rows[0]) throw new ManagementError(404, 'Aktif okul bulunamadı.');
      await tx.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      await tx.query('LOCK TABLE school_memberships IN SHARE ROW EXCLUSIVE MODE');
      await tx.query('LOCK TABLE invitations IN SHARE ROW EXCLUSIVE MODE');
      const platformAdminIds = (process.env.PLATFORM_ADMIN_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
      const activeAdmins = await tx.query(
        `SELECT user_id FROM school_memberships
         WHERE school_id=$1 AND role='admin' AND status='active'
           AND NOT (user_id=ANY($2::text[])) LIMIT 1`,
        [schoolId, platformAdminIds],
      );
      if (activeAdmins.rows.length) throw new ManagementError(409, 'Bu okulda etkin bir okul yöneticisi bulunuyor.');
      const existingUser = await userRepository.getByPhone(identity.phone, tx);
      const duplicateEmail = await tx.query(`SELECT id FROM users WHERE id IS DISTINCT FROM $2 AND LOWER(email)=LOWER($1)
        UNION ALL SELECT id FROM teacher_profiles WHERE user_id IS DISTINCT FROM $2 AND LOWER(email)=LOWER($1)
        UNION ALL SELECT id FROM pending_staff WHERE LOWER(email)=LOWER($1) LIMIT 1`, [identity.email, existingUser?.id || null]);
      if (duplicateEmail.rows.length) {
        throw new ManagementError(409, 'Bu e-posta başka bir hesaba bağlı.');
      }
      let userId: string;
      if (existingUser) {
        if (isPlatformAdmin(existingUser.id)) throw new ManagementError(409, 'Platform yöneticisi okul yöneticisi olarak eklenemez.');
        const state = await tx.query<{ password_hash: string | null; is_phone_verified: boolean }>(
          'SELECT password_hash,is_phone_verified FROM users WHERE id=$1 FOR UPDATE', [existingUser.id]);
        const relations = await tx.query('SELECT id FROM school_memberships WHERE user_id=$1 LIMIT 1', [existingUser.id]);
        if (state.rows[0]?.password_hash || state.rows[0]?.is_phone_verified || relations.rows.length) {
          throw new ManagementError(409, 'Bu hesap başka bir okul veya kullanıcı rolüyle ilişkilendirilmiş.');
        }
        userId = existingUser.id;
        const pending = await tx.query(`SELECT id FROM invitations WHERE target_user_id=$1 AND purpose='school_admin_activation'
          AND is_active=TRUE AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() LIMIT 1`, [userId]);
        if (pending.rows.length) throw new ManagementError(409, 'Bu okul yöneticisi için zaten bir aktivasyon daveti bekliyor.');
        await tx.query('UPDATE users SET first_name=$2,last_name=$3,email=$4,updated_at=NOW() WHERE id=$1',
          [userId, identity.firstName, identity.lastName, identity.email]);
      } else {
        userId = `usr-${randomUUID()}`;
        await tx.query(`INSERT INTO users(id,phone,first_name,last_name,email,is_phone_verified)
          VALUES($1,$2,$3,$4,$5,FALSE)`, [userId, identity.phone, identity.firstName, identity.lastName, identity.email]);
      }
      await invitationRepository.createAuthCode({ schoolId, targetPhone: identity.phone, targetUserId: userId,
        targetRole: 'admin', purpose: 'school_admin_activation', codeHash: hashActivationCode(code),
        createdBy: req.user!.id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), token: randomUUID() }, tx);
      await auditLogRepository.createAuditLog({ schoolId, action: 'school_admin_invited', actorName: 'Okul yönetimi',
        actorUserId: req.user!.id, details: `Okul yöneticisi ${userId} için aktivasyon daveti oluşturuldu.` }, tx);
      return { userId, schoolName: school.rows[0].name, schoolCode: school.rows[0].code };
    });
    const emailSent = await deliverSchoolAdminCode(identity.email, target.schoolName, target.schoolCode, identity.fullName, code);
    return res.status(201).json({ success: true, emailSent, message: emailSent
      ? 'Yönetici eklendi ve aktivasyon e-postası gönderildi.'
      : 'Yönetici eklendi ancak e-posta gönderilemedi. Yeniden göndermeyi deneyin.' });
  } catch (cause) {
    if (cause instanceof ManagementError) return res.status(cause.status).json({ error: cause.message });
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505') {
      return res.status(409).json({ error: 'Telefon veya e-posta başka bir hesaba bağlı.' });
    }
    return res.status(500).json({ error: 'Okul yöneticisi eklenemedi.' });
  }
});

adminManagementRouter.post('/admins/:id/resend', async (req: AuthenticatedRequest, res) => {
  const schoolId = req.membership!.schoolId;
  const userId = String(req.params.id);
  const code = generateStaffCode();
  try {
    const db = await getDb();
    const target = await db.transaction(async (tx) => {
      const school = await tx.query<{ name: string; code: string }>('SELECT name,code FROM schools WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [schoolId]);
      if (!school.rows[0]) throw new ManagementError(404, 'Aktif okul bulunamadı.');
      const user = await tx.query<{ first_name: string; last_name: string; phone: string; email: string | null }>(`SELECT u.first_name,u.last_name,u.phone,u.email FROM users u
        WHERE u.id=$1 AND EXISTS (SELECT 1 FROM invitations i WHERE i.school_id=$2 AND i.target_user_id=u.id
          AND i.purpose='school_admin_activation' AND i.consumed_at IS NULL) FOR UPDATE`, [userId, schoolId]);
      if (!user.rows[0]?.email || isPlatformAdmin(userId)) throw new ManagementError(404, 'Bekleyen yönetici daveti bulunamadı.');
      const active = await tx.query("SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role='admin' AND status='active'", [schoolId, userId]);
      if (active.rows.length) throw new ManagementError(409, 'Yönetici hesabı zaten etkin.');
      const recent = await tx.query(`SELECT id FROM invitations WHERE school_id=$1 AND target_user_id=$2
        AND purpose='school_admin_activation' AND created_at>NOW()-INTERVAL '60 seconds' LIMIT 1`, [schoolId, userId]);
      if (recent.rows.length) throw new ManagementError(429, 'Yeni e-posta göndermeden önce kısa süre bekleyin.');
      await invitationRepository.createAuthCode({ schoolId, targetPhone: user.rows[0].phone, targetUserId: userId,
        targetRole: 'admin', purpose: 'school_admin_activation', codeHash: hashActivationCode(code),
        createdBy: req.user!.id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), token: randomUUID() }, tx);
      await auditLogRepository.createAuditLog({ schoolId, action: 'school_admin_activation_resent', actorName: 'Okul yönetimi',
        actorUserId: req.user!.id, details: `Okul yöneticisi ${userId} için aktivasyon daveti yeniden oluşturuldu.` }, tx);
      return { ...user.rows[0], schoolName: school.rows[0].name, schoolCode: school.rows[0].code };
    });
    const emailSent = await deliverSchoolAdminCode(target.email!, target.schoolName, target.schoolCode,
      `${target.first_name} ${target.last_name}`.trim(), code);
    return res.json({ success: true, emailSent, message: emailSent ? 'Aktivasyon e-postası yeniden gönderildi.' : 'Yeni kod kaydedildi ancak e-posta gönderilemedi.' });
  } catch (cause) {
    if (cause instanceof ManagementError) return res.status(cause.status).json({ error: cause.message });
    return res.status(500).json({ error: 'Aktivasyon e-postası gönderilemedi.' });
  }
});

adminManagementRouter.patch('/admins/:id', async (req: AuthenticatedRequest, res) => {
  const schoolId = req.membership!.schoolId;
  const userId = String(req.params.id);
  let identity: ReturnType<typeof adminIdentity>;
  try { identity = adminIdentity(req.body || {}); }
  catch (cause) { return res.status(cause instanceof ManagementError ? cause.status : 400).json({ error: cause instanceof Error ? cause.message : 'Bilgileri kontrol edin.' }); }
  try {
    const db = await getDb();
    const invitationRevoked = await db.transaction(async (tx) => {
      await tx.query('SELECT id FROM schools WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [schoolId]);
      await tx.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      const current = await tx.query<{ phone: string; email: string | null }>(`SELECT u.phone,u.email FROM users u WHERE u.id=$1 AND (
        EXISTS (SELECT 1 FROM school_memberships sm WHERE sm.school_id=$2 AND sm.user_id=u.id AND sm.role='admin' AND sm.status='active')
        OR EXISTS (SELECT 1 FROM invitations i WHERE i.school_id=$2 AND i.target_user_id=u.id AND i.purpose='school_admin_activation'
          AND i.consumed_at IS NULL)) FOR UPDATE`, [userId, schoolId]);
      if (!current.rows[0] || isPlatformAdmin(userId)) throw new ManagementError(404, 'Okul yöneticisi bulunamadı.');
      const otherSchool = await tx.query('SELECT id FROM school_memberships WHERE user_id=$1 AND school_id<>$2 LIMIT 1', [userId, schoolId]);
      if (otherSchool.rows.length) throw new ManagementError(409, 'Birden fazla okula bağlı hesabın kimlik bilgileri bu ekrandan değiştirilemez.');
      const digits = getTurkishPhoneLookupDigits(identity.phone)!;
      const duplicatePhone = await tx.query(`SELECT id FROM users WHERE id<>$1 AND regexp_replace(phone,'[^0-9]','','g') IN ($2,$3,$4) LIMIT 1`, [userId, ...digits]);
      const duplicateEmail = await tx.query(`SELECT id FROM users WHERE id<>$1 AND LOWER(email)=LOWER($2)
        UNION ALL SELECT id FROM teacher_profiles WHERE user_id IS DISTINCT FROM $1 AND LOWER(email)=LOWER($2)
        UNION ALL SELECT id FROM pending_staff WHERE LOWER(email)=LOWER($2) LIMIT 1`, [userId, identity.email]);
      if (duplicatePhone.rows.length) throw new ManagementError(409, 'Telefon başka bir hesaba bağlı.');
      if (duplicateEmail.rows.length) throw new ManagementError(409, 'E-posta başka bir hesaba bağlı.');
      const identityChanged = normalizeTurkishPhone(current.rows[0].phone) !== identity.phone || (current.rows[0].email || '').toLowerCase() !== identity.email;
      await tx.query(`UPDATE users SET first_name=$2,last_name=$3,phone=$4,email=$5,
        auth_version=auth_version + CASE WHEN $6 THEN 1 ELSE 0 END,updated_at=NOW() WHERE id=$1`,
        [userId, identity.firstName, identity.lastName, identity.phone, identity.email, identityChanged]);
      if (identityChanged) await tx.query(`UPDATE invitations SET is_active=FALSE,revoked_at=COALESCE(revoked_at,NOW())
        WHERE school_id=$1 AND target_user_id=$2 AND purpose IN ('school_admin_activation','school_admin_activation_setup')
          AND consumed_at IS NULL AND revoked_at IS NULL`, [schoolId, userId]);
      await auditLogRepository.createAuditLog({ schoolId, action: 'school_admin_updated', actorName: 'Okul yönetimi',
        actorUserId: req.user!.id, details: `Okul yöneticisi ${userId} bilgileri güncellendi.` }, tx);
      return identityChanged;
    });
    return res.json({ success: true, invitationRevoked, message: invitationRevoked
      ? 'Bilgiler güncellendi. Bekleyen aktivasyon iptal edildi; yeni e-posta gönderin.'
      : 'Yönetici bilgileri güncellendi.' });
  } catch (cause) {
    if (cause instanceof ManagementError) return res.status(cause.status).json({ error: cause.message });
    return res.status(500).json({ error: 'Yönetici bilgileri güncellenemedi.' });
  }
});

adminManagementRouter.delete('/admins/:id', async (req: AuthenticatedRequest, res) => {
  const schoolId = req.membership!.schoolId;
  const userId = String(req.params.id);
  try {
    const db = await getDb();
    await db.transaction(async (tx) => {
      await tx.query('SELECT id FROM schools WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [schoolId]);
      await tx.query('LOCK TABLE school_memberships IN SHARE ROW EXCLUSIVE MODE');
      if (isPlatformAdmin(userId)) throw new ManagementError(404, 'Okul yöneticisi bulunamadı.');
      const membership = await tx.query(`SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2
        AND role='admin' AND status='active' FOR UPDATE`, [schoolId, userId]);
      if (membership.rows.length) {
        const admins = await tx.query<{ user_id: string }>(`SELECT user_id FROM school_memberships WHERE school_id=$1
          AND role='admin' AND status='active' FOR UPDATE`, [schoolId]);
        const realAdmins = admins.rows.filter((entry) => !isPlatformAdmin(entry.user_id));
        if (realAdmins.length <= 1) throw new ManagementError(409, 'Okulun son etkin yöneticisi kaldırılamaz. Önce başka bir yönetici ekleyin.');
        await tx.query("DELETE FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role='admin'", [schoolId, userId]);
        await tx.query('UPDATE users SET auth_version=auth_version+1,updated_at=NOW() WHERE id=$1', [userId]);
      } else {
        const pending = await tx.query(`SELECT id FROM invitations WHERE school_id=$1 AND target_user_id=$2
          AND purpose='school_admin_activation' AND consumed_at IS NULL FOR UPDATE`, [schoolId, userId]);
        if (!pending.rows.length) throw new ManagementError(404, 'Okul yöneticisi bulunamadı.');
      }
      await tx.query(`UPDATE invitations SET is_active=FALSE,revoked_at=COALESCE(revoked_at,NOW())
        WHERE school_id=$1 AND target_user_id=$2 AND purpose LIKE 'school_admin_%' AND consumed_at IS NULL`, [schoolId, userId]);
      if (!membership.rows.length) {
        await tx.query(`DELETE FROM invitations WHERE school_id=$1 AND target_user_id=$2
          AND purpose LIKE 'school_admin_%'`, [schoolId, userId]);
        await tx.query(`DELETE FROM users u WHERE u.id=$1 AND u.password_hash IS NULL AND u.is_phone_verified=FALSE
          AND NOT EXISTS (SELECT 1 FROM school_memberships WHERE user_id=u.id)
          AND NOT EXISTS (SELECT 1 FROM teacher_profiles WHERE user_id=u.id)
          AND NOT EXISTS (SELECT 1 FROM student_parent_relations WHERE parent_user_id=u.id)
          AND NOT EXISTS (SELECT 1 FROM appointments WHERE parent_id=u.id)
          AND NOT EXISTS (SELECT 1 FROM notifications WHERE user_id=u.id)
          AND NOT EXISTS (SELECT 1 FROM pending_staff WHERE phone=u.phone)
          AND NOT EXISTS (SELECT 1 FROM school_roster WHERE school_id<>$2
            AND right(regexp_replace(parent_phone,'[^0-9]','','g'),10)=right(regexp_replace(u.phone,'[^0-9]','','g'),10))
          AND NOT EXISTS (SELECT 1 FROM invitations WHERE target_user_id=u.id
            AND (school_id<>$2 OR purpose NOT LIKE 'school_admin_%')
            AND consumed_at IS NULL AND revoked_at IS NULL)`, [userId, schoolId]);
      }
      await auditLogRepository.createAuditLog({ schoolId, action: 'school_admin_removed', actorName: 'Okul yönetimi',
        actorUserId: req.user!.id, details: `Okul yöneticisi ${userId} okul yetkisinden kaldırıldı.` }, tx);
    });
    return res.json({ success: true });
  } catch (cause) {
    if (cause instanceof ManagementError) return res.status(cause.status).json({ error: cause.message });
    return res.status(500).json({ error: 'Okul yöneticisi kaldırılamadı.' });
  }
});

adminManagementRouter.delete('/audit-logs', async (req: AuthenticatedRequest, res) => {
  try {
    const db = await getDb();
    await db.query('DELETE FROM audit_logs WHERE school_id = $1', [req.membership!.schoolId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'İşlem günlüğü temizlenemedi.' }); }
});

async function removalImpact(client: TransactionClient, schoolId: string, studentId: string, parentId: string) {
  const result = await client.query<{ siblings: string; independent: boolean }>(`SELECT
    (SELECT COUNT(*)::text FROM student_parent_relations WHERE parent_user_id=$3 AND student_id<>$2) AS siblings,
    (EXISTS(SELECT 1 FROM school_memberships WHERE user_id=$3 AND NOT (school_id=$1 AND role='parent'))
      OR EXISTS(SELECT 1 FROM teacher_profiles WHERE user_id=$3)
      OR EXISTS(SELECT 1 FROM appointments WHERE parent_id=$3 AND school_id<>$1)
      OR EXISTS(SELECT 1 FROM notifications WHERE user_id=$3 AND school_id<>$1)
      OR EXISTS(SELECT 1 FROM school_roster sr JOIN users u ON u.id=$3 WHERE sr.school_id<>$1
        AND right(regexp_replace(sr.parent_phone,'[^0-9]','','g'),10)=right(regexp_replace(u.phone,'[^0-9]','','g'),10))
      OR EXISTS(SELECT 1 FROM pending_staff ps JOIN users u ON u.phone=ps.phone WHERE u.id=$3)
      OR EXISTS(SELECT 1 FROM invitations WHERE target_user_id=$3 AND school_id<>$1 AND is_active=TRUE)) AS independent`,
    [schoolId, studentId, parentId]);
  return { siblings: Number(result.rows[0].siblings), independent: result.rows[0].independent || isPlatformAdmin(parentId) };
}

adminManagementRouter.get('/students/:id/removal', async (req: AuthenticatedRequest, res) => {
  const schoolId = req.membership!.schoolId;
  const studentId = String(req.params.id);
  try {
    const db = await getDb();
    const student = await db.query<{ name: string }>('SELECT name FROM students WHERE school_id=$1 AND id=$2', [schoolId, studentId]);
    if (!student.rows[0]) return res.status(404).json({ error: 'Öğrenci bulunamadı.' });
    const parents = await db.query<{ parent_user_id: string }>(
      'SELECT parent_user_id FROM student_parent_relations WHERE school_id=$1 AND student_id=$2', [schoolId, studentId]);
    const impact = await Promise.all(parents.rows.map((parent) => removalImpact(db, schoolId, studentId, parent.parent_user_id)));
    return res.json({ studentName: normalizePersonName(student.rows[0].name),
      siblingAccounts: impact.filter((item) => item.siblings > 0).length,
      preservedAccounts: impact.filter((item) => item.siblings > 0 || item.independent).length,
      deletedAccounts: impact.filter((item) => item.siblings === 0 && !item.independent).length });
  } catch {
    return res.status(500).json({ error: 'Silme etkisi belirlenemedi.' });
  }
});

adminManagementRouter.delete('/students/:id/removal', async (req: AuthenticatedRequest, res) => {
  const schoolId = req.membership!.schoolId;
  const studentId = String(req.params.id);
  try {
    const db = await getDb();
    const outcome = await db.transaction(async (tx) => {
      const school = await tx.query('SELECT id FROM schools WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [schoolId]);
      if (!school.rows.length) throw new ManagementError(403, 'Okul etkin değil.');
      const student = await tx.query<{ name: string; class_name: string; student_number: string | null }>(
        'SELECT name,class_name,student_number FROM students WHERE school_id=$1 AND id=$2 FOR UPDATE', [schoolId, studentId]);
      if (!student.rows[0]) throw new ManagementError(404, 'Öğrenci bulunamadı.');
      const record = student.rows[0];
      const ambiguous = await tx.query(`SELECT id FROM students WHERE school_id=$1 AND id<>$2 AND name=$3
        AND class_name=$4 AND student_number IS NOT DISTINCT FROM $5 LIMIT 1`,
        [schoolId, studentId, record.name, record.class_name, record.student_number]);
      if (ambiguous.rows.length) throw new ManagementError(409, 'Aynı bilgilere sahip başka bir öğrenci var. Önce okul kayıtlarını ayırt edin.');
      const parents = await tx.query<{ id: string; phone: string }>(`SELECT u.id,u.phone FROM users u
        JOIN student_parent_relations rel ON rel.parent_user_id=u.id
        WHERE rel.school_id=$1 AND rel.student_id=$2 FOR UPDATE OF u`, [schoolId, studentId]);
      const parentIds = parents.rows.map((parent) => parent.id);
      const appointments = await tx.query<{ id: string; status: string }>(`SELECT id,status FROM appointments
        WHERE school_id=$1 AND (student_id=$2 OR (student_id IS NULL AND student_name=$3 AND class_name=$4
          AND parent_id=ANY($5::text[]))) FOR UPDATE`, [schoolId, studentId, record.name, record.class_name, parentIds]);
      if (appointments.rows.some((appointment) => appointment.status === 'checked_in')) {
        throw new ManagementError(409, 'Öğrencinin okulda devam eden ziyareti tamamlanmadan kayıt kaldırılamaz.');
      }
      const appointmentIds = appointments.rows.map((appointment) => appointment.id);
      if (appointmentIds.length) {
        await tx.query('DELETE FROM notifications WHERE school_id=$1 AND appointment_id=ANY($2::text[])', [schoolId, appointmentIds]);
        await tx.query(`UPDATE appointments SET status='cancelled',updated_at=NOW()
          WHERE school_id=$1 AND id=ANY($2::text[]) AND status IN ('pending','booked')`, [schoolId, appointmentIds]);
      }
      const roster = await tx.query<{ parent_phone: string }>(`SELECT parent_phone FROM school_roster WHERE school_id=$1
        AND student_name=$2 AND class_name=$3 AND student_number IS NOT DISTINCT FROM $4 FOR UPDATE`,
        [schoolId, record.name, record.class_name, record.student_number]);
      const parentPhones = parents.rows.map((parent) => normalizeTurkishPhone(parent.phone));
      if (parents.rows.length && roster.rows.some((entry) => !parentPhones.includes(normalizeTurkishPhone(entry.parent_phone)))) {
        throw new ManagementError(409, 'Kütük eşleştirmesi belirsiz. Okul kayıtlarını kontrol edin.');
      }
      await tx.query(`DELETE FROM school_roster WHERE school_id=$1 AND student_name=$2
        AND class_name=$3 AND student_number IS NOT DISTINCT FROM $4`,
        [schoolId, record.name, record.class_name, record.student_number]);
      await tx.query('DELETE FROM students WHERE school_id=$1 AND id=$2', [schoolId, studentId]);
      let deletedAccounts = 0;
      let preservedAccounts = 0;
      for (const parent of parents.rows) {
        const impact = await removalImpact(tx, schoolId, studentId, parent.id);
        const sameSchoolRelation = await tx.query('SELECT 1 FROM student_parent_relations WHERE school_id=$1 AND parent_user_id=$2 LIMIT 1', [schoolId, parent.id]);
        if (!sameSchoolRelation.rows.length) {
          await tx.query("DELETE FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role='parent'", [schoolId, parent.id]);
          await revokeCodes(tx, schoolId, parent.phone, 'parent');
          await tx.query('DELETE FROM notifications WHERE school_id=$1 AND user_id=$2', [schoolId, parent.id]);
        }
        if (impact.siblings || impact.independent) {
          preservedAccounts++;
          continue;
        }
        const otherMembership = await tx.query('SELECT 1 FROM school_memberships WHERE user_id=$1 LIMIT 1', [parent.id]);
        if (otherMembership.rows.length) { preservedAccounts++; continue; }
        const safeForeignKey = await tx.query<{ safe: boolean }>(`SELECT EXISTS(
          SELECT 1 FROM pg_constraint WHERE conrelid='public.appointments'::regclass
            AND conname='appointments_parent_id_fkey' AND confdeltype='n')
          AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.appointments'::regclass
            AND attname='parent_id' AND NOT attnotnull) AS safe`);
        if (!safeForeignKey.rows[0]?.safe) throw new ManagementError(503, 'Öğrenci kaldırma için veritabanı güncellemesi gerekli.');
        await tx.query(`UPDATE invitations SET is_active=FALSE,revoked_at=COALESCE(revoked_at,NOW()),target_user_id=NULL
          WHERE target_user_id=$1 AND consumed_at IS NULL`, [parent.id]);
        await tx.query('UPDATE invitations SET target_user_id=NULL WHERE target_user_id=$1', [parent.id]);
        await tx.query('UPDATE invitations SET created_by=NULL WHERE created_by=$1', [parent.id]);
        await tx.query('UPDATE appointments SET approved_by=NULL WHERE approved_by=$1', [parent.id]);
        await tx.query('UPDATE appointments SET checked_in_by=NULL WHERE checked_in_by=$1', [parent.id]);
        await tx.query('DELETE FROM users WHERE id=$1', [parent.id]);
        deletedAccounts++;
      }
      await auditLogRepository.createAuditLog({ schoolId, action: 'Öğrenci Okuldan Kaldırıldı',
        actorName: normalizePersonName(`${req.user!.firstName} ${req.user!.lastName}`),
        actorUserId: req.user!.id,
        details: `${normalizePersonName(record.name)} okuldan kaldırıldı. ${deletedAccounts} veli hesabı silindi, ${preservedAccounts} veli hesabı korundu.` }, tx);
      return { deletedAccounts, preservedAccounts };
    });
    return res.json({ success: true, ...outcome });
  } catch (cause) {
    if (cause instanceof ManagementError) return res.status(cause.status).json({ error: cause.message });
    console.error('[Student removal]: İşlem tamamlanamadı.');
    return res.status(500).json({ error: 'Öğrenci okuldan kaldırılamadı.' });
  }
});

adminManagementRouter.route('/:kind/:id').patch(mutate).delete(mutate);

async function mutate(req: AuthenticatedRequest, res: import('express').Response) {
  const schoolId = req.membership!.schoolId;
  const kind = String(req.params.kind);
  const id = String(req.params.id);
  const removing = req.method === 'DELETE';
  if (!['teacher', 'parent', 'security', 'student', 'roster'].includes(kind) || (removing && ['student','roster'].includes(kind))) {
    return res.status(400).json({ error: 'Geçersiz işlem.' });
  }
  try {
    const db = await getDb();
    await db.transaction(async (tx) => {
      let cancelledAppointments = 0;
      await tx.query('SELECT id FROM schools WHERE id = $1 FOR UPDATE', [schoolId]);
      if (kind === 'teacher') await tx.query('LOCK TABLE teacher_profiles IN SHARE ROW EXCLUSIVE MODE');
      if (kind === 'roster') {
        const parentName = normalizePersonName(textField(req.body.parentName, 150));
        const studentName = normalizePersonName(textField(req.body.studentName, 150));
        const className = textField(req.body.className, 50);
        const number = typeof req.body.studentNumber === 'string' ? req.body.studentNumber.trim() : '';
        const birthDate = typeof req.body.birthDate === 'string' && req.body.birthDate ? req.body.birthDate : null;
        if (birthDate && parseBirthDateInputToIso(birthDate) !== birthDate) throw new ManagementError(400, 'Doğum tarihini kontrol edin.');
        const phone = normalizeUserPhoneInput(req.body.parentPhone);
        if (!phone || number.length > 50) throw new ManagementError(400, 'Telefon veya okul numarası geçersiz.');
        const found = await tx.query<{ parent_phone: string; is_claimed: boolean }>(
          'SELECT parent_phone,is_claimed FROM school_roster WHERE school_id=$1 AND id=$2 FOR UPDATE', [schoolId,id]);
        const record = found.rows[0];
        if (!record) throw new ManagementError(404, 'Kayıt bulunamadı.');
        if (record.is_claimed) throw new ManagementError(409, 'Aktif hesabı veli listesinden düzenleyin.');
        const oldDigits = getTurkishPhoneLookupDigits(record.parent_phone);
        if (!oldDigits) throw new ManagementError(409, 'Eski telefon eşleştirmesi doğrulanamadı.');
        const identity = await tx.query(
          `SELECT id FROM users WHERE regexp_replace(phone,'[^0-9]','','g') IN ($1,$2,$3,$4,$5,$6) LIMIT 1`,
          [...oldDigits,...getTurkishPhoneLookupDigits(phone)!]);
        if (identity.rows.length) throw new ManagementError(409, 'Mevcut hesabı veli listesinden düzenleyin.');
        await tx.query(`UPDATE school_roster SET parent_name=$2,parent_phone=$3,updated_at=NOW()
          WHERE school_id=$1 AND is_claimed=FALSE AND regexp_replace(parent_phone,'[^0-9]','','g') IN ($4,$5,$6)`,
          [schoolId,parentName,phone,...oldDigits]);
        await tx.query(`UPDATE school_roster SET student_name=$3,class_name=$4,student_number=$5,birth_date=$6::date,updated_at=NOW()
          WHERE school_id=$1 AND id=$2 AND is_claimed=FALSE`, [schoolId,id,studentName,className,number || null,birthDate]);
        if (normalizeTurkishPhone(record.parent_phone) !== phone) await revokeCodes(tx,schoolId,record.parent_phone,'parent');
      } else if (kind === 'student') {
        const name = normalizePersonName(textField(req.body.name, 150));
        const className = textField(req.body.className, 50);
        const number = typeof req.body.studentNumber === 'string' ? req.body.studentNumber.trim() : '';
        const birthDate = typeof req.body.birthDate === 'string' && req.body.birthDate ? req.body.birthDate : null;
        if (birthDate && parseBirthDateInputToIso(birthDate) !== birthDate) throw new ManagementError(400, 'Doğum tarihini kontrol edin.');
        if (number.length > 50) throw new ManagementError(400, 'Okul numarası çok uzun.');
        const previous = await tx.query<{ name: string; class_name: string; student_number: string | null }>(
          'SELECT name,class_name,student_number FROM students WHERE school_id=$1 AND id=$2 FOR UPDATE', [schoolId, id]);
        if (!previous.rows[0]) throw new ManagementError(404, 'Kayıt bulunamadı.');
        const old = previous.rows[0];
        const ambiguous = await tx.query(`SELECT id FROM students WHERE school_id=$1 AND id<>$2 AND name=$3
          AND class_name=$4 AND student_number IS NOT DISTINCT FROM $5 LIMIT 1`, [schoolId, id, old.name, old.class_name, old.student_number]);
        if (ambiguous.rows.length) throw new ManagementError(409, 'Kütük eşleştirmesi belirsiz. Okul kayıtlarını kontrol edin.');
        await tx.query(`UPDATE school_roster sr SET student_name=$6,class_name=$7,student_number=$8,birth_date=$9::date,updated_at=NOW()
          WHERE sr.school_id=$1 AND sr.student_name=$3 AND sr.class_name=$4
            AND sr.student_number IS NOT DISTINCT FROM $5
            AND EXISTS (SELECT 1 FROM student_parent_relations rel JOIN users u ON u.id=rel.parent_user_id
              WHERE rel.school_id=sr.school_id AND rel.student_id=$2
                AND regexp_replace(sr.parent_phone,'[^0-9]','','g') IN
                  (regexp_replace(u.phone,'[^0-9]','','g'), '0' || right(regexp_replace(u.phone,'[^0-9]','','g'),10),
                   right(regexp_replace(u.phone,'[^0-9]','','g'),10)))`,
          [schoolId, id, old.name, old.class_name, old.student_number, name, className, number || null,birthDate]);
        const result = await tx.query<{ id: string }>(
          `UPDATE students SET name=$3, class_name=$4, student_number=$5, birth_date=$6::date, updated_at=NOW()
           WHERE school_id=$1 AND id=$2 RETURNING id`, [schoolId, id, name, className, number || null,birthDate]);
        if (!result.rows.length) throw new ManagementError(404, 'Kayıt bulunamadı.');
      } else {
        let userId: string | null = id;
        let oldPhone: string;
        let oldName: string;
        let oldEmail: string;
        let pendingSecurity = false;
        if (kind === 'teacher') {
          const profiles = await tx.query<{ user_id: string | null; phone: string; email: string | null; full_name: string }>(
            `SELECT user_id, phone, email, concat_ws(' ',first_name,last_name) AS full_name
             FROM teacher_profiles WHERE school_id=$1 AND id=$2 FOR UPDATE`, [schoolId, id]);
          const profile = profiles.rows[0];
          if (!profile) throw new ManagementError(404, 'Kayıt bulunamadı.');
          userId = profile.user_id;
          oldPhone = profile.phone;
          oldName = profile.full_name;
          oldEmail = profile.email || '';
        } else {
          const users = await tx.query<{ phone: string; email: string | null; full_name: string }>(
            `SELECT u.phone,u.email,concat_ws(' ',u.first_name,u.last_name) AS full_name
             FROM users u JOIN school_memberships sm ON sm.user_id=u.id
             WHERE sm.school_id=$1 AND u.id=$2 AND sm.role=$3 FOR UPDATE OF u`, [schoolId, id, kind]);
          if (users.rows[0]) {
            oldPhone = users.rows[0].phone;
            oldName = users.rows[0].full_name;
            oldEmail = users.rows[0].email || '';
          } else if (kind === 'security') {
            const pending = await tx.query<{ phone: string; email: string; full_name: string }>(
              `SELECT phone,email,concat_ws(' ',first_name,last_name) AS full_name FROM pending_staff
               WHERE school_id=$1 AND id=$2 AND role='security' FOR UPDATE`, [schoolId, id]);
            if (!pending.rows[0]) throw new ManagementError(404, 'Kayıt bulunamadı.');
            userId = null;
            pendingSecurity = true;
            oldPhone = pending.rows[0].phone;
            oldName = pending.rows[0].full_name;
            oldEmail = pending.rows[0].email;
          } else throw new ManagementError(404, 'Kayıt bulunamadı.');
        }
        if (removing) {
          if (kind === 'teacher') {
            const appointments = await tx.query<{id:string}>(`SELECT id FROM appointments WHERE school_id=$1 AND teacher_id=$2`,[schoolId,id]);
            cancelledAppointments = appointments.rows.length;
            const appointmentIds = appointments.rows.map((row) => row.id);
            if (appointmentIds.length) await tx.query('DELETE FROM notifications WHERE school_id=$1 AND appointment_id = ANY($2::text[])',[schoolId,appointmentIds]);
            await tx.query('DELETE FROM appointments WHERE school_id=$1 AND teacher_id=$2',[schoolId,id]);
            await tx.query('DELETE FROM availability_slots WHERE school_id=$1 AND teacher_id=$2',[schoolId,id]);
            await tx.query(`UPDATE invitations SET is_active=FALSE,revoked_at=COALESCE(revoked_at,NOW()),target_user_id=NULL
              WHERE school_id=$1 AND target_role='teacher' AND (target_user_id=$2 OR regexp_replace(target_phone,'[^0-9]','','g') IN ($3,$4,$5))
                AND consumed_at IS NULL`,[schoolId,userId,...(getTurkishPhoneLookupDigits(oldPhone) || ['', '', ''])]);
            if (userId) {
              await tx.query('DELETE FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role=\'teacher\'',[schoolId,userId]);
              await tx.query('DELETE FROM teacher_profiles WHERE school_id=$1 AND id=$2',[schoolId,id]);
              const independent = await tx.query(`SELECT
                  EXISTS(SELECT 1 FROM school_memberships WHERE user_id=$1) OR
                  EXISTS(SELECT 1 FROM student_parent_relations WHERE parent_user_id=$1) OR
                  EXISTS(SELECT 1 FROM appointments WHERE parent_id=$1) OR
                  EXISTS(SELECT 1 FROM teacher_profiles WHERE user_id=$1) OR
                  EXISTS(SELECT 1 FROM pending_staff ps JOIN users u ON u.phone=ps.phone WHERE u.id=$1) AS has_refs`,[userId]);
              if (!independent.rows[0]?.has_refs) {
                await tx.query('DELETE FROM notifications WHERE user_id=$1',[userId]);
                await tx.query('UPDATE invitations SET target_user_id=NULL WHERE target_user_id=$1',[userId]);
                await tx.query('UPDATE invitations SET created_by=NULL WHERE created_by=$1',[userId]);
                await tx.query('UPDATE appointments SET approved_by=NULL WHERE approved_by=$1',[userId]);
                await tx.query('UPDATE appointments SET checked_in_by=NULL WHERE checked_in_by=$1',[userId]);
                await tx.query('DELETE FROM users WHERE id=$1',[userId]);
              }
            } else {
              await tx.query('DELETE FROM teacher_profiles WHERE school_id=$1 AND id=$2 AND user_id IS NULL',[schoolId,id]);
            }
          } else {
            if (pendingSecurity) await tx.query("DELETE FROM pending_staff WHERE school_id=$1 AND id=$2 AND role='security'", [schoolId, id]);
            else if (userId) await tx.query(`UPDATE school_memberships SET status='inactive', updated_at=NOW()
              WHERE school_id=$1 AND user_id=$2 AND role=$3`, [schoolId, userId, kind]);
          }
          await revokeCodes(tx, schoolId, oldPhone, kind);
        } else {
          const fullName = normalizePersonName(textField(req.body.fullName, 150));
          const phone = normalizeUserPhoneInput(req.body.phone);
          if (!phone) throw new ManagementError(400, 'Geçerli bir Türkiye GSM numarası girin.');
          const names = fullName.split(' ');
          if (names.length < 2) throw new ManagementError(400, 'Ad ve soyad girin.');
          const firstName = names.shift()!;
          const lastName = names.join(' ');
          if (firstName.length > 100 || lastName.length > 100) throw new ManagementError(400, 'Ad veya soyad çok uzun.');
          const branch = kind === 'teacher' ? textField(req.body.branch, 100) : null;
          const emailProvided = req.body.email !== undefined;
          const email = emailProvided ? emailField(req.body.email) : oldEmail;
          const phoneChanged = normalizeTurkishPhone(oldPhone) !== phone;
          const emailChanged = emailProvided && oldEmail.trim().toLowerCase() !== email;
          if (emailChanged) {
            const duplicateEmail = await tx.query(`SELECT id FROM users WHERE id IS DISTINCT FROM $1 AND LOWER(email)=LOWER($2)
              UNION ALL SELECT id FROM teacher_profiles WHERE user_id IS DISTINCT FROM $1
                AND NOT (school_id=$3 AND id=$4) AND LOWER(email)=LOWER($2)
              UNION ALL SELECT id FROM pending_staff WHERE NOT (school_id=$3 AND id=$4) AND LOWER(email)=LOWER($2)
              LIMIT 1`, [userId, email, schoolId, id]);
            if (duplicateEmail.rows.length) throw new ManagementError(409, 'E-posta başka bir hesaba bağlı.');
          }
          if (userId) {
            const identity = await tx.query<{ phone: string; email: string | null; full_name: string }>(
              "SELECT phone,email,concat_ws(' ',first_name,last_name) AS full_name FROM users WHERE id=$1 FOR UPDATE", [userId]);
            const otherSchools = await tx.query(
              'SELECT id FROM school_memberships WHERE user_id=$1 AND school_id<>$2 LIMIT 1', [userId, schoolId]);
            if (otherSchools.rows.length && (identity.rows[0]?.phone !== phone || (identity.rows[0]?.email || '').toLowerCase() !== email || normalizePersonName(identity.rows[0]?.full_name || '') !== fullName)) {
              throw new ManagementError(409, 'Birden fazla okula bağlı hesabın kimlik bilgileri bu ekrandan değiştirilemez.');
            }
            const duplicate = await tx.query(
              `SELECT id FROM users WHERE id<>$1 AND regexp_replace(phone,'[^0-9]','','g') IN ($2,$3,$4) LIMIT 1`,
              [userId, ...getTurkishPhoneLookupDigits(phone)!]);
            if (duplicate.rows.length) throw new ManagementError(409, 'Telefon başka bir hesaba bağlı.');
            const otherRoles = await tx.query(
              'SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role<>$3 LIMIT 1', [schoolId, userId, kind]);
            if (otherRoles.rows.length && (phoneChanged || fullName !== normalizePersonName(oldName))) {
              throw new ManagementError(409, 'Birden fazla rolü olan hesabın kimlik bilgileri bu ekrandan değiştirilemez.');
            }
            await tx.query(`UPDATE users SET first_name=$2,last_name=$3,phone=$4::varchar(20),
              email=CASE WHEN $6::boolean THEN $5::varchar(150) ELSE email END,
              auth_version=auth_version + CASE WHEN phone<>$4::varchar(20)
                OR ($6::boolean AND COALESCE(email,'')<>$5::varchar(150)) THEN 1 ELSE 0 END,
              updated_at=NOW() WHERE id=$1`, [userId, firstName, lastName, phone, email, emailProvided]);
          } else if (phoneChanged) {
            const duplicate = await tx.query(
              `SELECT id FROM users WHERE regexp_replace(phone,'[^0-9]','','g') IN ($1,$2,$3) LIMIT 1`,
              getTurkishPhoneLookupDigits(phone)!);
            if (duplicate.rows.length) throw new ManagementError(409, 'Telefon başka bir hesaba bağlı.');
          }
          if (kind === 'teacher') {
            if (phoneChanged) {
              const phoneDigits = getTurkishPhoneLookupDigits(phone)!;
              const duplicateAcrossSchools = await tx.query(`SELECT id FROM teacher_profiles WHERE school_id<>$1 AND id<>$2
                AND regexp_replace(phone,'[^0-9]','','g') IN ($3,$4,$5) LIMIT 1`, [schoolId, id, ...phoneDigits]);
              const activeTeacherAccount = await tx.query(`SELECT sm.user_id FROM school_memberships sm
                JOIN users u ON u.id=sm.user_id
                WHERE sm.role='teacher' AND sm.status='active' AND sm.school_id<>$1
                  AND sm.user_id IS DISTINCT FROM $2
                  AND regexp_replace(u.phone,'[^0-9]','','g') IN ($3,$4,$5) LIMIT 1`, [schoolId, userId, ...phoneDigits]);
              if (duplicateAcrossSchools.rows.length || activeTeacherAccount.rows.length) {
                throw new ManagementError(409, 'Bu öğretmen başka bir okulda kayıtlı.');
              }
              const duplicate = await tx.query(`SELECT id FROM teacher_profiles WHERE school_id=$1 AND id<>$2
                AND regexp_replace(phone,'[^0-9]','','g') IN ($3,$4,$5) LIMIT 1`, [schoolId, id, ...phoneDigits]);
              if (duplicate.rows.length) throw new ManagementError(409, 'Bu telefon okulda başka bir öğretmene bağlı.');
            }
            await tx.query(`UPDATE teacher_profiles SET first_name=$3,last_name=$4,phone=$5,branch=$6,
              email=CASE WHEN $8::boolean THEN $7::varchar(150) ELSE email END,updated_at=NOW()
              WHERE school_id=$1 AND id=$2`, [schoolId, id, firstName, lastName, phone, branch, email, emailProvided]);
            if (userId) await tx.query(`UPDATE school_memberships SET branch=$3,updated_at=NOW()
              WHERE school_id=$1 AND user_id=$2 AND role='teacher'`, [schoolId, userId, branch]);
          }
          if (pendingSecurity) await tx.query(`UPDATE pending_staff SET first_name=$3,last_name=$4,phone=$5,
            email=CASE WHEN $7::boolean THEN $6::varchar(150) ELSE email END,updated_at=NOW()
            WHERE school_id=$1 AND id=$2 AND role='security'`, [schoolId, id, firstName, lastName, phone, email, emailProvided]);
          if (kind === 'parent') {
            const digits = getTurkishPhoneLookupDigits(oldPhone);
            if (digits) await tx.query(`UPDATE school_roster SET parent_name=$2,parent_phone=$3,updated_at=NOW()
              WHERE school_id=$1 AND regexp_replace(parent_phone,'[^0-9]','','g') IN ($4,$5,$6)`,
              [schoolId, fullName, phone, ...digits]);
          }
          if (phoneChanged || emailChanged) await revokeCodes(tx, schoolId, oldPhone, kind);
        }
      }
      await auditLogRepository.createAuditLog({
        schoolId, action: kind === 'teacher' && removing ? 'teacher_deleted' : `${kind}.${removing ? 'removed' : 'updated'}`,
        actorName: 'Okul yönetimi', actorUserId: req.user!.id, details: JSON.stringify({ id, ...(kind === 'teacher' && removing
          ? { deletedAppointments: cancelledAppointments, reason: 'Öğretmen ve ilişkili kayıtlar silindi.' } : {}) }),
      }, tx);
    });
    return res.json({ success: true });
  } catch (cause) {
    if (cause instanceof ManagementError) return res.status(cause.status).json({ error: cause.message });
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505') {
      return res.status(409).json({ error: 'Bu bilgilerle başka bir kayıt mevcut.' });
    }
    return res.status(500).json({ error: 'İşlem tamamlanamadı.' });
  }
}
