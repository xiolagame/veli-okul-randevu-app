import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { readSheet } from 'read-excel-file/universal';
import writeXlsxFile from 'write-excel-file/universal';
import { readRosterFile, readRosterBlob, XLSX_MEMORY_BUDGET, rosterTemplate, ROSTER_TEMPLATE_FILENAME, ROSTER_TEMPLATE_URL } from '../src/utils/roster-files';
import { ROSTER_HEADERS, validateRosterRow } from '../src/utils/roster-import';

const bytes = fs.readFileSync('public/' + ROSTER_TEMPLATE_FILENAME);
assert.equal(ROSTER_TEMPLATE_FILENAME, 'ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx');
const loaded = await rosterTemplate(async (url) => {
  assert.equal(url, ROSTER_TEMPLATE_URL);
  return new Response(new Uint8Array(bytes));
});
assert.deepEqual(Buffer.from(loaded), bytes, 'download must preserve the reviewed file');
const rows = await readSheet(loaded, 'Kayıtlar');
assert.deepEqual(rows.filter((row) => row.some((cell) => cell != null && cell !== '')), [ROSTER_HEADERS]);
const notes = await readSheet(loaded, 'Açıklamalar');
assert(!notes.flat().some((cell) => /doğum tarihi/i.test(String(cell))));
assert(!notes.flat().some((cell) => /500|2\s*MB/.test(String(cell))));
const xml = new Map<string, string>();
for (let offset = 0; offset + 46 < bytes.length; offset++) {
  if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
  const size = bytes.readUInt32LE(offset + 20), length = bytes.readUInt16LE(offset + 28);
  const name = bytes.subarray(offset + 46, offset + 46 + length).toString();
  const local = bytes.readUInt32LE(offset + 42);
  const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
  if (name.endsWith('.xml')) xml.set(name, (bytes.readUInt16LE(offset + 10) === 8 ? inflateRawSync(bytes.subarray(start, start + size)) : bytes.subarray(start, start + size)).toString());
}
const styles = xml.get('xl/styles.xml')!;
assert(/174F4A/i.test(styles) && /E6F4EF/i.test(styles), 'approved staff green palette');
assert(/numFmtId="49"|formatCode="@"/.test(styles), 'text formatting for leading zeros');
assert(![...xml.keys()].some((name) => /externalLinks|vbaProject/i.test(name)));
await assert.rejects(() => rosterTemplate(async () => new Response('', { status: 503 })));
await assert.rejects(() => rosterTemplate(async () => new Response('<html>fallback</html>')));

async function fixture(count: number) {
  return (await writeXlsxFile([
    { sheet: 'Kayıtlar', data: [ROSTER_HEADERS.map((value) => ({ value, type: String })),
      ...Array.from({ length: count }, (_, index) => ['ÖRNEK ÖĞRENCİ', String(index).padStart(4, '0'), '5/A', 'ÖRNEK VELİ', '05551234567'].map((value) => ({ value, type: String }))) ] },
  ]).toBlob()).arrayBuffer();
}
const imported = await readRosterFile(await fixture(1), ROSTER_TEMPLATE_FILENAME);
assert.equal(imported[0].studentNumber, '0000');
assert.equal(imported[0].parentPhone, '05551234567');
assert.equal(imported[0].studentName, 'ÖRNEK ÖĞRENCİ');
assert.equal(validateRosterRow(imported[0]).status, 'valid');

assert.equal((await readRosterFile(await fixture(500), ROSTER_TEMPLATE_FILENAME)).length, 500);
assert.equal((await readRosterFile(await fixture(1001), ROSTER_TEMPLATE_FILENAME)).length, 1001);
await assert.rejects(() => readRosterBlob(new Blob([new Uint8Array([0xff,0xfe])]), 'bad.csv'), /UTF-8/);
const excessiveArchive = new ArrayBuffer(46);
const archiveView = new DataView(excessiveArchive);
archiveView.setUint32(0, 0x02014b50, true);
archiveView.setUint32(24, XLSX_MEMORY_BUDGET + 1, true);
await assert.rejects(() => readRosterFile(excessiveArchive, 'excessive.xlsx'), /büyük veya karmaşık/);
await assert.rejects(() => readRosterBlob({size:XLSX_MEMORY_BUDGET+1,arrayBuffer(){throw Error('Must reject before loading');}} as Blob, 'excessive.xlsx'), /bellek güvenliği/);
console.log('Student/parent XLSX: reviewed asset download, five original headers, sheets, green/text styles, no birth-date note, Turkish text, leading zeros and 1,001 rows without a quota PASS.');
