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
  return <Dialog title="Okulunuzla bağlantı kurun" description="Başlamak için okul kaydınızdaki telefon numarasını doğrulayın." onClose={onClose}>
    <div className="form-stack"><span className="avatar"><KeyRound size={24} /></span><p className="text-sm text-slate-600">Okul yönetiminden okul kodunuzu ve kayıtlı telefon bilginizi doğrulamasını isteyin.</p><Alert>Giriş ekranındaki <strong>“Veli ilk giriş”</strong> seçeneğini açın. Okul kodu ve kayıtlı telefonunuza gönderilen WhatsApp koduyla hesabınızı etkinleştirin.</Alert><Button onClick={onClose}>Anladım</Button></div>
  </Dialog>;
};
