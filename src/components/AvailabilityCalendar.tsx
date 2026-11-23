import React from 'react';
import { calendarWeekday } from '../utils/appointment-slots';
import { formatDate, getIstanbulDate } from '../utils/dates';

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const monthShort = new Intl.DateTimeFormat('tr-TR', { month: 'short', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat('tr-TR', { month: 'long', timeZone: 'UTC' });
const label = (date: string, formatter: Intl.DateTimeFormat) => formatter.format(new Date(`${date}T00:00:00Z`));

// Kompakt "2 haftalık" takvim: yalnız randevu alınabilecek aralığı (firstDate..lastDate) gösterir.
// Açık günler kalın ve çerçeveli, kapalı günler soluk ve üstü çizili. Ay değiştirme düğmesi yoktur.
export function AvailabilityCalendar({ selectedDate, onSelectDate, weekdays, firstDate, lastDate, hint, isDateAvailable }: {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  weekdays: number[];
  firstDate: string;
  lastDate: string;
  hint?: string;
  // Ek kontrol (ör. bugünün bütün saatleri geçtiyse bugün kapalı).
  isDateAvailable?: (date: string) => boolean;
}) {
  const today = getIstanbulDate();
  // Izgara, firstDate'in haftasının pazartesisinden lastDate'in haftasının pazarına kadar uzanır;
  // aralığın dışındaki hücreler boş bırakılır.
  const startOffset = ((calendarWeekday(firstDate) ?? 1) + 6) % 7;
  const gridStart = addDays(firstDate, -startOffset);
  const endOffset = 6 - (((calendarWeekday(lastDate) ?? 0) + 6) % 7);
  const gridEnd = addDays(lastDate, endOffset);
  const cells: string[] = [];
  for (let date = gridStart; date <= gridEnd; date = addDays(date, 1)) cells.push(date);
  const range = `${Number(firstDate.slice(8))} ${label(firstDate, monthLong)} – ${Number(lastDate.slice(8))} ${label(lastDate, monthLong)}`;

  return <div className="availability-calendar two-week-calendar" aria-label="Müsait günler">
    <div className="calendar-heading"><strong>{range}</strong></div>
    <div className="calendar-days">{['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pa'].map((day) => <span key={day}>{day}</span>)}
      {cells.map((date) => {
        if (date < firstDate || date > lastDate) return <span key={date} aria-hidden="true" />;
        const enabled = weekdays.includes(calendarWeekday(date) ?? -1) && (!isDateAvailable || isDateAvailable(date));
        const dayNumber = Number(date.slice(8));
        // Ay değişen günlerde (ayın 1'i ve aralığın ilk günü) küçük ay adı gösterilir.
        const showMonth = dayNumber === 1 || date === firstDate;
        return <button key={date} type="button" disabled={!enabled} aria-label={formatDate(date)} aria-pressed={selectedDate === date}
          data-open={enabled} data-today={date === today ? 'true' : undefined} onClick={() => onSelectDate(date)}>
          <b>{dayNumber}</b>{showMonth && <small>{label(date, monthShort)}</small>}
        </button>;
      })}
    </div>
    {!weekdays.length && <p role="status" className="field-hint mt-2">Öğretmen henüz müsait gün belirlemedi.</p>}
    {weekdays.length > 0 && hint && <p className="field-hint mt-2">{hint}</p>}
  </div>;
}
