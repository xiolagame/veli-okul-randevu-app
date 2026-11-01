import { TransactionClient } from './database/postgres';
import { normalizeTurkishPhone } from '../src/utils/phone';

// Called inside the same transaction as staff phone/permission changes.
export async function revokeStaffProofs(tx: TransactionClient, phone: string, userId?: string | null, invalidateVersion = true) {
  const canonical = normalizeTurkishPhone(phone);
  if (!canonical) return;
  await tx.query(`UPDATE whatsapp_auth_challenges SET revoked_at=NOW()
    WHERE target_phone=$1 AND consumed_at IS NULL AND revoked_at IS NULL`, [canonical]);
  await tx.query(`UPDATE identity_auth_attempts SET status='REVOKED',revoked_at=NOW(),updated_at=NOW()
    WHERE canonical_phone=$1 AND status NOT IN ('AUTHENTICATED','EXPIRED','REVOKED')`, [canonical]);
  if (userId) {
    if (invalidateVersion) await tx.query('UPDATE users SET auth_version=auth_version+1,updated_at=NOW() WHERE id=$1', [userId]);
    await tx.query(`UPDATE mobile_push_devices SET active=FALSE,provider_target='',deactivated_at=NOW(),updated_at=NOW()
      WHERE user_id=$1 AND active=TRUE`, [userId]);
    await tx.query(`UPDATE notification_deliveries SET status='CANCELLED',updated_at=NOW()
      WHERE device_id IN (SELECT id FROM mobile_push_devices WHERE user_id=$1)
        AND status IN ('PENDING','FAILED','SENDING')`, [userId]);
  }
}
