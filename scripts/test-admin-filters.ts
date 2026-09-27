import assert from 'node:assert/strict';
import { formatDate, formatDateTime, formatDatesInText, getIstanbulDate } from '../src/utils/dates';
import { appointmentsOnDate, parentsInClass, sortAppointmentsForAdmin } from '../src/utils/admin-filters';

assert.equal(formatDate('2026-09-25'), '25/09/2026');
assert.equal(formatDate('2024-02-29'), '29/02/2024');
assert.equal(formatDate('2026-02-29'), '—');
assert.equal(formatDate(''), '—');
assert.equal(getIstanbulDate(new Date('2026-09-24T21:01:00Z')), '2026-09-25');
assert.equal(getIstanbulDate(new Date('2026-09-24T20:59:00Z')), '2026-09-24');
assert.equal(formatDateTime('2026-09-24T21:01:00Z'), '25/09/2026 00:01');
assert.equal(formatDatesInText('Randevu 2026-09-25, giriş 2026-09-24T21:01:00Z.'), 'Randevu 25/09/2026, giriş 25/09/2026 00:01.');
assert.equal(formatDatesInText('25.09.2026 10:00'), '25/09/2026 10:00');
assert.equal(formatDateTime('10:00'), '10:00');
const appointments = [{ id: 'today', date: '2026-09-25' }, { id: 'tomorrow', date: '2026-09-26' }];
assert.deepEqual(appointmentsOnDate(appointments, getIstanbulDate(new Date('2026-09-25T12:00:00Z'))).map((entry) => entry.id), ['today']);
assert.deepEqual(appointmentsOnDate(appointments, '2026-09-26').map((entry) => entry.id), ['tomorrow']);
assert.equal(appointmentsOnDate(appointments, '2026-09-27').length, 0);
const ordered = sortAppointmentsForAdmin([
  { id: 'future-far', date: '2026-09-27', startTime: '09:00' },
  { id: 'past-old', date: '2026-09-24', startTime: '09:00' },
  { id: 'future-near-b', date: '2026-09-25', startTime: '13:00' },
  { id: 'past-new', date: '2026-09-25', startTime: '11:00' },
  { id: 'future-near-a', date: '2026-09-25', startTime: '13:00' },
], { date: '2026-09-25', time: '12:00' });
assert.deepEqual(ordered.map((entry) => entry.id), ['future-near-a', 'future-near-b', 'future-far', 'past-new', 'past-old']);
const parents = [{ id: 'multiple', students: [{ id: 'a', className: '5-A' }, { id: 'b', className: '6-B' }] }, { id: 'other', students: [{ id: 'c', className: '6-B' }] }];
assert.deepEqual(parentsInClass(parents, ''), []);
assert.deepEqual(parentsInClass(parents, '5-A'), [{ id: 'multiple', students: [{ id: 'a', className: '5-A' }] }]);
assert.equal(parentsInClass(parents, '6-B').length, 2);
assert.equal(parentsInClass(parents, '7-C').length, 0);
assert.equal(parents[0].students.length, 2);
console.log('Date formatting, Istanbul midnight, appointment dates and class-first filters PASS.');
