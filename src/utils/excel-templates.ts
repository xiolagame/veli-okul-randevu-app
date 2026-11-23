import { getRuntimePlatform, RuntimePlatform } from '../platform/runtime-platform';

// Templates are served from ASCII-only URLs. A Turkish-named static file was not deployed and the SPA
// fallback answered with index.html (HTTP 200), which users then saved as a broken ".xlsx".
export type ExcelTemplate = { path: string; filename: string };

export const STAFF_TEMPLATE: ExcelTemplate = { path: '/personel-bilgi-formu.xlsx', filename: 'PERSONEL_BİLGİ_FORMU.xlsx' };
export const ROSTER_TEMPLATE: ExcelTemplate = { path: '/ogrenci-veli-bilgi-formu.xlsx', filename: 'ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx' };

// Native WebViews cannot save blobs or honour <a download>; the system browser downloads the public file instead.
export const TEMPLATE_PUBLIC_ORIGIN = 'https://velirandevu.com';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const TEMPLATE_DOWNLOAD_ERROR = 'Şablon indirilemedi. Lütfen tekrar deneyin.';
export const NOT_A_REAL_XLSX_ERROR = 'Bu dosya gerçek bir Excel (.xlsx) dosyası değil. Şablonu yeniden indirip onu doldurun.';

// A real .xlsx is a ZIP package: it starts with "PK\x03\x04". HTML error pages never do.
export function isZipPackage(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// True for an HTML page (or any text starting with "<") that was saved under an .xlsx name.
export function looksLikeHtml(buffer: ArrayBuffer | Uint8Array): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let index = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (index < bytes.length && (bytes[index] === 0x20 || bytes[index] === 0x0a || bytes[index] === 0x0d || bytes[index] === 0x09)) index++;
  return bytes[index] === 0x3c;
}

export function assertZipPackage(buffer: ArrayBuffer | Uint8Array): void {
  if (!isZipPackage(buffer)) throw new Error(NOT_A_REAL_XLSX_ERROR);
}

export async function fetchTemplate(template: ExcelTemplate, load: typeof fetch = fetch): Promise<ArrayBuffer> {
  const response = await load(template.path, { cache: 'no-store' });
  if (!response.ok) throw new Error(TEMPLATE_DOWNLOAD_ERROR);
  const buffer = await response.arrayBuffer();
  // Never hand a fallback HTML page to the user as a spreadsheet.
  if (!isZipPackage(buffer)) throw new Error(TEMPLATE_DOWNLOAD_ERROR);
  return buffer;
}

export type TemplateDownloadDeps = {
  platform: () => RuntimePlatform;
  load: typeof fetch;
  saveBlob: (buffer: ArrayBuffer, filename: string) => void;
  openExternal: (url: string) => Promise<void>;
};

function saveBlobInBrowser(buffer: ArrayBuffer, filename: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: XLSX_MIME }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function openInSystemBrowser(url: string): Promise<void> {
  try {
    const { AppLauncher } = await import('@capacitor/app-launcher');
    await AppLauncher.openUrl({ url });
  } catch {
    if (typeof window === 'undefined' || !window.open(url, '_blank', 'noopener')) throw new Error(TEMPLATE_DOWNLOAD_ERROR);
  }
}

export async function downloadTemplate(template: ExcelTemplate, deps: Partial<TemplateDownloadDeps> = {}): Promise<void> {
  const platform = (deps.platform ?? getRuntimePlatform)();
  if (platform !== 'WEB') {
    await (deps.openExternal ?? openInSystemBrowser)(`${TEMPLATE_PUBLIC_ORIGIN}${template.path}`);
    return;
  }
  const buffer = await fetchTemplate(template, deps.load ?? fetch);
  (deps.saveBlob ?? saveBlobInBrowser)(buffer, template.filename);
}
