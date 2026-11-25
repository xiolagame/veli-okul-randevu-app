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

// Öğretmene sunulacak seçenekler: okulun belirlediği süreden KISA süre seçilemez.
// Okul süresi 30 dk ise 30, 40, 50, 60; okul süresi 15 dk ise 15, 20, 30, 40, 50, 60.
// Okul süresi seçeneği "özel süre yok" (null) anlamına gelir; listedeki diğerleri özel süredir.
export function customDurationChoices(schoolDefaultMinutes: number): CustomMeetingDuration[] {
  return CUSTOM_MEETING_DURATIONS.filter((minutes) => minutes > schoolDefaultMinutes);
}

// Özel süre okul süresinden kısa olamaz (sunucu ve form aynı kuralı kullanır).
export function isCustomDurationAllowed(customDurationMinutes: number, schoolDefaultMinutes: number): boolean {
  return isCustomMeetingDuration(customDurationMinutes) && customDurationMinutes >= schoolDefaultMinutes;
}

// Bloğun gerçek görüşme süresi: öğretmenin seçtiği süre, yoksa okul süresi.
export function effectiveMeetingDuration(customDurationMinutes: number | null | undefined, schoolDefaultMinutes: number): number {
  return isCustomMeetingDuration(customDurationMinutes) ? customDurationMinutes : schoolDefaultMinutes;
}
