// 990000 kuruş -> "9.900 TL". Kuruş varsa "9.900,50 TL".
export function formatTryAmount(amountMinor: number): string {
  const lira = Math.floor(amountMinor / 100);
  const kurus = amountMinor % 100;
  const liraText = lira.toLocaleString('tr-TR');
  return kurus === 0 ? `${liraText} TL` : `${liraText},${String(kurus).padStart(2, '0')} TL`;
}

// "9.900", "9900,50" veya "9.900,5" -> kuruş. Geçersiz girişte null.
export function parseTryInputToMinor(input: string): number | null {
  const text = input.trim().replace(/\s|TL/gi, '');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(text)) return null;
  const [lira, kurus = ''] = text.replace(/\./g, '').split(',');
  const minor = Number(lira) * 100 + Number(kurus.padEnd(2, '0'));
  return Number.isSafeInteger(minor) && minor > 0 && minor <= 100_000_000 ? minor : null;
}
