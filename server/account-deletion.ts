import { Router } from 'express';
import { AuthenticatedRequest, authMiddleware, checkRateLimit, createAccountDeletionSubjectHash } from './auth';
import { getDb, TransactionClient } from './database/postgres';
import { sendEmail } from './email';
import { renderBrandedEmail } from './email-template';
import { verifyPassword } from './passwords';
import { getTurkishPhoneLookupDigits } from '../src/utils/phone';

const CONFIRMATION_PHRASE = 'HESABIMI SİL';
const DELETED_USER_LABEL = 'Silinmiş Kullanıcı';
const DELETED_PARENT_LABEL = 'Silinmiş Veli';
const REDACTED_DETAIL = 'İşlem ayrıntıları hesap silme kapsamında anonimleştirildi.';
const REDACTED_CONTENT = 'İçerik hesap silme kapsamında kaldırıldı.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class AccountDeletionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

interface DeletedAccountResult {
  completedAt: string;
  alreadyCompleted: boolean;
  notificationEmail: string | null;
  firstName: string;
}

async function findReceipt(tx: TransactionClient, requestId: string, subjectHash: string): Promise<string | null> {
  const receipt = await tx.query<{ subject_hash: string; completed_at: string }>(
    `SELECT subject_hash,completed_at FROM account_deletion_receipts
     WHERE request_id=$1 AND expires_at>NOW()`,
    [requestId],
  );
  const row = receipt.rows[0];
  if (!row) return null;
  if (row.subject_hash !== subjectHash) {
    throw new AccountDeletionError(409, 'Bu silme isteği kimliği başka bir işlemde kullanılmış. Lütfen tekrar deneyin.');
  }
  return row.completed_at;
}

