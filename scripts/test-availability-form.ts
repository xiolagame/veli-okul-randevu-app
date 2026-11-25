import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AvailabilityForm } from '../src/components/AvailabilityForm';
import {
  AVAILABILITY_PRESETS, applyTypedEnd, applyTypedStart, canMoveEnd, canMoveStart, daysWithOtherDuration, fitRange,
  formatTypedTime, fromMinutes, meetingCount, moveEnd, moveStart, otherDurationMessage, parseTypedTime,
  planAvailabilityAdditions, snapEnd, toMinutes,
} from '../src/utils/availability-form';

assert.deepEqual(AVAILABILITY_PRESETS.map((p) => `${p.start}-${p.end}`), ['09:00-12:00', '13:00-15:00'], 'hazır saatler');
assert.equal(toMinutes('09:30'), 570);
assert.equal(fromMinutes(570), '09:30');
assert.equal(meetingCount('09:00', '12:00', 15), 12);
assert.equal(meetingCount('13:00', '15:00', 20), 6);

// Bitiş en yakın geçerli saate oturur (eşitlikte erken olana), en az bir görüşme, en geç 22:00.
assert.equal(fromMinutes(snapEnd(540, 720, 40)), '11:40', '09:00–12:00, 40 dk -> 11:40 (11:40 ve 12:20 eşit uzak, erken olan)');
assert.equal(fromMinutes(snapEnd(780, 900, 50)), '14:40', '13:00–15:00, 50 dk -> 14:40');
assert.equal(fromMinutes(snapEnd(540, 630, 60)), '10:00', '09:00–10:30, 60 dk -> 10:00');
assert.equal(fromMinutes(snapEnd(540, 550, 60)), '10:00', 'görüşmeden kısa aralık bir görüşmeye uzar');
assert.equal(fromMinutes(snapEnd(1260, 1320, 40)), '21:40', '22:00 aşılmaz');

// Süre/hazır saat değişimi: not ile birlikte.
assert.deepEqual(fitRange({ start: '09:00', end: '12:00' }, 40), { range: { start: '09:00', end: '11:40' }, note: 'Bitiş 11:40 oldu.' });
assert.deepEqual(fitRange({ start: '09:00', end: '12:00' }, 30), { range: { start: '09:00', end: '12:00' }, note: '' });
assert.deepEqual(fitRange({ start: '21:30', end: '22:00' }, 60), { range: { start: '21:00', end: '22:00' }, note: "Başlangıç 21:00 oldu. Bitiş 22:00'yi aşamaz." });

// –/+ seçilen süre kadar kayar; başlangıç belirleyicidir.
assert.deepEqual(moveStart({ start: '09:00', end: '09:30' }, 1, 30), { range: { start: '09:30', end: '10:00' }, note: 'Bitiş 10:00 oldu.' }, 'başlangıç ilerleyince bitiş de ilerler');
assert.deepEqual(moveStart({ start: '09:00', end: '12:00' }, 1, 30), { range: { start: '09:30', end: '12:00' }, note: '' }, 'geniş aralıkta bitiş aynı kalır');
assert.deepEqual(moveStart({ start: '09:00', end: '12:00' }, -1, 60).range, { start: '08:00', end: '12:00' });
assert.deepEqual(moveEnd({ start: '09:00', end: '10:20' }, 1, 40).range, { start: '09:00', end: '11:00' });
assert.equal(canMoveStart({ start: '06:00', end: '07:00' }, -1, 30), false, '06:00 altına inmez');
assert.equal(canMoveStart({ start: '21:00', end: '22:00' }, 1, 60), false, 'bitiş 22:00 aşılacaksa başlangıç durur');
assert.equal(canMoveEnd({ start: '09:00', end: '09:40' }, -1, 40), false, 'bitiş başlangıçtan en az bir görüşme sonra');
assert.equal(canMoveEnd({ start: '21:00', end: '22:00' }, 1, 30), false, '22:00 üstüne çıkmaz');

// Klavyeden yazma: iki nokta kendiliğinden gelir.
assert.equal(formatTypedTime('9', false), '09:');
assert.equal(formatTypedTime('09:3', false), '09:3');
assert.equal(formatTypedTime('1', false), '1');
assert.equal(formatTypedTime('10', false), '10:');
assert.equal(formatTypedTime('1030', false), '10:30');
assert.equal(formatTypedTime('25', false), '2', '25 saat yazılamaz');
assert.equal(formatTypedTime('09:7', false), '09:', 'dakikanın ilk rakamı 5ten büyük olamaz');
assert.equal(formatTypedTime('09', true), '09', 'silerken iki nokta geri eklenmez');
assert.equal(parseTypedTime('09:30'), 570);
assert.equal(parseTypedTime('930'), 570);
assert.equal(parseTypedTime('9'), 540);
assert.equal(parseTypedTime('25:00'), null);

