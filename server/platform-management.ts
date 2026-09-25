import { Router } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { authMiddleware, AuthenticatedRequest } from './auth';
import { getDb } from './database/postgres';
import { auditLogRepository, membershipRepository } from './repositories';

function isPlatformAdmin(userId: string | undefined): boolean {
  return !!userId && (process.env.PLATFORM_ADMIN_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean).includes(userId);
}

export const platformManagementRouter = Router();
platformManagementRouter.use(authMiddleware);
platformManagementRouter.get('/capabilities', (req: AuthenticatedRequest, res) => {
  res.json({ manageSchools: isPlatformAdmin(req.user?.id) });
});
platformManagementRouter.use((req: AuthenticatedRequest, res, next) => {
  if (!isPlatformAdmin(req.user?.id)) return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
  next();
});

platformManagementRouter.get('/schools', async (_req, res) => {
  try {
    const db = await getDb();
    const result = await db.query('SELECT id,name,code,city,district,disabled_at AS "disabledAt" FROM schools ORDER BY name,id');
    res.json({ schools: result.rows });
  } catch { res.status(500).json({ error: 'Okullar yüklenemedi.' }); }
});

platformManagementRouter.post('/schools', async (req: AuthenticatedRequest, res) => {
  const { name, city, district } = req.body;
  let code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  const automatic = !code;
  if ((req.body.code !== undefined && typeof req.body.code !== 'string') || typeof name !== 'string' || !name.trim() || name.trim().length > 255 ||
      (!automatic && !/^[A-Za-z0-9_-]{3,50}$/.test(code)) ||
      typeof city !== 'string' || !city.trim() || city.trim().length > 100 ||
      typeof district !== 'string' || !district.trim() || district.trim().length > 100) {
    return res.status(400).json({ error: 'Okul adı, kodu, il ve ilçeyi kontrol edin.' });
  }
  try {
    const db = await getDb();
    const school = await db.transaction(async (tx) => {
      await tx.query('LOCK TABLE schools IN SHARE ROW EXCLUSIVE MODE');
      if (automatic) {
        do { code = randomBytes(5).toString('hex').toUpperCase(); }
        while ((await tx.query('SELECT id FROM schools WHERE UPPER(code)=$1', [code])).rows.length);
      }
      const duplicate = await tx.query('SELECT id FROM schools WHERE UPPER(code)=$1', [code.toUpperCase()]);
      if (duplicate.rows.length) return null;
      const id = 'sch-' + randomUUID();
      const settings = { schoolName: name.trim(), appName: 'Veli Randevu', defaultSlotMinutes: 15,
        minSlotMinutes: 10, maxBookingDaysAhead: 30, allowParentCancel: true };
      const result = await tx.query(`INSERT INTO schools(id,name,code,city,district,settings)
        VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id,name,code,city,district,disabled_at AS "disabledAt"`,
        [id,name.trim(),code.toUpperCase(),city.trim(),district.trim(),JSON.stringify(settings)]);
      await membershipRepository.createOrActivate({ schoolId: id, userId: req.user!.id, role: 'admin' }, tx);
      await auditLogRepository.createAuditLog({ schoolId: id, action: 'school.created', actorName: 'Platform yönetimi',
        details: JSON.stringify({ actorId: req.user!.id }) }, tx);
      return result.rows[0];
    });
    if (!school) return res.status(409).json({ error: 'Bu okul kodu zaten kullanılıyor.' });
    res.status(201).json({ school });
  } catch { res.status(500).json({ error: 'Okul oluşturulamadı.' }); }
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
        actorName: 'Platform yönetimi', details: JSON.stringify({ actorId: req.user!.id, reason: 'Okul erişim durumu değiştirildi; kayıtlar korunur.' }) }, tx);
      return true;
    });
    if (!found) return res.status(404).json({ error: 'Okul bulunamadı.' });
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Okul durumu değiştirilemedi.' }); }
});
