import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { AuthenticatedRequest, authMiddleware, tenantGuard } from './auth';
import { getDb, TransactionClient } from './database/postgres';
import { renderBrandedEmail } from './email-template';
import { sendEmail } from './email';
import { auditLogRepository, schoolRepository } from './repositories';
import { normalizeUserPhoneInput } from '../src/utils/phone';
import {
  PlatformRequestItem,
  PlatformRequestStatus,
  PlatformRequestType,
} from '../src/types/platform';

const PUBLIC_REQUEST_TYPES: PlatformRequestType[] = ['YEARLY_LICENSE', 'CONTACT'];
const SCHOOL_REQUEST_TYPES: PlatformRequestType[] = ['YEARLY_LICENSE', 'SUPPORT'];
const REQUEST_TYPES: PlatformRequestType[] = ['MONTHLY_LICENSE', 'YEARLY_LICENSE', 'CONTACT', 'SUPPORT'];
const REQUEST_STATUSES: PlatformRequestStatus[] = ['NEW', 'IN_PROGRESS', 'WAITING_PAYMENT', 'RESOLVED', 'ARCHIVED'];
const SUPPORT_CATEGORIES = ['Teknik Sorun', 'Randevu Sorunu', 'Veli Hesabı', 'Personel Hesabı', 'QR / Güvenlik', 'Lisans', 'Öneri', 'Diğer'] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RequestSource = 'PUBLIC' | 'SCHOOL_ADMIN';

interface CreateRequestInput {
  idempotencyKey: string;
  schoolId: string | null;
  createdByUserId: string | null;
  source: RequestSource;
  requestType: PlatformRequestType;
  schoolName: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  teacherCount: number | null;
  subject: string | null;
  message: string;
}

class RequestValidationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function cleanText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim();
  return cleaned.length <= maximum ? cleaned : '';
}

function validateEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new RequestValidationError(400, 'E-posta adresini kontrol edin.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw new RequestValidationError(400, 'E-posta adresini kontrol edin.');
  return email;
}

function validatePhone(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const phone = normalizeUserPhoneInput(value);
  if (!phone) throw new RequestValidationError(400, 'Telefon numarasını 0XXX XXX XX XX biçiminde girin.');
  return phone;
}

function validateTeacherCount(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 10000) {
    throw new RequestValidationError(400, 'Öğretmen sayısı 1 ile 10000 arasında bir tam sayı olmalıdır.');
  }
  return count;
}

function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new RequestValidationError(400, 'Talep doğrulama anahtarı geçersiz. Lütfen formu yeniden açın.');
  }
  return value;
}

function mapRequest(row: Record<string, unknown>): PlatformRequestItem {
  return {
    id: String(row.id),
    schoolId: row.school_id ? String(row.school_id) : null,
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    source: row.source as PlatformRequestItem['source'],
    requestType: row.request_type as PlatformRequestType,
    schoolName: String(row.school_name_snapshot),
    contactName: String(row.contact_name_snapshot),
    email: row.email_snapshot ? String(row.email_snapshot) : null,
    phone: row.phone_snapshot ? String(row.phone_snapshot) : null,
    teacherCount: row.teacher_count === null || row.teacher_count === undefined ? null : Number(row.teacher_count),
    subject: row.subject ? String(row.subject) : null,
    message: String(row.message || ''),
    status: row.status as PlatformRequestStatus,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    resolvedAt: row.resolved_at ? new Date(String(row.resolved_at)).toISOString() : null,
    archivedAt: row.archived_at ? new Date(String(row.archived_at)).toISOString() : null,
  };
}

async function findByIdempotencyKey(idempotencyKey: string, client?: TransactionClient): Promise<PlatformRequestItem | null> {
  const db = client || await getDb();
  const result = await db.query('SELECT * FROM platform_requests WHERE idempotency_key=$1', [idempotencyKey]);
  return result.rows[0] ? mapRequest(result.rows[0]) : null;
}