export async function deleteOwnAccount(input: {
  userId: string;
  password: string;
  requestId: string;
}): Promise<DeletedAccountResult> {
  const subjectHash = createAccountDeletionSubjectHash(input.userId);
  const db = await getDb();

  return db.transaction(async (tx) => {
    await tx.query('DELETE FROM account_deletion_receipts WHERE expires_at<=NOW()');
    const priorCompletion = await findReceipt(tx, input.requestId, subjectHash);
    if (priorCompletion) {
      return { completedAt: priorCompletion, alreadyCompleted: true, notificationEmail: null, firstName: '' };
    }

    const lockedUser = await tx.query<{
      id: string;
      phone: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      password_hash: string | null;
    }>(
      `SELECT id,phone,first_name,last_name,email,password_hash
       FROM users WHERE id=$1 FOR UPDATE`,
      [input.userId],
    );

    const user = lockedUser.rows[0];
    if (!user) {
      const completionAfterWait = await findReceipt(tx, input.requestId, subjectHash);
      if (completionAfterWait) {
        return { completedAt: completionAfterWait, alreadyCompleted: true, notificationEmail: null, firstName: '' };
      }
      throw new AccountDeletionError(409, 'Hesap silme işlemi tamamlanamadı. Oturumunuzu yenileyip tekrar deneyin.');
    }

    if (!verifyPassword(input.password, user.password_hash)) {
      throw new AccountDeletionError(403, 'Parolanız doğrulanamadı. Hesabınızda hiçbir değişiklik yapılmadı.');
    }

    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    const email = user.email?.trim() || null;
    const scrubFullName = fullName || `__missing-full-name-${input.requestId}`;
    const scrubEmail = email || `__missing-email-${input.requestId}`;
    const phoneDigits = getTurkishPhoneLookupDigits(user.phone) || ['', '', ''];
    const deletionMarker = input.requestId.replace(/-/g, '').slice(0, 8);
    const deletedRosterPhonePrefix = `del-${deletionMarker}-`;

    // Revoke pending access paths and device delivery targets before removing the identity.
    await tx.query('DELETE FROM mobile_push_devices WHERE user_id=$1', [user.id]);
    await tx.query('DELETE FROM notifications WHERE user_id=$1', [user.id]);
    await tx.query(
      `DELETE FROM invitations
       WHERE target_user_id=$1 OR regexp_replace(COALESCE(target_phone,''),'[^0-9]','','g') IN ($2,$3,$4)`,
      [user.id, ...phoneDigits],
    );
    await tx.query('UPDATE invitations SET created_by=NULL WHERE created_by=$1', [user.id]);
    await tx.query(
      `DELETE FROM pending_staff
       WHERE regexp_replace(phone,'[^0-9]','','g') IN ($1,$2,$3)`,
      phoneDigits,
    );
    await tx.query('UPDATE pending_staff SET created_by=NULL WHERE created_by=$1', [user.id]);
    await tx.query(
      `DELETE FROM otp_verifications
       WHERE regexp_replace(phone,'[^0-9]','','g') IN ($1,$2,$3)`,
      phoneDigits,
    );

    // Preserve institutional appointment facts while removing the parent's identity and private content.
    await tx.query(
      `UPDATE appointments SET
         parent_id=NULL,
         parent_name=$2,
         parent_phone=$3,
         notes=NULL,
         qr_token=NULL,
         status=CASE WHEN status IN ('pending','booked') THEN 'cancelled' ELSE status END,
         updated_at=NOW()
       WHERE parent_id=$1`,
      [user.id, DELETED_USER_LABEL, `del-${deletionMarker}`],
    );

    // Preserve the school's staff/appointment history, but remove the deleted teacher's identity and future slots.
    await tx.query(
      `UPDATE appointments a SET
         teacher_name=$2,
         teacher_branch='Silinmiş personel',
         approved_by=CASE WHEN approved_by=$1 THEN NULL ELSE approved_by END,
         checked_in_by=CASE WHEN checked_in_by=$1 THEN NULL ELSE checked_in_by END,
         updated_at=NOW()
       FROM teacher_profiles tp
       WHERE tp.user_id=$1 AND a.school_id=tp.school_id AND a.teacher_id=tp.id`,
      [user.id, DELETED_USER_LABEL],
    );
    await tx.query('UPDATE appointments SET approved_by=NULL WHERE approved_by=$1', [user.id]);
    await tx.query('UPDATE appointments SET checked_in_by=NULL WHERE checked_in_by=$1', [user.id]);
    await tx.query(
      `DELETE FROM availability_slots
       WHERE teacher_id IN (SELECT id FROM teacher_profiles WHERE user_id=$1)`,
      [user.id],
    );
    await tx.query(
      `UPDATE teacher_profiles SET
         user_id=NULL,
         first_name='Silinmiş',
         last_name='Kullanıcı',
         email=NULL,
         phone=NULL,
         account_deleted_at=NOW(),
         updated_at=NOW()
       WHERE user_id=$1`,
      [user.id],
    );

    // Keep student records, but sever and anonymize the deleted parent's roster identity.
    await tx.query(
      `UPDATE school_roster SET
         parent_name=$5,
         parent_phone=$6 || substr(md5($7::text || id),1,6),
         parent_account_deleted_at=NOW(),
         updated_at=NOW()
       WHERE school_id IN (SELECT school_id FROM school_memberships WHERE user_id=$1)
         AND regexp_replace(parent_phone,'[^0-9]','','g') IN ($2,$3,$4)`,
      [user.id, ...phoneDigits, DELETED_PARENT_LABEL, deletedRosterPhonePrefix, input.requestId],
    );

    // Remove personal support content while retaining the institutional request lifecycle.
    await tx.query(
      `UPDATE platform_requests SET
         created_by_user_id=NULL,
         status_updated_by_user_id=CASE WHEN status_updated_by_user_id=$1 THEN NULL ELSE status_updated_by_user_id END,
         contact_name_snapshot=$2,
         email_snapshot=NULL,
         phone_snapshot=NULL,
         subject=NULL,
         message=$3,
         privacy_anonymized_at=NOW(),
         updated_at=NOW()
       WHERE created_by_user_id=$1`,
      [user.id, DELETED_USER_LABEL, REDACTED_CONTENT],
    );
    await tx.query(
      `UPDATE platform_request_messages SET
         sender_user_id=NULL,
         sender_name_snapshot=$2,
         message=$3
       WHERE sender_user_id=$1`,
      [user.id, DELETED_USER_LABEL, REDACTED_CONTENT],
    );

    // Audit event/time/action survive; actor and free-text personal data do not.
    await tx.query(
      `UPDATE audit_logs AS target SET
         actor_name=CASE
           WHEN actor_user_id=$1 OR (
             actor_user_id IS NULL AND actor_name=$2 AND NOT EXISTS (
               SELECT 1 FROM users other_user
               JOIN school_memberships other_membership ON other_membership.user_id=other_user.id
               WHERE other_user.id<>$1 AND other_membership.school_id=target.school_id
                 AND btrim(concat_ws(' ',other_user.first_name,other_user.last_name))=$2
             )
           ) THEN $3 ELSE actor_name END,
         actor_user_id=CASE WHEN actor_user_id=$1 THEN NULL ELSE actor_user_id END,
         details=CASE
           WHEN actor_user_id=$1 OR (
             actor_user_id IS NULL AND actor_name=$2 AND NOT EXISTS (
               SELECT 1 FROM users other_user
               JOIN school_memberships other_membership ON other_membership.user_id=other_user.id
               WHERE other_user.id<>$1 AND other_membership.school_id=target.school_id
                 AND btrim(concat_ws(' ',other_user.first_name,other_user.last_name))=$2
             )
           ) THEN $4
           ELSE replace(
             replace(
               replace(details,$1,$3),
               $5,$3
             ),
             $6,$3
           )
         END
       WHERE actor_user_id=$1
          OR details LIKE '%' || $1 || '%'
          OR ($5<>'' AND details LIKE '%' || $5 || '%')
          OR ($6<>'' AND details LIKE '%' || $6 || '%')
          OR (
            school_id IN (SELECT school_id FROM school_memberships WHERE user_id=$1)
            AND (
             actor_user_id IS NULL AND actor_name=$2 AND NOT EXISTS (
               SELECT 1 FROM users other_user
               JOIN school_memberships other_membership ON other_membership.user_id=other_user.id
               WHERE other_user.id<>$1 AND other_membership.school_id=target.school_id
                 AND btrim(concat_ws(' ',other_user.first_name,other_user.last_name))=$2
             )
            )
          )`,
      [user.id, scrubFullName, DELETED_USER_LABEL, REDACTED_DETAIL, user.phone, scrubEmail],
    );

    // Explicitly invalidate credentials in the same transaction, then remove the global identity.
    await tx.query(
      `UPDATE users SET
         auth_version=auth_version+1,
         password_hash=NULL,
         email=NULL,
         first_name=$2,
         last_name='',
         security_question=NULL,
         is_phone_verified=FALSE,
         updated_at=NOW()
       WHERE id=$1`,
      [user.id, DELETED_USER_LABEL],
    );
    const removed = await tx.query('DELETE FROM users WHERE id=$1 RETURNING id', [user.id]);
    if (!removed.rows.length) throw new Error('Account identity was not removed');

    const receipt = await tx.query<{ completed_at: string }>(
      `INSERT INTO account_deletion_receipts(request_id,subject_hash)
       VALUES($1,$2)
       RETURNING completed_at`,
      [input.requestId, subjectHash],
    );

    return {
      completedAt: receipt.rows[0].completed_at,
      alreadyCompleted: false,
      notificationEmail: email,
      firstName: user.first_name || '',
    };
  });
}

