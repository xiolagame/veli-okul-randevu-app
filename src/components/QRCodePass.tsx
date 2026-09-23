import React, { useEffect, useState } from 'react';
import { Appointment } from '../types';
import QRCode from 'qrcode';
import { Calendar, Clock, User, CheckCircle2, AlertCircle, ShieldCheck, Printer, X } from 'lucide-react';

interface QRCodePassProps {
  appointment: Appointment;
  schoolName: string;
  onClose: () => void;
}

export const QRCodePass: React.FC<QRCodePassProps> = ({ appointment, schoolName, onClose }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!appointment.qrToken) return;
    void QRCode.toDataURL(appointment.qrToken, { margin: 1, width: 220 }).then(setQrDataUrl);
  }, [appointment.qrToken]);

  const handlePrint = () => {
    window.print();
  };

  const isApproved = appointment.status === 'booked';
  const isCheckedIn = appointment.status === 'checked_in';
  const isCheckedOut = appointment.status === 'checked_out';
  const isPending = appointment.status === 'pending';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 to-indigo-800 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-lg">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base leading-tight">Okul Giriş Kartı</h3>
              <p className="text-xs text-blue-100/90 truncate max-w-[240px]">{schoolName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pass Content */}
        <div className="p-6 space-y-5">
          {/* Status Alert */}
          {isApproved && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm font-medium">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>Giriş onaylandı. Güvenlik noktasında bu kodu ibraz ediniz.</span>
            </div>
          )}
          {isCheckedIn && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-800 text-sm font-medium">
              <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0" />
              <span>Giriş yapıldı ({appointment.checkedInAt}). İyi görüşmeler!</span>
            </div>
          )}
          {isCheckedOut && (
            <div className="flex items-center gap-2 p-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-700 text-sm font-medium">
              <CheckCircle2 className="w-5 h-5 text-slate-500 shrink-0" />
              <span>Ziyaret tamamlandı ve çıkış yapıldı ({appointment.checkedOutAt}).</span>
            </div>
          )}
          {isPending && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm font-medium">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
              <span>Randevu henüz öğretmen tarafından onaylanmadı. Kod pasiftir.</span>
            </div>
          )}

          {/* Opaque QR token; the server remains authoritative for status and time window. */}
          <div className="flex flex-col items-center justify-center p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="w-44 h-44 bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs flex items-center justify-center">
              {qrDataUrl ? <img src={qrDataUrl} alt="Randevu QR kodu" className="w-full h-full" /> : <span className="text-xs text-slate-500">QR hazırlanıyor</span>}
            </div>
            <div className="text-center">
              <span className="text-xs font-semibold text-slate-500">QR kod yalnızca sunucu tarafından doğrulanır.</span>
            </div>
          </div>

          {/* Details Table */}
          <div className="space-y-2.5 text-sm border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between text-slate-600">
              <span className="flex items-center gap-1.5 text-slate-500">
                <User className="w-4 h-4" /> Veli:
              </span>
              <span className="font-semibold text-slate-800">{appointment.parentName}</span>
            </div>

            <div className="flex items-center justify-between text-slate-600">
              <span className="flex items-center gap-1.5 text-slate-500">
                <User className="w-4 h-4" /> Öğrenci:
              </span>
              <span className="font-medium text-slate-800">{appointment.studentName} ({appointment.className})</span>
            </div>

            <div className="flex items-center justify-between text-slate-600">
              <span className="flex items-center gap-1.5 text-slate-500">
                <User className="w-4 h-4" /> Öğretmen:
              </span>
              <span className="font-semibold text-blue-700">{appointment.teacherName} <span className="font-normal text-xs text-slate-500">({appointment.teacherBranch})</span></span>
            </div>

            <div className="flex items-center justify-between text-slate-600">
              <span className="flex items-center gap-1.5 text-slate-500">
                <Calendar className="w-4 h-4" /> Tarih:
              </span>
              <span className="font-medium text-slate-800">{appointment.date}</span>
            </div>

            <div className="flex items-center justify-between text-slate-600">
              <span className="flex items-center gap-1.5 text-slate-500">
                <Clock className="w-4 h-4" /> Randevu Saati:
              </span>
              <span className="font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md">
                {appointment.startTime} - {appointment.endTime}
              </span>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex gap-2.5 pt-2">
            <button
              onClick={handlePrint}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 font-medium rounded-xl text-sm transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" /> Yazdır / Kaydet
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-medium rounded-xl text-sm transition-colors cursor-pointer"
            >
              Kapat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
