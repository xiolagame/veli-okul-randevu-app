import { formatDate, formatDateTime } from '../utils/dates';
import React, { useEffect, useState } from 'react';
import { Appointment } from '../types';
import QRCode from 'qrcode';
import { Printer, QrCode } from 'lucide-react';
import { Alert, Button, Dialog, StatusBadge } from './ui';

interface QRCodePassProps {
  appointment: Appointment;
  schoolName: string;
  onClose: () => void;
}

export const QRCodePass: React.FC<QRCodePassProps> = ({ appointment, schoolName, onClose }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    let active = true;
    setQrDataUrl(null);
    setQrError(false);
    if (appointment.qrToken) {
      void QRCode.toDataURL(appointment.qrToken, { margin: 4, width: 280 }).then((image) => { if (active) setQrDataUrl(image); }).catch(() => { if (active) setQrError(true); });
    }
    return () => { active = false; };
  }, [appointment.qrToken]);

  const statusMessage = {
    pending: 'Öğretmen onayı bekleniyor. Bu kart henüz giriş izni vermez.',
    booked: 'Randevunuz onaylandı. Girişte bu QR kodu güvenlik görevlisine gösterin.',
    checked_in: `Okula girişiniz kaydedildi${appointment.checkedInAt ? ` · ${formatDateTime(appointment.checkedInAt)}` : ''}.`,
    checked_out: 'Ziyaretiniz tamamlandı. İyi günler dileriz.',
    cancelled: 'Bu randevu iptal edildi. Giriş için kullanılamaz.',
    rejected: 'Öğretmeniniz bu randevuyu onaylamadı. Giriş için kullanılamaz.',
  };
  const tone = appointment.status === 'booked' || appointment.status === 'checked_in' ? 'success' : appointment.status === 'pending' ? 'warning' : appointment.status === 'rejected' || appointment.status === 'cancelled' ? 'danger' : 'info';

  return <Dialog title="Okul giriş kartınız" description={schoolName} onClose={onClose} className="qr-pass">
    <div className="flex justify-center mb-5"><StatusBadge status={appointment.status} /></div>
    <Alert tone={tone}>{statusMessage[appointment.status]}</Alert>
    <div className="qr-picture">
      {qrDataUrl ? <img src={qrDataUrl} alt="Okul girişinde gösterilecek randevu QR kodu" /> : <div className="text-center text-sm text-slate-500" role="status"><QrCode size={36} className="mx-auto mb-3" />{qrError ? 'QR görüntüsü yüklenemedi. Kartı yeniden açın.' : appointment.qrToken ? 'QR hazırlanıyor…' : 'Bu randevu için QR bulunmuyor.'}</div>}
    </div>
    <dl className="pass-details">
      <div><dt>Öğretmen</dt><dd>{appointment.teacherName}<span className="block font-normal text-xs text-slate-500">{appointment.teacherBranch}</span></dd></div>
      <div><dt>Öğrenci</dt><dd>{appointment.studentName} · {appointment.className}</dd></div>
      <div><dt>Veli</dt><dd>{appointment.parentName}</dd></div>
      <div><dt>Tarih</dt><dd>{formatDate(appointment.date)}</dd></div>
      <div><dt>Saat</dt><dd>{appointment.startTime} – {appointment.endTime}</dd></div>
    </dl>
    <p className="field-hint text-center mt-6">Girişte randevu durumunuz ve saatiniz yeniden kontrol edilir.</p>
    <div className="form-actions mt-4"><Button variant="secondary" onClick={() => window.print()}><Printer size={17} />Yazdır</Button><Button onClick={onClose}>Tamam</Button></div>
  </Dialog>;
};
