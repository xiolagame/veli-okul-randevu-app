import { getDb } from './database/postgres';
import { sendEmail } from './email';
import { renderBrandedEmail } from './email-template';

interface ReminderAppointment {
  id: string;
  school_name: string;
  teacher_name: string;
  teacher_email: string;
  student_name: string;
  class_name: string;
  parent_name: string;
  date: string;
  start_time: string;
  end_time: string;
}

export interface ReminderJobResult {
  eligible: number;
  sent: number;
  failed: number;
  skipped: number;
}

const dueCondition = `a.status='booked'
  AND a.teacher_reminder_30m_sent_at IS NULL
  AND (a.date::date + a.start_time::time) AT TIME ZONE 'Europe/Istanbul' > NOW()
  AND (a.date::date + a.start_time::time) AT TIME ZONE 'Europe/Istanbul' <= NOW() + INTERVAL '30 minutes'`;

export async function runAppointmentReminderJob(options: { limit?: number; schoolId?: string } = {}): Promise<ReminderJobResult> {
  const db = await getDb();
  const limit = options.limit ?? 100;
  const candidates = await db.query<{ id: string }>(
    `SELECT a.id FROM appointments a
     JOIN schools s ON s.id=a.school_id AND s.disabled_at IS NULL
     WHERE ${dueCondition} AND ($2::text IS NULL OR a.school_id=$2)
     ORDER BY a.date,a.start_time,a.id LIMIT $1`, [limit, options.schoolId || null]);
  const result: ReminderJobResult = { eligible: candidates.rows.length, sent: 0, failed: 0, skipped: 0 };

  for (const candidate of candidates.rows) {
    try {
      const sent = await db.transaction(async (tx) => {
        const appointment = await tx.query<ReminderAppointment>(
          `SELECT a.id,s.name AS school_name,
             TRIM(tp.first_name || ' ' || tp.last_name) AS teacher_name,
             COALESCE(NULLIF(tp.email,''),NULLIF(u.email,'')) AS teacher_email,
             a.student_name,a.class_name,a.parent_name,a.date,a.start_time,a.end_time
           FROM appointments a
           JOIN schools s ON s.id=a.school_id AND s.disabled_at IS NULL
           JOIN teacher_profiles tp ON tp.school_id=a.school_id AND tp.id=a.teacher_id
           JOIN users u ON u.id=tp.user_id
           JOIN school_memberships sm ON sm.school_id=a.school_id AND sm.user_id=u.id
             AND sm.role='teacher' AND sm.status='active'
           WHERE a.id=$1 AND ${dueCondition} AND ($2::text IS NULL OR a.school_id=$2)
           FOR UPDATE OF a`, [candidate.id, options.schoolId || null]);
        const record = appointment.rows[0];
        if (!record?.teacher_email) return false;
        const date = record.date.split('-').reverse().join('/');
        const email = renderBrandedEmail({
          subtitle: 'Randevu Hatırlatması',
          greeting: record.teacher_name,
          intro: [
            'Randevunuza 30 dakika kaldı.',
            `Okul: ${record.school_name}`,
            'Görüşme programınızı kontrol ederek zamanında hazır olun.',
          ],
          infoCards: [
            { label: 'Öğrenci', value: `${record.student_name} · ${record.class_name}` },
            { label: 'Veli', value: record.parent_name },
            { label: 'Randevu', value: `${date} · ${record.start_time}–${record.end_time}`, tone: 'accent' },
          ],
          notice: 'Bu e-posta yalnızca onaylanmış ve yaklaşan randevular için gönderilir.',
        });
        await sendEmail({
          to: record.teacher_email,
          subject: 'Veli Randevu — Randevunuza 30 Dakika Kaldı',
          ...email,
          idempotencyKey: `teacher-appointment-reminder-30m/${record.id}`,
        });
        await tx.query(`UPDATE appointments SET teacher_reminder_30m_sent_at=NOW(),
          teacher_reminder_30m_last_attempt_at=NOW(),teacher_reminder_30m_attempts=teacher_reminder_30m_attempts+1,
          updated_at=NOW() WHERE id=$1`, [record.id]);
        return true;
      });
      if (sent) result.sent += 1;
      else result.skipped += 1;
    } catch {
      result.failed += 1;
      await db.query(`UPDATE appointments SET teacher_reminder_30m_last_attempt_at=NOW(),
        teacher_reminder_30m_attempts=teacher_reminder_30m_attempts+1,updated_at=NOW()
        WHERE id=$1 AND teacher_reminder_30m_sent_at IS NULL`, [candidate.id]).catch(() => {});
    }
  }
  return result;
}
