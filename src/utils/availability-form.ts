import type { AvailabilitySlot } from '../types';
import { AVAILABILITY_DAYS } from './availability';

// Öğretmenin müsaitlik formu için saf (arayüzsüz) yardımcılar; testlenebilir.
// Kurallar:
// - Başlangıç ve bitiş seçilen görüşme süresi kadar kayar; aralık her zaman sürenin tam katıdır.
// - Başlangıç belirleyicidir: başlangıç ilerleyince bitiş gerekirse en az bir görüşme sonrasına kayar.
// - Süre veya hazır saat değişince bitiş en yakın geçerli saate oturur (eşitlikte erken olana).
// - Saatler 06:00–22:00 arasındadır.
// - Bir günde tek görüşme süresi olur.
export const AVAILABILITY_FIRST_MINUTE = 6 * 60;   // 06:00
export const AVAILABILITY_LAST_MINUTE = 22 * 60;   // 22:00

export const AVAILABILITY_PRESETS = [
  { start: '09:00', end: '12:00' },
  { start: '13:00', end: '15:00' },
] as const;

export const WEEKDAY_IDS = [1, 2, 3, 4, 5] as const; // Pazartesi..Cuma

export type TimeRange = { start: string; end: string };
export type RangeChange = { range: TimeRange; note: string };
export type TypedTimeResult = { ok: true; range: TimeRange; note: string } | { ok: false; error: string };

export function toMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function dayName(id: number): string {
  return AVAILABILITY_DAYS.find((day) => day.id === id)?.name || '';
}

// Bitişi, başlangıçtan süre katı olan en yakın saate oturtur (en az bir görüşme, en geç 22:00).
export function snapEnd(start: number, end: number, duration: number): number {
  const ratio = (end - start) / duration;
  const lower = Math.floor(ratio);
  const upper = Math.ceil(ratio);
  let meetings = ratio < 1 ? 1 : lower === upper ? lower : (ratio - lower <= upper - ratio ? lower : upper);
  while (meetings > 1 && start + meetings * duration > AVAILABILITY_LAST_MINUTE) meetings -= 1;
  return start + meetings * duration;
}

// Süre ya da hazır saat değişince aralığı kurallara uydurur.
export function fitRange(range: TimeRange, duration: number): RangeChange {
  let start = toMinutes(range.start);
  let note = '';
  if (start + duration > AVAILABILITY_LAST_MINUTE) {
    start = AVAILABILITY_LAST_MINUTE - duration;
    note = `Başlangıç ${fromMinutes(start)} oldu. Bitiş 22:00'yi aşamaz.`;
  }
  const end = snapEnd(start, toMinutes(range.end), duration);
  if (!note && end !== toMinutes(range.end)) note = `Bitiş ${fromMinutes(end)} oldu.`;
  return { range: { start: fromMinutes(start), end: fromMinutes(end) }, note };
}

export function canMoveStart(range: TimeRange, direction: 1 | -1, duration: number): boolean {
  const next = toMinutes(range.start) + direction * duration;
  return next >= AVAILABILITY_FIRST_MINUTE && next + duration <= AVAILABILITY_LAST_MINUTE;
}

export function canMoveEnd(range: TimeRange, direction: 1 | -1, duration: number): boolean {
  const next = toMinutes(range.end) + direction * duration;
  return next <= AVAILABILITY_LAST_MINUTE && next >= toMinutes(range.start) + duration;
}

// Başlangıcı bir görüşme süresi kaydırır; bitiş gerekirse başlangıçtan bir görüşme sonrasına gelir.
export function moveStart(range: TimeRange, direction: 1 | -1, duration: number): RangeChange {
  if (!canMoveStart(range, direction, duration)) return { range, note: '' };
  const start = toMinutes(range.start) + direction * duration;
  const end = toMinutes(range.end);
  if (end < start + duration) return { range: { start: fromMinutes(start), end: fromMinutes(start + duration) }, note: `Bitiş ${fromMinutes(start + duration)} oldu.` };
  return { range: { start: fromMinutes(start), end: range.end }, note: '' };
}

export function moveEnd(range: TimeRange, direction: 1 | -1, duration: number): RangeChange {
  if (!canMoveEnd(range, direction, duration)) return { range, note: '' };
  return { range: { start: range.start, end: fromMinutes(toMinutes(range.end) + direction * duration) }, note: '' };
}

// Klavyeden yazarken: yalnız rakam alınır, iki nokta kendiliğinden eklenir (930 -> 09:30).
export function formatTypedTime(raw: string, deleting: boolean): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  let hours: string;
  let minutes: string;
  if (digits[0] >= '3') {
    hours = `0${digits[0]}`;
    minutes = digits.slice(1, 3);
  } else {
    if (digits.length === 1) return digits;
    hours = digits.slice(0, 2);
    if (Number(hours) > 23) return digits[0];
    minutes = digits.slice(2, 4);
  }
  if (minutes.length > 0 && minutes[0] > '5') minutes = '';
  const colon = minutes.length > 0 || !deleting || raw.endsWith(':');
  return `${hours}${colon ? ':' : ''}${minutes}`;
}

