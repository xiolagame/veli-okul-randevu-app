import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateSecurityQr } from '../server/appointment-entry';
import { Appointment, AvailabilitySlot } from '../src/types';
import { groupAvailabilityByDay } from '../src/utils/availability';
import { normalizeClassName } from '../src/utils/class-name';
import { normalizeTurkishPhone } from '../src/utils/phone';

for (const input of ['05334138206', '5334138206', '905334138206', '+905334138206', '0533 413 82 06', '(0533) 413-82-06', 5334138206]) {
  assert.equal(normalizeTurkishPhone(input), '+905334138206');
}
for (const input of ['', '533413820', '053341382060', '2121234567', '+445334138206']) assert.equal(normalizeTurkishPhone(input), null);
for (const input of ['5-a', '5 A', '5-a ']) assert.equal(normalizeClassName(input), '5-A');

const slots: AvailabilitySlot[] = [
  { id: 'wed-10', teacherId: 'tp', dayOfWeek: 3, startTime: '10:00', endTime: '10:20', slotDurationMinutes: 20 },
  { id: 'mon-14', teacherId: 'tp', dayOfWeek: 1, startTime: '14:00', endTime: '14:20', slotDurationMinutes: 20 },
  { id: 'fri-09', teacherId: 'tp', dayOfWeek: 5, startTime: '09:00', endTime: '09:20', slotDurationMinutes: 20 },
  { id: 'tue-11', teacherId: 'tp', dayOfWeek: 2, startTime: '11:00', endTime: '11:20', slotDurationMinutes: 20 },
  { id: 'mon-0830', teacherId: 'tp', dayOfWeek: 1, startTime: '08:30', endTime: '08:50', slotDurationMinutes: 20 },
  { id: 'wed-08', teacherId: 'tp', dayOfWeek: 3, startTime: '08:00', endTime: '08:20', slotDurationMinutes: 20 },
];
const groups = groupAvailabilityByDay(slots);
assert.deepEqual(groups.map((group) => group.name), ['Pazartesi', 'Salı', 'Çarşamba', 'Cuma']);
assert.deepEqual(groups[0].slots.map((slot) => slot.startTime), ['08:30', '14:00']);
assert.deepEqual(groups[2].slots.map((slot) => slot.startTime), ['08:00', '10:00']);

const appointment: Appointment = {
  id: 'apt-local', teacherId: 'tp', teacherName: 'ÖĞRETMEN', teacherBranch: 'Türkçe',
  parentId: 'parent', parentName: 'VELİ', parentPhone: '+905334138206', studentName: 'ÖĞRENCİ',
  className: '5-A', date: '2026-09-29', startTime: '10:00', endTime: '10:20', status: 'booked', createdAt: '2026-09-29T00:00:00Z',
};
const verification = evaluateSecurityQr(appointment, new Date('2026-09-29T07:05:00Z'));
assert.equal(verification.decision, 'APPROVED');
assert.equal(verification.title, 'RANDEVU ONAYLANDI');
assert.equal(verification.message, 'Veliye okula giriş izni verebilirsiniz.');

const teacherSource = fs.readFileSync('src/components/TeacherView.tsx', 'utf8');
const parentSource = fs.readFileSync('src/components/ParentView.tsx', 'utf8');
const securitySource = fs.readFileSync('src/components/SecurityView.tsx', 'utf8');
const apiSource = fs.readFileSync('server/api.ts', 'utf8');
assert.doesNotMatch(teacherSource, /QRCodePass|Giriş kartı|QrCode/);
assert.match(parentSource, /QRCodePass/);
assert.match(parentSource, /Giriş kartı/);
assert.doesNotMatch(securitySource, /checkInVisitor|checkOutVisitor|Giriş(?:i)? Kaydet|QR Doğrula|>QR doğrula<|inputCode/);
assert.match(securitySource, /verifySecurityQr/);
assert.doesNotMatch(apiSource, /security\/check-in|security\/check-out/);
assert.match(apiSource, /Security QR verification is read-only and never mutates appointment state/);

console.log('Roster phone/class normalization, availability grouping, parent-only QR and camera-only read-only security contract PASS.');
