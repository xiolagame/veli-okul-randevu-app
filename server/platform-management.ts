import { Router } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { authMiddleware, AuthenticatedRequest, isPlatformAdmin } from './auth';
import { checkDatabaseHealth, getDb } from './database/postgres';
import { auditLogRepository, invitationRepository, membershipRepository, schoolRepository, userRepository } from './repositories';
import { generateStaffCode, hashActivationCode } from './activation-codes';
import { normalizeUserPhoneInput } from '../src/utils/phone';
import { normalizePersonName } from '../src/utils/person-name';
import { normalizeSchoolCodeInput } from '../src/utils/school-code';
import { deliverSchoolAdminCode } from './school-admin-email';
import { generateSchoolLicenseCode } from './school-license';
import { isValidLicenseCode, normalizeLicenseCode } from '../src/utils/license-code';
import { platformRequestRouter } from './platform-requests';

function platformTargetAllows(method: string, path: string): boolean {
  if (/^\/schools\/[^/]+\/management\/(parents)$/.test(path) && method === 'GET') return true;
  if (/^\/schools\/[^/]+\/management\/admins(?:\/[^/]+(?:\/resend)?)?$/.test(path) && ['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) return true;
  if (/^\/schools\/[^/]+\/management\/students\/[^/]+\/removal$/.test(path) && ['GET', 'DELETE'].includes(method)) return true;
  if (/^\/schools\/[^/]+\/management\/audit-logs$/.test(path) && method === 'DELETE') return true;
  if (/^\/schools\/[^/]+\/management\/(teacher|parent|security|student|roster)\/[^/]+$/.test(path) && ['PATCH', 'DELETE'].includes(method)) return true;
  if (/^\/schools\/[^/]+\/(info|teachers|users|students|availability|appointments|audit-logs|settings|roster)$/.test(path) && method === 'GET') return true;
  if (/^\/schools\/[^/]+\/(teachers|staff|auth-codes)$/.test(path) && method === 'POST') return true;
  if (/^\/schools\/[^/]+\/staff\/(teacher|security)\/[^/]+\/resend-activation$/.test(path) && method === 'POST') return true;
  if (/^\/schools\/[^/]+\/roster\/bulk-upload$/.test(path) && method === 'POST') return true;
  if (/^\/schools\/[^/]+\/settings$/.test(path) && method === 'PUT') return true;
  if (/^\/schools\/[^/]+\/security\/test-isolation$/.test(path) && method === 'GET') return true;
  return false;
}

export const platformTargetContextGuard = [authMiddleware, async (req: AuthenticatedRequest, res: import('express').Response, next: import('express').NextFunction) => {
  if (!isPlatformAdmin(req.user?.id)) return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
  const targetSchoolId = req.params.targetSchoolId;
  const routeSchoolId = /^\/schools\/([^/?]+)(?:\/|$)/.exec(req.url)?.[1];
  if (!targetSchoolId || !routeSchoolId || decodeURIComponent(routeSchoolId) !== targetSchoolId) return res.status(403).json({ error: 'Okul bağlamı doğrulanamadı.' });
  const headerSchoolId = req.headers['x-school-id'];
  if (headerSchoolId && headerSchoolId !== targetSchoolId) return res.status(400).json({ error: 'Okul bağlamı uyuşmuyor.' });
  if (!platformTargetAllows(req.method, req.url.split('?')[0])) return res.status(403).json({ error: 'Bu platform işlemi kullanılamıyor.' });
  if (!await schoolRepository.getById(targetSchoolId)) return res.status(404).json({ error: 'Aktif okul bulunamadı.' });
  req.platformTargetSchoolId = targetSchoolId;
  next();
}];

export const platformManagementRouter = Router();
platformManagementRouter.use(authMiddleware);
platformManagementRouter.get('/capabilities', (req: AuthenticatedRequest, res) => {
  res.json({ manageSchools: isPlatformAdmin(req.user?.id) });
});
platformManagementRouter.use((req: AuthenticatedRequest, res, next) => {
  if (!isPlatformAdmin(req.user?.id)) return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
  next();
});
platformManagementRouter.use('/requests', platformRequestRouter);

platformManagementRouter.get('/schools', async (_req, res) => {
  try {
    const db = await getDb();
    const result = await db.query(`SELECT s.id,s.name,s.code,s.city,s.district,s.disabled_at AS "disabledAt",
      sl.license_code AS "licenseCode",COALESCE(sl.status,'legacy') AS "licenseStatus",sl.expires_at AS "licenseExpiresAt",
      CASE WHEN active_admin.user_id IS NOT NULL THEN 'active'
           WHEN pending_admin.user_id IS NOT NULL THEN 'pending' ELSE 'unassigned' END AS "adminStatus",
      COALESCE(active_admin.full_name,pending_admin.full_name) AS "adminName"
      FROM schools s
      LEFT JOIN school_licenses sl ON sl.school_id=s.id
      LEFT JOIN LATERAL (
        SELECT u.id AS user_id,concat_ws(' ',u.first_name,u.last_name) AS full_name
        FROM school_memberships sm JOIN users u ON u.id=sm.user_id
        WHERE sm.school_id=s.id AND sm.role='admin' AND sm.status='active'
          AND NOT (u.id = ANY($1::text[]))
        ORDER BY sm.joined_at,sm.id LIMIT 1
      ) active_admin ON TRUE
      LEFT JOIN LATERAL (
        SELECT u.id AS user_id,concat_ws(' ',u.first_name,u.last_name) AS full_name
        FROM invitations i JOIN users u ON u.id=i.target_user_id
        WHERE i.school_id=s.id AND i.purpose='school_admin_activation'
          AND i.is_active=TRUE AND i.expires_at>NOW()
          AND i.consumed_at IS NULL AND i.revoked_at IS NULL
        ORDER BY i.created_at DESC,i.id DESC LIMIT 1
      ) pending_admin ON active_admin.user_id IS NULL
      ORDER BY s.name,s.id`, [(process.env.PLATFORM_ADMIN_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)]);
    res.json({ schools: result.rows.map((school) => ({ ...school, adminName: school.adminName ? normalizePersonName(school.adminName) : null })) });
  } catch { res.status(500).json({ error: 'Okullar yüklenemedi.' }); }
});

platformManagementRouter.get('/security', async (_req, res) => {
  const health = await checkDatabaseHealth();
  res.json({
    database: health.status === 'connected' ? 'connected' : 'unavailable',
    authConfiguration: (process.env.JWT_SECRET?.trim().length || 0) >= 32 ? 'ready' : 'incomplete',
    codeSigning: (process.env.AUTH_CODE_SECRET?.trim().length || 0) >= 32 ? 'ready' : 'incomplete',
  });
});

platformManagementRouter.get('/audit-logs', async (_req, res) => {
  try {
    const db = await getDb();
    const result = await db.query<{ id: string; schoolName: string; actorName: string; action: string; details: string; timestamp: string }>(
      `SELECT a.id,s.name AS "schoolName",a.actor_name AS "actorName",a.action,a.details,a.timestamp
       FROM audit_logs a LEFT JOIN schools s ON s.id=a.school_id ORDER BY a.created_at DESC,a.id LIMIT 100`);
    res.json({ logs: result.rows });
  } catch { res.status(500).json({ error: 'Platform işlem günlüğü yüklenemedi.' }); }
});

platformManagementRouter.delete('/audit-logs', async (req: AuthenticatedRequest, res) => {
  if (req.body?.confirmation !== 'TEMİZLE') return res.status(400).json({ error: 'Günlüğü temizlemek için TEMİZLE yazın.' });
  try {
    const db = await getDb();
    const deletedCount = await db.transaction(async (tx) => {
      await tx.query('LOCK TABLE audit_logs IN SHARE ROW EXCLUSIVE MODE');
      const deleted = await tx.query("DELETE FROM audit_logs WHERE audit_scope='PLATFORM'");
      const count = deleted.rowCount ?? 0;
      await tx.query(
        `INSERT INTO audit_logs(id,school_id,timestamp,action,actor_name,details,audit_scope)
         VALUES($1,NULL,$2,'platform.audit_logs_cleared',$3,$4,'PLATFORM')`,
        [`log-${randomUUID()}`, new Date().toISOString(), `${req.user!.firstName} ${req.user!.lastName} (Platform Yönetimi)`.trim(),
          JSON.stringify({ deletedCount: count, actorUserId: req.user!.id })],
      );
      return count;
    });
    return res.json({ success: true, deletedCount });
  } catch { return res.status(500).json({ error: 'Platform işlem günlüğü temizlenemedi.' }); }
});

platformManagementRouter.post('/schools', async (req: AuthenticatedRequest, res) => {
  const { name, city, district } = req.body;
  let code = typeof req.body.code === 'string' ? normalizeSchoolCodeInput(req.body.code.trim()) : '';
  const automatic = !code;
  let licenseCode = normalizeLicenseCode(req.body.licenseCode);
  const automaticLicense = !licenseCode;
  if ((req.body.code !== undefined && typeof req.body.code !== 'string') || typeof name !== 'string' || !name.trim() || name.trim().length > 255 ||
      (!automatic && !/^[A-Z0-9_-]{3,50}$/.test(code)) ||
      (req.body.licenseCode !== undefined && typeof req.body.licenseCode !== 'string') ||
      (!automaticLicense && !isValidLicenseCode(licenseCode)) ||
      typeof city !== 'string' || !city.trim() || city.trim().length > 100 ||
      typeof district !== 'string' || !district.trim() || district.trim().length > 100) {
    return res.status(400).json({ error: 'Okul adı, okul kodu, lisans kodu, il ve ilçeyi kontrol edin.' });
  }
  try {
    const db = await getDb();
    const school = await db.transaction(async (tx) => {
      await tx.query('LOCK TABLE schools IN SHARE ROW EXCLUSIVE MODE');
      await tx.query('LOCK TABLE school_licenses IN SHARE ROW EXCLUSIVE MODE');
      if (automatic) {
        do { code = randomBytes(5).toString('hex').toUpperCase(); }
        while ((await tx.query('SELECT id FROM schools WHERE UPPER(code)=$1', [code])).rows.length);
      }
      const duplicate = await tx.query('SELECT id FROM schools WHERE UPPER(code)=$1', [code]);
      if (duplicate.rows.length) return null;
      if (automaticLicense) {
        do { licenseCode = generateSchoolLicenseCode(); }
        while ((await tx.query('SELECT id FROM school_licenses WHERE license_code=$1', [licenseCode])).rows.length);
      } else if ((await tx.query('SELECT id FROM school_licenses WHERE license_code=$1', [licenseCode])).rows.length) {
        throw new Error('LICENSE_CODE_DUPLICATE');
      }
      const id = 'sch-' + randomUUID();
      const settings = { schoolName: name.trim(), appName: 'Veli Randevu', defaultSlotMinutes: 15,
        minSlotMinutes: 10, maxBookingDaysAhead: 30, allowParentCancel: true };
      const result = await tx.query(`INSERT INTO schools(id,name,code,city,district,settings)
        VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id,name,code,city,district,disabled_at AS "disabledAt"`,
        [id,name.trim(),code,city.trim(),district.trim(),JSON.stringify(settings)]);
      await tx.query(`INSERT INTO school_licenses(id,school_id,license_code,status,activated_at)
        VALUES($1,$2,$3,'active',NOW())`, [`lic-${randomUUID()}`, id, licenseCode]);
      await auditLogRepository.createAuditLog({ schoolId: id, action: 'school.created', actorName: 'Platform yönetimi',
        actorUserId: req.user!.id, details: JSON.stringify({ actorId: req.user!.id }), auditScope: 'PLATFORM' }, tx);
      return { ...result.rows[0], licenseCode, licenseStatus: 'active', licenseExpiresAt: null };
    });
    if (!school) return res.status(409).json({ error: 'Bu okul kodu zaten kullanılıyor.' });
    res.status(201).json({ school });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'LICENSE_CODE_DUPLICATE') return res.status(409).json({ error: 'Bu lisans kodu başka bir okulda kullanılıyor.' });
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505') return res.status(409).json({ error: 'Okul veya lisans kodu zaten kullanılıyor.' });
    res.status(500).json({ error: 'Okul oluşturulamadı.' });
  }
});

platformManagementRouter.post('/schools/:id/admin-invitation', async (req: AuthenticatedRequest, res) => {
  const schoolId = String(req.params.id);
  const fullName = typeof req.body?.fullName === 'string' ? normalizePersonName(req.body.fullName) : '';
  const phone = normalizeUserPhoneInput(req.body?.phone);
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (fullName.split(' ').length < 2 || fullName.length > 150 || !phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) {
    return res.status(400).json({ error: 'Okul yöneticisinin adını, telefonunu ve e-posta adresini kontrol edin.' });
  }

  const [firstName, ...lastName] = fullName.split(' ');
  const code = generateStaffCode();
  let invitation: { schoolName: string; schoolCode: string; licenseCode?: string; email: string; fullName: string };
  try {
    const db = await getDb();
    invitation = await db.transaction(async (tx) => {
      const school = await tx.query<{ name: string; code: string; license_code: string | null }>(`SELECT s.name,s.code,sl.license_code
        FROM schools s LEFT JOIN school_licenses sl ON sl.school_id=s.id
        WHERE s.id=$1 AND s.disabled_at IS NULL FOR UPDATE OF s`, [schoolId]);
      if (!school.rows[0]) throw new Error('SCHOOL_NOT_AVAILABLE');
      await tx.query('LOCK TABLE school_memberships IN SHARE ROW EXCLUSIVE MODE');
      await tx.query('LOCK TABLE invitations IN SHARE ROW EXCLUSIVE MODE');
      const existingUser = await userRepository.getByPhone(phone, tx);
      if (existingUser) {
        const userState = await tx.query<{ email: string | null; password_hash: string | null; first_name: string | null; last_name: string | null; is_phone_verified: boolean }>(
          'SELECT email,password_hash,first_name,last_name,is_phone_verified FROM users WHERE id=$1 FOR UPDATE', [existingUser.id]);
        const memberships = await tx.query('SELECT school_id,role,status FROM school_memberships WHERE user_id=$1 LIMIT 1', [existingUser.id]);
        const existing = userState.rows[0];
        const existingName = `${existing?.first_name || ''} ${existing?.last_name || ''}`.trim().toLocaleLowerCase('tr-TR');
        if (existing?.password_hash || existing?.is_phone_verified || memberships.rows.length ||
            (existing?.email && existing.email.trim().toLowerCase() !== email) ||
            (existingName && existingName !== fullName.toLocaleLowerCase('tr-TR'))) throw new Error('ADMIN_IDENTITY_IN_USE');
        const pending = await tx.query(`SELECT id FROM invitations WHERE target_user_id=$1 AND purpose='school_admin_activation'
          AND is_active=TRUE AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() LIMIT 1`, [existingUser.id]);
        if (pending.rows.length) throw new Error('ADMIN_INVITATION_PENDING');
        await tx.query('UPDATE users SET first_name=$2,last_name=$3,email=$4,updated_at=NOW() WHERE id=$1', [existingUser.id, firstName, lastName.join(' '), email]);
      } else {
        await tx.query('INSERT INTO users(id,phone,first_name,last_name,email,is_phone_verified) VALUES($1,$2,$3,$4,$5,FALSE)',
          [`usr-${randomUUID()}`, phone, firstName, lastName.join(' '), email]);
      }
      const candidate = await userRepository.getByPhone(phone, tx);
      if (!candidate) throw new Error('ADMIN_IDENTITY_UNAVAILABLE');
      const otherPending = await tx.query(`SELECT id FROM invitations WHERE target_user_id=$1 AND school_id<>$2
        AND purpose='school_admin_activation' AND is_active=TRUE AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() LIMIT 1`, [candidate.id, schoolId]);
      if (otherPending.rows.length) throw new Error('ADMIN_IDENTITY_IN_USE');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await invitationRepository.createAuthCode({ schoolId, targetPhone: phone, targetUserId: candidate.id, targetRole: 'admin',
        purpose: 'school_admin_activation', codeHash: hashActivationCode(code), createdBy: req.user!.id, expiresAt, token: randomUUID() }, tx);
      await auditLogRepository.createAuditLog({ schoolId, action: 'school_admin_invited', actorName: 'Platform yönetimi',
        actorUserId: req.user!.id, details: `Okul yöneticisi ${candidate.id} için aktivasyon daveti oluşturuldu.`, auditScope: 'PLATFORM' }, tx);
      return { schoolName: school.rows[0].name, schoolCode: school.rows[0].code,
        licenseCode: school.rows[0].license_code || undefined, email, fullName };
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'SCHOOL_NOT_AVAILABLE') return res.status(404).json({ error: 'Aktif okul bulunamadı.' });
    if (cause instanceof Error && cause.message === 'ADMIN_INVITATION_PENDING') return res.status(409).json({ error: 'Bu okul yöneticisi için zaten bir aktivasyon daveti bekliyor.' });
    if (cause instanceof Error && cause.message === 'ADMIN_IDENTITY_IN_USE') return res.status(409).json({ error: 'Bu hesap başka bir okul veya kullanıcı rolüyle ilişkilendirilmiş. Farklı bir yönetici bilgisi kullanın.' });
    return res.status(500).json({ error: 'Okul yöneticisi daveti oluşturulamadı.' });
  }
  const emailSent = await deliverSchoolAdminCode(invitation.email, invitation.schoolName, invitation.schoolCode, invitation.fullName, code, false, invitation.licenseCode);
  return res.status(201).json({ success: true, emailSent, message: emailSent ? 'Aktivasyon e-postası gönderildi.' : 'Yönetici daveti kaydedildi ancak e-posta gönderilemedi. Okul listesinden yeniden gönderebilirsiniz.' });
});

platformManagementRouter.post('/schools/:id/admin-invitation/resend', async (req: AuthenticatedRequest, res) => {
  const schoolId = String(req.params.id);
  const code = generateStaffCode();
  try {
    const db = await getDb();
    const invitation = await db.transaction(async (tx) => {
      const school = await tx.query<{ name: string; code: string; license_code: string | null }>(`SELECT s.name,s.code,sl.license_code
        FROM schools s LEFT JOIN school_licenses sl ON sl.school_id=s.id
        WHERE s.id=$1 AND s.disabled_at IS NULL FOR UPDATE OF s`, [schoolId]);
      if (!school.rows[0]) throw new Error('SCHOOL_NOT_AVAILABLE');
      await tx.query('LOCK TABLE school_memberships IN SHARE ROW EXCLUSIVE MODE');
      await tx.query('LOCK TABLE invitations IN SHARE ROW EXCLUSIVE MODE');
      const pending = await tx.query<{ target_user_id: string; target_phone: string; created_at: string }>(`SELECT target_user_id,target_phone,created_at FROM invitations
        WHERE school_id=$1 AND purpose='school_admin_activation' AND target_user_id IS NOT NULL
          AND consumed_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`, [schoolId]);
      const target = pending.rows[0];
      if (!target) throw new Error('ADMIN_INVITATION_NOT_FOUND');
      if (new Date(target.created_at).getTime() > Date.now() - 60_000) throw new Error('ADMIN_INVITATION_COOLDOWN');
      const user = await tx.query<{ first_name: string; last_name: string; email: string | null }>('SELECT first_name,last_name,email FROM users WHERE id=$1 AND phone=$2 FOR UPDATE', [target.target_user_id, target.target_phone]);
      if (!user.rows[0]?.email) throw new Error('ADMIN_INVITATION_NOT_FOUND');
      const activeMembership = await tx.query("SELECT id FROM school_memberships WHERE user_id=$1 AND role='admin' AND status='active' LIMIT 1", [target.target_user_id]);
      if (activeMembership.rows.length) throw new Error('ADMIN_ALREADY_ACTIVE');
      await invitationRepository.createAuthCode({ schoolId, targetPhone: target.target_phone, targetUserId: target.target_user_id, targetRole: 'admin',
        purpose: 'school_admin_activation', codeHash: hashActivationCode(code), createdBy: req.user!.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), token: randomUUID() }, tx);
      await auditLogRepository.createAuditLog({ schoolId, action: 'school_admin_activation_resent', actorName: 'Platform yönetimi',
        actorUserId: req.user!.id, details: `Okul yöneticisi ${target.target_user_id} için aktivasyon daveti yeniden oluşturuldu.`, auditScope: 'PLATFORM' }, tx);
      return { schoolName: school.rows[0].name, schoolCode: school.rows[0].code, email: user.rows[0].email,
        licenseCode: school.rows[0].license_code || undefined,
        fullName: `${user.rows[0].first_name} ${user.rows[0].last_name}`.trim() };
    });
    const emailSent = await deliverSchoolAdminCode(invitation.email, invitation.schoolName, invitation.schoolCode, invitation.fullName, code, false, invitation.licenseCode);
    return res.json({ success: true, emailSent, message: emailSent ? 'Aktivasyon e-postası yeniden gönderildi.' : 'Yeni kod kaydedildi ancak e-posta gönderilemedi. Biraz bekleyip yeniden deneyin.' });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'SCHOOL_NOT_AVAILABLE') return res.status(404).json({ error: 'Aktif okul bulunamadı.' });
    if (cause instanceof Error && cause.message === 'ADMIN_INVITATION_COOLDOWN') return res.status(429).json({ error: 'Yeni e-posta göndermeden önce kısa süre bekleyin.' });
    if (cause instanceof Error && cause.message === 'ADMIN_ALREADY_ACTIVE') return res.status(409).json({ error: 'Bu okulda yönetici hesabı zaten etkin.' });
    return res.status(404).json({ error: 'Bekleyen yönetici daveti bulunamadı.' });
  }
});

