import { Router } from 'express';
import { AuthenticatedRequest, canUsePlatformAuthority } from './auth';
import { getDb, TransactionClient } from './database/postgres';
import { hashSetupToken } from './activation-codes';
import { auditLogRepository } from './repositories';
import type { PlatformLicense, LicenseViewStatus } from '../src/types/licenses';

class LicenseError extends Error { constructor(public status: number, message: string) { super(message); } }
type Row = Omit<PlatformLicense, 'viewStatus' | 'remainingDays' | 'expired' | 'revision'>;
const source = `SELECT s.id AS "schoolId",s.name AS "schoolName",s.code AS "schoolCode",s.disabled_at::text AS "schoolDisabledAt",
  l.id AS "licenseId",l.license_code AS "licenseCode",l.status,l.activated_at::text AS "activatedAt",l.expires_at::text AS "expiresAt",
  to_char(l.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"
  FROM schools s LEFT JOIN school_licenses l ON l.school_id=s.id`;
function revision(row: Row) { return hashSetupToken(JSON.stringify([row.licenseId, row.status, row.activatedAt, row.expiresAt, row.updatedAt])); }
function present(row: Row, threshold: number, now: Date): PlatformLicense {
  const milliseconds = row.expiresAt ? new Date(row.expiresAt).getTime() - now.getTime() : null;
  const expired = milliseconds !== null && milliseconds <= 0;
  const viewStatus: LicenseViewStatus = !row.licenseId ? 'legacy' : row.status === 'suspended' ? 'suspended' : row.status === 'revoked' ? 'revoked' : expired ? 'expired' : milliseconds !== null && milliseconds <= threshold * 86400000 ? 'expiring' : 'active';
  return { ...row, activatedAt: row.activatedAt ? new Date(row.activatedAt).toISOString() : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null, revision: revision(row), viewStatus, expired,
    remainingDays: milliseconds === null ? null : Math.ceil(milliseconds / 86400000) };
}
const classification = `WITH licenses AS (${source}), classified AS (SELECT *, CASE WHEN "licenseId" IS NULL THEN 'legacy'
  WHEN status='suspended' THEN 'suspended' WHEN status='revoked' THEN 'revoked'
  WHEN "expiresAt"::timestamptz <= $1::timestamptz THEN 'expired'
  WHEN "expiresAt"::timestamptz <= $1::timestamptz + $2::int*interval '1 day' THEN 'expiring' ELSE 'active' END AS state FROM licenses)`;
