import crypto from 'crypto';
import { getDb, TransactionClient } from './database/postgres';

export type PushEventType = 'APPOINTMENT_REQUESTED' | 'APPOINTMENT_APPROVED' | 'APPOINTMENT_REJECTED';

export interface PushPayload {
  title: string;
  body: string;
  data: { eventType: PushEventType; resourceType: 'appointment'; resourceId: string; notificationId: string; route: string };
}

export type PushSendResult =
  | { status: 'SENT'; messageId: string }
  | { status: 'INVALID_TARGET' | 'CONFIG_NOT_AVAILABLE' }
  | { status: 'RETRYABLE_FAILURE'; errorCode: string };

export interface PushProvider {
  send(target: string, payload: PushPayload): Promise<PushSendResult>;
}

const SAFE_FCM_CODE = /^[A-Za-z0-9/._:-]+$/;

export function getSafeFcmErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'UNKNOWN_FCM_ERROR';
  const record = error as Record<string, unknown>;
  const errorInfo = record.errorInfo && typeof record.errorInfo === 'object'
    ? record.errorInfo as Record<string, unknown>
    : null;
  const candidates = [errorInfo?.code, record.code];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const code = candidate.trim();
      if (code && SAFE_FCM_CODE.test(code)) return code.slice(0, 128);
    }
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) {
      return `HTTP_${candidate}`;
    }
  }
  for (const candidate of [record.status, record.statusCode, record.httpStatus]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) {
      return `HTTP_${candidate}`;
    }
  }
  return 'UNKNOWN_FCM_ERROR';
}

const messages: Record<PushEventType, { title: string; body: string; role: 'teacher' | 'parent' }> = {
  APPOINTMENT_REQUESTED: { title: 'Yeni randevu talebi', body: 'Yeni bir randevu talebiniz var.', role: 'teacher' },
  APPOINTMENT_APPROVED: { title: 'Randevunuz onaylandı', body: 'Randevu talebiniz öğretmen tarafından onaylandı.', role: 'parent' },
  APPOINTMENT_REJECTED: { title: 'Randevu talebiniz sonuçlandı', body: 'Randevu talebiniz öğretmen tarafından onaylanmadı.', role: 'parent' },
};

export function createPushPayload(eventType: PushEventType, appointmentId: string, notificationId: string): PushPayload {
  return {
    title: messages[eventType].title,
    body: messages[eventType].body,
    data: { eventType, resourceType: 'appointment', resourceId: appointmentId, notificationId,
      route: `/app/appointments/${appointmentId}` },
  };
}

export class FirebasePushProvider implements PushProvider {
  constructor(private readonly sendMessage?: (target: string, payload: PushPayload) => Promise<string>) {}

  async send(target: string, payload: PushPayload): Promise<PushSendResult> {
    const projectId = process.env.FCM_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FCM_FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FCM_FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!this.sendMessage && (!projectId || !clientEmail || !privateKey)) return { status: 'CONFIG_NOT_AVAILABLE' };
    try {
      let messageId: string;
      if (this.sendMessage) {
        messageId = await this.sendMessage(target, payload);
      } else {
        const { cert, getApps, initializeApp } = await import('firebase-admin/app');
        const { getMessaging } = await import('firebase-admin/messaging');
        const app = getApps().find((existing) => existing.name === 'veli-push') || initializeApp({
          credential: cert({ projectId: projectId!, clientEmail: clientEmail!, privateKey: privateKey! }),
        }, 'veli-push');
        messageId = await getMessaging(app).send({
          token: target,
          notification: { title: payload.title, body: payload.body },
          data: payload.data,
          android: { notification: { channelId: 'veli_randevu_appointments' } },
        });
      }
      return { status: 'SENT', messageId };
    } catch (error) {
      const errorCode = getSafeFcmErrorCode(error);
      if (errorCode === 'messaging/registration-token-not-registered' || errorCode === 'messaging/invalid-registration-token') {
        return { status: 'INVALID_TARGET' };
      }
      return { status: 'RETRYABLE_FAILURE', errorCode };
    }
  }
}

const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_ID = 'com.velirandevu.app';
const validGeneration = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

export class StalePushRegistrationError extends Error {
  constructor() { super('Stale push registration'); }
}

