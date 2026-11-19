import crypto from 'crypto';
import { generateSetupToken, hashSetupToken } from './activation-codes';
import { getDb, TransactionClient } from './database/postgres';
import { sendEmail } from './email';
import { Appointment } from '../src/types';
import { renderBrandedEmail } from './email-template';
import { getPublicOrigin } from './public-origin';

export const appointmentReviewPurpose = 'appointment_email_review';

export type ReviewBinding = { a: string; t: string; d: string; s: string; e: string };

export function reviewBinding(appointment: Appointment): ReviewBinding {
  return { a: appointment.id, t: appointment.teacherId, d: appointment.date,
    s: appointment.startTime, e: appointment.endTime };
}

export function matchesReviewBinding(value: string | null, appointment: Appointment): boolean {
  try {
    const binding = JSON.parse(value || '') as ReviewBinding;
    const expected = reviewBinding(appointment);
    return Object.keys(expected).every((key) => binding[key as keyof ReviewBinding] === expected[key as keyof ReviewBinding]);
  } catch { return false; }
}

export async function findAppointmentReview(client: TransactionClient, schoolId: string, teacherUserId: string, token: string, lock = false) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await client.query<{ id: string; description: string }>(
    `SELECT id,description FROM invitations WHERE school_id=$1 AND target_user_id=$2
       AND target_role='teacher' AND purpose=$3 AND token=$4 AND is_active=TRUE
       AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW()
       ${lock ? 'FOR UPDATE' : ''}`,
    [schoolId, teacherUserId, appointmentReviewPurpose, hashSetupToken(token)]);
  return result.rows[0] || null;
}

export async function sendAppointmentRequestEmail(data: {
  appointment: Appointment; teacherUserId: string; teacherEmail: string;
  schoolName: string; teacherName: string;
}): Promise<void> {
  const token = generateSetupToken();
  const db = await getDb();
  await db.query(`INSERT INTO invitations
    (id,school_id,token,description,is_active,expires_at,purpose,target_user_id,target_role)
    VALUES ($1,$2,$3,$4,TRUE,NOW()+INTERVAL '24 hours',$5,$6,'teacher')`,
    [crypto.randomUUID(), data.appointment.schoolId, hashSetupToken(token),
      JSON.stringify(reviewBinding(data.appointment)), appointmentReviewPurpose, data.teacherUserId]);
  const link = `${getPublicOrigin()}/#appointment-review=${encodeURIComponent(data.appointment.schoolId)}.${token}`;
  const appointment = data.appointment;
  const date = appointment.date.split('-').reverse().join('/');
  const rendered = renderBrandedEmail({
    subtitle: 'Yeni Randevu Talebi',
    greeting: data.teacherName,
    intro: [
      `${data.schoolName} okulunda yeni bir veli görüşme talebi oluşturuldu.`,
      'Müsaitseniz velinin okula giriş izninin oluşturulabilmesi için randevuyu inceleyip onaylayın.',
      ...(appointment.notes?.trim() ? [`Veli Notu: ${appointment.notes.trim()}`] : []),
    ],
    infoCards: [
      { label: 'Öğrenci', value: `${appointment.studentName} · ${appointment.className}` },
      { label: 'Veli', value: appointment.parentName },
      { label: 'Randevu', value: `${date} · ${appointment.startTime}–${appointment.endTime}`, tone: 'accent' },
    ],
    action: { label: 'Randevu Talebini İncele', url: link },
    notice: 'Bağlantı 24 saat geçerlidir. Onaylamak için öğretmen hesabınızla giriş yapmanız gerekir.',
  });
  await sendEmail({ to: data.teacherEmail, subject: 'Veli Randevu — Yeni Randevu Talebi', ...rendered });
}
