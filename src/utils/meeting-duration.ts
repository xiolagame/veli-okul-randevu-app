// Öğretmenin müsaitlik bloğu için seçebileceği görüşme süreleri (dakika).
// Seçilmezse (null) okulun standart süresi kullanılır.
export const CUSTOM_MEETING_DURATIONS = [20, 30, 40, 50, 60] as const;

export type CustomMeetingDuration = typeof CUSTOM_MEETING_DURATIONS[number];

export function isCustomMeetingDuration(value: unknown): value is CustomMeetingDuration {
  return typeof value === 'number' && (CUSTOM_MEETING_DURATIONS as readonly number[]).includes(value);
}

// İstekteki değeri çözer: boş/okul süresi -> null, izinli süre -> sayı, geçersiz -> 'invalid'.
export function parseCustomMeetingDuration(value: unknown): CustomMeetingDuration | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null;
  const numeric = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  return isCustomMeetingDuration(numeric) ? numeric : 'invalid';
}

// Bloğun gerçek görüşme süresi: öğretmenin seçtiği süre, yoksa okul süresi.
export function effectiveMeetingDuration(customDurationMinutes: number | null | undefined, schoolDefaultMinutes: number): number {
  return isCustomMeetingDuration(customDurationMinutes) ? customDurationMinutes : schoolDefaultMinutes;
}
