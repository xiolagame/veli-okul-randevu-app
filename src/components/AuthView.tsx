import React, { useState } from 'react';
import { KeyRound, Lock, Phone, ShieldCheck, Eye, EyeOff, ArrowRight, Calendar, Users, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { Alert, Brand, Button, Dialog } from './ui';
import { normalizeTurkishPhone } from '../utils/phone';

interface AuthViewProps {
  onSuccess?: () => void;
  onOpenOnboarding?: () => void;
}

type CodeFlow = 'activation' | 'reset' | null;

export const AuthView: React.FC<AuthViewProps> = () => {
  const { login, schools } = useApp();
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [codeFlow, setCodeFlow] = useState<CodeFlow>(null);
  const [schoolId, setSchoolId] = useState('');
  const [codePhone, setCodePhone] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const closeCodeFlow = () => {
    setCodeFlow(null);
    setSchoolId('');
    setCodePhone('');
    setCode('');
    setNewPassword('');
    setPasswordConfirmation('');
  };

  const openCodeFlow = (flow: Exclude<CodeFlow, null>) => {
    setError('');
    setSuccessMessage('');
    setCodePhone(phone);
    setCodeFlow(flow);
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');
    const normalizedPhone = normalizeTurkishPhone(phone);
    if (!normalizedPhone) {
      setError('Geçerli bir Türkiye GSM numarası girin.');
      return;
    }
    setIsSubmitting(true);
    try {
      const success = await login(normalizedPhone, password);
      if (!success) setError('Telefon numarası veya şifre hatalı.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCodeFlow = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!codeFlow) return;
    setError('');
    if (newPassword !== passwordConfirmation) {
      setError('Şifreler eşleşmiyor.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Yeni şifre en az 8 karakter olmalıdır.');
      return;
    }

    const normalizedPhone = normalizeTurkishPhone(codePhone);
    if (!normalizedPhone) {
      setError('Geçerli bir Türkiye GSM numarası girin.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = codeFlow === 'activation'
        ? await api.activateAccount(schoolId, normalizedPhone, code, newPassword)
        : await api.resetPasswordWithCode(schoolId, normalizedPhone, code, newPassword);
      setPhone(normalizedPhone);
      setPassword('');
      closeCodeFlow();
      setSuccessMessage(result.message);
    } catch (requestError: any) {
      setError(requestError.message || 'Bilgiler doğrulanamadı veya kodun süresi dolmuş olabilir.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Brand light />
        <div>
          <p className="eyebrow" style={{ color: '#c8dea7' }}>OKUL İLE AİLE ARASINDA</p>
          <h1>İyi bir görüşme,<br /><em>güçlü bir bağ.</em></h1>
          <p>Öğretmeninizle iletişim kurmanın, görüşme planlamanın ve okul ziyaretlerinizi takip etmenin kolay yolu.</p>
          <div className="auth-illustration" aria-label="Randevu adımları">
            <div className="flow-node"><span><Users size={19} /></span>Öğretmeninizi seçin</div>
            <div className="flow-connector" />
            <div className="flow-node"><span><Calendar size={19} /></span>Size uygun zamanı bulun</div>
            <div className="flow-connector" />
            <div className="flow-node"><span><Check size={19} /></span>Görüşmeye hazır olun</div>
          </div>
        </div>
        <div className="auth-footnote"><ShieldCheck size={18} />Okulunuzla güvenli ve düzenli iletişim.</div>
      </aside>
      <main className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand"><Brand /></div>
          <span className="eyebrow">VELİ RANDEVU'YA HOŞ GELDİNİZ</span>
          <h2>Tekrar merhaba.</h2>
          <p>Okulunuzla buluşmak için hesabınıza giriş yapın.</p>
          {!codeFlow && error && <div className="mb-5"><Alert tone="danger">{error}</Alert></div>}
          {successMessage && <div className="mb-5"><Alert tone="success">{successMessage}</Alert></div>}
          <form onSubmit={handleLogin} className="form-stack">
            <label className="field" htmlFor="login-phone">Telefon numaranız
              <div className="field-icon"><Phone size={18} aria-hidden="true" /><input id="login-phone" type="tel" inputMode="tel" autoComplete="username" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0555 123 45 67" required /></div>
              <span className="field-hint">Numaranızı başında 0 veya +90 ile yazabilirsiniz.</span>
            </label>
            <div className="field">
              <label htmlFor="login-password">Parolanız</label>
              <div className="field-icon"><Lock size={18} aria-hidden="true" /><input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Parolanızı girin" required /><button type="button" className="icon-button" aria-label={showPassword ? 'Parolayı gizle' : 'Parolayı göster'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
              <button type="button" onClick={() => openCodeFlow('reset')} className="text-sm text-blue-700 font-semibold self-end">Parolamı unuttum</button>
            </div>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Giriş yapılıyor…' : 'Giriş yap'}<ArrowRight size={18} /></Button>
          </form>
          <div className="auth-divider">İlk kez mi buradasınız?</div>
          <Button variant="secondary" className="w-full" onClick={() => openCodeFlow('activation')}><KeyRound size={18} />Hesabımı etkinleştir</Button>
          <p className="auth-help">Giriş için yardıma mı ihtiyacınız var?<br />Okul yönetiminizle iletişime geçebilirsiniz.</p>
        </div>
      </main>
      {codeFlow && <Dialog title={codeFlow === 'activation' ? 'Birlikte başlayalım.' : 'Yeni bir parola belirleyin.'} description="Okul yönetiminizden aldığınız tek kullanımlık kodla devam edin." onClose={closeCodeFlow} dismissible={!isSubmitting}>
        <form onSubmit={handleCodeFlow} className="form-stack">
          {error && <Alert tone="danger">{error}</Alert>}
          <label className="field" htmlFor="code-school">Okulunuz
            <select id="code-school" value={schoolId} onChange={(event) => setSchoolId(event.target.value)} required><option value="">Okulunuzu seçin</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select>
          </label>
          <label className="field" htmlFor="code-phone">Telefon numaranız<input id="code-phone" type="tel" inputMode="tel" autoComplete="tel" value={codePhone} onChange={(event) => setCodePhone(event.target.value)} placeholder="0555 123 45 67" required /></label>
          <label className="field" htmlFor="activation-code">{codeFlow === 'activation' ? 'Aktivasyon kodu' : 'Parola sıfırlama kodu'}<input id="activation-code" type="text" inputMode="numeric" maxLength={5} pattern="[0-9]{5}" autoComplete="one-time-code" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="5 haneli kod" required className="font-mono" /></label>
          <label className="field" htmlFor="new-password">Yeni parolanız<input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={128} required /><span className="field-hint">8–128 karakter uzunluğunda bir parola belirleyin.</span></label>
          <label className="field" htmlFor="confirm-password">Yeni parolanız, tekrar<input id="confirm-password" type="password" autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} minLength={8} maxLength={128} required /></label>
          <div className="form-actions"><Button variant="secondary" disabled={isSubmitting} onClick={closeCodeFlow}>Vazgeç</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Kaydediliyor…' : codeFlow === 'activation' ? 'Hesabı etkinleştir' : 'Parolayı güncelle'}</Button></div>
        </form>
      </Dialog>}
    </div>
  );
};
