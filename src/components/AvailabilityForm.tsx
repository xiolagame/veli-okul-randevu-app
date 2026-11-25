import React, { useState } from 'react';
import { AlertCircle, CalendarCheck, Info, Minus, Plus } from 'lucide-react';
import { Button } from './ui';
import { AVAILABILITY_DAYS } from '../utils/availability';
import {
  AVAILABILITY_PRESETS, applyTypedEnd, applyTypedStart, canMoveEnd, canMoveStart, daysWithOtherDuration, fitRange,
  formatTypedTime, meetingCount, moveEnd, moveStart, otherDurationMessage, type TimeRange,
} from '../utils/availability-form';
import { customDurationChoices, effectiveMeetingDuration } from '../utils/meeting-duration';
import type { AvailabilitySlot } from '../types';

const SHORT_DAY: Record<number, string> = { 1: 'Pt', 2: 'Sa', 3: 'Ça', 4: 'Pe', 5: 'Cu', 6: 'Ct' };
// Görsel şeritte en fazla bu kadar parça çizilir (çok kısa sürelerde şerit okunur kalsın).
const MAX_BAR_SEGMENTS = 32;

// Sıra: günler → görüşme süresi → saat aralığı (hazır saatler, başlangıç/bitiş) → özet → ekle.
export function AvailabilityForm({ durationMinutes, busy, existing = [], onSubmit }: {
  durationMinutes: number;
  busy: boolean;
  existing?: Pick<AvailabilitySlot, 'dayOfWeek' | 'slotDurationMinutes'>[];
  onSubmit: (days: number[], start: string, end: string, customDurationMinutes: number | null) => void;
}) {
  // null = okulun standart süresi; aksi halde okul süresinden uzun 20/30/40/50/60 dk.
  const [chosenDuration, setChosenDuration] = useState<number | null>(null);
  const customDuration = chosenDuration !== null && customDurationChoices(durationMinutes).includes(chosenDuration as never) ? chosenDuration : null;
  const meetingMinutes = effectiveMeetingDuration(customDuration, durationMinutes);
  const [days, setDays] = useState<number[]>([]);
  const [range, setRange] = useState<TimeRange>(() => fitRange({ start: AVAILABILITY_PRESETS[0].start, end: AVAILABILITY_PRESETS[0].end }, Math.max(1, durationMinutes)).range);
  const [drafts, setDrafts] = useState<Partial<Record<'start' | 'end', string>>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<{ field: 'start' | 'end'; message: string } | null>(null);

  // Okul süresi değişirse (ör. yönetici ayarı) aralık yeni süreye uydurulur.
  const [fittedFor, setFittedFor] = useState(meetingMinutes);
  if (fittedFor !== meetingMinutes) {
    setFittedFor(meetingMinutes);
    setRange((current) => fitRange(current, meetingMinutes).range);
  }

  const toggle = (day: number) => setDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day]);
  const choose = (minutes: number | null) => {
    const next = effectiveMeetingDuration(minutes, durationMinutes);
    const fitted = fitRange(range, next);
    setChosenDuration(minutes);
    setFittedFor(next);
    setRange(fitted.range);
    setNote(fitted.note);
    setError(null);
  };
  const change = (result: { range: TimeRange; note: string }) => { setRange(result.range); setNote(result.note); setError(null); };
  const commit = (which: 'start' | 'end') => {
    const text = drafts[which];
    setDrafts((current) => ({ ...current, [which]: undefined }));
    if (text === undefined || text === range[which]) return;
    const result = which === 'start' ? applyTypedStart(range, text, meetingMinutes) : applyTypedEnd(range, text, meetingMinutes);
    if (result.ok) change(result);
    else { setError({ field: which, message: result.error }); setNote(''); }
  };

  const count = meetingCount(range.start, range.end, meetingMinutes);
  const blocked = daysWithOtherDuration(existing, days, meetingMinutes);
  const sortedDays = [...days].sort((a, b) => a - b);
  const canAdd = !busy && days.length > 0 && count >= 1 && blocked.length < days.length;
  const summary = !days.length
    ? 'Önce bir veya birkaç gün seçin.'
    : count < 1
      ? `Bu aralığa ${meetingMinutes} dk'lık görüşme sığmıyor.`
      : null;
  const durationOptions = [durationMinutes, ...customDurationChoices(durationMinutes)];

  const stepper = (which: 'start' | 'end', label: string) => {
    const move = which === 'start' ? moveStart : moveEnd;
    const can = which === 'start' ? canMoveStart : canMoveEnd;
    const invalid = error?.field === which;
    return <div className={`time-stepper${invalid ? ' time-stepper-invalid' : ''}`}>
      <label htmlFor={`time-${which}`}>{label}</label>
      <div role="group" aria-label={label}>
        <button type="button" aria-label={`${label} saatini ${meetingMinutes} dakika geri al`} disabled={!can(range, -1, meetingMinutes)} onClick={() => change(move(range, -1, meetingMinutes))}><Minus size={18} aria-hidden="true" /></button>
        <input id={`time-${which}`} className="time-input" type="text" inputMode="numeric" enterKeyHint="done" autoComplete="off" maxLength={5}
          aria-invalid={invalid} aria-describedby={invalid ? 'availability-error' : 'availability-hint'}
          value={drafts[which] ?? range[which]}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            const deleting = ((event.nativeEvent as InputEvent).inputType || '').startsWith('delete');
            const formatted = formatTypedTime(event.target.value, deleting);
            setDrafts((current) => ({ ...current, [which]: formatted }));
          }}
          onBlur={() => commit(which)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
        <button type="button" aria-label={`${label} saatini ${meetingMinutes} dakika ileri al`} disabled={!can(range, 1, meetingMinutes)} onClick={() => change(move(range, 1, meetingMinutes))}><Plus size={18} aria-hidden="true" /></button>
      </div>
    </div>;
  };

  const segments = Math.min(count, MAX_BAR_SEGMENTS);

  return <form className="availability-form" onSubmit={(event) => { event.preventDefault(); if (canAdd) onSubmit(days, range.start, range.end, customDuration); }}>
    <fieldset>
      <legend>Günler</legend>
      <div className="availability-chips availability-days" role="group" aria-label="Günler">
        {AVAILABILITY_DAYS.map((day) => <button key={day.id} type="button" aria-pressed={days.includes(day.id)} aria-label={day.name} onClick={() => toggle(day.id)}>{SHORT_DAY[day.id]}</button>)}
      </div>
    </fieldset>
    <fieldset>
      <legend id="availability-duration-label">Görüşme süresi</legend>
      <div className="availability-durations" role="radiogroup" aria-labelledby="availability-duration-label">
        {durationOptions.map((minutes, index) => {
          const value = index === 0 ? null : minutes;
          const selected = (index === 0 && customDuration === null) || customDuration === minutes;
          return <button key={minutes} type="button" role="radio" aria-checked={selected} onClick={() => choose(value)}>{minutes} dk</button>;
        })}
      </div>
    </fieldset>
    <fieldset>
      <legend>Saat aralığı</legend>
      <div className="availability-chips" role="group" aria-label="Hazır saatler">
        {AVAILABILITY_PRESETS.map((preset) => {
          const fitted = fitRange({ start: preset.start, end: preset.end }, meetingMinutes).range;
          return <button key={preset.start} type="button" aria-pressed={range.start === fitted.start && range.end === fitted.end}
            onClick={() => change(fitRange({ start: preset.start, end: preset.end }, meetingMinutes))}>{preset.start} – {preset.end}</button>;
        })}
      </div>
      <div className="time-steppers">{stepper('start', 'Başlangıç')}{stepper('end', 'Bitiş')}</div>
      <p className="availability-hint" id="availability-hint">Saate dokunup rakam yazabilirsiniz ya da +/- butonlarını kullanabilirsiniz.</p>
    </fieldset>
    {error && <p className="availability-message availability-error" id="availability-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error.message}</span></p>}
    {note && <p className="availability-message availability-note" role="status"><Info size={18} aria-hidden="true" /><span>{note}</span></p>}
    {blocked.length > 0 && <p className="availability-message availability-warning" role="status"><Info size={18} aria-hidden="true" /><span>{blocked.map(otherDurationMessage).join(' ')}</span></p>}
    {count >= 1 && <div className="availability-bar" aria-hidden="true">
      <div className="availability-bar-segments">{Array.from({ length: segments }, (_, index) => <span key={index} />)}</div>
      <div className="availability-bar-ends"><span>{range.start}</span><span>{range.end}</span></div>
    </div>}
    <p className="availability-summary" role="status">
      {summary ?? <><CalendarCheck size={18} aria-hidden="true" /><span>{sortedDays.map((day) => SHORT_DAY[day]).join(', ')} · <strong>{count} görüşme</strong> · her biri {meetingMinutes} dk</span></>}
    </p>
    <Button type="submit" disabled={!canAdd}><Plus size={17} aria-hidden="true" />Programa ekle</Button>
  </form>;
}
