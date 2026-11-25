import type { AvailabilitySlot } from '../types';

// Öğretmenin müsaitlik formu için saf (arayüzsüz) yardımcılar; testlenebilir.
export const AVAILABILITY_FIRST_MINUTE = 6 * 60;   // 06:00
export const AVAILABILITY_LAST_MINUTE = 22 * 60;   // 22:00

export const AVAILABILITY_PRESETS = [
  { start: '09:00', end: '12:00' },
  { start: '13:00', end: '15:00' },
] as const;

export const WEEKDAY_IDS = [1, 2, 3, 4, 5] as const; // Pazartesi..Cuma

export function toMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Başlangıcı/bitişi `step` dakika kaydırır; aralık 06:00–22:00 içinde ve en az bir görüşme uzunluğunda kalır.
export function shiftTime(range: { start: string; end: string }, which: 'start' | 'end', direction: 1 | -1, step: number): { start: string; end: string } {
  const start = toMinutes(range.start);
  const end = toMinutes(range.end);
  if (which === 'start') {
    const next = Math.min(Math.max(start + direction * step, AVAILABILITY_FIRST_MINUTE), end - step);
    return { start: fromMinutes(next), end: range.end };
  }
  const next = Math.max(Math.min(end + direction * step, AVAILABILITY_LAST_MINUTE), start + step);
  return { start: range.start, end: fromMinutes(next) };
}

// Aralıkta kaç görüşme sığar.
export function meetingCount(start: string, end: string, durationMinutes: number): number {
  if (durationMinutes < 1) return 0;
  return Math.max(0, Math.floor((toMinutes(end) - toMinutes(start)) / durationMinutes));
}

// Aralık süreye tam bölünmüyorsa sonda kullanılmayan dakika.
export function unusedMinutes(start: string, end: string, durationMinutes: number): number {
  if (durationMinutes < 1) return 0;
  const span = toMinutes(end) - toMinutes(start);
  return span > 0 ? span % durationMinutes : 0;
}

// Seçilen günlerden hangilerine eklenebilir, hangilerinde mevcut bir aralıkla çakışır.
export function planAvailabilityAdditions(existing: Pick<AvailabilitySlot, 'dayOfWeek' | 'startTime' | 'endTime'>[], days: number[], start: string, end: string): { add: number[]; conflicts: number[] } {
  const add: number[] = [];
  const conflicts: number[] = [];
  for (const day of [...days].sort((a, b) => a - b)) {
    const overlaps = existing.some((slot) => slot.dayOfWeek === day && slot.startTime < end && slot.endTime > start);
    (overlaps ? conflicts : add).push(day);
  }
  return { add, conflicts };
}
