export function normalizePersonName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('tr-TR');
}

export function uppercasePersonNameInput(value: string): string {
  return value.toLocaleUpperCase('tr-TR');
}
