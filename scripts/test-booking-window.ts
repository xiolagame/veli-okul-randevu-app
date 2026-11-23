import assert from 'node:assert/strict';
import { MAX_BOOKING_DAYS_AHEAD, bookingTimeProblem, bookingWindow, isDateInBookingWindow, isSlotInFuture } from '../src/utils/booking-window';

// 2026-11-23 20:40 İstanbul (UTC+3) = 17:40 UTC
const now = new Date('2026-11-23T17:40:00Z');

assert.equal(MAX_BOOKING_DAYS_AHEAD, 14);
assert.deepEqual(bookingWindow(now), { firstDate: '2026-11-23', lastDate: '2026-12-07' });
assert.equal(isDateInBookingWindow('2026-11-23', now), true);
assert.equal(isDateInBookingWindow('2026-12-07', now), true, '14. gün dahil');
assert.equal(isDateInBookingWindow('2026-12-08', now), false, '15. gün kapalı');
assert.equal(isDateInBookingWindow('2026-11-22', now), false, 'dün kapalı');

assert.equal(isSlotInFuture('2026-11-23', '20:30', now), false, 'bugün geçmiş saat');
assert.equal(isSlotInFuture('2026-11-23', '20:40', now), false, 'şu anki saat');
assert.equal(isSlotInFuture('2026-11-23', '20:45', now), true);
assert.equal(isSlotInFuture('2026-11-24', '09:00', now), true);

assert.equal(bookingTimeProblem('2026-11-23', '10:00', now), 'PAST');
assert.equal(bookingTimeProblem('2026-12-10', '10:00', now), 'TOO_FAR');
assert.equal(bookingTimeProblem('2026-11-26', '10:15', now), null);

// Gece yarısına yakın: İstanbul'da gün UTC'den önce değişir.
const lateNight = new Date('2026-11-23T21:30:00Z'); // İstanbul 24 Kasım 00:30
assert.equal(bookingWindow(lateNight).firstDate, '2026-11-24');

console.log('Randevu tarih aralığı (bugün .. +14 gün, geçmiş saat yok) PASS');