export function validDeviceInput(input: unknown): input is {
  installationId: string; platform: 'ANDROID' | 'IOS'; provider: 'FCM'; targetKind: 'REGISTRATION_TOKEN'; providerTarget: string;
  appId: string; registrationGeneration?: number;
} {
  if (!input || typeof input !== 'object') return false;
  const device = input as Record<string, unknown>;
  return Object.keys(device).every((key) => ['installationId', 'platform', 'provider', 'targetKind', 'providerTarget', 'appId', 'registrationGeneration'].includes(key))
    && typeof device.installationId === 'string' && INSTALLATION_ID.test(device.installationId)
    && (device.platform === 'ANDROID' || device.platform === 'IOS')
    && device.provider === 'FCM' && device.targetKind === 'REGISTRATION_TOKEN'
    && typeof device.providerTarget === 'string' && device.providerTarget.length >= 20 && device.providerTarget.length <= 4096
    && (device.platform !== 'IOS' || !/^[a-f0-9]{64}$/i.test(device.providerTarget))
    && !/\s/.test(device.providerTarget) && device.appId === APP_ID
    && (device.platform === 'IOS'
      ? (device.registrationGeneration === undefined || validGeneration(device.registrationGeneration))
      : device.registrationGeneration === undefined);
}

export async function registerPushDevice(userId: string, input: unknown): Promise<boolean> {
  if (!validDeviceInput(input)) return false;
  const db = await getDb();
  const targetHash = crypto.createHash('sha256').update(input.providerTarget).digest('hex');
  const generation = input.registrationGeneration ?? 0;
  await db.transaction(async (tx) => {
    await tx.query('LOCK TABLE mobile_push_devices IN SHARE ROW EXCLUSIVE MODE');
    const owner = await tx.query<{ auth_version: number }>('SELECT auth_version FROM users WHERE id=$1', [userId]);
    if (!owner.rows.length) throw new Error('Push owner unavailable');
    const previous = await tx.query<{ id: string; user_id: string; target_hash: string; platform: string;
      registration_generation: string | number; revoked_through_generation: string | number }>(
      `SELECT id,user_id,target_hash,platform,registration_generation,revoked_through_generation
       FROM mobile_push_devices WHERE installation_id=$1 FOR UPDATE`, [input.installationId]);
    if (previous.rows.length) {
      const device = previous.rows[0];
      const acceptedGeneration = BigInt(device.registration_generation);
      const revokedThrough = BigInt(device.revoked_through_generation);
      const incomingGeneration = BigInt(generation);
      if (incomingGeneration < acceptedGeneration || (revokedThrough > 0n && incomingGeneration <= revokedThrough)
        || (generation > 0 && incomingGeneration === acceptedGeneration && device.user_id !== userId)) {
        throw new StalePushRegistrationError();
      }
    }
    const conflicting = await tx.query<{ id: string }>(
      'SELECT id FROM mobile_push_devices WHERE target_hash=$1 AND installation_id<>$2 AND active=TRUE',
      [targetHash, input.installationId]);
    for (const row of conflicting.rows) {
      await tx.query(`UPDATE mobile_push_devices SET active=FALSE,provider_target='',deactivated_at=NOW(),updated_at=NOW() WHERE id=$1`, [row.id]);
      await tx.query(`UPDATE notification_deliveries SET status='CANCELLED',updated_at=NOW()
        WHERE device_id=$1 AND status IN ('PENDING','FAILED','SENDING')`, [row.id]);
    }
    if (previous.rows.length) {
      const device = previous.rows[0];
      if (device.user_id !== userId || device.target_hash !== targetHash) {
        await tx.query(`UPDATE notification_deliveries SET status='CANCELLED',updated_at=NOW()
          WHERE device_id=$1 AND status IN ('PENDING','FAILED','SENDING')`, [device.id]);
      }
      await tx.query(`UPDATE mobile_push_devices SET user_id=$2,platform=$6,provider_target=$3,target_hash=$4,auth_version=$5,active=TRUE,
        registration_generation=$7,
        deactivated_at=NULL,last_registered_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [device.id, userId, input.providerTarget, targetHash, owner.rows[0].auth_version, input.platform, generation]);
    } else {
      await tx.query(`INSERT INTO mobile_push_devices
        (id,user_id,auth_version,installation_id,platform,provider,target_kind,provider_target,target_hash,app_id,registration_generation)
        VALUES ($1,$2,$3,$4,$5,'FCM','REGISTRATION_TOKEN',$6,$7,$8,$9)`,
      [crypto.randomUUID(), userId, owner.rows[0].auth_version, input.installationId, input.platform, input.providerTarget, targetHash, APP_ID, generation]);
    }
  });
  return true;
}

export async function deactivatePushDevice(userId: string, installationId: string, registrationGeneration?: number): Promise<void> {
  if (!INSTALLATION_ID.test(installationId)) return;
  if (registrationGeneration !== undefined && !validGeneration(registrationGeneration)) throw new Error('Invalid push generation');
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query('LOCK TABLE mobile_push_devices IN SHARE ROW EXCLUSIVE MODE');
    const device = await tx.query<{ id: string; user_id: string; platform: string;
      registration_generation: string | number }>(
      `SELECT id,user_id,platform,registration_generation,revoked_through_generation
       FROM mobile_push_devices WHERE installation_id=$1 FOR UPDATE`, [installationId]);
    if (!device.rows.length) {
      if (registrationGeneration === undefined) return;
      const owner = await tx.query<{ auth_version: number }>('SELECT auth_version FROM users WHERE id=$1', [userId]);
      if (!owner.rows.length) throw new Error('Push owner unavailable');
      await tx.query(`INSERT INTO mobile_push_devices
        (id,user_id,auth_version,installation_id,platform,provider,target_kind,provider_target,target_hash,app_id,
         active,registration_generation,revoked_through_generation,deactivated_at)
        VALUES ($1,$2,$3,$4,'IOS','FCM','REGISTRATION_TOKEN','','',$5,FALSE,0,$6,NOW())`,
      [crypto.randomUUID(), userId, owner.rows[0].auth_version, installationId, APP_ID, registrationGeneration]);
      return;
    }
    const current = device.rows[0];
    if (current.user_id !== userId) return;
    if (registrationGeneration === undefined) {
      if (BigInt(current.registration_generation) > 0n) return;
    } else {
      if (current.platform !== 'IOS' || BigInt(registrationGeneration) < BigInt(current.registration_generation)) return;
    }
    await tx.query(`UPDATE mobile_push_devices SET active=FALSE,provider_target='',deactivated_at=NOW(),updated_at=NOW(),
      revoked_through_generation=GREATEST(revoked_through_generation,$2::bigint) WHERE id=$1`,
    [current.id, registrationGeneration ?? 0]);
    await tx.query(`UPDATE notification_deliveries SET status='CANCELLED',updated_at=NOW()
      WHERE device_id=$1 AND status IN ('PENDING','FAILED','SENDING')`, [current.id]);
  });
}

export async function enqueueAppointmentPush(tx: TransactionClient, input: {
  notificationId: string; schoolId: string; userId: string; appointmentId: string; eventType: PushEventType;
}): Promise<void> {
  await tx.query(`INSERT INTO notification_deliveries (id,notification_id,device_id,channel,event_type)
    SELECT 'pdel-' || md5($1 || d.id),$1,d.id,'FCM',$5 FROM mobile_push_devices d
    JOIN users u ON u.id=d.user_id AND u.auth_version=d.auth_version
    JOIN school_memberships sm ON sm.user_id=d.user_id AND sm.school_id=$2 AND sm.role=$6 AND sm.status='active'
    JOIN schools s ON s.id=sm.school_id AND s.disabled_at IS NULL
    WHERE d.user_id=$3 AND d.active=TRUE AND d.platform IN ('ANDROID','IOS') AND d.provider='FCM'
      AND EXISTS (SELECT 1 FROM notifications n
        JOIN appointments a ON a.school_id=n.school_id AND a.id=n.appointment_id
        LEFT JOIN teacher_profiles tp ON tp.school_id=a.school_id AND tp.id=a.teacher_id
        WHERE n.id=$1 AND n.school_id=$2 AND n.user_id=$3 AND n.appointment_id=$4
          AND (($5='APPOINTMENT_REQUESTED' AND tp.user_id=$3)
            OR ($5 IN ('APPOINTMENT_APPROVED','APPOINTMENT_REJECTED') AND a.parent_id=$3)))
    ON CONFLICT (notification_id,device_id,channel) DO NOTHING`,
  [input.notificationId, input.schoolId, input.userId, input.appointmentId, input.eventType, messages[input.eventType].role]);
}

interface ClaimedDelivery {
  id: string; device_id: string; provider_target: string; event_type: PushEventType;
  target_hash: string; appointment_id: string; notification_id: string; user_id: string; school_id: string;
}

export async function dispatchPushDeliveries(provider: PushProvider = new FirebasePushProvider(), limit = 50, appointmentId?: string): Promise<{
  claimed: number; sent: number; failed: number; invalid: number; unavailable: number;
}> {
  const db = await getDb();
  const claimed = await db.transaction(async (tx) => {
    const result = await tx.query<ClaimedDelivery>(`WITH due AS (
      SELECT nd.id FROM notification_deliveries nd
      JOIN notifications n ON n.id=nd.notification_id
      WHERE (nd.status IN ('PENDING','FAILED') OR (nd.status='SENDING' AND nd.claimed_until<NOW()))
        AND nd.attempt_count<5 AND nd.next_attempt_at<=NOW()
        AND ($2::text IS NULL OR n.appointment_id=$2)
      ORDER BY nd.next_attempt_at,nd.id LIMIT $1 FOR UPDATE OF nd SKIP LOCKED
    ) UPDATE notification_deliveries nd SET status='SENDING',attempt_count=nd.attempt_count+1,
      last_attempt_at=NOW(),claimed_until=NOW()+INTERVAL '2 minutes',updated_at=NOW()
      FROM due WHERE nd.id=due.id RETURNING nd.id,nd.device_id,nd.event_type,nd.notification_id`,
    [Math.min(Math.max(limit, 1), 100), appointmentId || null]);
    const records: ClaimedDelivery[] = [];
    for (const row of result.rows) {
      const details = await tx.query<ClaimedDelivery>(`SELECT nd.id,nd.device_id,nd.event_type,nd.notification_id,
        n.appointment_id,n.user_id,n.school_id,d.provider_target,d.target_hash
        FROM notification_deliveries nd JOIN notifications n ON n.id=nd.notification_id
        JOIN appointments a ON a.school_id=n.school_id AND a.id=n.appointment_id
        LEFT JOIN teacher_profiles tp ON tp.school_id=a.school_id AND tp.id=a.teacher_id
        JOIN mobile_push_devices d ON d.id=nd.device_id
        JOIN users u ON u.id=d.user_id AND u.auth_version=d.auth_version
        JOIN school_memberships sm ON sm.user_id=n.user_id AND sm.school_id=n.school_id
          AND sm.role=$2 AND sm.status='active'
        JOIN schools s ON s.id=n.school_id AND s.disabled_at IS NULL
        WHERE nd.id=$1 AND d.active=TRUE AND d.user_id=n.user_id
          AND n.appointment_id IS NOT NULL AND n.hidden_at IS NULL
          AND ((nd.event_type='APPOINTMENT_REQUESTED' AND tp.user_id=n.user_id)
            OR (nd.event_type IN ('APPOINTMENT_APPROVED','APPOINTMENT_REJECTED') AND a.parent_id=n.user_id))`,
      [row.id, messages[row.event_type].role]);
      if (details.rows[0]) records.push(details.rows[0]);
      else await tx.query(`UPDATE notification_deliveries SET status='CANCELLED',updated_at=NOW() WHERE id=$1`, [row.id]);
    }
    return records;
  });
  const result = { claimed: claimed.length, sent: 0, failed: 0, invalid: 0, unavailable: 0 };
  for (const delivery of claimed) {
    let sendResult: PushSendResult;
    try {
      sendResult = await provider.send(delivery.provider_target,
        createPushPayload(delivery.event_type, delivery.appointment_id, delivery.notification_id));
    } catch {
      sendResult = { status: 'RETRYABLE_FAILURE', errorCode: 'UNKNOWN_FCM_ERROR' };
    }
    if (sendResult.status === 'CONFIG_NOT_AVAILABLE') {
      result.unavailable++;
      await db.query(`UPDATE notification_deliveries SET status='FAILED',next_attempt_at=NOW()+INTERVAL '15 minutes',
        attempt_count=attempt_count-1,last_error_code='CONFIG_NOT_AVAILABLE',claimed_until=NULL,updated_at=NOW()
        WHERE id=$1 AND status='SENDING'`, [delivery.id]);
      continue;
    }
    if (sendResult.status === 'SENT') {
      result.sent++;
      await db.query(`UPDATE notification_deliveries SET status='SENT',sent_at=NOW(),provider_message_id=$2,
        last_error_code=NULL,claimed_until=NULL,updated_at=NOW() WHERE id=$1 AND status='SENDING'`, [delivery.id, sendResult.messageId]);
    } else if (sendResult.status === 'INVALID_TARGET') {
      result.invalid++;
      await db.transaction(async (tx) => {
        await tx.query(`UPDATE notification_deliveries SET status='INVALID_TARGET',last_error_code='INVALID_TARGET',
          claimed_until=NULL,updated_at=NOW() WHERE id=$1 AND status='SENDING'`, [delivery.id]);
        const deactivated = await tx.query(`UPDATE mobile_push_devices SET active=FALSE,provider_target='',deactivated_at=NOW(),updated_at=NOW()
          WHERE id=$1 AND target_hash=$2 RETURNING id`, [delivery.device_id, delivery.target_hash]);
        if (deactivated.rows.length) await tx.query(`UPDATE notification_deliveries SET status='CANCELLED',updated_at=NOW()
          WHERE device_id=$1 AND id<>$2 AND status IN ('PENDING','FAILED','SENDING')`, [delivery.device_id, delivery.id]);
      });
    } else {
      result.failed++;
      await db.query(`UPDATE notification_deliveries SET status='FAILED',
        next_attempt_at=NOW()+(INTERVAL '1 minute' * LEAST(60,POWER(2,attempt_count))),
        last_error_code=$2,claimed_until=NULL,updated_at=NOW()
        WHERE id=$1 AND status='SENDING'`, [delivery.id, sendResult.errorCode]);
    }
  }
  return result;
}
