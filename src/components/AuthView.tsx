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
type ParentFlow = 'registration' | 'reset' | null;
type StaffResetStep = 'request' | 'verify' | 'password' | null;

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
  const [parentFlow, setParentFlow] = useState<ParentFlow>(null);
  const [parentChallenge, setParentChallenge] = useState('');
  const [parentSchoolCode, setParentSchoolCode] = useState('');
  const [parentBirthDate, setParentBirthDate] = useState('');
  const [parentSchoolId, setParentSchoolId] = useState('');
  const [staffSetupToken, setStaffSetupToken] = useState('');
  const [showResetChoices, setShowResetChoices] = useState(false);
  const [staffResetStep, setStaffResetStep] = useState<StaffResetStep>(null);
  const [staffResetSchoolCode, setStaffResetSchoolCode] = useState('');
  const [staffResetChallenge, setStaffResetChallenge] = useState('');
  const [staffResetSchoolId, setStaffResetSchoolId] = useState('');

  const closeCodeFlow = () => {
    setCodeFlow(null);
    setSchoolId('');
    setCodePhone('');
    setCode('');
    setStaffSetupToken('');
    setNewPassword('');
    setPasswordConfirmation('');
  };

  const openCodeFlow = (flow: Exclude<CodeFlow, null>) => {
    setError('');
    setSuccessMessage('');
    setStaffSetupToken('');
    setCodePhone(phone);
    setCodeFlow(flow);
  };

  const closeParentFlow = () => {
    setParentFlow(null);
    setParentChallenge('');
    setParentSchoolCode('');
    setParentBirthDate('');
    setParentSchoolId('');
    setNewPassword('');
    setPasswordConfirmation('');
    setStaffSetupToken('');
    setError('');
  };

  const submitParentFlow = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!parentFlow) return;
    setError('');
    const normalizedPhone = normalizeTurkishPhone(codePhone);
    if (!normalizedPhone) { setError('Geçerli bir Türkiye GSM numarası girin.'); return; }
    setIsSubmitting(true);
    try {
      if (!parentChallenge) {
        const result = parentFlow === 'registration'
          ? await api.parentRegistrationChallenge(parentSchoolCode, normalizedPhone, parentBirthDate)
          : await api.parentResetChallenge(parentSchoolCode, normalizedPhone, parentBirthDate);
        setParentChallenge(result.challenge);
        setParentSchoolId(result.schoolId);
        return;
      }
      if (newPassword !== passwordConfirmation) { setError('Şifreler eşleşmiyor.'); return; }
      const result = parentFlow === 'registration'
        ? await api.parentRegistrationComplete(parentSchoolId, normalizedPhone, parentBirthDate, parentChallenge, newPassword)
        : await api.parentResetComplete(parentSchoolId, normalizedPhone, parentBirthDate, parentChallenge, newPassword);
      setPhone(normalizedPhone);
      closeParentFlow();
      setSuccessMessage(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bilgiler doğrulanamadı.');
    } finally { setIsSubmitting(false); }
  };

  const closeStaffReset = () => { setStaffResetStep(null); setStaffResetSchoolCode(''); setStaffResetChallenge(''); setStaffResetSchoolId(''); setCode(''); setNewPassword(''); setPasswordConfirmation(''); setError(''); };
  const submitStaffReset = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedPhone = normalizeTurkishPhone(codePhone);
    if (!normalizedPhone) { setError('Geçerli bir Türkiye GSM numarası girin.'); return; }
    setError('');
    setIsSubmitting(true);
    try {
      if (staffResetStep === 'request') {
        const result = await api.requestStaffReset(staffResetSchoolCode, normalizedPhone);
        setSuccessMessage(result.message);
        setStaffResetStep('verify');
      } else if (staffResetStep === 'verify') {
        const result = await api.verifyStaffReset(staffResetSchoolCode, normalizedPhone, code);
        setStaffResetChallenge(result.setupToken);
        setStaffResetSchoolId(result.schoolId);
        setStaffResetStep('password');
      } else {
        if (newPassword !== passwordConfirmation) { setError('Şifreler eşleşmiyor.'); return; }
        const result = await api.completeStaffReset(staffResetSchoolId, normalizedPhone, staffResetChallenge, newPassword);
        closeStaffReset();
        setSuccessMessage(result.message);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.'); }
    finally { setIsSubmitting(false); }
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
    if (codeFlow === 'activation' && !staffSetupToken) {
      const normalizedPhone = normalizeTurkishPhone(codePhone);
      if (!normalizedPhone) { setError('Geçerli bir Türkiye GSM numarası girin.'); return; }
      setIsSubmitting(true);
      try {
        const result = await api.verifyStaffActivation(schoolId, normalizedPhone, code);
        setStaffSetupToken(result.setupToken);
        setSuccessMessage('Kod doğrulandı. Şimdi yeni parolanızı belirleyin.');
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kod doğrulanamadı.'); }
      finally { setIsSubmitting(false); }
      return;
    }
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
        ? await api.completeStaffActivation(schoolId, normalizedPhone, staffSetupToken, newPassword)
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
              <button type="button" onClick={() => setShowResetChoices((shown) => !shown)} className="text-sm text-blue-700 font-semibold self-end">Şifremi unuttum</button>
              {showResetChoices && <div className="flex gap-2"><button type="button" className="text-sm text-blue-700 font-semibold" onClick={() => { setParentFlow('reset'); setCodePhone(phone); }}>Veli</button><button type="button" className="text-sm text-blue-700 font-semibold" onClick={() => { setStaffResetStep('request'); setCodePhone(phone); }}>Personel</button></div>}
            </div>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Giriş yapılıyor…' : 'Giriş yap'}<ArrowRight size={18} /></Button>
          </form>
          <div className="auth-divider">İlk kez mi buradasınız?</div>
          <Button variant="secondary" className="w-full" onClick={() => { setParentFlow('registration'); setCodePhone(phone); }}><Users size={18} />Hesap Oluştur</Button>
          <button type="button" onClick={() => openCodeFlow('activation')} className="mt-4 w-full text-sm font-semibold text-blue-700">Personel İlk Giriş</button>
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
          {codeFlow === 'activation' && !staffSetupToken && <label className="field" htmlFor="activation-code">6 haneli aktivasyon kodu<input id="activation-code" type="text" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" autoComplete="one-time-code" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 haneli kod" required className="font-mono" /></label>}
          {staffSetupToken && <><label className="field" htmlFor="new-password">Yeni parolanız<input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={128} required /><span className="field-hint">8–128 karakter uzunluğunda bir parola belirleyin.</span></label><label className="field" htmlFor="confirm-password">Yeni parolanız, tekrar<input id="confirm-password" type="password" autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} minLength={8} maxLength={128} required /></label></>}
          <div className="form-actions"><Button variant="secondary" disabled={isSubmitting} onClick={closeCodeFlow}>Vazgeç</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'İşleniyor…' : staffSetupToken ? 'Hesabı Aktifleştir' : 'Kodu Doğrula'}</Button></div>
        </form>
      </Dialog>}
      {parentFlow && <Dialog title={parentFlow === 'registration' ? 'Hesabınızı oluşturun' : 'Şifrenizi sıfırlayın'} description="Okul kaydını telefon numarası ve öğrencinizin doğum tarihiyle doğrulayın." onClose={closeParentFlow} dismissible={!isSubmitting}>
        <form onSubmit={submitParentFlow} className="form-stack">
          {error && <Alert tone="danger">{error}</Alert>}
          {!parentChallenge ? <>
            <label className="field">Okul Kodu<input autoComplete="off" value={parentSchoolCode} onChange={(event) => setParentSchoolCode(event.target.value)} required /></label>
            <label className="field">Telefon Numaranız<input type="tel" inputMode="tel" autoComplete="tel" value={codePhone} onChange={(event) => setCodePhone(event.target.value)} placeholder="0555 123 45 67" required /></label>
            <label className="field">Öğrencinizin Doğum Tarihi<input type="date" value={parentBirthDate} onChange={(event) => setParentBirthDate(event.target.value)} required /></label>
          </> : <>
            <label className="field">Yeni Şifreniz<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
            <label className="field">Şifre Tekrar<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></label>
          </>}
          <div className="form-actions"><Button type="button" variant="secondary" disabled={isSubmitting} onClick={closeParentFlow}>Vazgeç</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'İşleniyor…' : parentChallenge ? parentFlow === 'registration' ? 'Hesabı Oluştur' : 'Şifremi Güncelle' : 'Devam Et'}</Button></div>
        </form>
      </Dialog>}
      {staffResetStep && <Dialog title="Personel şifre sıfırlama" description="Sıfırlama kodu kayıtlı personel e-posta adresine gönderilir." onClose={closeStaffReset} dismissible={!isSubmitting}>
        <form onSubmit={submitStaffReset} className="form-stack">
          {error && <Alert tone="danger">{error}</Alert>}
          <label className="field">Okul Kodu<input value={staffResetSchoolCode} onChange={(event) => setStaffResetSchoolCode(event.target.value)} required readOnly={staffResetStep !== 'request'} /></label>
          <label className="field">Telefon Numaranız<input type="tel" inputMode="tel" autoComplete="tel" value={codePhone} onChange={(event) => setCodePhone(event.target.value)} placeholder="0555 123 45 67" required readOnly={staffResetStep !== 'request'} /></label>
          {staffResetStep === 'verify' && <label className="field">6 haneli sıfırlama kodu<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g,'').slice(0,6))} required /></label>}
          {staffResetStep === 'password' && <><label className="field">Yeni Şifreniz<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><label className="field">Şifre Tekrar<input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></label></>}
          <div className="form-actions"><Button type="button" variant="secondary" disabled={isSubmitting} onClick={closeStaffReset}>Vazgeç</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'İşleniyor…' : staffResetStep === 'request' ? 'Sıfırlama Kodu Gönder' : staffResetStep === 'verify' ? 'Kodu Doğrula' : 'Şifremi Güncelle'}</Button></div>
        </form>
      </Dialog>}
    </div>
  );
};
