import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from './ui';
import { AVAILABILITY_DAYS } from '../utils/availability';
import { AVAILABILITY_PRESETS, WEEKDAY_IDS, meetingCount, shiftTime, unusedMinutes } from '../utils/availability-form';
import { customDurationChoices, effectiveMeetingDuration, parseCustomMeetingDuration } from '../utils/meeting-duration';

const SHORT_DAY: Record<number, string> = { 1: 'Pt', 2: 'Sa', 3: 'Ça', 4: 'Pe', 5: 'Cu', 6: 'Ct' };

// Tek ekranda: günler (çoklu seçim) → hazır saatler → –/+ ince ayar → Ekle. Saat kadranı açılmaz.
export function AvailabilityForm({ durationMinutes, busy, onSubmit }: {
  durationMinutes: number;
  busy: boolean;
  onSubmit: (days: number[], start: string, end: string, customDurationMinutes: number | null) => void;
}) {
  // null = okulun standart süresi; aksi halde öğretmenin seçtiği 20/30/40/50/60 dk.
  const [chosenDuration, setCustomDuration] = useState<number | null>(null);
  // Okul süresi değişirse eski seçim listede yoksa okul süresine dönülür.
  const customDuration = chosenDuration !== null && customDurationChoices(durationMinutes).includes(chosenDuration as never) ? chosenDuration : null;
  const meetingMinutes = effectiveMeetingDuration(customDuration, durationMinutes);
  const [days, setDays] = useState<number[]>([]);
  const [range, setRange] = useState<{ start: string; end: string }>({ start: AVAILABILITY_PRESETS[0].start, end: AVAILABILITY_PRESETS[0].end });
  const step = Math.max(5, durationMinutes || 15);
  const toggle = (day: number) => setDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day]);
  const weekdaysSelected = WEEKDAY_IDS.every((day) => days.includes(day)) && !days.includes(6);
  const count = meetingCount(range.start, range.end, meetingMinutes);
  const leftover = unusedMinutes(range.start, range.end, meetingMinutes);
  const summary = !days.length
    ? 'Önce bir veya birkaç gün seçin.'
    : count < 1
      ? `Bu saat aralığına ${meetingMinutes} dakikalık görüşme sığmıyor. Aralığı uzatın veya süreyi kısaltın.`
      : `${[...days].sort((a, b) => a - b).map((day) => SHORT_DAY[day]).join(', ')} · ${range.start}–${range.end} · ${count} görüşme · ${meetingMinutes} dk${leftover ? ` · ${leftover} dk boş kalır` : ''}`;

  const stepper = (which: 'start' | 'end', label: string) => <div className="time-stepper">
    <span id={`time-${which}-label`}>{label}</span>
    <div role="group" aria-labelledby={`time-${which}-label`}>
      <button type="button" aria-label={`${label} saatini ${step} dakika geri al`} onClick={() => setRange((current) => shiftTime(current, which, -1, step))}><Minus size={18} aria-hidden="true" /></button>
      <output aria-live="polite">{range[which]}</output>
      <button type="button" aria-label={`${label} saatini ${step} dakika ileri al`} onClick={() => setRange((current) => shiftTime(current, which, 1, step))}><Plus size={18} aria-hidden="true" /></button>
    </div>
  </div>;

  return <form className="availability-form" onSubmit={(event) => { event.preventDefault(); if (days.length && count >= 1) onSubmit(days, range.start, range.end, customDuration); }}>
    <fieldset aria-label="Günler">
      <div className="availability-legend"><span>Günler</span>
        <button type="button" className="availability-chip-link" aria-pressed={weekdaysSelected} onClick={() => setDays(weekdaysSelected ? [] : [...WEEKDAY_IDS])}>Hafta içi</button></div>
      <div className="availability-chips availability-days" role="group" aria-label="Günler">
        {AVAILABILITY_DAYS.map((day) => <button key={day.id} type="button" aria-pressed={days.includes(day.id)} aria-label={day.name} onClick={() => toggle(day.id)}>{SHORT_DAY[day.id]}</button>)}
      </div>
    </fieldset>
    <fieldset>
      <legend>Saat aralığı</legend>
      <div className="availability-chips" role="group" aria-label="Hazır saatler">
        {AVAILABILITY_PRESETS.map((preset) => <button key={preset.start} type="button" aria-pressed={range.start === preset.start && range.end === preset.end} onClick={() => setRange({ start: preset.start, end: preset.end })}>{preset.start} – {preset.end}</button>)}
      </div>
      <div className="time-steppers">{stepper('start', 'Başlangıç')}{stepper('end', 'Bitiş')}</div>
      <label className="availability-duration" htmlFor="availability-duration"><span>Görüşme süresi</span>
        <select id="availability-duration" value={customDuration ?? ''} onChange={(event) => { const parsed = parseCustomMeetingDuration(event.target.value); setCustomDuration(parsed === 'invalid' ? null : parsed); }}>
          <option value="">Okul süresi ({durationMinutes} dk)</option>
          {customDurationChoices(durationMinutes).map((minutes) => <option key={minutes} value={minutes}>{minutes} dk</option>)}
        </select>
      </label>
    </fieldset>
    <p className="availability-summary" role="status">{summary}</p>
    <Button type="submit" disabled={busy || !days.length || count < 1}><Plus size={17} aria-hidden="true" />Programa ekle</Button>
  </form>;
}
