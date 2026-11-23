import { bookingWindow, MAX_BOOKING_DAYS_AHEAD } from '../../src/utils/booking-window';

// Testler randevu tarihlerini sabit (2090 veya geçmiş) yazmak yerine, velinin seçebileceği
// "bugün + 1 .. bugün + 14" aralığından üretir; böylece 14 gün kuralı testleri bozmaz.
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function bookableDate(daysAhead: number): string {
  if (daysAhead < 1 || daysAhead > MAX_BOOKING_DAYS_AHEAD) throw new Error('daysAhead 1..14 olmalı');
  return addDays(bookingWindow().firstDate, daysAhead);
}

// Verilen tarihle aynı haftanın gününe denk gelen, randevu aralığındaki ilk tarih (yarından itibaren).
export function sameWeekdayInWindow(isoDate: string): string {
  const target = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  for (let i = 1; i <= 7; i++) {
    const candidate = bookableDate(i);
    if (new Date(`${candidate}T00:00:00Z`).getUTCDay() === target) return candidate;
  }
  throw new Error('Haftanın günü bulunamadı');
}