// Yazılan saatlerin kuralları ve sade mesajlar.
assert.deepEqual(applyTypedEnd({ start: '09:00', end: '11:40' }, '10:30', 40), { ok: false, error: "10:30 uygun değil. 40 dk'lık görüşmelerde bitiş 10:20 veya 11:00 olabilir. Bitiş 11:40 olarak kaldı." });
assert.deepEqual(applyTypedEnd({ start: '09:00', end: '11:40' }, '09:20', 40), { ok: false, error: 'Bitiş, başlangıçtan en az 40 dk sonra olmalı. En erken 09:40.' });
assert.deepEqual(applyTypedEnd({ start: '09:00', end: '11:40' }, '22:30', 40), { ok: false, error: 'Bitiş en geç 22:00 olabilir.' });
assert.deepEqual(applyTypedEnd({ start: '09:00', end: '11:40' }, '11:00', 40), { ok: true, range: { start: '09:00', end: '11:00' }, note: '' });
assert.deepEqual(applyTypedStart({ start: '09:00', end: '12:00' }, '05:30', 30), { ok: false, error: 'Başlangıç en erken 06:00 olabilir.' });
assert.deepEqual(applyTypedStart({ start: '09:00', end: '12:00' }, '21:30', 40), { ok: false, error: "Başlangıç en geç 21:20 olabilir. 40 dk'lık görüşme 22:00'den sonra bitemez." });
assert.deepEqual(applyTypedStart({ start: '09:00', end: '12:00' }, 'abc', 30), { ok: false, error: 'Saati 09:30 şeklinde yazın.' });
assert.deepEqual(applyTypedStart({ start: '09:00', end: '12:00' }, '09:20', 30), { ok: true, range: { start: '09:20', end: '11:50' }, note: 'Bitiş 11:50 oldu.' });
assert.deepEqual(applyTypedStart({ start: '09:00', end: '09:30' }, '10:00', 30), { ok: true, range: { start: '10:00', end: '10:30' }, note: 'Bitiş 10:30 oldu.' });

// Bir günde tek süre ve çakışma planı.
const existing = [
  { dayOfWeek: 1, startTime: '08:30', endTime: '11:30', slotDurationMinutes: 30 },
  { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', slotDurationMinutes: 30 },
];
assert.deepEqual(daysWithOtherDuration(existing, [3, 1, 2], 40), [1, 2]);
assert.deepEqual(daysWithOtherDuration(existing, [1, 3], 30), []);
assert.equal(otherDurationMessage(1), 'Pazartesi için bir müsaitliğiniz var, farklı bir süre için önce onu silin.');
assert.deepEqual(planAvailabilityAdditions(existing, [1, 2, 3], '13:00', '14:00', 40), { add: [3], conflicts: [], otherDuration: [1, 2] });
assert.deepEqual(planAvailabilityAdditions(existing, [1, 2, 3], '09:00', '12:00', 30), { add: [3], conflicts: [1, 2], otherDuration: [] });
assert.deepEqual(planAvailabilityAdditions(existing, [1], '11:30', '12:00', 30), { add: [1], conflicts: [], otherDuration: [] }, 'uç uca gelen aralık çakışmaz');

// Arayüz işaretlemesi: hafta içi düğmesi yok, süre günlerden sonra, saat kutuları yazılabilir.
const html = renderToStaticMarkup(React.createElement(AvailabilityForm, { durationMinutes: 15, busy: false, onSubmit: () => {} }));
for (const text of ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Görüşme süresi', '15 dk', '20 dk', '60 dk', '09:00 – 12:00', '13:00 – 15:00', 'Başlangıç', 'Bitiş', 'Programa ekle',
  'Saate dokunup rakam yazabilirsiniz ya da +/- butonlarını kullanabilirsiniz.']) assert(html.includes(text), text);
assert(!html.includes('Hafta içi'), 'hafta içi düğmesi kaldırıldı');
assert(!html.includes('okul'), 'süre seçicide okul yazısı yok');
assert(html.indexOf('Görüşme süresi') < html.indexOf('Saat aralığı') && html.indexOf('Günler') < html.indexOf('Görüşme süresi'), 'sıra: günler, süre, saat aralığı');
assert(html.includes('inputMode="numeric"') || html.includes('inputmode="numeric"'), 'saat kutusu rakam klavyesi açar');
assert(!html.includes('type="time"'), 'saat kadranı (type=time) kullanılmaz');
assert(html.includes('disabled=""') && html.includes('Önce bir veya birkaç gün seçin.'), 'gün seçilmeden ekleme kapalı');
const html30 = renderToStaticMarkup(React.createElement(AvailabilityForm, { durationMinutes: 30, busy: false, onSubmit: () => {} }));
assert(html30.includes('30 dk') && html30.includes('40 dk') && !html30.includes('>20 dk<'), 'okul 30 dk iken 20 dk gösterilmez');

console.log('Müsaitlik formu (süreye göre kayan saatler, otomatik bitiş, klavye girişi, sade uyarılar, günde tek süre) PASS');
