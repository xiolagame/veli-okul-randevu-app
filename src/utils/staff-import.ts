import { normalizeTurkishPhone } from './phone';
import { StaffDraft, validateStaffForm } from './staff-form';

export const STAFF_IMPORT_MAX_ROWS = 200;
export const STAFF_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export type StaffImportRow = {
  line: number;
  draft: StaffDraft;
  errors: string[];
};

type ExistingStaff = { phone?: string; email?: string };

const headers = ['Ad Soyad', 'Görevi', 'Branş', 'Telefon', 'E-posta'];

function phoneKey(value: string): string {
  const normalized = normalizeTurkishPhone(value);
  return normalized ? normalized.replace(/\D/g, '').slice(-10) : '';
}

function textCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  throw new Error('Excel hücrelerinde yalnızca düz metin veya sayı kullanın.');
}

function checkArchive(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);
  let entries = 0;
  let total = 0;
  for (let offset = 0; offset + 46 <= view.byteLength; offset++) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    entries++;
    total += view.getUint32(offset + 24, true);
    if (entries > 100 || total > 20 * 1024 * 1024) {
      throw new Error('Excel dosyası çok büyük veya karmaşık.');
    }
  }
  if (!entries) throw new Error('Geçerli bir Excel dosyası seçin.');
}

export async function readStaffImportFile(
  file: File,
  existing: ExistingStaff[],
): Promise<StaffImportRow[]> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Yalnızca .xlsx dosyası yükleyebilirsiniz.');
  if (file.size > STAFF_IMPORT_MAX_BYTES) throw new Error('Excel dosyası en fazla 2 MB olabilir.');
  if (!file.size) throw new Error('Excel dosyası boş.');

  const buffer = await file.arrayBuffer();
  checkArchive(buffer);

  const { readSheet } = await import('read-excel-file/universal');
  let sheet: import('read-excel-file/universal').SheetData;
  try {
    sheet = await readSheet(buffer, 'Personel');
  } catch {
    throw new Error('Personel sayfası okunamadı. Standart Excel şablonunu kullanın.');
  }

  if (!sheet.length || headers.some((header, index) => sheet[0]?.[index] !== header)) {
    throw new Error('Excel sütun başlıkları farklı. Standart şablonu kullanın.');
  }

  const records = sheet.slice(1).filter((row) =>
    row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ''),
  );

  if (!records.length) throw new Error('Excel dosyasında personel kaydı bulunamadı.');
  if (records.length > STAFF_IMPORT_MAX_ROWS) {
    throw new Error('Tek seferde en fazla 200 personel ekleyebilirsiniz.');
  }

  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();
  const existingPhones = new Set(existing.map((item) => phoneKey(item.phone || '')).filter(Boolean));
  const existingEmails = new Set(existing.map((item) => (item.email || '').trim().toLowerCase()).filter(Boolean));

  return records.map((row) => {
    const line = sheet.indexOf(row) + 1;
    if (row.length > headers.length && row.slice(headers.length).some((cell) => cell != null && String(cell).trim())) {
      return {
        line,
        draft: { fullName: '', role: '', branch: '', phone: '', email: '' },
        errors: ['Şablonda fazladan sütun bulunuyor.'],
      };
    }

    const cells = headers.map((_, index) => textCell(row[index]));
    const roleValue = cells[1].toLocaleLowerCase('tr-TR');
    const role: StaffDraft['role'] =
      roleValue === 'öğretmen' ? 'teacher' :
      roleValue === 'güvenlik' ? 'security' : '';

    const draft: StaffDraft = {
      fullName: cells[0],
      role,
      branch: cells[2],
      phone: cells[3],
      email: cells[4].toLowerCase(),
    };

    const errors = Object.values(validateStaffForm(draft)).filter(
      (message): message is string => Boolean(message),
    );

    if (!role) errors.push('Görevi yalnızca Öğretmen veya Güvenlik olabilir.');

    const phone = phoneKey(draft.phone);
    if (phone) {
      if (seenPhones.has(phone)) errors.push('Telefon Excel içinde tekrar ediyor.');
      if (existingPhones.has(phone)) errors.push('Telefon okulda zaten kayıtlı.');
      seenPhones.add(phone);
    }

    if (draft.email) {
      if (seenEmails.has(draft.email)) errors.push('E-posta Excel içinde tekrar ediyor.');
      if (existingEmails.has(draft.email)) errors.push('E-posta okulda zaten kayıtlı.');
      seenEmails.add(draft.email);
    }

    return { line, draft, errors };
  });
}