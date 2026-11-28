// WhatsApp doğrulama mesajlarının teslim takibi.
// Meta, gönderilen her mesajın durumunu (gönderildi / teslim edildi / okundu / ulaşmadı) webhook ile bildirir.
// Giriş akışına dokunmaz: yalnızca gelen bildirimleri saklar ve platform yönetimine gösterir.
import crypto from 'node:crypto';
import { Router } from 'express';
import { getDb } from './database/postgres';
import { normalizeTurkishPhone } from '../src/utils/phone';
import type { WhatsAppDeliveryStatus, WhatsAppStatusReport } from '../src/types/platform';

export const WHATSAPP_WEBHOOK_PATH = '/webhooks/whatsapp';
const RETENTION_DAYS = 30;
const MAX_STATUSES_PER_CALL = 100;
const KNOWN_STATUSES: WhatsAppDeliveryStatus[] = ['sent', 'delivered', 'read', 'failed'];

type WebhookRequest = { headers: Record<string, unknown>; body: unknown };

export interface DeliveryUpdate {
  messageId: string;
  phone: string;
  status: WhatsAppDeliveryStatus;
  errorCode: number | null;
  errorTitle: string | null;
  statusAt: string;
}

function configuration(): { appSecret: string; verifyToken: string } | null {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim() || '';
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || '';
  return appSecret && verifyToken ? { appSecret, verifyToken } : null;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function isValidWebhookSignature(rawBody: Buffer, header: unknown, appSecret: string): boolean {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(header, expected);
}

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// Yalnızca bu uygulamanın gönderim numarasına ait durum bildirimleri okunur; gelen mesaj içerikleri yok sayılır.
export function readDeliveryUpdates(payload: unknown, phoneNumberId: string): DeliveryUpdate[] {
  const root = asRecord(payload);
  if (root.object !== 'whatsapp_business_account') return [];
  const updates: DeliveryUpdate[] = [];
  for (const entry of asList(root.entry)) {
    for (const change of asList(asRecord(entry).changes)) {
      const value = asRecord(asRecord(change).value);
      if (!phoneNumberId || String(asRecord(value.metadata).phone_number_id || '') !== phoneNumberId) continue;
      for (const item of asList(value.statuses)) {
        const status = asRecord(item);
        const messageId = typeof status.id === 'string' ? status.id : '';
        const name = status.status as WhatsAppDeliveryStatus;
        const phone = normalizeTurkishPhone(String(status.recipient_id || ''));
        const seconds = Number(status.timestamp);
        if (!messageId || messageId.length > 200 || !phone || !KNOWN_STATUSES.includes(name)) continue;
        const error = asRecord(asList(status.errors)[0]);
        const code = Number(error.code);
        const title = String(error.title || asRecord(error.error_data).details || '').slice(0, 300);
        updates.push({
          messageId, phone, status: name,
          errorCode: Number.isInteger(code) && code > 0 ? code : null,
          errorTitle: title || null,
          statusAt: new Date(Number.isFinite(seconds) && seconds > 0 && seconds < 1e11 ? seconds * 1000 : Date.now()).toISOString(),
        });
        if (updates.length >= MAX_STATUSES_PER_CALL) return updates;
      }
    }
  }
  return updates;
}

async function purgeOldStatuses(): Promise<void> {
  await (await getDb()).query(`DELETE FROM whatsapp_message_status WHERE created_at < NOW() - make_interval(days => $1)`, [RETENTION_DAYS]);
}

// Bildirimler sırasız gelebilir: durum yalnızca ileri gider (gönderildi → teslim → okundu).
// "Ulaşmadı", teslim edilmiş bir mesajın durumunu geri almaz.
// Yalnızca son 2 günde Veli Randevu'dan kod istenen numaralar saklanır (aynı WhatsApp hattı başka işlerde de
// kullanılıyorsa onların alıcıları kaydedilmez).
export async function storeDeliveryUpdates(updates: DeliveryUpdate[]): Promise<void> {
  const db = await getDb();
  for (const update of updates) {
    await db.query(
      `INSERT INTO whatsapp_message_status(message_id,recipient_phone,status,error_code,error_title,status_at)
       SELECT $1::varchar,$2::varchar,$3::varchar,$4::int,$5::varchar,$6::timestamptz
       WHERE EXISTS (SELECT 1 FROM whatsapp_auth_challenges WHERE target_phone=$2::varchar AND created_at > NOW() - INTERVAL '2 days')
       ON CONFLICT(message_id) DO UPDATE SET
         status=EXCLUDED.status,error_code=EXCLUDED.error_code,error_title=EXCLUDED.error_title,
         status_at=EXCLUDED.status_at,updated_at=NOW()
       WHERE (CASE EXCLUDED.status WHEN 'sent' THEN 1 WHEN 'failed' THEN 2 WHEN 'delivered' THEN 3 ELSE 4 END)
           > (CASE whatsapp_message_status.status WHEN 'sent' THEN 1 WHEN 'failed' THEN 2 WHEN 'delivered' THEN 3 ELSE 4 END)`,
      [update.messageId, update.phone, update.status, update.errorCode, update.errorTitle, update.statusAt],
    );
  }
}

export const whatsAppWebhookRouter = Router();

// Meta'nın adres doğrulaması (kurulum sırasında bir kez).
whatsAppWebhookRouter.get('/', (req, res) => {
  const config = configuration();
  if (!config) return res.status(404).json({ error: 'Bulunamadı' });
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode !== 'subscribe' || typeof token !== 'string' || !safeEqual(token, config.verifyToken) || typeof challenge !== 'string' || !/^[\w-]{1,200}$/.test(challenge)) {
    return res.status(403).json({ error: 'Doğrulama başarısız.' });
  }
  return res.status(200).type('text/plain').send(challenge);
});

