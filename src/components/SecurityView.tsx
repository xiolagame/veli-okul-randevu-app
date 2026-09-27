import { formatAppointmentDateTime, formatDate, formatDateTime, formatDatesInText } from '../utils/dates';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, EmptyState, PageHeader, StatusBadge } from './ui';
import { useApp } from '../context/AppContext';
import { getTodayDateString } from '../data/mockData';
import { SecurityQrVerification } from '../types';
import QrScanner from 'qr-scanner';
import {
  QrCode,
  Camera,
  ShieldCheck,
  Search,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  LogIn,
  X,
} from 'lucide-react';

export const SecurityView: React.FC = () => {
  const { appointments, verifySecurityQr, checkInVisitor, settings } = useApp();
  const todayStr = getTodayDateString();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inputCode, setInputCode] = useState<string>('');
  const [verifyResult, setVerifyResult] = useState<SecurityQrVerification | null>(null);
  const [checkInComplete, setCheckInComplete] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const scanHandledRef = useRef(false);
  const verificationInProgressRef = useRef(false);
  const startingRef = useRef(false);
  const cameraRunRef = useRef(0);

  const [segment, setSegment] = useState<'all' | 'expected' | 'inside'>('all');

  // Filter today's appointments
  const todayAppointments = appointments.filter((a) => a.date === todayStr);

  const expectedVisitors = todayAppointments.filter((a) => a.status === 'booked');
  const insideVisitors = todayAppointments.filter((a) => a.status === 'checked_in');
  const displayedAppointments = todayAppointments.filter((a) => {
    if (segment === 'expected') return a.status === 'booked';
    if (segment === 'inside') return a.status === 'checked_in';
    return true;
  });

  const stopCamera = () => {
    cameraRunRef.current += 1;
    startingRef.current = false;
    scannerRef.current?.stop();
    setCameraActive(false);
    setCameraStarting(false);
  };

  useEffect(() => () => {
    cameraRunRef.current += 1;
    scannerRef.current?.destroy();
    scannerRef.current = null;
  }, []);

  const getCameraError = (cause: unknown) => {
    const error = typeof cause === 'object' && cause !== null
      ? cause as { name?: unknown; message?: unknown }
      : null;
    const name = typeof error?.name === 'string' ? error.name : '';
    const message = typeof cause === 'string' ? cause.toLowerCase() : typeof error?.message === 'string' ? error.message.toLowerCase() : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Kamera izni verilmedi. Ayarlarınızdan kamera erişimine izin verin.';
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || message.includes('camera not found')) return 'Bu cihazda kullanılabilir kamera bulunamadı.';
    if (name === 'SecurityError') return 'Kamera yalnızca güvenli bağlantıda (HTTPS) kullanılabilir.';
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'Kamera başka bir uygulama tarafından kullanılıyor olabilir.';
    return 'Kamera başlatılamadı. Lütfen tekrar deneyin.';
  };

  const verifyCode = async (code: string) => {
    const cleanCode = code.trim();
    if (!cleanCode || verificationInProgressRef.current) return;
    verificationInProgressRef.current = true;
    scanHandledRef.current = true;
    setInputCode(cleanCode);
    stopCamera();
    setBusy(true);
    setError('');
    try {
      const res = await verifySecurityQr(cleanCode);
      setVerifyResult(res);
    } catch {
      setVerifyResult(null);
      setError('QR kod doğrulanamadı. Bağlantınızı kontrol edip yeniden deneyin.');
    } finally {
      setBusy(false);
    }
  };

  const resetResult = () => {
    verificationInProgressRef.current = false;
    scanHandledRef.current = false;
    setVerifyResult(null);
    setCheckInComplete(false);
    setInputCode('');
    setError('');
    setCameraError('');
  };

  const startCamera = async () => {
    if (startingRef.current) return;
    setCameraError('');
    if (!window.isSecureContext) {
      setCameraError('Kamera yalnızca güvenli bağlantıda (HTTPS) kullanılabilir.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Bu tarayıcı QR taramayı desteklemiyor.');
      return;
    }
    if (!videoRef.current) {
      setCameraError('Kamera başlatılamadı. Lütfen tekrar deneyin.');
      return;
    }

    startingRef.current = true;
    const run = ++cameraRunRef.current;
    setCameraStarting(true);
    setCameraActive(true);
    try {
      const scanner: QrScanner = scannerRef.current || new QrScanner(videoRef.current, (result) => {
        if (scannerRef.current !== scanner || scanHandledRef.current) return;
        const code = typeof result === 'string' ? result : result.data;
        scanHandledRef.current = true;
        void verifyCode(code.trim());
      }, { preferredCamera: 'environment', returnDetailedScanResult: true });
      scannerRef.current = scanner;
      await scanner.start();
      if (run !== cameraRunRef.current) return;
      startingRef.current = false;
      setCameraStarting(false);
    } catch (cause) {
      if (run !== cameraRunRef.current) return;
      scannerRef.current?.stop();
      startingRef.current = false;
      setCameraActive(false);
      setCameraStarting(false);
      let denied = false;
      try {
        denied = (await navigator.permissions?.query({ name: 'camera' as PermissionName }))?.state === 'denied';
      } catch {}
      if (run === cameraRunRef.current) {
        setCameraError(denied ? 'Kamera izni verilmedi. Ayarlarınızdan kamera erişimine izin verin.' : getCameraError(cause));
      }
    }
  };

  const handleCheckIn = async () => {
    if (!inputCode.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await checkInVisitor(inputCode.trim());
      setVerifyResult(res);
      setCheckInComplete(res.allowed);
      if (res.allowed) setInputCode('');
    } catch {
      setError('Giriş kaydedilemedi. Lütfen tekrar deneyin.');
    } finally {
      setBusy(false);
    }
  };

  const resultTone = verifyResult?.allowed ? 'success' : verifyResult?.decision === 'TOO_EARLY' || verifyResult?.decision === 'PENDING_APPROVAL' ? 'warning' : 'danger';
  const showAppointmentDetails = verifyResult?.appointment && ['APPROVED', 'TOO_EARLY', 'ALREADY_CHECKED_IN'].includes(verifyResult.decision);

  return (
    <main id="main-content" className="page-shell">
      <PageHeader eyebrow="GÜVENLİK NOKTASI" title="Güvenli bir karşılama." description={`${settings.schoolName} · ${formatDate(todayStr)}`} />
      <div className="grid gap-6 items-start">
        <section className="security-scanner">
          {!verifyResult && !error && <>
            <div className="scan-frame"><QrCode size={40} strokeWidth={1.5} /></div>
            <h2>QR kodu okutun</h2>
            <p>Randevu kartındaki QR kodu kameraya gösterin.</p>
          </>}
          <div className={`camera-preview ${verifyResult || error || busy ? `camera-preview-result tone-${resultTone}` : cameraActive ? 'camera-preview-active' : ''}`}>
            <video ref={videoRef} autoPlay playsInline muted aria-label="QR kodu kamera görüntüsü" hidden={!!(verifyResult || error || busy)} />
          {verifyResult || error || busy ? <>
            <div className="camera-result-panel" role="status" aria-live="polite">
              <button type="button" className="camera-result-close" aria-label="Sonucu kapat" disabled={busy} onClick={resetResult}><X size={21} /></button>
              {busy && !verifyResult && !error ? <><QrCode className="camera-result-icon" /><h2>QR KOD DOĞRULANIYOR</h2><p>Lütfen bekleyin.</p></> : verifyResult ? <>
                {verifyResult.allowed ? <CheckCircle2 className="camera-result-icon" /> : <AlertTriangle className="camera-result-icon" />}
                <h2>{verifyResult.title}</h2><p>{formatDatesInText(verifyResult.message)}</p>
                {error && <p role="alert">{error}</p>}
                {showAppointmentDetails && verifyResult.appointment && <dl className="camera-result-details"><div><dt>Veli</dt><dd>{verifyResult.appointment.parentName}</dd></div><div><dt>Öğrenci</dt><dd>{verifyResult.appointment.studentName}</dd></div><div><dt>Öğretmen</dt><dd>{verifyResult.appointment.teacherName}</dd></div><div><dt>Randevu</dt><dd>{formatAppointmentDateTime(verifyResult.appointment.date, verifyResult.appointment.startTime)}</dd></div><div><dt>Saat aralığı</dt><dd>{verifyResult.appointment.startTime}–{verifyResult.appointment.endTime}</dd></div>{verifyResult.decision === 'ALREADY_CHECKED_IN' && verifyResult.appointment.checkedInAt && <div><dt>Giriş zamanı</dt><dd>{formatDateTime(verifyResult.appointment.checkedInAt)}</dd></div>}</dl>}
                {verifyResult.allowed && !checkInComplete && <Button className="w-full" disabled={busy} onClick={handleCheckIn}><LogIn size={19} />Girişi Kaydet</Button>}
                <Button variant="secondary" className="w-full" disabled={busy} onClick={() => { resetResult(); void startCamera(); }}><Camera size={19} />Yeni QR Tara</Button>
              </> : <><AlertTriangle className="camera-result-icon" /><h2>QR DOĞRULANAMADI</h2><p>{error}</p><Button className="w-full" onClick={() => { resetResult(); void startCamera(); }}><Camera size={19} />Yeni QR Tara</Button></>}
            </div>
          </> : <>
            {!cameraActive && <div className="camera-placeholder"><Camera size={30} /><span>Arka kamera tarama alanı</span></div>}
            {cameraActive && <div className="camera-reticle" aria-hidden="true" />}
          </>}
          </div>
          {cameraError && <Alert tone="danger">{cameraError}</Alert>}
          {!verifyResult && !error && !busy && <Button type="button" variant={cameraActive ? 'secondary' : 'primary'} disabled={cameraStarting} onClick={() => cameraActive ? stopCamera() : void startCamera()}>
            <Camera size={19} />{cameraStarting ? 'Kamera açılıyor…' : cameraActive ? 'Taramayı durdur' : 'QR Kod Tara'}
          </Button>}
          {!verifyResult && !error && !busy && <p className="mt-5 text-xs flex gap-2 items-start"><ShieldCheck size={17} />Giriş yalnızca geçerli ve onaylı randevu için kaydedilir.</p>}
        </section>
      </div>
      <section className="surface mt-7">
        <div className="section-heading"><div><h2>Bugünkü ziyaretler</h2><p>{insideVisitors.length} kişi okulda · {expectedVisitors.length} kişi bekleniyor</p></div></div>
        <div className="chips mb-6">{[
          { id: 'all' as const, label: 'Tümü' },
          { id: 'expected' as const, label: `Beklenen (${expectedVisitors.length})` },
          { id: 'inside' as const, label: `Okulda (${insideVisitors.length})` },
        ].map((item) => <button key={item.id} type="button" aria-pressed={segment === item.id} onClick={() => setSegment(item.id)}>{item.label}</button>)}</div>
        {displayedAppointments.length ? <div className="space-y-4">{displayedAppointments.map((appointment) => <article className="appointment-card" key={appointment.id}><div className="appointment-time"><strong>{appointment.startTime}</strong><span>{appointment.endTime}</span></div><div className="appointment-detail"><div className="appointment-top"><div><h3>{appointment.parentName}</h3><p>{appointment.studentName} · {appointment.className}</p></div><StatusBadge status={appointment.status} /></div><p className="mt-3">Görüşülecek öğretmen: {appointment.teacherName} · {appointment.teacherBranch}</p><p className="mt-1">{appointment.parentPhone}</p><div className="appointment-actions">
          {appointment.status === 'booked' && <Button variant="secondary" disabled={busy} onClick={() => { if (appointment.qrToken) { window.scrollTo({ top: 0, behavior: 'smooth' }); void verifyCode(appointment.qrToken); } }}><Search size={17} />QR doğrula</Button>}
        </div></div></article>)}</div> : <EmptyState icon={Calendar} title="Bu görünümde ziyaret bulunmuyor" description="Bugünün randevuları ve giriş durumları burada listelenir." />}
      </section>
    </main>
  );
};
