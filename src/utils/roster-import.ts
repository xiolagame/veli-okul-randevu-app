import { formatTurkishPhoneInput, normalizeUserPhoneInput } from './phone';
import { normalizePersonName } from './person-name';
import { uppercasePersonNameInput } from './person-name';
import { formatBirthDateInput, formatIsoBirthDateForInput, parseBirthDateInputToIso } from './birth-date';
import { normalizeClassName } from './class-name';

export const ROSTER_HEADERS = ['Öğrenci Ad Soyad', 'Öğrenci No', 'Sınıf/Şube', 'Veli Ad Soyad', 'Veli Telefonu'];
export const LEGACY_ROSTER_HEADERS = [...ROSTER_HEADERS, 'Doğum Tarihi'];
export const MAX_ROSTER_ROWS = 500;
export const MAX_ROSTER_FILE_BYTES = 2 * 1024 * 1024;
export type RosterDraft = { studentName: string; studentNumber: string; className: string; parentName: string; parentPhone: string; birthDate: string };
export type RosterPreview = { record: RosterDraft; status: 'valid' | 'duplicate' | 'invalid'; errors: string[] };
export const emptyRosterRow = (): RosterDraft => ({ studentName: '', studentNumber: '', className: '', parentName: '', parentPhone: '', birthDate: '' });

export function formatRosterDraftInput(record: RosterDraft): RosterDraft {
  return {
    ...record,
    studentName: uppercasePersonNameInput(record.studentName),
    className: normalizeClassName(record.className) || record.className.toLocaleUpperCase('tr-TR'),
    parentName: uppercasePersonNameInput(record.parentName),
    parentPhone: formatTurkishPhoneInput(record.parentPhone),
    birthDate: formatIsoBirthDateForInput(record.birthDate) || formatBirthDateInput(record.birthDate),
  };
}

export function normalizeBirthDate(value: unknown): string | null {
  return parseBirthDateInputToIso(value);
}

export function validateRosterRow(value: unknown): RosterPreview {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const read = (key: string) => typeof source[key] === 'string' ? source[key].trim().replace(/\s+/g, ' ') : '';
  const record: RosterDraft = { studentName: normalizePersonName(read('studentName')), studentNumber: read('studentNumber'), className: normalizeClassName(source.className) || '', parentName: normalizePersonName(read('parentName')), parentPhone: normalizeUserPhoneInput(source.parentPhone) || '', birthDate: normalizeBirthDate(source.birthDate) || '' };
  const errors: string[] = [];
  if (!record.studentName || record.studentName.length > 150) errors.push('Öğrenci adı eksik veya çok uzun.');
  if (!record.className) errors.push('Sınıf/şube bilgisi eksik veya geçersiz.');
  if (!record.parentName || record.parentName.length > 150) errors.push('Veli adı eksik veya çok uzun.');
  if (!record.parentPhone) errors.push('Telefon numarası geçersiz.');
  if (read('birthDate') && !record.birthDate) errors.push('Doğum tarihi geçersiz.');
  if (record.studentNumber && !/^[\p{L}\p{N}_-]{1,50}$/u.test(record.studentNumber)) errors.push('Öğrenci numarası formatı geçersiz.');
  if (source.studentNumber != null && typeof source.studentNumber !== 'string') errors.push('Öğrenci numarasını metin olarak girin.');
  return { record, status: errors.length ? 'invalid' : 'valid', errors };
}

export function sameRosterIdentity(left: RosterDraft, right: RosterDraft): boolean {
  return left.className === right.className && left.parentPhone === right.parentPhone &&
    (left.studentNumber && right.studentNumber ? left.studentNumber === right.studentNumber : left.studentName.toLocaleLowerCase('tr-TR') === right.studentName.toLocaleLowerCase('tr-TR'));
}

export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') { cell += '"'; index++; }
      else if (quoted || cell === '') quoted = !quoted;
      else throw new Error('Dosyada geçersiz tırnak kullanımı.');
    } else if (!quoted && (character === delimiter || character === '\n' || character === '\r')) {
      row.push(cell); cell = '';
      if (character !== delimiter) {
        if (character === '\r' && input[index + 1] === '\n') index++;
        if (row.some((entry) => entry.trim())) rows.push(row);
        row = [];
        if (rows.length > MAX_ROSTER_ROWS + 1) throw new Error('En fazla 500 kayıt yüklenebilir.');
      }
    } else cell += character;
  }
  if (quoted) throw new Error('Dosyada kapatılmamış tırnak var.');
  row.push(cell);
  if (row.some((entry) => entry.trim())) rows.push(row);
  return rows;
}

export function rowsToDrafts(rows: string[][], withHeaders = true): RosterDraft[] {
  const headerCount = rows[0]?.length || 0;
  const expectedHeaders = headerCount === 6 ? LEGACY_ROSTER_HEADERS : ROSTER_HEADERS;
  if (withHeaders && (headerCount !== expectedHeaders.length || !expectedHeaders.every((header, index) => rows[0][index]?.trim() === header))) throw new Error('Sütunlar şablonla aynı olmalı.');
  const data = withHeaders ? rows.slice(1) : rows;
  if (!data.length || data.length > MAX_ROSTER_ROWS) throw new Error('1–500 kayıt yükleyin.');
  return data.map((row) => {
    if (row.length !== 5 && row.length !== 6) throw new Error('Her satırda yeni şablondaki 5 sütun veya eski şablondaki 6 sütun bulunmalı.');
    return { studentName: row[0], studentNumber: row[1], className: row[2], parentName: row[3], parentPhone: row[4], birthDate: row[5] || '' };
  });
}
