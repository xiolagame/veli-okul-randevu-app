import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { normalizePersonName } from '../utils/person-name';
import { Alert, Brand, Button } from './ui';

type Review = Awaited<ReturnType<typeof api.getAppointmentEmailReview>>['appointment'];

export function AppointmentEmailReview({ schoolId, token }: { schoolId: string; token: string }) {
  const [appointment, setAppointment] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getAppointmentEmailReview(schoolId, token)
      .then((result) => { if (!cancelled) setAppointment(result.appointment); })
      .catch(() => { if (!cancelled) setError('Bağlantı geçersiz, süresi dolmuş veya bu randevuya erişiminiz yok.'); });
    return () => { cancelled = true; };
  }, [schoolId, token]);

  const approve = async () => {
    setBusy(true);
    setError('');
    try {
      await api.approveAppointmentEmailReview(schoolId, token);
      setApproved(true);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch { setError('Randevu onaylanamadı. Talep değişmiş veya bağlantının süresi dolmuş olabilir.'); }
    finally { setBusy(false); }
  };

  return <main id="main-content" className="page-shell max-w-xl mx-auto">
    <Brand />
    <section className="surface mt-8 space-y-5">
      <div><p className="eyebrow">VELİ RANDEVU</p><h1 className="text-2xl font-bold">Randevu Talebi</h1></div>
      {error && <Alert tone="danger">{error}</Alert>}
      {approved && <Alert tone="success">Randevu onaylandı.</Alert>}
      {appointment && <>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm break-words">
          <div><dt className="font-semibold">Öğrenci</dt><dd>{normalizePersonName(appointment.studentName)}</dd></div>
          <div><dt className="font-semibold">Sınıf</dt><dd>{appointment.className}</dd></div>
          <div><dt className="font-semibold">Veli</dt><dd>{normalizePersonName(appointment.parentName)}</dd></div>
          <div><dt className="font-semibold">Tarih</dt><dd>{appointment.date.split('-').reverse().join('.')}</dd></div>
          <div><dt className="font-semibold">Saat</dt><dd>{appointment.startTime}–{appointment.endTime}</dd></div>
          <div><dt className="font-semibold">Öğretmen</dt><dd>{normalizePersonName(appointment.teacherName)}</dd></div>
        </dl>
        {appointment.notes && <section className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h2 className="font-semibold text-slate-900">Veli Notu</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{appointment.notes}</p></section>}
        {appointment.status === 'pending' && !approved ? <Button disabled={busy} onClick={() => { void approve(); }}>{busy ? 'Onaylanıyor…' : 'Randevuyu Onayla'}</Button>
          : !approved && <Alert tone="warning">Bu randevu artık onay beklemiyor.</Alert>}
      </>}
      {!appointment && !error && <p>Randevu talebi yükleniyor…</p>}
      <Button variant="secondary" onClick={() => { window.location.href = '/'; }}>Uygulamaya Git</Button>
    </section>
  </main>;
}
