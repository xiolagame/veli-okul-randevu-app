// Randevu bildirimlerinin metinleri tek yerde. Aynı metin hem uygulama içi bildirimde hem telefona giden push'ta
// kullanılır. Üç fiil karışmasın diye ayrı tutulur: onayladı, reddetti, iptal etti ("onaylanmadı" kullanılmaz).

export const APPOINTMENT_REASON_MAX_LENGTH = 500;
export const PUSH_BODY_MAX_LENGTH = 110;

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export interface AppointmentMessage { title: string; message: string }

/** "2026-11-27" + "10:00:00" → "27 Kasım Cuma 10:00". Çözülemeyen tarih olduğu gibi kalır. */
export function formatAppointmentWhen(date: string, startTime: string): string {
  const time = String(startTime || '').slice(0, 5);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
  if (!match) return `${date} ${time}`.trim();
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (!MONTHS[month - 1] || Number.isNaN(weekday)) return `${date} ${time}`.trim();
  return `${day} ${MONTHS[month - 1]} ${WEEKDAYS[weekday]} ${time}`.trim();
}

/** İsteğe bağlı gerekçe: boşluklar sadeleşir, en fazla 500 karakter; boşsa undefined. */
export function cleanAppointmentReason(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim().slice(0, APPOINTMENT_REASON_MAX_LENGTH).trim();
  return text || undefined;
}

const withReason = (text: string, reason?: string) => (reason ? `${text} Sebep: ${reason}` : text);
const person = (name: string, student: string, className: string) =>
  [student, className].filter(Boolean).length ? `${name} (${[student, className].filter(Boolean).join(', ')})` : name;

export function appointmentRequestedMessage(input: { parentName: string; studentName: string; className: string; date: string; startTime: string }): AppointmentMessage {
  return { title: 'Yeni randevu talebi',
    message: `${person(input.parentName, input.studentName, input.className)} ${formatAppointmentWhen(input.date, input.startTime)} için randevu talep etti.` };
}

export function appointmentApprovedMessage(input: { teacherName: string; date: string; startTime: string }): AppointmentMessage {
  return { title: 'Randevunuz onaylandı',
    message: `${input.teacherName}, ${formatAppointmentWhen(input.date, input.startTime)} randevunuzu onayladı.` };
}

export function appointmentRejectedMessage(input: { teacherName: string; reason?: string }): AppointmentMessage {
  return { title: 'Randevunuz reddedildi', message: withReason(`${input.teacherName} randevu talebinizi reddetti.`, input.reason) };
}

/** Öğretmen ya da okul yönetimi iptal ettiğinde veliye giden bildirim. */
export function appointmentCancelledForParentMessage(input: { cancelledBy: 'teacher' | 'admin'; teacherName: string; date: string; startTime: string; reason?: string }): AppointmentMessage {
  const actor = input.cancelledBy === 'teacher' ? input.teacherName : 'Okul yönetimi';
  return { title: 'Randevunuz iptal edildi',
    message: withReason(`${actor}, ${formatAppointmentWhen(input.date, input.startTime)} randevunuzu iptal etti.`, input.reason) };
}

/** Veli iptal ettiğinde öğretmene giden bildirim. */
export function appointmentCancelledForTeacherMessage(input: { parentName: string; studentName: string; className: string; date: string; startTime: string; reason?: string }): AppointmentMessage {
  return { title: 'Randevu iptal edildi',
    message: withReason(`${person(input.parentName, input.studentName, input.className)}, ${formatAppointmentWhen(input.date, input.startTime)} randevusunu iptal etti.`, input.reason) };
}

/** Push metni kısa kalır: uzun gerekçe kelime sınırında "…" ile kesilir; tamamı uygulama içinde görünür. */
export function shortenForPush(text: string, max = PUSH_BODY_MAX_LENGTH): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:]+$/, '')}…`;
}
