export const LICENSE_CODE_MAX_LENGTH = 64;
export const LICENSE_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export function normalizeLicenseCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function formatLicenseCodeInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, LICENSE_CODE_MAX_LENGTH);
}

export function isValidLicenseCode(value: unknown): boolean {
  const normalized = normalizeLicenseCode(value);
  return normalized.length >= 6 && normalized.length <= LICENSE_CODE_MAX_LENGTH && LICENSE_CODE_PATTERN.test(normalized);
}