export const platformLicenseRouter = Router();
// Mounted behind platformManagementRouter's verified JWT and platform-authority gate.
platformLicenseRouter.use((req: AuthenticatedRequest, res, next) => {
  if (!canUsePlatformAuthority(req.user)) return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
  next();
});
platformLicenseRouter.get('/', async (req, res) => {
  try {
    const threshold = Number(req.query.threshold ?? 30), page = Number(req.query.page ?? 0);
    const q = req.query.q ?? '', status = req.query.status ?? '', sort = req.query.sort ?? 'priority', problems = req.query.problems ?? 'false';
    if ((req.query.threshold !== undefined && typeof req.query.threshold !== 'string') || (req.query.page !== undefined && typeof req.query.page !== 'string') ||
      typeof status !== 'string' || typeof sort !== 'string' || typeof problems !== 'string' || ![7,15,30].includes(threshold) || !Number.isInteger(page) || page < 0 || page > 100000 || typeof q !== 'string' || q.length > 100 ||
      !['','active','expiring','expired','suspended','revoked','legacy'].includes(String(status)) || !['priority','asc','desc'].includes(String(sort)) || !['true','false'].includes(String(problems))) throw new LicenseError(400, 'Filtreleri kontrol edin.');
    const db = await getDb(), now = new Date();
    const where = `WHERE ($3='' OR position(lower($3::text) in lower("schoolName"))>0) AND ($4='' OR state=$4 OR ($4='active' AND state='expiring')) AND ($5::boolean=FALSE OR state NOT IN ('active'))`;
    const params = [now.toISOString(), threshold, q, status, problems === 'true'];
    const order = sort === 'priority' ? `CASE state WHEN 'expired' THEN 0 WHEN 'expiring' THEN 1 WHEN 'suspended' THEN 2 WHEN 'revoked' THEN 3 WHEN 'legacy' THEN 4 ELSE 5 END,"expiresAt"::timestamptz ASC NULLS LAST` : `"expiresAt"::timestamptz ${sort === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`;
    const [items, total, summary] = await Promise.all([
      db.query<Row>(classification + ` SELECT * FROM classified ${where} ORDER BY ${order},"schoolId" LIMIT 25 OFFSET $6`, [...params, page*25]),
      db.query<{ count: number }>(classification + ` SELECT count(*)::int AS count FROM classified ${where}`, params),
      db.query(classification + ` SELECT count(*)::int AS total,count(*) FILTER(WHERE state IN ('active','expiring'))::int AS active,
        count(*) FILTER(WHERE state='expiring')::int AS expiring,count(*) FILTER(WHERE "expiresAt"::timestamptz<=$1::timestamptz)::int AS expired,
        count(*) FILTER(WHERE state='suspended')::int AS suspended FROM classified`, params.slice(0,2)),
    ]);
    res.json({ items: items.rows.map(row => present(row, threshold, now)), total: total.rows[0].count, page, pageSize:25, summary: summary.rows[0] });
  } catch (error) { res.status(error instanceof LicenseError ? error.status : 500).json({ error: error instanceof LicenseError ? error.message : 'Lisans listesi alınamadı.' }); }
});
async function load(tx: TransactionClient, schoolId: string): Promise<Row> {
  const row = (await tx.query<Row>(source + ' WHERE s.id=$1', [schoolId])).rows[0];
  if (!row) throw new LicenseError(404, 'Okul bulunamadı.');
  return row;
}
platformLicenseRouter.patch('/:schoolId', async (req: AuthenticatedRequest, res) => {
  const schoolId = String(req.params.schoolId);
  try {
    const body = req.body;
    if (!body || Array.isArray(body) || Object.keys(body).some(key => !['action','expectedRevision','note','expiresAt','confirmedShortening'].includes(key)) ||
      !['expiry','suspend','resume'].includes(body.action) || typeof body.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedRevision) ||
      typeof body.note !== 'string' || body.note.length > 500 || (body.confirmedShortening !== undefined && typeof body.confirmedShortening !== 'boolean') ||
      (body.action !== 'expiry' && (body.expiresAt !== undefined || body.confirmedShortening !== undefined))) throw new LicenseError(400, 'İşlem bilgilerini kontrol edin.');
    if (body.action === 'suspend' && body.note.trim().length < 3) throw new LicenseError(400, 'Durdurma nedenini yazın.');
    const now = new Date();
    if (body.action === 'expiry' && (typeof body.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.expiresAt) || !Number.isFinite(Date.parse(body.expiresAt)) || new Date(body.expiresAt).toISOString() !== body.expiresAt || Date.parse(body.expiresAt) <= now.getTime() || Date.parse(body.expiresAt) > Date.parse('2200-01-01T00:00:00.000Z'))) throw new LicenseError(400, 'Gelecekte geçerli bir bitiş zamanı seçin.');
    const result = await (await getDb()).transaction(async tx => {
      if (!(await tx.query('SELECT id FROM schools WHERE id=$1 FOR UPDATE', [schoolId])).rows.length) throw new LicenseError(404, 'Okul bulunamadı.');
      await tx.query('SELECT id FROM school_licenses WHERE school_id=$1 FOR UPDATE', [schoolId]);
      const before = await load(tx, schoolId);
      if (!before.licenseId) throw new LicenseError(409, 'Bu okulda lisans kaydı yok. Mevcut legacy erişim politikası korunuyor.');
      if (revision(before) !== body.expectedRevision) throw new LicenseError(409, 'Lisans başka bir işlemde değişti. Listeyi yenileyip tekrar inceleyin.');
      if (body.action === 'expiry') {
        if (Date.parse(body.expiresAt) <= Date.now()) throw new LicenseError(400, 'Gelecekte geçerli bir bitiş zamanı seçin.');
        if ((!before.expiresAt || Date.parse(body.expiresAt) < Date.parse(before.expiresAt)) && body.confirmedShortening !== true) throw new LicenseError(400, 'Lisans süresinin kısalmasını ayrıca onaylayın.');
        await tx.query('UPDATE school_licenses SET expires_at=$2::timestamptz,updated_at=clock_timestamp() WHERE school_id=$1', [schoolId, body.expiresAt]);
      } else {
        if (body.action === 'suspend' && before.status !== 'active') throw new LicenseError(409, 'Yalnız aktif lisans durdurulabilir.');
        if (body.action === 'resume' && (before.status !== 'suspended' || (before.expiresAt && Date.parse(before.expiresAt) <= Date.now()))) throw new LicenseError(409, 'Yeniden etkinleştirmeden önce durdurulmuş lisansın geçerli bir bitiş zamanı olmalı.');
        await tx.query('UPDATE school_licenses SET status=$2,updated_at=clock_timestamp() WHERE school_id=$1', [schoolId, body.action === 'suspend' ? 'suspended' : 'active']);
      }
      const after = await load(tx, schoolId);
      const log = await auditLogRepository.createAuditLog({ schoolId, actorUserId:req.user!.id, actorName:'Platform yöneticisi', auditScope:'PLATFORM', action:'license.'+body.action,
        details:JSON.stringify({ before:{status:before.status,expiresAt:before.expiresAt},after:{status:after.status,expiresAt:after.expiresAt},reason:body.note.trim() }) }, tx);
      return { license: present(after,30,new Date()), auditId:log.id };
    });
    res.json(result);
  } catch (error) {
    try {
      const db = await getDb();
      if ((await db.query('SELECT id FROM schools WHERE id=$1',[schoolId])).rows.length) await auditLogRepository.createAuditLog({schoolId,actorUserId:req.user!.id,actorName:'Platform yöneticisi',auditScope:'PLATFORM',action:'license.change_failed',details:JSON.stringify({outcome:'FAILED',status:error instanceof LicenseError?error.status:500})});
    } catch { /* Keep the original error if the database is unavailable. */ }
    res.status(error instanceof LicenseError ? error.status : 500).json({ error:error instanceof LicenseError?error.message:'Lisans değiştirilemedi.' });
  }
});
