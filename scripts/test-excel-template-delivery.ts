import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { readSheet } from 'read-excel-file/universal';
import writeXlsxFile from 'write-excel-file/universal';
import {
  NOT_A_REAL_XLSX_ERROR, ROSTER_TEMPLATE, STAFF_TEMPLATE, TEMPLATE_DOWNLOAD_ERROR, TEMPLATE_PUBLIC_ORIGIN,
  downloadTemplate, fetchTemplate, isZipPackage, looksLikeHtml,
} from '../src/utils/excel-templates';
import { readStaffImportFile } from '../src/utils/staff-import';
import { readRosterFile, rosterTemplate } from '../src/utils/roster-files';
import { TEMPLATES, buildTemplate } from './build-excel-templates.mjs';

const publicFile = (name: string) => path.join('public', name);
const bytes = (name: string) => fs.readFileSync(publicFile(name));
const arrayBuffer = (buffer: Buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HTML_PAGE = '<!doctype html><html><body><div id="root"></div></body></html>';

// 1. The linked URLs are ASCII-only and exist as real ZIP packages. (The old Turkish-named link returned index.html.)
for (const template of [STAFF_TEMPLATE, ROSTER_TEMPLATE]) {
  assert.match(template.path, /^\/[a-z0-9-]+\.xlsx$/, 'Template URL must be ASCII-only: ' + template.path);
  assert(fs.existsSync(publicFile(template.path.slice(1))), 'Linked template is missing from public/: ' + template.path);
  assert(isZipPackage(bytes(template.path.slice(1))), 'Template is not a ZIP/XLSX package: ' + template.path);
}
function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
for (const file of walk('src').filter((name) => /\.(ts|tsx)$/.test(name))) {
  const text = fs.readFileSync(file, 'utf8');
  assert(!/\/PERSONEL_B|\/ÖĞRENCİ_VELİ|\/OGRENCI_VELI/.test(text), 'Source must not link a Turkish-named template URL: ' + file);
}

// 2. Package structure is standard OOXML: canonical content types, no BOM, required parts, expected sheets.
const PARTS = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/theme/theme1.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'];
function readParts(name: string) {
  const entries = unzipSync(new Uint8Array(bytes(name)));
  assert.deepEqual(Object.keys(entries), PARTS, 'Canonical part order: ' + name);
  return Object.fromEntries(Object.entries(entries).map(([part, data]) => [part, strFromU8(data)]));
}
for (const [file, sheets, headers] of [
  ['personel-bilgi-formu.xlsx', ['Personel', 'Açıklamalar'], ['Ad Soyad', 'Görevi', 'Branş', 'Telefon', 'E-posta']],
  ['ogrenci-veli-bilgi-formu.xlsx', ['Kayıtlar', 'Açıklamalar'], ['Öğrenci Ad Soyad', 'Öğrenci No', 'Sınıf/Şube', 'Veli Ad Soyad', 'Veli Telefonu']],
] as const) {
  const parts = readParts(file);
  for (const [part, text] of Object.entries(parts)) assert(!text.startsWith('﻿'), `${file}: ${part} must not start with a BOM`);
  const types = parts['[Content_Types].xml'];
  assert(types.includes('<Default Extension="xml" ContentType="application/xml"/>'), file + ': Default xml type');
  assert(types.includes('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'), file + ': workbook override');
  for (const part of PARTS.filter((name) => /^xl\/(worksheets|styles|theme|sharedStrings)/.test(name))) {
    assert(types.includes(`PartName="/${part}"`), `${file}: missing content type for ${part}`);
  }
  for (const sheet of sheets) assert(parts['xl/workbook.xml'].includes(`name="${sheet}"`), `${file}: sheet ${sheet}`);
  assert.deepEqual((await readSheet(arrayBuffer(bytes(file)), sheets[0]))[0], headers, file + ': header row');
}
const staff = readParts('personel-bilgi-formu.xlsx');
assert(/showErrorMessage="1"[^>]*errorStyle="stop"|errorStyle="stop"[^>]*showErrorMessage="1"/.test(staff['xl/worksheets/sheet1.xml']), 'Role dropdown must block invalid values');
assert(staff['xl/worksheets/sheet1.xml'].includes('<x:formula1>"Öğretmen,Güvenlik"</x:formula1>'));
const staffNotes = staff['xl/worksheets/sheet2.xml'];
assert(staffNotes.includes('E-posta yalnız öğretmen için zorunludur'), 'Instructions must match the import rules');
assert(!staffNotes.includes('E-posta her personel için zorunludur') && !staffNotes.includes('telefon veya e-postayı'), 'Stale instruction text');
const roster = readParts('ogrenci-veli-bilgi-formu.xlsx');
assert(/<x:col min="1" max="1"[^>]* style="5"/.test(roster['xl/worksheets/sheet1.xml']), 'Roster columns keep text format beyond the pre-styled rows');
assert(roster['xl/worksheets/sheet1.xml'].includes('state="frozen"'), 'Roster header row is frozen');
assert(roster['xl/styles.xml'].includes('formatCode="@"'), 'Text number format keeps leading zeros');

// 3. The build script reproduces the shipped files byte for byte, and legacy copies stay identical.
for (const template of TEMPLATES) {
  const rebuilt = buildTemplate(new Uint8Array(bytes(template.source)), template.kind);
  for (const output of template.outputs) assert(rebuilt.equals(bytes(output)), `${output} must equal build-excel-templates output`);
}
assert(bytes('PERSONEL_BİLGİ_FORMU.xlsx').equals(bytes('personel-bilgi-formu.xlsx')), 'Legacy staff copy must stay identical');
assert(bytes('ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx').equals(bytes('ogrenci-veli-bilgi-formu.xlsx')), 'Legacy roster copy must stay identical');

// 4. Netlify rescues cached pages that still use the old Turkish URLs, before the SPA fallback.
const netlify = fs.readFileSync('netlify.toml', 'utf8');
const spa = netlify.indexOf('from = "/*"');
assert(spa > 0);
for (const [from, to] of [
  ['/PERSONEL_B%C4%B0LG%C4%B0_FORMU.xlsx', '/personel-bilgi-formu.xlsx'],
  ['/PERSONEL_BİLGİ_FORMU.xlsx', '/personel-bilgi-formu.xlsx'],
  ['/%C3%96%C4%9ERENC%C4%B0_VEL%C4%B0_B%C4%B0LG%C4%B0_FORMU.xlsx', '/ogrenci-veli-bilgi-formu.xlsx'],
  ['/ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx', '/ogrenci-veli-bilgi-formu.xlsx'],
]) {
  const at = netlify.indexOf(`from = "${from}"`);
  assert(at > 0 && at < spa, 'Legacy redirect missing or after SPA fallback: ' + from);
  assert(netlify.slice(at, spa).split('[[redirects]]')[0].includes(`to = "${to}"`), 'Legacy redirect target: ' + from);
}

// 5. fetchTemplate never returns HTML or error pages as a spreadsheet.
const real = bytes('personel-bilgi-formu.xlsx');
const respond = (body: BodyInit, init?: ResponseInit) => (async () => new Response(body, init)) as typeof fetch;
await assert.rejects(() => fetchTemplate(STAFF_TEMPLATE, respond(HTML_PAGE, { status: 200, headers: { 'content-type': 'text/html' } })), new RegExp(TEMPLATE_DOWNLOAD_ERROR));
await assert.rejects(() => fetchTemplate(STAFF_TEMPLATE, respond('missing', { status: 404 })), new RegExp(TEMPLATE_DOWNLOAD_ERROR));
await assert.rejects(() => fetchTemplate(STAFF_TEMPLATE, (async () => { throw new TypeError('offline'); }) as typeof fetch));
let requested = '';
const served = await fetchTemplate(STAFF_TEMPLATE, (async (input: RequestInfo | URL) => { requested = String(input); return new Response(new Uint8Array(real)); }) as typeof fetch);
assert.equal(requested, STAFF_TEMPLATE.path);
assert(Buffer.from(served).equals(real));
await assert.rejects(() => rosterTemplate(respond(HTML_PAGE)), new RegExp(TEMPLATE_DOWNLOAD_ERROR));

// 6. Web saves a verified blob with the Turkish file name; Android/iOS open the public ASCII URL in the system browser.
const saved: { size: number; filename: string }[] = [];
const opened: string[] = [];
const noFetch = (async () => { throw new Error('native must not fetch'); }) as typeof fetch;
await downloadTemplate(STAFF_TEMPLATE, { platform: () => 'WEB', load: respond(new Uint8Array(real)), saveBlob: (buffer, filename) => saved.push({ size: buffer.byteLength, filename }), openExternal: async (url) => { opened.push(url); } });
assert.deepEqual(saved, [{ size: real.length, filename: 'PERSONEL_BİLGİ_FORMU.xlsx' }]);
assert.deepEqual(opened, []);
await assert.rejects(() => downloadTemplate(STAFF_TEMPLATE, { platform: () => 'WEB', load: respond(HTML_PAGE), saveBlob: () => saved.push({ size: -1, filename: 'wrong' }) }), new RegExp(TEMPLATE_DOWNLOAD_ERROR));
assert.equal(saved.length, 1, 'A fallback HTML page must never be saved as an .xlsx');
for (const platform of ['ANDROID', 'IOS'] as const) {
  await downloadTemplate(ROSTER_TEMPLATE, { platform: () => platform, load: noFetch, saveBlob: () => assert.fail('native must not save blobs'), openExternal: async (url) => { opened.push(url); } });
}
assert.deepEqual(opened, Array(2).fill(`${TEMPLATE_PUBLIC_ORIGIN}/ogrenci-veli-bilgi-formu.xlsx`));
assert.equal(new URL(opened[0]).protocol, 'https:');
await assert.rejects(() => downloadTemplate(STAFF_TEMPLATE, { platform: () => 'IOS', openExternal: async () => { throw new Error(TEMPLATE_DOWNLOAD_ERROR); } }), new RegExp(TEMPLATE_DOWNLOAD_ERROR));

// 7. A broken download that users already saved (HTML named .xlsx) is explained instead of "file unreadable".
assert(looksLikeHtml(new TextEncoder().encode(HTML_PAGE)) && looksLikeHtml(new TextEncoder().encode('﻿  \n<html>')));
assert(!looksLikeHtml(real) && !looksLikeHtml(new Uint8Array([1, 2, 3])));
await assert.rejects(() => readStaffImportFile(new File([HTML_PAGE], 'PERSONEL_BİLGİ_FORMU.xlsx'), []), new RegExp(NOT_A_REAL_XLSX_ERROR.slice(0, 20)));
await assert.rejects(() => readRosterFile(new TextEncoder().encode(HTML_PAGE).buffer as ArrayBuffer, 'ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx'), new RegExp(NOT_A_REAL_XLSX_ERROR.slice(0, 20)));
await assert.rejects(() => readRosterFile(new Uint8Array([1, 2, 3]).buffer, 'broken.xlsx'), /Geçerli bir XLSX/);

// 8. Other spreadsheet apps may rename the sheet; the header check still protects the content.
const renamedStaff = await writeXlsxFile([{ sheet: 'Sayfa1', data: [
  ['Ad Soyad', 'Görevi', 'Branş', 'Telefon', 'E-posta'].map((value) => ({ value, type: String })),
  ['AYŞE ŞAHİN', 'Öğretmen', 'Matematik', '05551112233', 'ayse@example.test'].map((value) => ({ value, type: String })),
] }]).toBlob();
const staffRows = await readStaffImportFile(new File([renamedStaff], 'personel.xlsx'), []);
assert.equal(staffRows.length, 1);
assert.deepEqual(staffRows[0].errors, []);
const wrongHeaders = await writeXlsxFile([{ sheet: 'Sayfa1', data: [['A', 'B', 'C', 'D', 'E'].map((value) => ({ value, type: String })), ['1', '2', '3', '4', '5'].map((value) => ({ value, type: String }))] }]).toBlob();
await assert.rejects(() => readStaffImportFile(new File([wrongHeaders], 'x.xlsx'), []), /başlıkları farklı/);
const renamedRoster = await writeXlsxFile([{ sheet: 'Sheet1', data: [
  ['Öğrenci Ad Soyad', 'Öğrenci No', 'Sınıf/Şube', 'Veli Ad Soyad', 'Veli Telefonu'].map((value) => ({ value, type: String })),
  ['ÖRNEK ÖĞRENCİ', '007', '5-A', 'ÖRNEK VELİ', '05334138206'].map((value) => ({ value, type: String })),
] }]).toBlob();
const rosterRows = await readRosterFile(await renamedRoster.arrayBuffer(), 'veli.xlsx');
assert.equal(rosterRows[0].studentNumber, '007', 'Leading zeros survive');
const wrongHeadersBuffer = await wrongHeaders.arrayBuffer();
await assert.rejects(() => readRosterFile(wrongHeadersBuffer, 'x.xlsx'), /Sütunlar şablonla aynı olmalı/);

// 9. The shipped templates themselves, once filled in (rows written into the real package), import correctly.
import { strToU8, zipSync } from 'fflate';
function fillTemplate(file: string, rowXml: string) {
  const entries = unzipSync(new Uint8Array(bytes(file)));
  const sheet = strFromU8(entries['xl/worksheets/sheet1.xml']);
  const filled = sheet.replace(/<x:row r="2">.*?<\/x:row>/, rowXml);
  assert.notEqual(filled, sheet, 'Row 2 must be replaceable: ' + file);
  const out: Record<string, Uint8Array> = {};
  for (const name of PARTS) out[name] = name === 'xl/worksheets/sheet1.xml' ? strToU8(filled) : entries[name];
  return zipSync(out);
}
const cell = (ref: string, value: string) => `<x:c r="${ref}" t="str"><x:v>${value}</x:v></x:c>`;
const filledStaff = fillTemplate('personel-bilgi-formu.xlsx', `<x:row r="2">${cell('A2', 'AYŞE ŞAHİN')}${cell('B2', 'Öğretmen')}${cell('C2', 'Matematik')}${cell('D2', '05551112233')}${cell('E2', 'ayse@example.test')}</x:row>`);
const filledStaffRows = await readStaffImportFile(new File([filledStaff], 'PERSONEL_BİLGİ_FORMU.xlsx'), []);
assert.equal(filledStaffRows.length, 1);
assert.deepEqual(filledStaffRows[0].errors, []);
assert.deepEqual([filledStaffRows[0].draft.role, filledStaffRows[0].draft.phone, filledStaffRows[0].draft.fullName], ['teacher', '05551112233', 'AYŞE ŞAHİN']);
const filledRoster = fillTemplate('ogrenci-veli-bilgi-formu.xlsx', `<x:row r="2">${cell('A2', 'ÖRNEK ÖĞRENCİ')}${cell('B2', '007')}${cell('C2', '5-A')}${cell('D2', 'ÖRNEK VELİ')}${cell('E2', '05334138206')}</x:row>`);
const filledRosterRows = await readRosterFile(arrayBuffer(Buffer.from(filledRoster)), 'ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx');
assert.equal(filledRosterRows.length, 1);
assert.deepEqual([filledRosterRows[0].studentNumber, filledRosterRows[0].parentPhone], ['007', '05334138206']);

console.log('Excel templates: ASCII URLs, canonical OOXML, reproducible build, HTML fallback rejection, web blob save, native system-browser download and Netlify legacy redirects PASS.');
