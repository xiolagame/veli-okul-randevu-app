export function normalizeTurkishPhone(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null;

  const cleaned = String(value).trim().replace(/[\s\-()]/g, '');
  if (!/^\+?\d+$/.test(cleaned)) return null;

  let subscriberNumber: string | null = null;
  if (/^\+90(5\d{9})$/.test(cleaned)) subscriberNumber = cleaned.slice(3);
  else if (/^90(5\d{9})$/.test(cleaned)) subscriberNumber = cleaned.slice(2);
  else if (/^0(5\d{9})$/.test(cleaned)) subscriberNumber = cleaned.slice(1);
  else if (/^(5\d{9})$/.test(cleaned)) subscriberNumber = cleaned;

  return subscriberNumber ? `+90${subscriberNumber}` : null;
}

export function getTurkishPhoneLookupDigits(value: unknown): [string, string, string] | null {
  const canonicalPhone = normalizeTurkishPhone(value);
  if (!canonicalPhone) return null;

  const subscriberNumber = canonicalPhone.slice(3);
  return [canonicalPhone.slice(1), `0${subscriberNumber}`, subscriberNumber];
}

export function formatTurkishPhoneInput(value: string): string {
  const canonical = normalizeTurkishPhone(value);
  const rawDigits = canonical ? `0${canonical.slice(3)}` : value.replace(/\D/g, '');
  const digits = (rawDigits.startsWith('90') && rawDigits.length > 10 ? `0${rawDigits.slice(2)}` : rawDigits).slice(0, 11);
  return [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7, 9), digits.slice(9, 11)].filter(Boolean).join(' ');
}

export function isValidTurkishPhoneInput(value: unknown): boolean {
  return normalizeTurkishPhone(value) !== null;
}

export function normalizeUserPhoneInput(value: unknown): string | null {
  return normalizeTurkishPhone(value);
}

export function displayStoredTurkishPhone(value: string): string {
  const canonical = normalizeTurkishPhone(value);
  return canonical ? formatTurkishPhoneInput(`0${canonical.slice(3)}`) : value;
}
