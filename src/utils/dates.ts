export function getIstanbulDate(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return '—';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export function formatAppointmentDateTime(date: string, time: string): string {
  const formattedDate = formatDate(date);
  if (formattedDate === '—' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return '—';
  return `${time} ${formattedDate.replace(/\//g, '.')}`;
}

export function formatDateTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  // Veritabanından bazen "2026-11-22 20:03:15.578346+00" biçimi gelir (boşluklu, kısa saat dilimi):
  // ISO'ya çevir, yoksa ekranda ham metin olarak görünüyordu.
  const pg = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2})(?::?(\d{2}))?$/);
  if (pg) value = `${pg[1]}T${pg[2]}${pg[3]}:${pg[4] || '00'}`;
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return formatDatesInText(value);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '—';
  const time = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }).format(parsed);
  return `${formatDate(getIstanbulDate(parsed))} ${time}`;
}

export function formatDatesInText(value: string): string {
  return value.replace(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?\b/g,
    (match) => match.includes('T') ? formatDateTime(match) : formatDate(match))
    .replace(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g, '$1/$2/$3');
}