async function createRequest(input: CreateRequestInput): Promise<{ request: PlatformRequestItem; created: boolean }> {
  const db = await getDb();
  const existing = await findByIdempotencyKey(input.idempotencyKey, db);
  if (existing) return { request: existing, created: false };
  const result = await db.query(
    `INSERT INTO platform_requests (
       id,idempotency_key,school_id,created_by_user_id,source,request_type,
       school_name_snapshot,contact_name_snapshot,email_snapshot,phone_snapshot,
       teacher_count,subject,message,status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'NEW')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [`req-${randomUUID()}`, input.idempotencyKey, input.schoolId, input.createdByUserId, input.source,
      input.requestType, input.schoolName, input.contactName, input.email, input.phone,
      input.teacherCount, input.subject, input.message]
  );
  if (result.rows[0]) return { request: mapRequest(result.rows[0]), created: true };
  const concurrent = await findByIdempotencyKey(input.idempotencyKey, db);
  if (!concurrent) throw new Error('Request idempotency conflict could not be resolved.');
  return { request: concurrent, created: false };
}

function requestTypeLabel(type: PlatformRequestType): string {
  return ({
    MONTHLY_LICENSE: 'Aylık Lisans (Eski)',
    YEARLY_LICENSE: 'Yıllık Lisans',
    CONTACT: 'İletişim',
    SUPPORT: 'Destek',
  } as const)[type];
}

async function deliverRequestEmails(request: PlatformRequestItem): Promise<{ platformSent: boolean; requesterSent: boolean }> {
  let platformSent = false;
  let requesterSent = false;
  const platformRecipient = process.env.PLATFORM_REQUEST_NOTIFICATION_EMAIL?.trim().toLowerCase();
  if (platformRecipient && EMAIL_PATTERN.test(platformRecipient)) {
    try {
      await sendEmail({
        to: platformRecipient,
        subject: `[VELİ RANDEVU] Yeni ${requestTypeLabel(request.requestType)} Talebi`,
        idempotencyKey: `${request.id}-platform`,
        ...renderBrandedEmail({
          subtitle: 'Yeni talep bildirimi',
          intro: [
            `${request.source === 'PUBLIC' ? 'Public formdan' : 'Okul yönetiminden'} yeni bir ${requestTypeLabel(request.requestType).toLocaleLowerCase('tr-TR')} talebi alındı.`,
            ...(request.message ? [`Mesaj: ${request.message}`] : []),
          ],
          infoCards: [
            { label: 'Okul', value: request.schoolName },
            { label: 'Yetkili', value: request.contactName },
            ...(request.email ? [{ label: 'E-posta', value: request.email }] : []),
            ...(request.phone ? [{ label: 'Telefon', value: request.phone }] : []),
            ...(request.teacherCount ? [{ label: 'Öğretmen Sayısı', value: String(request.teacherCount) }] : []),
            ...(request.subject ? [{ label: 'Konu', value: request.subject }] : []),
          ],
          notice: `Talep kimliği: ${request.id}`,
        }),
      });
      platformSent = true;
    } catch {
      platformSent = false;
    }
  }
  if (request.email) {
    try {
      await sendEmail({
        to: request.email,
        subject: 'VELİ RANDEVU — Talebiniz Alındı',
        idempotencyKey: `${request.id}-requester`,
        ...renderBrandedEmail({
          subtitle: 'Talebiniz alındı',
          greeting: request.contactName,
          intro: [
            `${requestTypeLabel(request.requestType)} talebiniz alınmıştır.`,
            'Talebinizi inceleyerek en kısa sürede sizinle iletişime geçeceğiz.',
          ],
          infoCards: [
            { label: 'Okul', value: request.schoolName },
            { label: 'Talep Türü', value: requestTypeLabel(request.requestType) },
            { label: 'Talep Tarihi', value: new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul' }).format(new Date(request.createdAt)) },
          ],
        }),
      });
      requesterSent = true;
    } catch {
      requesterSent = false;
    }
  }
  return { platformSent, requesterSent };
}

async function withinPublicRateLimit(scope: string): Promise<boolean> {
  const scopeHash = createHash('sha256').update(`platform-request:${scope}`).digest('hex');
  const db = await getDb();
  const result = await db.query<{ attempts: number; blocked_until: string | null }>(
    `INSERT INTO auth_rate_limits(scope_hash,attempts,window_started_at,blocked_until) VALUES($1,1,NOW(),NULL)
     ON CONFLICT(scope_hash) DO UPDATE SET
       attempts=CASE WHEN auth_rate_limits.window_started_at < NOW()-INTERVAL '15 minutes' THEN 1 ELSE auth_rate_limits.attempts+1 END,
       window_started_at=CASE WHEN auth_rate_limits.window_started_at < NOW()-INTERVAL '15 minutes' THEN NOW() ELSE auth_rate_limits.window_started_at END,
       blocked_until=CASE WHEN auth_rate_limits.window_started_at < NOW()-INTERVAL '15 minutes' THEN NULL
         WHEN auth_rate_limits.attempts+1 >= 10 THEN NOW()+INTERVAL '15 minutes' ELSE auth_rate_limits.blocked_until END
     RETURNING attempts,blocked_until`, [scopeHash]);
  const row = result.rows[0];
  return !!row && Number(row.attempts) < 10 && (!row.blocked_until || new Date(row.blocked_until).getTime() <= Date.now());
}

function clientAddress(req: import('express').Request): string {
  const netlifyAddress = req.headers['x-nf-client-connection-ip'];
  if (typeof netlifyAddress === 'string' && netlifyAddress.trim()) return netlifyAddress.trim();
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.ip || 'unknown';
}

function isAllowedTransition(type: PlatformRequestType, from: PlatformRequestStatus, to: PlatformRequestStatus): boolean {
  if (from === to) return true;
  if (to === 'WAITING_PAYMENT' && !['MONTHLY_LICENSE', 'YEARLY_LICENSE'].includes(type)) return false;
  const transitions: Record<PlatformRequestStatus, PlatformRequestStatus[]> = {
    NEW: ['IN_PROGRESS', 'WAITING_PAYMENT', 'RESOLVED', 'ARCHIVED'],
    IN_PROGRESS: ['WAITING_PAYMENT', 'RESOLVED', 'ARCHIVED'],
    WAITING_PAYMENT: ['IN_PROGRESS', 'RESOLVED', 'ARCHIVED'],
    RESOLVED: ['IN_PROGRESS', 'ARCHIVED'],
    ARCHIVED: ['IN_PROGRESS'],
  };
  return transitions[from].includes(to);
}

export const publicRequestRouter = Router();
publicRequestRouter.post('/', async (req, res) => {
  try {
    if (typeof req.body?.companyWebsite === 'string' && req.body.companyWebsite.trim()) {
      return res.status(400).json({ error: 'Talebiniz doğrulanamadı.' });
    }
    if (!await withinPublicRateLimit(clientAddress(req))) {
      return res.status(429).json({ error: 'Çok fazla talep gönderdiniz. Lütfen daha sonra tekrar deneyin.' });
    }
    const requestType = req.body?.requestType as PlatformRequestType;
    if (!PUBLIC_REQUEST_TYPES.includes(requestType)) throw new RequestValidationError(400, 'Talep türünü kontrol edin.');
    const schoolName = cleanText(req.body?.schoolName, 255);
    const contactName = cleanText(req.body?.contactName, 150);
    if (schoolName.length < 2) throw new RequestValidationError(400, 'Lütfen okul adını girin.');
    if (contactName.length < 2) throw new RequestValidationError(400, 'Lütfen yetkili adını girin.');
    const email = validateEmail(req.body?.email);
    const phone = validatePhone(req.body?.phone);
    if (!email && !phone) throw new RequestValidationError(400, 'E-posta veya telefon bilgilerinden en az birini girin.');
    const message = cleanText(req.body?.message, 2000);
    if (typeof req.body?.message === 'string' && req.body.message.trim() && !message) throw new RequestValidationError(400, 'Mesaj en fazla 2000 karakter olabilir.');
    const result = await createRequest({
      idempotencyKey: validateIdempotencyKey(req.body?.requestToken),
      schoolId: null,
      createdByUserId: null,
      source: 'PUBLIC',
      requestType,
      schoolName,
      contactName,
      email,
      phone,
      teacherCount: validateTeacherCount(req.body?.teacherCount),
      subject: null,
      message,
    });
    const emailResult = result.created ? await deliverRequestEmails(result.request) : { platformSent: false, requesterSent: false };
    return res.status(result.created ? 201 : 200).json({
      ok: true,
      requestId: result.request.id,
      duplicate: !result.created,
      emailNotificationSent: emailResult.platformSent,
      requesterEmailSent: emailResult.requesterSent,
    });
  } catch (error) {
    if (error instanceof RequestValidationError) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: 'Talebiniz gönderilemedi. Lütfen tekrar deneyin.' });
  }
});

export const schoolRequestRouter = Router({ mergeParams: true });
schoolRequestRouter.use(authMiddleware, tenantGuard(['admin']));
schoolRequestRouter.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const schoolId = req.membership!.schoolId;
    if (req.body?.schoolId !== undefined && req.body.schoolId !== schoolId) {
      return res.status(400).json({ error: 'Okul bağlamı uyuşmuyor.' });
    }
    const requestType = req.body?.requestType as PlatformRequestType;
    if (!SCHOOL_REQUEST_TYPES.includes(requestType)) throw new RequestValidationError(400, 'Talep türünü kontrol edin.');
    const message = cleanText(req.body?.message, 2000);
    if (!message) throw new RequestValidationError(400, 'Lütfen talebinizi açıklayın.');
    const subject = requestType === 'SUPPORT' ? cleanText(req.body?.subject, 120) : null;
    if (requestType === 'SUPPORT' && !SUPPORT_CATEGORIES.includes(subject as typeof SUPPORT_CATEGORIES[number])) {
      throw new RequestValidationError(400, 'Destek kategorisini kontrol edin.');
    }
    const school = await schoolRepository.getById(schoolId);
    if (!school) return res.status(403).json({ error: 'Okul bağlamı doğrulanamadı.' });
    const db = await getDb();
    const contact = await db.query<{ full_name: string; email: string | null; phone: string }>(
      `SELECT concat_ws(' ',first_name,last_name) AS full_name,email,phone FROM users WHERE id=$1`, [req.user!.id]);
    if (!contact.rows[0]) return res.status(401).json({ error: 'Kullanıcı doğrulanamadı.' });
    const teacherCount = await db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM teacher_profiles WHERE school_id=$1', [schoolId]);
    const result = await createRequest({
      idempotencyKey: validateIdempotencyKey(req.body?.requestToken),
      schoolId,
      createdByUserId: req.user!.id,
      source: 'SCHOOL_ADMIN',
      requestType,
      schoolName: school.name,
      contactName: contact.rows[0].full_name.trim() || 'Okul Yöneticisi',
      email: validateEmail(contact.rows[0].email),
      phone: validatePhone(contact.rows[0].phone),
      teacherCount: Number(teacherCount.rows[0]?.count || 0) || null,
      subject,
      message,
    });
    const emailResult = result.created ? await deliverRequestEmails(result.request) : { platformSent: false, requesterSent: false };
    return res.status(result.created ? 201 : 200).json({
      ok: true,
      requestId: result.request.id,
      duplicate: !result.created,
      emailNotificationSent: emailResult.platformSent,
      requesterEmailSent: emailResult.requesterSent,
    });
  } catch (error) {
    if (error instanceof RequestValidationError) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: 'Talebiniz gönderilemedi. Lütfen tekrar deneyin.' });
  }
});

schoolRequestRouter.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const result = await (await getDb()).query(
      `SELECT * FROM platform_requests
       WHERE source='SCHOOL_ADMIN' AND school_id=$1
       ORDER BY created_at DESC,id DESC`, [req.membership!.schoolId]);
    return res.json({ requests: result.rows.map(mapRequest) });
  } catch {
    return res.status(500).json({ error: 'Talepler yüklenemedi.' });
  }
});

export const platformRequestRouter = Router();
platformRequestRouter.get('/', async (req: AuthenticatedRequest, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const requestType = typeof req.query.requestType === 'string' ? req.query.requestType : '';
  if (status && status !== 'ALL' && !REQUEST_STATUSES.includes(status as PlatformRequestStatus)) return res.status(400).json({ error: 'Durum filtresi geçersiz.' });
  if (requestType && requestType !== 'ALL' && !REQUEST_TYPES.includes(requestType as PlatformRequestType)) return res.status(400).json({ error: 'Talep türü filtresi geçersiz.' });
  const clauses: string[] = [];
  const values: string[] = [];
  if (!status) clauses.push("status<>'ARCHIVED'");
  else if (status !== 'ALL') { values.push(status); clauses.push(`status=$${values.length}`); }
  if (requestType && requestType !== 'ALL') { values.push(requestType); clauses.push(`request_type=$${values.length}`); }
  try {
    const result = await (await getDb()).query(
      `SELECT * FROM platform_requests ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC,id DESC LIMIT 500`, values);
    return res.json({ requests: result.rows.map(mapRequest) });
  } catch {
    return res.status(500).json({ error: 'Gelen talepler yüklenemedi.' });
  }
});

platformRequestRouter.get('/:id', async (req, res) => {
  try {
    const result = await (await getDb()).query('SELECT * FROM platform_requests WHERE id=$1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Talep bulunamadı.' });
    return res.json({ request: mapRequest(result.rows[0]) });
  } catch {
    return res.status(500).json({ error: 'Talep yüklenemedi.' });
  }
});

platformRequestRouter.patch('/:id/status', async (req: AuthenticatedRequest, res) => {
  const nextStatus = req.body?.status as PlatformRequestStatus;
  if (!REQUEST_STATUSES.includes(nextStatus)) return res.status(400).json({ error: 'Talep durumu geçersiz.' });
  try {
    const db = await getDb();
    const updated = await db.transaction(async (tx) => {
      const currentResult = await tx.query('SELECT * FROM platform_requests WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!currentResult.rows[0]) return null;
      const current = mapRequest(currentResult.rows[0]);
      if (!isAllowedTransition(current.requestType, current.status, nextStatus)) throw new RequestValidationError(409, 'Bu durum geçişine izin verilmiyor.');
      const result = await tx.query(
        `UPDATE platform_requests SET status=$2::varchar,status_updated_by_user_id=$3,updated_at=NOW(),
           resolved_at=CASE WHEN $2::varchar='RESOLVED' THEN COALESCE(resolved_at,NOW()) ELSE NULL END,
           archived_at=CASE WHEN $2::varchar='ARCHIVED' THEN COALESCE(archived_at,NOW()) ELSE NULL END
         WHERE id=$1 RETURNING *`, [current.id, nextStatus, req.user!.id]);
      if (current.schoolId && current.status !== nextStatus) {
        await auditLogRepository.createAuditLog({
          schoolId: current.schoolId,
          action: 'platform_request.status_changed',
          actorName: `${req.user!.firstName} ${req.user!.lastName} (Platform Yönetimi)`.trim(),
          details: JSON.stringify({ requestId: current.id, from: current.status, to: nextStatus }),
        }, tx);
      }
      return mapRequest(result.rows[0]);
    });
    if (!updated) return res.status(404).json({ error: 'Talep bulunamadı.' });
    return res.json({ request: updated });
  } catch (error) {
    if (error instanceof RequestValidationError) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: 'Talep durumu güncellenemedi.' });
  }
});
