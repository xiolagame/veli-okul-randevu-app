export function intervalsOverlap(
  slot: { startTime: string; endTime: string },
  occupied: { startTime: string; endTime: string }
): boolean {
  return slot.startTime < occupied.endTime && slot.endTime > occupied.startTime;
}

export function calendarWeekday(isoDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== isoDate) return null;
  return date.getUTCDay();
}

export function slotMatchesAvailability(
  slot: { dayOfWeek: number; startTime: string; endTime: string; slotDurationMinutes: number },
  date: string,
  startTime: string,
  endTime: string
): boolean {
  if (calendarWeekday(date) !== slot.dayOfWeek || slot.dayOfWeek === 0) return false;
  const minutes = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
    ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : NaN;
  const start = minutes(startTime);
  const end = minutes(endTime);
  const windowStart = minutes(slot.startTime);
  const windowEnd = minutes(slot.endTime);
  const duration = slot.slotDurationMinutes;
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(windowStart) && Number.isFinite(windowEnd) &&
    Number.isInteger(duration) && duration > 0 && start >= windowStart && end <= windowEnd &&
    end - start === duration && (start - windowStart) % duration === 0;
}
