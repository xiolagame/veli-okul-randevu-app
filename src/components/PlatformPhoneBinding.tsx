import React, { FormEvent, useEffect, useState } from 'react';
import { KeyRound, Mail, MessageCircle, Phone, ShieldCheck } from 'lucide-react';
import { api } from '../services/api';
import { authSession } from '../platform/auth-session';
import { formatTurkishPhoneInput, isValidTurkishPhoneInput } from '../utils/phone';
import { Alert, Button, Skeleton } from './ui';

type BindingStep = 'PHONE' | 'EMAIL' | 'WHATSAPP';
type EmailSetupStep = 'DETAILS' | 'CODE';

export function PlatformPhoneBinding() {
  const [status, setStatus] = useState<{ whatsappPhoneBound: boolean; emailConfigured: boolean; passwordReauthAvailable: boolean } | null>(null);
  const [step, setStep] = useState<BindingStep>('PHONE');
  const [emailSetupStep, setEmailSetupStep] = useState<EmailSetupStep>('DETAILS');
  const [newEmail, setNewEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [emailBindingId, setEmailBindingId] = useState('');
  const [initialEmailCode, setInitialEmailCode] = useState('');
  const [phone, setPhone] = useState('');
  const [bindingId, setBindingId] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [whatsappCode, setWhatsappCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api.getPlatformPhoneBindingStatus()
      .then((result) => { if (!cancelled) setStatus(result); })
      .catch(() => { if (!cancelled) setError('Platform telefon durumu alınamadı.'); });
    return () => { cancelled = true; };
  }, []);

  const submitEmailSetup = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (emailSetupStep === 'DETAILS') {
        const result = await api.startPlatformEmailBinding(newEmail, currentPassword);
        setCurrentPassword('');
        setEmailBindingId(result.bindingId);
        setMessage(result.message);
        setEmailSetupStep('CODE');
      } else {
        if (!/^\d{6}$/.test(initialEmailCode)) throw new Error('E-postadaki 6 haneli kodu girin.');
        const result = await api.completePlatformEmailBinding(emailBindingId, initialEmailCode);
        setMessage(result.message);
        await authSession.clearTokenAfterRemoteInvalidation();
        window.location.assign('/');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'E-posta tanımlama işlemi tamamlanamadı.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (step === 'PHONE') {
        if (!isValidTurkishPhoneInput(phone)) throw new Error('Geçerli bir Türkiye GSM numarası girin.');
        const result = await api.startPlatformPhoneBinding(phone);
        setBindingId(result.bindingId);
        setMessage(result.message);
        setStep('EMAIL');
      } else if (step === 'EMAIL') {
        if (!/^\d{6}$/.test(emailCode)) throw new Error('E-postadaki 6 haneli kodu girin.');
        const result = await api.verifyPlatformPhoneBindingEmail(bindingId, emailCode);
        setMessage(result.message);
        setStep('WHATSAPP');
      } else {
        if (!/^\d{6}$/.test(whatsappCode)) throw new Error('WhatsApp üzerinden gelen 6 haneli kodu girin.');
        const result = await api.completePlatformPhoneBinding(bindingId, whatsappCode);
        setMessage(result.message);
        await authSession.clearTokenAfterRemoteInvalidation();
        window.location.assign('/');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Telefon bağlama işlemi tamamlanamadı.');
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <section className="surface"><Skeleton rows={3} /></section>;

  return <section className="surface" aria-labelledby="platform-phone-binding-heading">
    <div className="section-heading">
      <div>
        <h3 id="platform-phone-binding-heading">Platform WhatsApp telefonu</h3>
        <p>Telefon değişmeden önce kayıtlı e-posta ve yeni WhatsApp numarası ayrı kodlarla doğrulanır.</p>
      </div>
      <span className={`status-badge tone-${status.whatsappPhoneBound ? 'success' : 'warning'}`}>
        {status.whatsappPhoneBound ? 'WhatsApp telefonu bağlı' : 'WhatsApp telefonu bağlanmalı'}
      </span>
    </div>
    <Alert tone="info"><ShieldCheck size={18} aria-hidden="true" /> İşlem tamamlandığında mevcut oturum güvenlik amacıyla kapatılır. Yeni telefon kaynak koduna veya işlem günlüğüne açık olarak yazılmaz.</Alert>
    {error && <Alert tone="danger">{error}</Alert>}
    {message && <Alert tone="success">{message}</Alert>}
    {!status.emailConfigured ? <form className="form-stack mt-4" onSubmit={submitEmailSetup}>
      <Alert tone="warning">Telefon bağlamadan önce Platform hesabınıza doğrulanmış bir e-posta tanımlayın.</Alert>
      {!status.passwordReauthAvailable && <Alert tone="danger">Bu hesapta yeniden kimlik doğrulama için mevcut parola bulunmuyor. Güvenli operasyonel kurtarma tamamlanmadan e-posta tanımlanamaz.</Alert>}
      {emailSetupStep === 'DETAILS' && <>
        <label className="field" htmlFor="platform-binding-new-email">Yeni e-posta adresi
          <div className="field-icon"><Mail size={18} aria-hidden="true" /><input id="platform-binding-new-email" type="email" autoComplete="email" maxLength={150} value={newEmail} disabled={busy || !status.passwordReauthAvailable} onChange={(event) => setNewEmail(event.target.value)} required /></div>
        </label>
        <label className="field" htmlFor="platform-binding-current-password">Mevcut Platform parolası
          <div className="field-icon"><KeyRound size={18} aria-hidden="true" /><input id="platform-binding-current-password" type="password" autoComplete="current-password" maxLength={128} value={currentPassword} disabled={busy || !status.passwordReauthAvailable} onChange={(event) => setCurrentPassword(event.target.value)} required /></div>
        </label>
      </>}
      {emailSetupStep === 'CODE' && <label className="field" htmlFor="platform-binding-initial-email-code">Yeni e-postaya gelen kod
        <div className="field-icon"><Mail size={18} aria-hidden="true" /><input id="platform-binding-initial-email-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={initialEmailCode} disabled={busy} onChange={(event) => setInitialEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 haneli kod" required /></div>
      </label>}
      <Button type="submit" disabled={busy || !status.passwordReauthAvailable}>
        {busy ? 'Doğrulanıyor…' : emailSetupStep === 'DETAILS' ? 'E-posta doğrulama kodu gönder' : 'E-postayı doğrula ve bağla'}
      </Button>
    </form> : <form className="form-stack mt-4" onSubmit={submit}>
      {step === 'PHONE' && <label className="field" htmlFor="platform-binding-phone">Bağlanacak WhatsApp telefonu
        <div className="field-icon"><Phone size={18} aria-hidden="true" /><input id="platform-binding-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={14} placeholder="0555 123 45 67" value={phone} disabled={busy || !status.emailConfigured} onChange={(event) => setPhone(formatTurkishPhoneInput(event.target.value))} required /></div>
      </label>}
      {step === 'EMAIL' && <label className="field" htmlFor="platform-binding-email-code">Kayıtlı e-postaya gelen kod
        <div className="field-icon"><Mail size={18} aria-hidden="true" /><input id="platform-binding-email-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={emailCode} disabled={busy} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 haneli kod" required /></div>
      </label>}
      {step === 'WHATSAPP' && <label className="field" htmlFor="platform-binding-whatsapp-code">Yeni telefona gelen WhatsApp kodu
        <div className="field-icon"><MessageCircle size={18} aria-hidden="true" /><input id="platform-binding-whatsapp-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={whatsappCode} disabled={busy} onChange={(event) => setWhatsappCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 haneli kod" required /></div>
      </label>}
      <Button type="submit" disabled={busy || !status.emailConfigured}>
        {busy ? 'Doğrulanıyor…' : step === 'PHONE' ? <><KeyRound size={18} />E-posta doğrulamasını başlat</> : step === 'EMAIL' ? 'E-postayı doğrula' : 'Telefonu doğrula ve bağla'}
      </Button>
    </form>}
  </section>;
}
