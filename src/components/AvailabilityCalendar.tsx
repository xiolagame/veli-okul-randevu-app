import React from 'react';
import { calendarWeekday } from '../utils/appointment-slots';
import { formatDate, getIstanbulDate } from '../utils/dates';

export function AvailabilityCalendar({ month, onMonthChange, selectedDate, onSelectDate, weekdays }: {
  month: string;
  onMonthChange: (month: string) => void;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  weekdays: number[];
}) {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const today = getIstanbulDate();
  const move = (months: number) => {
    const next = new Date(Date.UTC(year, monthNumber - 1 + months, 1));
    onMonthChange(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  return <div className="availability-calendar" aria-label="Müsait günler">
    <div className="calendar-heading"><button type="button" onClick={() => move(-1)} disabled={month <= today.slice(0, 7)} aria-label="Önceki ay">‹</button><strong>{new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)}</strong><button type="button" onClick={() => move(1)} aria-label="Sonraki ay">›</button></div>
    <div className="calendar-days">{['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pa'].map((day) => <span key={day}>{day}</span>)}
      {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}
      {Array.from({ length: dayCount }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, '0')}`;
        const enabled = date >= today && weekdays.includes(calendarWeekday(date) ?? -1);
        return <button key={date} type="button" disabled={!enabled} aria-label={formatDate(date)} aria-pressed={selectedDate === date} onClick={() => onSelectDate(date)}>{index + 1}</button>;
      })}
    </div>
    {!weekdays.length && <p role="status" className="field-hint mt-2">Öğretmen henüz müsait gün belirlemedi.</p>}
  </div>;
}