platformManagementRouter.patch('/schools/:id/status', async (req: AuthenticatedRequest, res) => {
  if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Geçersiz durum.' });
  const id = String(req.params.id);
  const active: boolean = req.body.active;
  try {
    const db = await getDb();
    const found = await db.transaction(async (tx) => {
      const existing = await tx.query<{ disabled_at: string | null }>('SELECT disabled_at FROM schools WHERE id=$1 FOR UPDATE', [id]);
      if (!existing.rows[0]) return false;
      if (active === (existing.rows[0].disabled_at === null)) return true;
      await tx.query('UPDATE schools SET disabled_at=CASE WHEN $2 THEN NULL ELSE NOW() END,updated_at=NOW() WHERE id=$1', [id,active]);
      await auditLogRepository.createAuditLog({ schoolId: id, action: active ? 'school.enabled' : 'school.disabled',
        actorName: 'Platform yönetimi', actorUserId: req.user!.id, details: JSON.stringify({ actorId: req.user!.id, reason: 'Okul erişim durumu değiştirildi; kayıtlar korunur.' }), auditScope: 'PLATFORM' }, tx);
      return true;
    });
    if (!found) return res.status(404).json({ error: 'Okul bulunamadı.' });
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Okul durumu değiştirilemedi.' }); }
});

platformManagementRouter.delete('/schools/:id', async (req: AuthenticatedRequest, res) => {
  const schoolId = String(req.params.id);
  try {
    const db = await getDb();
    const result = await db.transaction(async (tx) => {
      const school = await tx.query<{ disabled_at: string | null }>('SELECT disabled_at FROM schools WHERE id=$1 FOR UPDATE', [schoolId]);
      if (!school.rows[0]) return 'missing' as const;
      if (!school.rows[0].disabled_at) return 'active' as const;
      const candidates = await tx.query<{ id: string }>(`SELECT DISTINCT id FROM (
        SELECT user_id AS id FROM school_memberships WHERE school_id=$1
        UNION SELECT parent_user_id AS id FROM student_parent_relations WHERE school_id=$1
        UNION SELECT user_id AS id FROM teacher_profiles WHERE school_id=$1
        UNION SELECT parent_id AS id FROM appointments WHERE school_id=$1
        UNION SELECT approved_by AS id FROM appointments WHERE school_id=$1
        UNION SELECT checked_in_by AS id FROM appointments WHERE school_id=$1
        UNION SELECT user_id AS id FROM notifications WHERE school_id=$1
        UNION SELECT target_user_id AS id FROM invitations WHERE school_id=$1
        UNION SELECT created_by AS id FROM invitations WHERE school_id=$1
        UNION SELECT created_by AS id FROM pending_staff WHERE school_id=$1
      ) scoped_users WHERE id IS NOT NULL`, [schoolId]);
      const candidateUserIds = candidates.rows.map((candidate) => candidate.id);
      if (candidateUserIds.length) {
        await tx.query('SELECT id FROM users WHERE id=ANY($1::text[]) FOR UPDATE', [candidateUserIds]);
      }
      const deleted = await tx.query('DELETE FROM schools WHERE id=$1 AND disabled_at IS NOT NULL RETURNING id', [schoolId]);
      if (deleted.rows.length && candidateUserIds.length) {
        const platformAdminIds = (process.env.PLATFORM_ADMIN_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
        await tx.query(`DELETE FROM users u
          WHERE u.id=ANY($1::text[])
            AND NOT (u.id=ANY($2::text[]))
            AND NOT EXISTS (SELECT 1 FROM school_memberships sm WHERE sm.user_id=u.id)
            AND NOT EXISTS (SELECT 1 FROM student_parent_relations spr WHERE spr.parent_user_id=u.id)
            AND NOT EXISTS (SELECT 1 FROM teacher_profiles tp WHERE tp.user_id=u.id)
            AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.parent_id=u.id OR a.approved_by=u.id OR a.checked_in_by=u.id)
            AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id=u.id)
            AND NOT EXISTS (SELECT 1 FROM invitations i WHERE i.target_user_id=u.id OR i.created_by=u.id)
            AND NOT EXISTS (SELECT 1 FROM pending_staff ps WHERE ps.created_by=u.id)
            AND NOT EXISTS (SELECT 1 FROM school_roster sr
              WHERE RIGHT(regexp_replace(sr.parent_phone,'[^0-9]','','g'),10)=RIGHT(regexp_replace(u.phone,'[^0-9]','','g'),10))
            AND NOT EXISTS (SELECT 1 FROM teacher_profiles tp
              WHERE RIGHT(regexp_replace(tp.phone,'[^0-9]','','g'),10)=RIGHT(regexp_replace(u.phone,'[^0-9]','','g'),10))
            AND NOT EXISTS (SELECT 1 FROM appointments a
              WHERE RIGHT(regexp_replace(a.parent_phone,'[^0-9]','','g'),10)=RIGHT(regexp_replace(u.phone,'[^0-9]','','g'),10))
            AND NOT EXISTS (SELECT 1 FROM invitations i
              WHERE RIGHT(regexp_replace(i.target_phone,'[^0-9]','','g'),10)=RIGHT(regexp_replace(u.phone,'[^0-9]','','g'),10))
            AND NOT EXISTS (SELECT 1 FROM pending_staff ps
              WHERE RIGHT(regexp_replace(ps.phone,'[^0-9]','','g'),10)=RIGHT(regexp_replace(u.phone,'[^0-9]','','g'),10))`,
          [candidateUserIds, platformAdminIds]);
      }
      return deleted.rows.length ? 'deleted' as const : 'missing' as const;
    });
    if (result === 'missing') return res.status(404).json({ error: 'Okul bulunamadı.' });
    if (result === 'active') return res.status(409).json({ error: 'Aktif okul kalıcı olarak silinemez. Önce devre dışı bırakın.' });
    return res.json({ success: true, message: 'Okul ve okula bağlı veriler kalıcı olarak silindi.' });
  } catch {
    return res.status(500).json({ error: 'Okul kalıcı olarak silinemedi.' });
  }
});

platformManagementRouter.patch('/schools/:id/code', async (req: AuthenticatedRequest, res) => {
  const code = typeof req.body?.code === 'string' ? normalizeSchoolCodeInput(req.body.code.trim()) : '';
  if (!/^[A-Z0-9_-]{3,50}$/.test(code)) return res.status(400).json({ error: 'Okul kodu 3–50 harf, rakam, tire veya alt çizgiden oluşmalıdır.' });
  const schoolId = String(req.params.id);
  try {
    const db = await getDb();
    const result = await db.transaction(async (tx) => {
      await tx.query('LOCK TABLE schools IN SHARE ROW EXCLUSIVE MODE');
      const current = await tx.query<{ code: string }>('SELECT code FROM schools WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [schoolId]);
      if (!current.rows[0]) return 'missing' as const;
      const duplicate = await tx.query('SELECT id FROM schools WHERE UPPER(code)=$1 AND id<>$2 LIMIT 1', [code, schoolId]);
      if (duplicate.rows.length) return 'duplicate' as const;
      if (current.rows[0].code.toUpperCase() === code) return 'unchanged' as const;
      await tx.query('UPDATE schools SET code=$2,updated_at=NOW() WHERE id=$1', [schoolId, code]);
      await auditLogRepository.createAuditLog({ schoolId, action: 'school.code_changed', actorName: `${req.user!.firstName} ${req.user!.lastName} (Platform Yönetimi)`.trim(), actorUserId: req.user!.id, details: JSON.stringify({ oldCode: current.rows[0].code, newCode: code }), auditScope: 'PLATFORM' }, tx);
      return 'updated' as const;
    });
    if (result === 'missing') return res.status(404).json({ error: 'Aktif okul bulunamadı.' });
    if (result === 'duplicate') return res.status(409).json({ error: 'Bu okul kodu başka bir okul tarafından kullanılıyor.' });
    return res.json({ success: true, code });
  } catch { return res.status(500).json({ error: 'Okul kodu değiştirilemedi.' }); }
});
