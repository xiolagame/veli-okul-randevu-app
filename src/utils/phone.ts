export function normalizeTurkishPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const cleaned = value.trim().replace(/[\s\-()]/g, '');
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
