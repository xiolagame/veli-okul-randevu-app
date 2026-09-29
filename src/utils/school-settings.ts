import { SchoolSettings } from '../types';

export const FALLBACK_SLOT_MINUTES = 15;

export function resolveDefaultSlotMinutes(settings: Partial<SchoolSettings> | Record<string, unknown> | null | undefined): number {
  const source = settings as Record<string, unknown> | null | undefined;
  const candidate = source && ('defaultSlotMinutes' in source ? source.defaultSlotMinutes : source.slotDuration);
  const value = Number(candidate);
  return Number.isInteger(value) && value > 0 ? value : FALLBACK_SLOT_MINUTES;
}

export function normalizeSchoolSettings(value: unknown, schoolName: string): SchoolSettings {
  const settings = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const minSlotMinutes = Number(settings.minSlotMinutes);
  const maxBookingDaysAhead = Number(settings.maxBookingDaysAhead ?? settings.maxAdvanceBookingDays);
  return {
    schoolName: typeof settings.schoolName === 'string' && settings.schoolName.trim() ? settings.schoolName : schoolName,
    appName: typeof settings.appName === 'string' && settings.appName.trim() ? settings.appName : 'Veli Randevu',
    defaultSlotMinutes: resolveDefaultSlotMinutes(settings),
    minSlotMinutes: Number.isInteger(minSlotMinutes) && minSlotMinutes > 0 ? minSlotMinutes : 10,
    maxBookingDaysAhead: Number.isInteger(maxBookingDaysAhead) && maxBookingDaysAhead > 0 ? maxBookingDaysAhead : 30,
    allowParentCancel: typeof settings.allowParentCancel === 'boolean' ? settings.allowParentCancel : true,
  };
}

export function validateDefaultSlotMinutes(value: unknown, minimum: number): number | null {
  const duration = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  return Number.isInteger(duration) && duration >= minimum ? duration : null;
}
