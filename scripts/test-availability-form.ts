import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AvailabilityForm } from '../src/components/AvailabilityForm';
import { AVAILABILITY_PRESETS, fromMinutes, meetingCount, planAvailabilityAdditions, shiftTime, toMinutes } from '../src/utils/availability-form';

assert.deepEqual(AVAILABILITY_PRESETS.map((p) => `${p.start}-${p.end}`), ['09:00-12:00', '13:00-15:00'], 'hazır saatler');
assert.equal(toMinutes('09:30'), 570);
assert.equal(fromMinutes(570), '09:30');
assert.equal(meetingCount('09:00', '12:00', 15), 12);
assert.equal(meetingCount('13:00', '15:00', 20), 6);
assert.equal(meetingCount('09:00', '09:10', 15), 0);

// –/+ ince ayar: sınırlar ve en az bir görüşme uzunluğu
let range = { start: '09:00', end: '12:00' };
range = shiftTime(range, 'start', 1, 15); assert.deepEqual(range, { start: '09:15', end: '12:00' });
range = shiftTime(range, 'end', -1, 15); assert.deepEqual(range, { start: '09:15', end: '11:45' });
assert.equal(shiftTime({ start: '11:45', end: '12:00' }, 'start', 1, 15).start, '11:45', 'başlangıç bitişe en fazla bir görüşme kala gelir');
assert.equal(shiftTime({ start: '11:45', end: '12:00' }, 'end', -1, 15).end, '12:00', 'bitiş başlangıçtan en az bir görüşme sonra');
assert.equal(shiftTime({ start: '06:00', end: '09:00' }, 'start', -1, 15).start, '06:00', '06:00 altına inmez');
assert.equal(shiftTime({ start: '20:00', end: '22:00' }, 'end', 1, 15).end, '22:00', '22:00 üstüne çıkmaz');

// Çok günlü ekleme planı: çakışan günler ayrılır
const existing = [{ dayOfWeek: 2, startTime: '09:00', endTime: '17:00' }, { dayOfWeek: 4, startTime: '13:00', endTime: '15:00' }];
assert.deepEqual(planAvailabilityAdditions(existing, [1, 2, 3, 4, 5], '09:00', '12:00'), { add: [1, 3, 4, 5], conflicts: [2] });
assert.deepEqual(planAvailabilityAdditions(existing, [4, 1], '15:00', '16:00'), { add: [1, 4], conflicts: [] }, 'uç uca gelen aralık çakışmaz');
assert.deepEqual(planAvailabilityAdditions(existing, [2], '10:00', '11:00'), { add: [], conflicts: [2] });

// Arayüz işaretlemesi
const html = renderToStaticMarkup(React.createElement(AvailabilityForm, { durationMinutes: 15, busy: false, onSubmit: () => {} }));
for (const text of ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Hafta içi', '09:00 – 12:00', '13:00 – 15:00', 'Başlangıç', 'Bitiş', 'Programa ekle']) assert(html.includes(text), text);
assert(!html.includes('type="time"'), 'saat kadranı (type=time) kullanılmaz');
assert(html.includes('disabled=""') && html.includes('Önce bir veya birkaç gün seçin.'), 'gün seçilmeden ekleme kapalı');

console.log('Müsaitlik formu (günler, hazır saatler, –/+ ayar, çok günlü plan) PASS');
