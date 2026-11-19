import React from 'react';
import { Appointment } from '../types';
import { Calendar, Clock, User, CheckCircle2, AlertCircle, ShieldCheck, Printer, X } from 'lucide-react';

interface QRCodePassProps {
  appointment: Appointment;
  schoolName: string;
  onClose: () => void;
}

export const QRCodePass: React.FC<QRCodePassProps> = ({ appointment, schoolName, onClose }) => {
  // Generate deterministic QR-like SVG pattern from the 6-digit entry code
  const code = appointment.entryCode || '123456';

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

          {/* QR Code & 6-Digit Display */}
          <div className="flex flex-col items-center justify-center p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            {/* SVG QR Code Simulation */}
            <div className="w-44 h-44 bg-white p-2.5 rounded-lg border border-slate-200 shadow-xs flex items-center justify-center">
              <svg viewBox="0 0 100 100" className="w-full h-full text-slate-900">
                {/* QR Corner Squares */}
                <rect x="5" y="5" width="26" height="26" fill="currentColor" rx="2" />
                <rect x="9" y="9" width="18" height="18" fill="white" rx="1" />
                <rect x="13" y="13" width="10" height="10" fill="currentColor" rx="1" />

                <rect x="69" y="5" width="26" height="26" fill="currentColor" rx="2" />
                <rect x="73" y="9" width="18" height="18" fill="white" rx="1" />
                <rect x="77" y="13" width="10" height="10" fill="currentColor" rx="1" />

                <rect x="5" y="69" width="26" height="26" fill="currentColor" rx="2" />
                <rect x="9" y="73" width="18" height="18" fill="white" rx="1" />
                <rect x="13" y="77" width="10" height="10" fill="currentColor" rx="1" />

                {/* Simulated Data Matrix Dots based on code digits */}
                <rect x="36" y="8" width="8" height="8" fill="currentColor" />
                <rect x="48" y="14" width="8" height="8" fill="currentColor" />
                <rect x="36" y="24" width="6" height="6" fill="currentColor" />
                <rect x="54" y="26" width="6" height="6" fill="currentColor" />
                <rect x="10" y="38" width="8" height="8" fill="currentColor" />
                <rect x="24" y="44" width="8" height="8" fill="currentColor" />
                <rect x="38" y="38" width="12" height="12" fill="currentColor" />
                <rect x="56" y="42" width="8" height="8" fill="currentColor" />
                <rect x="72" y="38" width="6" height="6" fill="currentColor" />
                <rect x="84" y="44" width="8" height="8" fill="currentColor" />
                <rect x="38" y="60" width="8" height="8" fill="currentColor" />
                <rect x="52" y="66" width="8" height="8" fill="currentColor" />
                <rect x="70" y="68" width="10" height="10" fill="currentColor" />
                <rect x="84" y="74" width="8" height="8" fill="currentColor" />
                <rect x="42" y="82" width="8" height="8" fill="currentColor" />
                <rect x="62" y="84" width="6" height="6" fill="currentColor" />
              </svg>
            </div>

            {/* 6-Digit Big Badge */}
            <div className="text-center">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">GİRİŞ DOĞRULAMA KODU</span>
              <div className="font-mono text-3xl font-extrabold tracking-widest text-blue-700 mt-0.5">
                {code.slice(0, 3)} {code.slice(3)}
              </div>
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
