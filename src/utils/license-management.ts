import { getIstanbulDate } from './dates';
import type { LicenseViewStatus } from '../types/licenses';
export const licenseStatusLabels: Record<LicenseViewStatus, string> = {
  active: 'Aktif', expiring: 'Yakında Dolacak', expired: 'Süresi Doldu', suspended: 'Durduruldu', revoked: 'İptal Edildi', legacy: 'Lisans Kaydı Yok',
};
// Calendar arithmetic in Turkey's UTC+03 timezone; clamp Jan 31 / leap-day boundaries.
export function extendLicenseCalendar(expiresAt: string | null, months: number, now = new Date()): string {
  if (![1, 3, 6, 12].includes(months)) throw new Error('Geçersiz uzatma süresi.');
  const base = expiresAt && new Date(expiresAt).getTime() > now.getTime() ? new Date(expiresAt) : now;
  const local = new Date(base.getTime() + 3 * 3600000);
  const year = local.getUTCFullYear(), month = local.getUTCMonth() + months;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(local.getUTCDate(), last), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds()) - 3 * 3600000).toISOString();
}
// Date picker means access through the selected Turkish calendar day; next midnight is exclusive.
export function licenseExpiryFromDay(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Geçerli bir tarih seçin.');
  const midnight = new Date(day + 'T00:00:00+03:00');
  if (!Number.isFinite(midnight.getTime()) || getIstanbulDate(midnight) !== day) throw new Error('Geçerli bir tarih seçin.');
  return new Date(midnight.getTime() + 86400000).toISOString();
}
export function licenseLastDay(value: string): string {
  const date = new Date(value), local = new Date(date.getTime() + 3 * 3600000);
  return getIstanbulDate(new Date(date.getTime() - (local.getUTCHours() === 0 && local.getUTCMinutes() === 0 && local.getUTCSeconds() === 0 && local.getUTCMilliseconds() === 0 ? 1 : 0)));
}
