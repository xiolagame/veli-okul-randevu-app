import crypto from 'crypto';
import { generateSetupToken, hashSetupToken } from './activation-codes';
import { getDb, TransactionClient } from './database/postgres';
import { sendEmail } from './email';
import { Appointment } from '../src/types';

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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
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
  const origin = process.env.URL?.startsWith('https://') ? process.env.URL.replace(/\/$/, '')
    : process.env.NODE_ENV === 'production' ? 'https://velirokulrandevu.netlify.app' : 'http://localhost:3000';
  const link = `${origin}/#appointment-review=${encodeURIComponent(data.appointment.schoolId)}.${token}`;
  const appointment = data.appointment;
  const date = appointment.date.split('-').reverse().join('/');
  await sendEmail({ to: data.teacherEmail, subject: 'Veli Randevu — Yeni Randevu Talebi',
    html: `<p>Merhaba ${escapeHtml(data.teacherName)},</p><p>${escapeHtml(data.schoolName)} okulunda ${escapeHtml(appointment.className)} sınıfındaki ${escapeHtml(appointment.studentName)} öğrencisinin velisi ${escapeHtml(appointment.parentName)}, ${escapeHtml(date)} tarihinde ${escapeHtml(appointment.startTime)}–${escapeHtml(appointment.endTime)} saatleri için randevu talebi oluşturmuştur.</p><p>Müsaitseniz velinin okula giriş izninin oluşturulabilmesi için lütfen randevuyu inceleyip onaylayınız.</p><p><a href="${escapeHtml(link)}">Randevu Talebini İncele</a></p><p>Bağlantı 24 saat geçerlidir. Onaylamak için öğretmen hesabınızla giriş yapmanız gerekir.</p>` });
}
