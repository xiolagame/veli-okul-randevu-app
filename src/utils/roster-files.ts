import { DelimitedRosterParser, ROSTER_HEADERS, LEGACY_ROSTER_HEADERS, RosterDraft, parseDelimited, rowsToDrafts } from './roster-import';

export const ROSTER_TEMPLATE_FILENAME = 'ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx';
export const ROSTER_TEMPLATE_URL = '/ogrenci-veli-bilgi-formu.xlsx';

export const XLSX_MEMORY_BUDGET = 128 * 1024 * 1024;
function checkArchive(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  let total = 0, entries = 0;
  for (let offset = 0; offset + 46 <= view.byteLength; offset++) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    total += view.getUint32(offset + 24, true);
    entries++;
    if (total > XLSX_MEMORY_BUDGET || entries > 1000) throw new Error('Excel dosyası çok büyük veya karmaşık.');
  }
  if (!entries) throw new Error('Geçerli bir XLSX dosyası seçin.');
}

export async function readRosterFile(buffer: ArrayBuffer, name: string) {
  if (/\.xlsx$/i.test(name) && buffer.byteLength > XLSX_MEMORY_BUDGET) throw new Error('Excel bellek güvenliği bütçesi aşıldı (128 MiB). CSV kullanın veya dosyayı bölün.');
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
  if (![5, 6].includes(columnCount) || sheet.some(row => row.length > columnCount)) throw new Error('Kayıtlar sayfasında 5 sütun (eski dosyalarda 6) bulunmalı.');
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

export async function readRosterBlob(file:Blob,name:string,progress:(read:number)=>void=()=>{}) {
  if(!/\.csv$/i.test(name)) {
    if(file.size>XLSX_MEMORY_BUDGET)throw new Error('Excel bellek güvenliği bütçesi aşıldı (128 MiB). CSV kullanın veya dosyayı bölün.');
    return readRosterFile(await file.arrayBuffer(),name);
  }
  const reader=file.stream().getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let parser:DelimitedRosterParser|undefined,head:string[]|undefined,prefix='',read=0;
  const drafts:RosterDraft[]=[];
  const consume=(rows:string[][])=>{for(const row of rows){if(!head){head=row;const expected=head.length===6?LEGACY_ROSTER_HEADERS:ROSTER_HEADERS;if(head.length!==expected.length||!expected.every((h,i)=>head![i].trim()===h))throw new Error('Sütunlar şablonla aynı olmalı.');}else drafts.push(...rowsToDrafts([row],false));}};
  try {while(true){const part=await reader.read();if(part.done)break;read+=part.value.byteLength;let text=decoder.decode(part.value,{stream:true});if(!parser){prefix+=text;if(!prefix.includes('\n')&&!prefix.includes('\r')){if(prefix.length>4096)throw new Error('CSV başlığı çok uzun.');continue;}const first=prefix.split(/[\r\n]/)[0];parser=new DelimitedRosterParser(first.includes(';')?';':',');text=prefix;prefix='';}consume(parser.feed(text));progress(read);}
    if(!parser)parser=new DelimitedRosterParser(prefix.includes(';')?';':',');consume(parser.feed(prefix+decoder.decode(),true));
    if(!drafts.length)throw new Error('En az bir kayıt yükleyin.');return drafts;
  } catch(error) {if(error instanceof TypeError)throw new Error('CSV dosyasını UTF-8 olarak kaydedin.');throw error;} finally {await reader.cancel();reader.releaseLock();}
}
