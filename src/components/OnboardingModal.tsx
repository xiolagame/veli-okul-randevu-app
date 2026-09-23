import React from 'react';
import { KeyRound, ShieldCheck, X } from 'lucide-react';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSchoolCode?: string;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-blue-700"><ShieldCheck className="w-5 h-5" /><h2 className="font-bold text-slate-900">Güvenli Hesap Etkinleştirme</h2></div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-800"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-950 space-y-2">
          <KeyRound className="w-5 h-5 text-blue-700" />
          <p>Hesaplar yalnızca okul yönetiminin kütük kaydına bağlı olarak oluşturulur.</p>
          <p>Okulunuzdan tek kullanımlık aktivasyon kodu isteyin; giriş ekranındaki <strong>“İlk kez giriş / Hesabımı etkinleştir”</strong> seçeneğiyle işlemi tamamlayın.</p>
        </div>
        <button type="button" onClick={onClose} className="w-full py-2.5 bg-blue-700 text-white rounded-xl text-xs font-bold">Anladım</button>
      </div>
    </div>
  );
};
