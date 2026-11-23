// Velinin randevu alabileceği tarih aralığı. Uygulama (takvim) ve sunucu (kayıt) aynı kuralı kullanır.
// Tüm hesaplar İstanbul saatine göredir.
export const MAX_BOOKING_DAYS_AHEAD = 14;

function istanbulParts(now: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// İlk ve son seçilebilir gün (ikisi dahil): bugün .. bugün + 14 gün.
export function bookingWindow(now: Date = new Date()): { firstDate: string; lastDate: string } {
  const today = istanbulParts(now).date;
  return { firstDate: today, lastDate: addDays(today, MAX_BOOKING_DAYS_AHEAD) };
}

export function isDateInBookingWindow(date: string, now: Date = new Date()): boolean {
  const { firstDate, lastDate } = bookingWindow(now);
  return date >= firstDate && date <= lastDate;
}

// Bugün için geçmiş saat seçilemez (saat "SS:DD" metni, metin karşılaştırması doğru sıralar).
export function isSlotInFuture(date: string, startTime: string, now: Date = new Date()): boolean {
  const current = istanbulParts(now);
  return date > current.date || (date === current.date && startTime > current.time);
}

export type BookingTimeProblem = 'PAST' | 'TOO_FAR' | null;

export function bookingTimeProblem(date: string, startTime: string, now: Date = new Date()): BookingTimeProblem {
  if (!isSlotInFuture(date, startTime, now)) return 'PAST';
  if (!isDateInBookingWindow(date, now)) return 'TOO_FAR';
  return null;
}
