import { Appointment, SecurityQrAppointment, SecurityQrDecision, SecurityQrVerification } from '../src/types';

export const SECURITY_ENTRY_EARLY_MINUTES = 30;
export const SECURITY_ENTRY_LATE_MINUTES = 30;

function getIstanbulDateParts(now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    minutes: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

function toMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function toAppointmentSummary(appointment: Appointment): SecurityQrAppointment {
  return {
    id: appointment.id,
    parentName: appointment.parentName,
    studentName: appointment.studentName,
    className: appointment.className,
    teacherName: appointment.teacherName,
    teacherBranch: appointment.teacherBranch,
    date: appointment.date,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    checkedInAt: appointment.checkedInAt,
  };
}

function result(
  decision: SecurityQrDecision,
  title: string,
  message: string,
  appointment?: Appointment
): SecurityQrVerification {
  return {
    success: true,
    allowed: decision === 'APPROVED',
    decision,
    title,
    message,
    ...(appointment ? { appointment: toAppointmentSummary(appointment) } : {}),
  };
}

export function invalidQrVerification(): SecurityQrVerification {
  return result('INVALID', 'GEÇERSİZ QR KODU', 'Bu QR koduyla geçerli bir randevu bulunamadı.');
}

export function evaluateSecurityQr(appointment: Appointment, now = new Date()): SecurityQrVerification {
  if (appointment.status === 'pending') {
    return result('PENDING_APPROVAL', 'RANDEVU HENÜZ ONAYLANMADI', 'Öğretmen onayı bekleniyor.', appointment);
  }
  if (appointment.status === 'rejected') {
    return result('REJECTED', 'RANDEVU REDDEDİLMİŞ', 'Bu randevu öğretmen tarafından onaylanmamıştır.', appointment);
  }
  if (appointment.status === 'cancelled') {
    return result('CANCELLED', 'RANDEVU İPTAL EDİLMİŞ', 'Bu randevu iptal edilmiş.', appointment);
  }
  if (appointment.status === 'checked_in') {
    return result('ALREADY_CHECKED_IN', 'DAHA ÖNCE GİRİŞ KAYDI YAPILDI', `Giriş zamanı: ${appointment.checkedInAt || 'kayıtlı'}.`, appointment);
  }
  if (appointment.status !== 'booked') {
    return result('INVALID', 'RANDEVU DOĞRULANAMADI', 'Bu randevu giriş için doğrulanamadı.');
  }

  const serverTime = getIstanbulDateParts(now);
  const startMinutes = toMinutes(appointment.startTime);
  const endMinutes = toMinutes(appointment.endTime);
  if (startMinutes === null || endMinutes === null) {
    return result('INVALID', 'RANDEVU DOĞRULANAMADI', 'Bu randevu giriş için doğrulanamadı.');
  }

  if (appointment.date > serverTime.date || (appointment.date === serverTime.date && serverTime.minutes < startMinutes - SECURITY_ENTRY_EARLY_MINUTES)) {
    return result('TOO_EARLY', 'RANDEVU SAATİ HENÜZ GELMEDİ', 'Randevunun giriş saati henüz gelmedi.', appointment);
  }
  if (appointment.date < serverTime.date || (appointment.date === serverTime.date && serverTime.minutes > endMinutes + SECURITY_ENTRY_LATE_MINUTES)) {
    return result('EXPIRED', 'RANDEVU SÜRESİ GEÇMİŞ', 'Bu randevunun giriş süresi sona erdi.', appointment);
  }

  return result('APPROVED', 'RANDEVU ONAYLANDI', 'Veliye okula giriş izni verebilirsiniz.', appointment);
}