export const accountDeletionRouter = Router();

accountDeletionRouter.post('/user/me/deletion', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const body = req.body as Record<string, unknown>;
  if ('userId' in body || 'schoolId' in body || 'targetUserId' in body) {
    return res.status(400).json({ error: 'Hesap silme isteği yalnız oturum sahibi için yapılabilir.' });
  }
  const password = typeof body.password === 'string' ? body.password : '';
  const confirmation = typeof body.confirmation === 'string' ? body.confirmation.trim() : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  if (!password || password.length > 128 || confirmation !== CONFIRMATION_PHRASE || !UUID_PATTERN.test(requestId)) {
    return res.status(400).json({ error: 'Parola, onay metni veya istek kimliği geçersiz.' });
  }
  if (!checkRateLimit(`account-deletion:${req.user!.id}`, 5, 15 * 60)) {
    return res.status(429).json({ error: 'Çok fazla hesap silme denemesi yapıldı. Lütfen daha sonra tekrar deneyin.' });
  }

  try {
    const result = await deleteOwnAccount({ userId: req.user!.id, password, requestId });
    let notificationSent = false;
    if (!result.alreadyCompleted && result.notificationEmail) {
      const rendered = renderBrandedEmail({
        subtitle: 'Hesap silme işlemi tamamlandı',
        greeting: result.firstName,
        intro: [
          'Veli Randevu hesabınız ve kişisel giriş bilgileriniz silindi.',
          'Okula ait zorunlu randevu ve güvenlik kayıtları kimliğinizden ayrıştırılarak anonimleştirildi.',
        ],
        notice: 'Bu e-posta yalnız işlemin tamamlandığını bildirmek amacıyla gönderilmiştir.',
      });
      try {
        await sendEmail({
          to: result.notificationEmail,
          subject: 'Veli Randevu — Hesap silme işlemi tamamlandı',
          idempotencyKey: `account-deletion-${requestId}`,
          ...rendered,
        });
        notificationSent = true;
      } catch {
        // Deletion is complete and must never be rolled back because an optional notification failed.
      }
    }
    return res.status(200).json({
      success: true,
      completed: true,
      completedAt: result.completedAt,
      alreadyCompleted: result.alreadyCompleted,
      notificationSent,
      message: 'Hesabınız ve kişisel verileriniz silindi. Zorunlu kurumsal kayıtlar anonimleştirildi.',
    });
  } catch (error) {
    if (error instanceof AccountDeletionError) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: 'Hesabınız silinemedi. Hiçbir değişiklik yapılmadı; lütfen tekrar deneyin.' });
  }
});
