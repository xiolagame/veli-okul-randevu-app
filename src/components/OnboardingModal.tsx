import React from 'react';
import { KeyRound } from 'lucide-react';
import { Alert, Button, Dialog } from './ui';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSchoolCode?: string;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;
  return <Dialog title="Okulunuzla bağlantı kurun" description="Başlamak için okul yönetiminizden aktivasyon kodu alın." onClose={onClose}>
    <div className="form-stack"><span className="avatar"><KeyRound size={24} /></span><p className="text-sm text-slate-600">Okul yönetimi kaydınızı kontrol ettikten sonra size tek kullanımlık bir aktivasyon kodu verir.</p><Alert>Giriş ekranındaki <strong>“Hesabımı etkinleştir”</strong> seçeneğini açın. Okulunuzu seçip telefon numaranız, kodunuz ve yeni parolanızla hesabınızı etkinleştirin.</Alert><Button onClick={onClose}>Anladım</Button></div>
  </Dialog>;
};
