import { MAX_ROSTER_FILE_BYTES, MAX_ROSTER_ROWS, parseDelimited, rowsToDrafts } from './roster-import';

export const ROSTER_TEMPLATE_FILENAME = 'ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx';
export const ROSTER_TEMPLATE_URL = '/' + ROSTER_TEMPLATE_FILENAME;

function checkArchive(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  let total = 0, entries = 0;
  for (let offset = 0; offset + 46 <= view.byteLength; offset++) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    total += view.getUint32(offset + 24, true);
    entries++;
    if (total > 20 * 1024 * 1024 || entries > 100) throw new Error('Excel dosyası çok büyük veya karmaşık.');
  }
  if (!entries) throw new Error('Geçerli bir XLSX dosyası seçin.');
}

export async function readRosterFile(buffer: ArrayBuffer, name: string) {
  if (buffer.byteLength > MAX_ROSTER_FILE_BYTES) throw new Error('Dosya en fazla 2 MB olabilir.');
  if (/\.csv$/i.test(name)) {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { throw new Error('CSV dosyasını UTF-8 olarak kaydedin.'); }
    const delimiter = text.split(/\r?\n/)[0].includes(';') ? ';' : ',';
    return rowsToDrafts(parseDelimited(text, delimiter));
  }
  if (!/\.xlsx$/i.test(name)) throw new Error('Yalnız XLSX veya UTF-8 CSV dosyaları desteklenir.');
  checkArchive(buffer);
  const { readSheet } = await import('read-excel-file/universal');
  let sheet: import('read-excel-file/universal').SheetData;
  try { sheet = await readSheet(buffer, 'Kayıtlar'); }
  catch { throw new Error('Excel dosyası okunamadı. Standart şablonu kullanın.'); }
  const columnCount = sheet[0]?.length || 0;
  if (sheet.length > MAX_ROSTER_ROWS + 1 || ![5, 6].includes(columnCount) || sheet.some(row => row.length > columnCount)) throw new Error('Kayıtlar sayfasında 5 sütun (eski dosyalarda 6) ve en fazla 500 kayıt olmalı.');
  const rows: string[][] = [];
  sheet.forEach((row) => {
    const cells: string[] = [];
    for (let index = 1; index <= columnCount; index++) {
      const value = row[index - 1];
      if (value instanceof Date) {
        if (index !== 6 || Number.isNaN(value.getTime())) throw new Error('Tarih yalnız Doğum Tarihi sütununda kullanılabilir.');
        cells.push(value.toISOString().slice(0,10));
      } else if (value == null || typeof value === 'string' || typeof value === 'number') cells.push(String(value ?? ''));
      else throw new Error('Özel hücre yerine düz metin, sayı veya tarih kullanın.');
    }
    rows.push(cells);
  });
  return rowsToDrafts(rows);
}

export async function rosterTemplate(load: typeof fetch = fetch) {
  // The reviewed workbook is the single source of truth, including its formatting.
  const response = await load(ROSTER_TEMPLATE_URL);
  if (!response.ok) throw new Error('Şablon indirilemedi. Lütfen tekrar deneyin.');
  const buffer = await response.arrayBuffer();
  checkArchive(buffer);
  return buffer;
}
