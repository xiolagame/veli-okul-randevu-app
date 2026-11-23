// Rebuilds the public Excel templates in canonical OOXML form. Run: node scripts/build-excel-templates.mjs
//
// Why: the templates must be real, strictly standard .xlsx packages and must be served from ASCII-only URLs.
// A Turkish-named file (PERSONEL_BİLGİ_FORMU.xlsx) was not deployed by Netlify and the SPA fallback returned
// index.html with HTTP 200, which users saved as a fake ".xlsx". The app now links only the ASCII names below.
//
// The workbook structure that Excel already opens (styles, theme, sheets) is kept. Only these safe fixes are applied:
//  - standard [Content_Types].xml (Default xml = application/xml + explicit workbook override), no BOMs, canonical part order
//  - staff: accurate instruction text, dropdown validation that blocks invalid values with a Turkish message
//  - roster: header row frozen and text number format for the whole of each column (keeps leading zeros)
// The script is idempotent. Legacy Turkish-named copies stay byte-identical because the archived iOS provenance
// manifest still lists them; no code links to them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const root = process.cwd();
const publicDir = path.join(root, 'public');

export const TEMPLATES = [
  { source: 'PERSONEL_BİLGİ_FORMU.xlsx', kind: 'staff', outputs: ['personel-bilgi-formu.xlsx', 'PERSONEL_BİLGİ_FORMU.xlsx'] },
  { source: 'ogrenci-veli-bilgi-formu.xlsx', kind: 'roster', outputs: ['ogrenci-veli-bilgi-formu.xlsx', 'ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx'] },
];

const ORDER = [
  '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
  'xl/theme/theme1.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
];
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;

const stripBom = (text) => text.replace(/^﻿/, '');
const replaceOnce = (text, from, to, label) => {
  if (text.includes(to)) return text; // already applied
  if (!text.includes(from)) throw new Error(`Template changed unexpectedly: ${label}`);
  return text.replace(from, to);
};

function fixStaff(files) {
  let sheet2 = files['xl/worksheets/sheet2.xml'];
  sheet2 = replaceOnce(sheet2,
    'Ad Soyad, Telefon ve E-posta her personel için zorunludur.',
    'Ad Soyad ve Telefon her personel için zorunludur. E-posta yalnız öğretmen için zorunludur (bildirimler içindir); güvenlik için boş bırakın.',
    'staff instruction 4');
  sheet2 = replaceOnce(sheet2,
    'Aynı telefon veya e-postayı birden fazla satıra yazmayın.',
    'Aynı telefon numarasını birden fazla satıra yazmayın.',
    'staff instruction 6');
  files['xl/worksheets/sheet2.xml'] = sheet2;
  files['xl/worksheets/sheet1.xml'] = replaceOnce(files['xl/worksheets/sheet1.xml'],
    '<x:dataValidation type="list" sqref="B2:B201">',
    '<x:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="stop" errorTitle="Geçersiz görev" error="Görevi listeden seçin: Öğretmen veya Güvenlik." promptTitle="Görevi" prompt="Listeden Öğretmen veya Güvenlik seçin." sqref="B2:B201">',
    'staff validation');
}

function fixRoster(files) {
  let sheet = files['xl/worksheets/sheet1.xml'];
  if (!sheet.includes('<x:sheetViews>')) {
    sheet = replaceOnce(sheet, '<x:cols>',
      '<x:sheetViews><x:sheetView workbookViewId="0"><x:pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen" /></x:sheetView></x:sheetViews><x:cols>',
      'roster frozen header');
  }
  if (!/<x:col [^>]*style="/.test(sheet)) sheet = sheet.replace(/<x:col (min="\d+" max="\d+")/g, '<x:col $1 style="5"');
  files['xl/worksheets/sheet1.xml'] = sheet;
}

export function buildTemplate(input, kind) {
  const entries = unzipSync(input);
  const files = {};
  for (const [name, data] of Object.entries(entries)) files[name] = stripBom(strFromU8(data));
  for (const name of ORDER.slice(1)) if (!(name in files)) throw new Error(`Missing part: ${name}`);
  if (kind === 'staff') fixStaff(files); else fixRoster(files);
  files['[Content_Types].xml'] = CONTENT_TYPES;
  // Fixed local-time stamp keeps the zip bytes identical on every machine.
  const mtime = new Date(2026, 0, 1, 0, 0, 0);
  const zipInput = {};
  for (const name of ORDER) zipInput[name] = [strToU8(files[name]), { level: 9, mtime }];
  return Buffer.from(zipSync(zipInput));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const template of TEMPLATES) {
    const built = buildTemplate(new Uint8Array(fs.readFileSync(path.join(publicDir, template.source))), template.kind);
    for (const output of template.outputs) {
      fs.writeFileSync(path.join(publicDir, output), built);
      console.log(`${output}: ${built.length} bytes`);
    }
  }
}