export function parseTypedTime(text: string): number | null {
  const digits = text.replace(/\D/g, '');
  if (!digits || digits.length > 4) return null;
  const hours = digits.length <= 2 ? Number(digits) : Number(digits.slice(0, -2));
  const minutes = digits.length <= 2 ? 0 : Number(digits.slice(-2));
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// Yazılan başlangıç saati: kurala uymuyorsa kabul edilmez; uyarsa bitiş gerekirse güncellenir.
export function applyTypedStart(range: TimeRange, text: string, duration: number): TypedTimeResult {
  const value = parseTypedTime(text);
  if (value === null) return { ok: false, error: 'Saati 09:30 şeklinde yazın.' };
  if (value < AVAILABILITY_FIRST_MINUTE) return { ok: false, error: 'Başlangıç en erken 06:00 olabilir.' };
  if (value + duration > AVAILABILITY_LAST_MINUTE) {
    return { ok: false, error: `Başlangıç en geç ${fromMinutes(AVAILABILITY_LAST_MINUTE - duration)} olabilir. ${duration} dk'lık görüşme 22:00'den sonra bitemez.` };
  }
  const oldEnd = toMinutes(range.end);
  const end = oldEnd < value + duration ? value + duration : snapEnd(value, oldEnd, duration);
  return { ok: true, range: { start: fromMinutes(value), end: fromMinutes(end) }, note: end !== oldEnd ? `Bitiş ${fromMinutes(end)} oldu.` : '' };
}

// Yazılan bitiş saati: başlangıçtan süre katı olmalı; değilse kabul edilmez ve eski saat kalır.
export function applyTypedEnd(range: TimeRange, text: string, duration: number): TypedTimeResult {
  const value = parseTypedTime(text);
  if (value === null) return { ok: false, error: 'Saati 09:30 şeklinde yazın.' };
  const start = toMinutes(range.start);
  if (value > AVAILABILITY_LAST_MINUTE) return { ok: false, error: 'Bitiş en geç 22:00 olabilir.' };
  if (value < start + duration) return { ok: false, error: `Bitiş, başlangıçtan en az ${duration} dk sonra olmalı. En erken ${fromMinutes(start + duration)}.` };
  if ((value - start) % duration !== 0) {
    const lower = start + Math.floor((value - start) / duration) * duration;
    const upper = lower + duration;
    const options = upper <= AVAILABILITY_LAST_MINUTE ? `${fromMinutes(lower)} veya ${fromMinutes(upper)}` : fromMinutes(lower);
    return { ok: false, error: `${fromMinutes(value)} uygun değil. ${duration} dk'lık görüşmelerde bitiş ${options} olabilir. Bitiş ${range.end} olarak kaldı.` };
  }
  return { ok: true, range: { start: range.start, end: fromMinutes(value) }, note: '' };
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

// Bir günde farklı süreli müsaitlik varsa o güne başka süre eklenemez.
export function daysWithOtherDuration(existing: Pick<AvailabilitySlot, 'dayOfWeek' | 'slotDurationMinutes'>[], days: number[], duration: number): number[] {
  return [...days].sort((a, b) => a - b).filter((day) => existing.some((slot) => slot.dayOfWeek === day && slot.slotDurationMinutes !== duration));
}

export function otherDurationMessage(day: number): string {
  return `${dayName(day)} için bir müsaitliğiniz var, farklı bir süre için önce onu silin.`;
}

// Seçilen günlerden hangilerine eklenebilir; farklı süreli ve çakışan günler ayrılır.
type ExistingSlot = Pick<AvailabilitySlot, 'dayOfWeek' | 'startTime' | 'endTime'> & { slotDurationMinutes?: number };

export function planAvailabilityAdditions(
  slots: ExistingSlot[],
  days: number[],
  start: string,
  end: string,
  duration?: number,
): { add: number[]; conflicts: number[]; otherDuration: number[] } {
  const add: number[] = [];
  const conflicts: number[] = [];
  const otherDuration: number[] = [];
  for (const day of [...days].sort((a, b) => a - b)) {
    if (duration !== undefined && slots.some((slot) => slot.dayOfWeek === day && slot.slotDurationMinutes !== undefined && slot.slotDurationMinutes !== duration)) {
      otherDuration.push(day);
      continue;
    }
    const overlaps = slots.some((slot) => slot.dayOfWeek === day && slot.startTime < end && slot.endTime > start);
    (overlaps ? conflicts : add).push(day);
  }
  return { add, conflicts, otherDuration };
}
