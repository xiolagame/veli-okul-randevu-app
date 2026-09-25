import { normalizeTurkishPhone } from './phone';

export const ROSTER_HEADERS = ['Öğrenci Ad Soyad', 'Öğrenci No', 'Veli Ad Soyad', 'Veli Telefonu', 'Doğum Tarihi'];
export const MAX_ROSTER_ROWS = 500;
export const MAX_ROSTER_FILE_BYTES = 2 * 1024 * 1024;
export type RosterDraft = { studentName: string; studentNumber: string; parentName: string; parentPhone: string; birthDate: string };
export type RosterPreview = { record: RosterDraft; status: 'valid' | 'duplicate' | 'invalid'; errors: string[] };
export const emptyRosterRow = (): RosterDraft => ({ studentName: '', studentNumber: '', parentName: '', parentPhone: '', birthDate: '' });

export function normalizeBirthDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  const local = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(clean);
  if (!iso && !local) return null;
  const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(local![3]), Number(local![2]), Number(local![1])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getTime() > Date.now()) return null;
  return date.toISOString().slice(0, 10);
}

export function validateRosterRow(value: unknown): RosterPreview {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const read = (key: string) => typeof source[key] === 'string' ? source[key].trim().replace(/\s+/g, ' ') : '';
  const record: RosterDraft = { studentName: read('studentName'), studentNumber: read('studentNumber'), parentName: read('parentName'), parentPhone: normalizeTurkishPhone(source.parentPhone) || '', birthDate: normalizeBirthDate(source.birthDate) || '' };
  const errors: string[] = [];
  if (!record.studentName || record.studentName.length > 150) errors.push('Öğrenci adı eksik veya çok uzun.');
  if (!record.parentName || record.parentName.length > 150) errors.push('Veli adı eksik veya çok uzun.');
  if (!record.parentPhone) errors.push('Telefon numarası geçersiz.');
  if (!record.birthDate) errors.push(read('birthDate') ? 'Doğum tarihi geçersiz.' : 'Doğum tarihi eksik.');
  if (record.studentNumber && !/^[\p{L}\p{N}_-]{1,50}$/u.test(record.studentNumber)) errors.push('Öğrenci numarası formatı geçersiz.');
  if (source.studentNumber != null && typeof source.studentNumber !== 'string') errors.push('Öğrenci numarasını metin olarak girin.');
  return { record, status: errors.length ? 'invalid' : 'valid', errors };
}

export function sameRosterIdentity(left: RosterDraft, right: RosterDraft): boolean {
  return left.parentPhone === right.parentPhone &&
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
  if (withHeaders && (rows[0]?.length !== 5 || !ROSTER_HEADERS.every((header, index) => rows[0][index]?.trim() === header))) throw new Error('Sütunlar şablonla aynı olmalı.');
  const data = withHeaders ? rows.slice(1) : rows;
  if (!data.length || data.length > MAX_ROSTER_ROWS) throw new Error('1–500 kayıt yükleyin.');
  return data.map((row) => {
    if (row.length !== 5) throw new Error('Her satırda şablondaki 5 sütun bulunmalı.');
    return { studentName: row[0], studentNumber: row[1], parentName: row[2], parentPhone: row[3], birthDate: row[4] };
  });
}
