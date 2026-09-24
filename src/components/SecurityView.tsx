import React, { useState } from 'react';
import { Alert, Button, EmptyState, PageHeader, StatusBadge } from './ui';
import { useApp } from '../context/AppContext';
import { getTodayDateString } from '../data/mockData';
import { SecurityQrVerification } from '../types';
import {
  QrCode,
  ShieldCheck,
  Search,
  CheckCircle2,
  AlertTriangle,
  LogOut,
  Calendar,
  LogIn,
} from 'lucide-react';

export const SecurityView: React.FC = () => {
  const { appointments, verifySecurityQr, checkInVisitor, checkOutVisitor, settings } = useApp();
  const todayStr = getTodayDateString();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inputCode, setInputCode] = useState<string>('');
  const [verifyResult, setVerifyResult] = useState<SecurityQrVerification | null>(null);

  const [segment, setSegment] = useState<'all' | 'expected' | 'inside' | 'done'>('all');

  // Filter today's appointments
  const todayAppointments = appointments.filter((a) => a.date === todayStr);

  const expectedVisitors = todayAppointments.filter((a) => a.status === 'booked');
  const insideVisitors = todayAppointments.filter((a) => a.status === 'checked_in');
  const checkedOutVisitors = todayAppointments.filter((a) => a.status === 'checked_out');

  const displayedAppointments = todayAppointments.filter((a) => {
    if (segment === 'expected') return a.status === 'booked';
    if (segment === 'inside') return a.status === 'checked_in';
    if (segment === 'done') return a.status === 'checked_out';
    return true;
  });

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputCode.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await verifySecurityQr(inputCode.trim());
      setVerifyResult(res);
    } catch {
      setVerifyResult(null);
      setError('QR kod doğrulanamadı. Bağlantınızı kontrol edip yeniden deneyin.');
    } finally {
      setBusy(false);
    }
  };

  const handleCheckIn = async () => {
    if (!inputCode.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await checkInVisitor(inputCode.trim());
      setVerifyResult(res);
      if (res.allowed) setInputCode('');
    } catch {
      setError('Giriş kaydedilemedi. Lütfen tekrar deneyin.');
    } finally {
      setBusy(false);
    }
  };

  const handleManualCheckOut = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await checkOutVisitor(id);
      setVerifyResult(null);
    } catch {
      setError('Çıkış kaydedilemedi. Lütfen tekrar deneyin.');
    } finally {
      setBusy(false);
    }
  };

  const resultTone = verifyResult?.allowed ? 'success' : verifyResult?.decision === 'TOO_EARLY' || verifyResult?.decision === 'PENDING_APPROVAL' ? 'warning' : 'danger';

  return (
    <main id="main-content" className="page-shell">
      <PageHeader eyebrow="GÜVENLİK NOKTASI" title="Güvenli bir karşılama." description={`${settings.schoolName} · ${todayStr}`} />
      <div className="grid lg:grid-cols-[1.05fr_1fr] gap-6 items-start">
        <section className="security-scanner">
          <div className="scan-frame"><QrCode size={40} strokeWidth={1.5} /></div>
          <h2>QR kodu doğrulayın</h2>
          <p>Velinin giriş kartındaki QR içeriğini okuyucuyla aktarın veya aşağıya yapıştırın.</p>
          <form onSubmit={handleVerify} className="form-stack">
            <label className="field" htmlFor="security-qr">Randevu QR içeriği<input id="security-qr" type="text" maxLength={80} placeholder="VELIQR1:…" value={inputCode} onChange={(event) => setInputCode(event.target.value.trim())} autoComplete="off" spellCheck={false} /></label>
            <Button type="submit" disabled={busy || !inputCode.trim()}><QrCode size={20} />{busy ? 'Kontrol ediliyor…' : 'QR kodu doğrula'}</Button>
          </form>
          <p className="mt-5 text-xs flex gap-2 items-start"><ShieldCheck size={17} />Önce randevuyu doğrulayın. Girişi, sonuç ekranındaki ayrı butonla kaydedin.</p>
        </section>
        <section aria-live="polite" aria-atomic="true">
          {error && <Alert tone="danger">{error}</Alert>}
          {verifyResult ? <div className={`qr-result tone-${resultTone}`} role="status">
            {verifyResult.allowed ? <CheckCircle2 /> : <AlertTriangle />}
            <h2>{verifyResult.title}</h2><p>{verifyResult.message}</p>
            {verifyResult.appointment && <dl className="pass-details mt-6 pt-5 border-t border-current/15"><div><dt>Veli</dt><dd>{verifyResult.appointment.parentName}</dd></div><div><dt>Öğrenci</dt><dd>{verifyResult.appointment.studentName}</dd></div><div><dt>Öğretmen</dt><dd>{verifyResult.appointment.teacherName}</dd></div><div><dt>Saat</dt><dd>{verifyResult.appointment.startTime} – {verifyResult.appointment.endTime}</dd></div></dl>}
            {verifyResult.allowed && <Button className="w-full mt-6" disabled={busy || !inputCode.trim()} onClick={handleCheckIn}><LogIn size={20} />Girişi kaydet</Button>}
          </div> : <div className="surface"><EmptyState icon={ShieldCheck} title="Doğrulama için hazır" description="QR kod kontrol edildiğinde randevu durumu ve giriş bilgileri burada görünecek." /></div>}
        </section>
      </div>
      <section className="surface mt-7">
        <div className="section-heading"><div><h2>Bugünkü ziyaretler</h2><p>{insideVisitors.length} kişi okulda · {expectedVisitors.length} kişi bekleniyor · {checkedOutVisitors.length} ziyaret tamamlandı</p></div></div>
        <div className="chips mb-6">{[
          { id: 'all' as const, label: 'Tümü' },
          { id: 'expected' as const, label: `Beklenen (${expectedVisitors.length})` },
          { id: 'inside' as const, label: `Okulda (${insideVisitors.length})` },
          { id: 'done' as const, label: 'Tamamlanan' },
        ].map((item) => <button key={item.id} type="button" aria-pressed={segment === item.id} onClick={() => setSegment(item.id)}>{item.label}</button>)}</div>
        {displayedAppointments.length ? <div className="space-y-4">{displayedAppointments.map((appointment) => <article className="appointment-card" key={appointment.id}><div className="appointment-time"><strong>{appointment.startTime}</strong><span>{appointment.endTime}</span></div><div className="appointment-detail"><div className="appointment-top"><div><h3>{appointment.parentName}</h3><p>{appointment.studentName} · {appointment.className}</p></div><StatusBadge status={appointment.status} /></div><p className="mt-3">Görüşülecek öğretmen: {appointment.teacherName} · {appointment.teacherBranch}</p><p className="mt-1">{appointment.parentPhone}</p><div className="appointment-actions">
          {appointment.status === 'booked' && <Button variant="secondary" disabled={busy} onClick={async () => { if (appointment.qrToken) { setInputCode(appointment.qrToken); setBusy(true); setError(''); try { setVerifyResult(await verifySecurityQr(appointment.qrToken)); window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { setVerifyResult(null); setError('QR kod doğrulanamadı. Lütfen tekrar deneyin.'); } finally { setBusy(false); } } }}><Search size={17} />QR doğrula</Button>}
          {appointment.status === 'checked_in' && <Button variant="secondary" disabled={busy} onClick={() => handleManualCheckOut(appointment.id)}><LogOut size={17} />Çıkışı kaydet</Button>}
        </div></div></article>)}</div> : <EmptyState icon={Calendar} title="Bu görünümde ziyaret bulunmuyor" description="Bugünün randevuları ve giriş durumları burada listelenir." />}
      </section>
    </main>
  );
};
