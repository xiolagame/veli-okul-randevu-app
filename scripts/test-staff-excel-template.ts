import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { readSheet } from 'read-excel-file/universal';
import writeXlsxFile from 'write-excel-file/universal';
import { readStaffImportFile } from '../src/utils/staff-import';

const template = fs.readFileSync('public/PERSONEL_BİLGİ_FORMU.xlsx');
assert.equal(createHash('sha256').update(template).digest('hex'), 'e8280c90cef82fe652a2397b3bc79aca4e9f5bd8fa1ba275e5b5ac10be16ad34', 'rename must preserve styles and validations byte-for-byte');
assert.deepEqual((await readSheet(new Uint8Array(template).buffer, 'Personel'))[0], ['Ad Soyad', 'Görevi', 'Branş', 'Telefon', 'E-posta']);
const xml: string[] = [];
for (let i = 0; i + 46 < template.length; i++) {
  if (template.readUInt32LE(i) !== 0x02014b50) continue;
  const size = template.readUInt32LE(i + 20), nameLength = template.readUInt16LE(i + 28);
  const name = template.subarray(i + 46, i + 46 + nameLength).toString();
  const offset = template.readUInt32LE(i + 42);
  const data = offset + 30 + template.readUInt16LE(offset + 26) + template.readUInt16LE(offset + 28);
  if (name.endsWith('.xml')) xml.push((template.readUInt16LE(i + 10) === 8 ? inflateRawSync(template.subarray(data, data + size)) : template.subarray(data, data + size)).toString());
}
assert(xml.some((value) => /dataValidation/.test(value) && /Öğretmen/.test(value) && /Güvenlik/.test(value)));
async function parse(rows: string[][]) {
  const blob = await writeXlsxFile([{ sheet: 'Personel', data: [
    ['Ad Soyad', 'Görevi', 'Branş', 'Telefon', 'E-posta'].map((value) => ({ value, type: String })),
    ...rows.map((row) => row.map((value) => ({ value, type: String }))),
  ] }]).toBlob();
  return readStaffImportFile(new File([blob], 'PERSONEL_BİLGİ_FORMU.xlsx'), []);
}
const rows = await parse([
  ['ÖĞRETMEN ÖRNEK', 'Öğretmen', 'Matematik', '05551234567', 'teacher@example.test'],
  ['GÜVENLİK ÖRNEK', 'Güvenlik', '', '05551234568', 'security@example.test'],
]);
assert(rows.every((row) => row.errors.length === 0));
assert.equal(rows[0].draft.phone[0], '0');
assert.equal(rows[0].draft.role, 'teacher'); assert.equal(rows[1].draft.role, 'security');
assert((await parse([['ÖRNEK PERSONEL', 'Yönetici', '', '05551234569', 'bad@example.test']]))[0].errors.length);
assert((await parse([['ÖRNEK PERSONEL', 'Öğretmen', '', '05551234569', 'bad@example.test']]))[0].errors.length);
const duplicates = await parse([
  ['ÖRNEK PERSONEL', 'Güvenlik', '', '05551234569', 'same@example.test'],
  ['DİĞER PERSONEL', 'Güvenlik', '', '+905551234569', 'same@example.test'],
]);
assert(duplicates[1].errors.length);
console.log('Staff XLSX template: exact filename, unchanged workbook/dropdown, Turkish text, role/branch rules, leading zero and duplicates PASS.');
