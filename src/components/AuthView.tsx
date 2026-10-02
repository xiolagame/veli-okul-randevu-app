import React, { useState } from 'react';
import { KeyRound, Lock, Phone, ShieldCheck, Eye, EyeOff, ArrowRight, BadgeHelp, Calendar, Users, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { Alert, Brand, Button, Dialog } from './ui';
import { displayStoredTurkishPhone, formatTurkishPhoneInput, normalizeUserPhoneInput } from '../utils/phone';
import { formatBirthDateInput, parseBirthDateInputToIso } from '../utils/birth-date';
import { normalizeSchoolCodeInput } from '../utils/school-code';
import { formatLicenseCodeInput } from '../utils/license-code';

interface AuthViewProps {
  onSuccess?: () => void;
  onOpenOnboarding?: () => void;
  onOpenPublicRequest: () => void;
  onOpenHelp: () => void;
}

type CodeFlow = 'activation' | 'reset' | null;
type ParentFlow = 'registration' | 'reset' | null;
type StaffResetStep = 'request' | 'verify' | 'password' | null;
type SchoolAdminStep = 'verify' | 'password' | null;
type SchoolAdminResetStep = 'request' | 'verify' | 'password' | null;

export const AuthView: React.FC<AuthViewProps> = ({ onOpenPublicRequest, onOpenHelp }) => {
  const { login } = useApp();
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
  const [resolvedStaffSchoolId, setResolvedStaffSchoolId] = useState('');
  const [showResetChoices, setShowResetChoices] = useState(false);
  const [staffResetStep, setStaffResetStep] = useState<StaffResetStep>(null);
  const [staffResetSchoolCode, setStaffResetSchoolCode] = useState('');
  const [staffResetChallenge, setStaffResetChallenge] = useState('');
  const [staffResetSchoolId, setStaffResetSchoolId] = useState('');
  const [schoolAdminActivationStep, setSchoolAdminActivationStep] = useState<SchoolAdminStep>(null);
  const [schoolAdminSchoolCode, setSchoolAdminSchoolCode] = useState('');
  const [schoolAdminLicenseCode, setSchoolAdminLicenseCode] = useState('');
  const [schoolAdminSetupToken, setSchoolAdminSetupToken] = useState('');
  const [schoolAdminSchoolId, setSchoolAdminSchoolId] = useState('');
  const [schoolAdminResetStep, setSchoolAdminResetStep] = useState<SchoolAdminResetStep>(null);
  const [schoolAdminResetSchoolCode, setSchoolAdminResetSchoolCode] = useState('');
  const [schoolAdminResetSetupToken, setSchoolAdminResetSetupToken] = useState('');
  const [schoolAdminResetSchoolId, setSchoolAdminResetSchoolId] = useState('');

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
    const normalizedPhone = normalizeUserPhoneInput(codePhone);
    if (!normalizedPhone) { setError('Geçerli bir Türkiye GSM numarası girin.'); return; }
    const birthDate = parseBirthDateInputToIso(parentBirthDate);
    if (!birthDate) { setError('Doğum tarihini GG/AA/YYYY biçiminde kontrol edin.'); return; }
    setIsSubmitting(true);
    try {
      if (!parentChallenge) {
        const result = parentFlow === 'registration'
          ? await api.parentRegistrationChallenge(parentSchoolCode, codePhone, birthDate)
          : await api.parentResetChallenge(parentSchoolCode, codePhone, birthDate);
        setParentChallenge(result.challenge);
        setParentSchoolId(result.schoolId);
        return;
      }
      if (newPassword !== passwordConfirmation) { setError('Şifreler eşleşmiyor.'); return; }
      const result = parentFlow === 'registration'
        ? await api.parentRegistrationComplete(parentSchoolId, codePhone, birthDate, parentChallenge, newPassword)
        : await api.parentResetComplete(parentSchoolId, codePhone, birthDate, parentChallenge, newPassword);
      setPhone(displayStoredTurkishPhone(normalizedPhone));
      closeParentFlow();
      setSuccessMessage(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bilgiler doğrulanamadı.');
    } finally { setIsSubmitting(false); }
  };

  const closeStaffReset = () => { setStaffResetStep(null); setStaffResetSchoolCode(''); setStaffResetChallenge(''); setStaffResetSchoolId(''); setCode(''); setNewPassword(''); setPasswordConfirmation(''); setError(''); };
  const submitStaffReset = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedPhone = normalizeUserPhoneInput(codePhone);
    if (!normalizedPhone) { setError('Geçerli bir Türkiye GSM numarası girin.'); return; }
    setError('');
    setIsSubmitting(true);
    try {
      if (staffResetStep === 'request') {
        const result = await api.requestStaffReset(staffResetSchoolCode, codePhone);
        setSuccessMessage(result.message);
        setStaffResetStep('verify');
      } else if (staffResetStep === 'verify') {
        const result = await api.verifyStaffReset(staffResetSchoolCode, codePhone, code);
        setStaffResetChallenge(result.setupToken);
        setStaffResetSchoolId(result.schoolId);
        setStaffResetStep('password');
      } else {
        if (newPassword !== passwordConfirmation) { setError('Şifreler eşleşmiyor.'); return; }
        const result = await api.completeStaffReset(staffResetSchoolId, codePhone, staffResetChallenge, newPassword);
        closeStaffReset();
        setSuccessMessage(result.message);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.'); }
    finally { setIsSubmitting(false); }
  };

  const closeSchoolAdminActivation = () => {
    setSchoolAdminActivationStep(null);
    setSchoolAdminSchoolCode('');
    setSchoolAdminLicenseCode('');
    setSchoolAdminSetupToken('');
    setSchoolAdminSchoolId('');
    setCode('');
    setNewPassword('');
    setPasswordConfirmation('');
    setError('');
  };
  const submitSchoolAdminActivation = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedPhone = normalizeUserPhoneInput(codePhone);
    if (!normalizedPhone) { setError('Geçerli bir Türkiye GSM numarası girin.'); return; }
    setError('');
    setIsSubmitting(true);
    try {
      if (schoolAdminActivationStep === 'verify') {
        const result = await api.verifySchoolAdminActivation(schoolAdminSchoolCode, codePhone, schoolAdminLicenseCode, code);
        setSchoolAdminSetupToken(result.setupToken);
        setSchoolAdminSchoolId(result.schoolId);
        setSchoolAdminActivationStep('password');
        setSuccessMessage('Kod doğrulandı. Okul Yönetimi parolanızı belirleyin.');
      } else {
        if (newPassword !== passwordConfirmation) { setError('Şifreler eşleşmiyor.'); return; }
        const result = await api.completeSchoolAdminActivation(schoolAdminSchoolId, codePhone, schoolAdminSetupToken, newPassword);
        closeSchoolAdminActivation();
        setPhone(displayStoredTurkishPhone(normalizedPhone));
        setSuccessMessage(result.message);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Bilgiler doğrulanamadı.'); }
    finally { setIsSubmitting(false); }
  };
  const closeSchoolAdminReset = () => {
    setSchoolAdminResetStep(null);
    setSchoolAdminResetSchoolCode('');
    setSchoolAdminResetSetupToken('');
    setSchoolAdminResetSchoolId('');
    setCode('');
    setNewPassword('');
    setPasswordConfirmation('');
    setError('');
  };
  const submitSchoolAdminReset = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedPhone = normalizeUserPhoneInput(codePhone);
    if (!normalizedPhone) { setError('Geçerli bir Türkiye GSM numarası girin.'); return; }
    setError('');
    setIsSubmitting(true);
    try {
      if (schoolAdminResetStep === 'request') {
        const result = await api.requestSchoolAdminReset(schoolAdminResetSchoolCode, codePhone);
        setSuccessMessage(result.message);
        setSchoolAdminResetStep('verify');
      } else if (schoolAdminResetStep === 'verify') {
        const result = await api.verifySchoolAdminReset(schoolAdminResetSchoolCode, codePhone, code);
        setSchoolAdminResetSetupToken(result.setupToken);
        setSchoolAdminResetSchoolId(result.schoolId);
        setSchoolAdminResetStep('password');
      } else {
        if (newPassword !== passwordConfirmation) { setError('Şifreler eşleşmiyor.'); return; }
        const result = await api.completeSchoolAdminReset(schoolAdminResetSchoolId, codePhone, schoolAdminResetSetupToken, newPassword);
        closeSchoolAdminReset();
        setSuccessMessage(result.message);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Bilgiler doğrulanamadı.'); }
    finally { setIsSubmitting(false); }
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');
    const normalizedPhone = normalizeUserPhoneInput(phone);
    if (!normalizedPhone) {
      setError('Geçerli bir Türkiye GSM numarası girin.');
      return;
    }
    setIsSubmitting(true);
    try {
      const success = await login(phone, password);
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
      const normalizedPhone = normalizeUserPhoneInput(codePhone);
      if (!normalizedPhone) { setError('Geçerli bir Türkiye GSM numarası girin.'); return; }
      setIsSubmitting(true);
      try {
        const result = await api.verifyStaffActivation(schoolId, codePhone, code);
        setStaffSetupToken(result.setupToken);
        setResolvedStaffSchoolId(result.schoolId);
        setSuccessMessage('Kod doğrulandı. Şimdi yeni parolanızı belirleyin.');
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kod doğrulanamadı.'); }
      finally { setIsSubmitting(false); }
      return;
    }
    if (newPassword !== passwordConfirmation) {
      setError('Şifreler eşleşmiyor.');
      return;
    }
    if (newPassword.length < 5) {
      setError('Yeni şifre en az 5 karakter olmalıdır.');
      return;
    }

    const normalizedPhone = normalizeUserPhoneInput(codePhone);
    if (!normalizedPhone) {
      setError('Geçerli bir Türkiye GSM numarası girin.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = codeFlow === 'activation'
        ? await api.completeStaffActivation(resolvedStaffSchoolId, codePhone, staffSetupToken, newPassword)
        : await api.resetPasswordWithCode(schoolId, codePhone, code, newPassword);
      setPhone(displayStoredTurkishPhone(normalizedPhone));
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
          <h1>Eğitim, okul ve aileyle güçlenir.</h1>
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
              <div className="field-icon"><Phone size={18} aria-hidden="true" /><input id="login-phone" type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} value={phone} onChange={(event) => setPhone(formatTurkishPhoneInput(event.target.value))} placeholder="0555 123 45 67" required /></div>
            </label>
            <div className="field">
              <label htmlFor="login-password">Parolanız</label>
              <div className="field-icon"><Lock size={18} aria-hidden="true" /><input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Parolanızı girin" required /><button type="button" className="icon-button" aria-label={showPassword ? 'Parolayı gizle' : 'Parolayı göster'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
              <button type="button" onClick={() => setShowResetChoices((shown) => !shown)} className="text-sm text-blue-700 font-semibold self-end">Şifremi unuttum</button>
              {showResetChoices && <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="group" aria-label="Şifre sıfırlama hesap türü"><button type="button" className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-blue-700 transition hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={() => { setParentFlow('reset'); setCodePhone(phone); }}>Veli</button><button type="button" className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-blue-700 transition hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={() => { setStaffResetStep('request'); setCodePhone(phone); }}>Personel</button><button type="button" className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-blue-700 transition hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" onClick={() => { setSchoolAdminResetStep('request'); setCodePhone(phone); }}>Okul Yöneticisi</button></div>}
            </div>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Giriş yapılıyor…' : 'Giriş yap'}<ArrowRight size={18} /></Button>
          </form>
          <div className="auth-divider">İlk kez mi buradasınız?</div>
          <Button variant="secondary" className="w-full" onClick={() => { setParentFlow('registration'); setCodePhone(phone); }}><Users size={18} />Veli Hesabı Oluştur</Button>
          <button type="button" onClick={() => openCodeFlow('activation')} className="mt-4 w-full text-sm font-semibold text-blue-700">Personel İlk Giriş</button>
          <button type="button" onClick={() => { setError(''); setSuccessMessage(''); setCode(''); setNewPassword(''); setPasswordConfirmation(''); setSchoolAdminSchoolCode(''); setSchoolAdminSetupToken(''); setSchoolAdminSchoolId(''); setCodePhone(phone); setSchoolAdminActivationStep('verify'); }} className="mt-3 w-full text-sm font-semibold text-blue-700">Okul Yöneticisi İlk Giriş</button>
          <button type="button" className="auth-help-link" onClick={onOpenHelp}>Yardım, Kullanım Rehberi ve Yasal Bilgiler<ArrowRight size={16} /></button>
          <div className="public-request-cta">
            <div className="public-request-cta-copy"><BadgeHelp size={20} aria-hidden="true" /><div><h3>Veli Randevu ile tanışın</h3><p>Yıllık lisans hakkında bilgi alın veya bize ulaşın.</p></div></div>
            <Button variant="secondary" className="w-full" onClick={onOpenPublicRequest}>Lisans / İletişim<ArrowRight size={17} /></Button>
          </div>
        </div>
      </main>
      {codeFlow && <Dialog title={codeFlow === 'activation' ? 'Birlikte başlayalım.' : 'Yeni bir parola belirleyin.'} description="Okul yönetiminizden aldığınız tek kullanımlık kodla devam edin." onClose={closeCodeFlow} dismissible={!isSubmitting}>
        <form onSubmit={handleCodeFlow} className="form-stack">
          {error && <Alert tone="danger">{error}</Alert>}
          <label className="field" htmlFor="code-school">Okulunuz
            <input id="code-school" value={schoolId} onChange={(event) => setSchoolId(normalizeSchoolCodeInput(event.target.value))} placeholder="Okul kodu" disabled={!!staffSetupToken} required />
          </label>
          <label className="field" htmlFor="code-phone">Telefon numaranız<input id="code-phone" type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} value={codePhone} onChange={(event) => setCodePhone(formatTurkishPhoneInput(event.target.value))} placeholder="0555 123 45 67" required /></label>
          {codeFlow === 'activation' && !staffSetupToken && <label className="field" htmlFor="activation-code">6 haneli aktivasyon kodu<input id="activation-code" type="text" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" autoComplete="one-time-code" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 haneli kod" required className="font-mono" /></label>}
          {staffSetupToken && <><label className="field" htmlFor="new-password">Yeni parolanız<input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={5} maxLength={128} required /><span className="field-hint">En az 5 karakter</span></label><label className="field" htmlFor="confirm-password">Yeni parolanız, tekrar<input id="confirm-password" type="password" autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} minLength={5} maxLength={128} required /></label></>}
          <div className="form-actions"><Button variant="secondary" disabled={isSubmitting} onClick={closeCodeFlow}>Vazgeç</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'İşleniyor…' : staffSetupToken ? 'Hesabı Aktifleştir' : 'Kodu Doğrula'}</Button></div>
        </form>
      </Dialog>}
      {parentFlow && <Dialog title={parentFlow === 'registration' ? 'Hesabınızı oluşturun' : 'Şifrenizi sıfırlayın'} description="Okul kaydını telefon numarası ve öğrencinizin doğum tarihiyle doğrulayın." onClose={closeParentFlow} dismissible={!isSubmitting}>
        <form onSubmit={submitParentFlow} className="form-stack">
          {error && <Alert tone="danger">{error}</Alert>}
          {!parentChallenge ? <>
            <label className="field">Okul Kodu<input autoComplete="off" value={parentSchoolCode} onChange={(event) => setParentSchoolCode(normalizeSchoolCodeInput(event.target.value))} required /></label>
            <label className="field">Telefon Numaranız<input type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} value={codePhone} onChange={(event) => setCodePhone(formatTurkishPhoneInput(event.target.value))} placeholder="0555 123 45 67" required /></label>
            <label className="field">Öğrencinizin Doğum Tarihi<input type="text" inputMode="numeric" maxLength={10} placeholder="GG/AA/YYYY" value={parentBirthDate} onChange={(event) => setParentBirthDate(formatBirthDateInput(event.target.value))} required /></label>
          </> : <>
            <label className="field">Yeni Şifreniz<input type="password" autoComplete="new-password" minLength={5} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><span className="field-hint">En az 5 karakter</span></label>
            <label className="field">Şifre Tekrar<input type="password" autoComplete="new-password" minLength={5} maxLength={128} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></label>
          </>}
          <div className="form-actions"><Button type="button" variant="secondary" disabled={isSubmitting} onClick={closeParentFlow}>Vazgeç</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'İşleniyor…' : parentChallenge ? parentFlow === 'registration' ? 'Hesabı Oluştur' : 'Şifremi Güncelle' : 'Devam Et'}</Button></div>
        </form>
      </Dialog>}
      {staffResetStep && <Dialog title="Personel şifre sıfırlama" description="Sıfırlama kodu kayıtlı personel e-posta adresine gönderilir." onClose={closeStaffReset} dismissible={!isSubmitting}>
        <form onSubmit={submitStaffReset} className="form-stack">
          {error && <Alert tone="danger">{error}</Alert>}
          <label className="field">Okul Kodu<input value={staffResetSchoolCode} onChange={(event) => setStaffResetSchoolCode(normalizeSchoolCodeInput(event.target.value))} required readOnly={staffResetStep !== 'request'} /></label>
          <label className="field">Telefon Numaranız<input type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} value={codePhone} onChange={(event) => setCodePhone(formatTurkishPhoneInput(event.target.value))} placeholder="0555 123 45 67" required readOnly={staffResetStep !== 'request'} /></label>
          {staffResetStep === 'verify' && <label className="field">6 haneli sıfırlama kodu<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g,'').slice(0,6))} required /></label>}
          {staffResetStep === 'password' && <><label className="field">Yeni Şifreniz<input type="password" autoComplete="new-password" minLength={5} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><span className="field-hint">En az 5 karakter</span></label><label className="field">Şifre Tekrar<input type="password" autoComplete="new-password" minLength={5} maxLength={128} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></label></>}
          <div className="form-actions"><Button type="button" variant="secondary" disabled={isSubmitting} onClick={closeStaffReset}>Vazgeç</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'İşleniyor…' : staffResetStep === 'request' ? 'Sıfırlama Kodu Gönder' : staffResetStep === 'verify' ? 'Kodu Doğrula' : 'Şifremi Güncelle'}</Button></div>
        </form>
      </Dialog>}
      {schoolAdminActivationStep && <Dialog title="Okul Yöneticisi İlk Giriş" description="Platform yönetiminin okulunuz için gönderdiği tek kullanımlık kodla hesabınızı etkinleştirin." onClose={closeSchoolAdminActivation} dismissible={!isSubmitting}>
        <form onSubmit={submitSchoolAdminActivation} className="form-stack">
          {error && <Alert tone="danger">{error}</Alert>}
          <label className="field" htmlFor="school-admin-activation-school">Okul Kodu<input id="school-admin-activation-school" autoComplete="off" value={schoolAdminSchoolCode} onChange={(event) => setSchoolAdminSchoolCode(normalizeSchoolCodeInput(event.target.value))} readOnly={schoolAdminActivationStep === 'password'} required /></label>
          <label className="field" htmlFor="school-admin-activation-phone">Telefon Numaranız<input id="school-admin-activation-phone" type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} placeholder="0555 123 45 67" value={codePhone} onChange={(event) => setCodePhone(formatTurkishPhoneInput(event.target.value))} readOnly={schoolAdminActivationStep === 'password'} required /></label>
          {schoolAdminActivationStep === 'verify' && <label className="field" htmlFor="school-admin-activation-license">Lisans Kodu<input id="school-admin-activation-license" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={64} placeholder="VR-7K4M-9Q2X-H8NP" value={schoolAdminLicenseCode} onChange={(event) => setSchoolAdminLicenseCode(formatLicenseCodeInput(event.target.value))} /><span className="field-hint">İlk okul yöneticisi aktivasyonunda e-postanızdaki lisans kodunu girin. Ek yöneticiler için gerekli değildir.</span></label>}
          {schoolAdminActivationStep === 'verify' ? <label className="field" htmlFor="school-admin-activation-code">6 haneli aktivasyon kodu<input id="school-admin-activation-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label> : <>
            <label className="field" htmlFor="school-admin-new-password">Yeni parolanız<input id="school-admin-new-password" type="password" autoComplete="new-password" minLength={5} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><span className="field-hint">En az 5 karakter</span></label>
            <label className="field" htmlFor="school-admin-confirm-password">Yeni parolanız, tekrar<input id="school-admin-confirm-password" type="password" autoComplete="new-password" minLength={5} maxLength={128} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></label>
          </>}
          <div className="form-actions"><Button type="button" variant="secondary" disabled={isSubmitting} onClick={closeSchoolAdminActivation}>Vazgeç</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'İşleniyor…' : schoolAdminActivationStep === 'verify' ? 'Kodu Doğrula' : 'Hesabı Etkinleştir'}</Button></div>
        </form>
      </Dialog>}
      {schoolAdminResetStep && <Dialog title="Okul Yönetimi parola sıfırlama" description="Yanıt, hesap bilgilerini açıklamaz. Kod varsa kayıtlı e-posta adresine gönderilir." onClose={closeSchoolAdminReset} dismissible={!isSubmitting}>
        <form onSubmit={submitSchoolAdminReset} className="form-stack">
          {error && <Alert tone="danger">{error}</Alert>}
          <label className="field" htmlFor="school-admin-reset-school">Okul Kodu<input id="school-admin-reset-school" autoComplete="off" value={schoolAdminResetSchoolCode} onChange={(event) => setSchoolAdminResetSchoolCode(normalizeSchoolCodeInput(event.target.value))} readOnly={schoolAdminResetStep !== 'request'} required /></label>
          <label className="field" htmlFor="school-admin-reset-phone">Telefon Numaranız<input id="school-admin-reset-phone" type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} placeholder="0555 123 45 67" value={codePhone} onChange={(event) => setCodePhone(formatTurkishPhoneInput(event.target.value))} readOnly={schoolAdminResetStep !== 'request'} required /></label>
          {schoolAdminResetStep === 'verify' && <label className="field" htmlFor="school-admin-reset-code">6 haneli sıfırlama kodu<input id="school-admin-reset-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>}
          {schoolAdminResetStep === 'password' && <><label className="field" htmlFor="school-admin-reset-password">Yeni parolanız<input id="school-admin-reset-password" type="password" autoComplete="new-password" minLength={5} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><span className="field-hint">En az 5 karakter</span></label><label className="field" htmlFor="school-admin-reset-confirm">Yeni parolanız, tekrar<input id="school-admin-reset-confirm" type="password" autoComplete="new-password" minLength={5} maxLength={128} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></label></>}
          <div className="form-actions"><Button type="button" variant="secondary" disabled={isSubmitting} onClick={closeSchoolAdminReset}>Vazgeç</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'İşleniyor…' : schoolAdminResetStep === 'request' ? 'Sıfırlama Kodu Gönder' : schoolAdminResetStep === 'verify' ? 'Kodu Doğrula' : 'Parolayı Güncelle'}</Button></div>
        </form>
      </Dialog>}
    </div>
  );
};
