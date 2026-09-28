export function normalizeClassName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 50 || /[\x00-\x1f]/.test(normalized)) return null;
  const standard = /^(\d{1,2})\s*(?:[-/]|\s)\s*([\p{L}\p{N}]{1,10})$/u.exec(normalized);
  return standard
    ? `${standard[1]}-${standard[2].toLocaleUpperCase('tr-TR')}`
    : normalized.toLocaleUpperCase('tr-TR');
}