// Gövde, imza denetimi için ham (Buffer) olarak gelir (bkz. app.ts).
whatsAppWebhookRouter.post('/', async (req: WebhookRequest, res) => {
  const config = configuration();
  if (!config) return res.status(404).json({ error: 'Bulunamadı' });
  if (!Buffer.isBuffer(req.body) || !isValidWebhookSignature(req.body, req.headers['x-hub-signature-256'], config.appSecret)) {
    return res.status(401).json({ error: 'İmza doğrulanamadı.' });
  }
  let payload: unknown;
  try { payload = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ error: 'Geçersiz istek.' }); }
  try {
    const updates = readDeliveryUpdates(payload, process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '');
    if (updates.length) {
      await storeDeliveryUpdates(updates);
      await purgeOldStatuses();
    }
    return res.status(200).json({ success: true });
  } catch {
    console.warn('[WhatsApp Status] Delivery update could not be stored.');
    // 500 dönülürse Meta bildirimi daha sonra yeniden gönderir.
    return res.status(500).json({ error: 'Bildirim kaydedilemedi.' });
  }
});

// Platform yönetimi görünümü (yetki denetimi platformManagementRouter üst katmanında).
export const platformWhatsAppStatusRouter = Router();
platformWhatsAppStatusRouter.get('/', async (req, res) => {
  const search = typeof req.query.phone === 'string' ? req.query.phone.trim() : '';
  const phone = search ? normalizeTurkishPhone(search) : null;
  if (search && !phone) return res.status(400).json({ error: 'Telefon numarasını 0XXX XXX XX XX biçiminde girin.' });
  try {
    await purgeOldStatuses();
    const db = await getDb();
    const values = phone ? [phone] : [];
    const messages = await db.query<Record<string, unknown>>(
      `SELECT w.message_id,w.recipient_phone,w.status,w.error_code,w.error_title,w.status_at,w.created_at,
         COALESCE(
           (SELECT concat_ws(' ',u.first_name,u.last_name) FROM users u WHERE u.phone=w.recipient_phone LIMIT 1),
           (SELECT concat_ws(' ',t.first_name,t.last_name) FROM teacher_profiles t WHERE t.phone=w.recipient_phone LIMIT 1)
         ) AS full_name
       FROM whatsapp_message_status w ${phone ? 'WHERE w.recipient_phone=$1' : ''}
       ORDER BY w.created_at DESC,w.message_id LIMIT 100`, values);
    // Aranan numara için kod istekleri de gösterilir: bildirim gelmemişse "istek var, durum yok" anlaşılır.
    const requests = phone ? await db.query<{ created_at: string }>(
      `SELECT created_at FROM whatsapp_auth_challenges WHERE target_phone=$1 AND created_at > NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC LIMIT 20`, values) : { rows: [] };
    const latest = await db.query<{ latest: string | null }>('SELECT MAX(updated_at) AS latest FROM whatsapp_message_status');
    const iso = (value: unknown) => new Date(value as string).toISOString();
    const report: WhatsAppStatusReport = {
      configured: !!configuration(),
      lastReportAt: latest.rows[0]?.latest ? iso(latest.rows[0].latest) : null,
      messages: messages.rows.map((row) => ({
        id: String(row.message_id),
        phone: String(row.recipient_phone),
        name: row.full_name ? String(row.full_name) : null,
        status: row.status as WhatsAppDeliveryStatus,
        errorCode: row.error_code === null || row.error_code === undefined ? null : Number(row.error_code),
        errorTitle: row.error_title ? String(row.error_title) : null,
        statusAt: iso(row.status_at),
        createdAt: iso(row.created_at),
      })),
      codeRequests: requests.rows.map((row) => iso(row.created_at)),
    };
    return res.json(report);
  } catch {
    return res.status(500).json({ error: 'WhatsApp teslim durumu yüklenemedi.' });
  }
});
