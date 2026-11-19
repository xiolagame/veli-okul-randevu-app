import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Mail, Phone, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { formatTurkishPhoneInput, normalizeUserPhoneInput } from '../utils/phone';
import { normalizeSchoolCodeInput } from '../utils/school-code';
import { Alert, Button } from './ui';
import { getRuntimePlatform } from '../platform/runtime-platform';
import { appLifecycle } from '../platform/lifecycle';
import { remainingResendSeconds } from '../platform/otp-resend-clock';

type Step = 'PHONE' | 'WHATSAPP_CODE' | 'EMAIL_CODE';

export function PhoneCentricLoginPanel({ onLegacyFallback, allowLegacyFallback = true }: {
  onLegacyFallback: (phone: string) => void;
  allowLegacyFallback?: boolean;
}) {
  const { whatsappLogin } = useApp();
  const [step, setStep] = useState<Step>('PHONE');
  const [phone, setPhone] = useState('');
  const [attemptId, setAttemptId] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [schoolCode, setSchoolCode] = useState('');
  const [requiresSchoolCode, setRequiresSchoolCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (getRuntimePlatform() === 'IOS') return;
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (getRuntimePlatform() !== 'IOS' || !resendAvailableAt) return;
    const update = () => setCooldown(remainingResendSeconds(resendAvailableAt));
    update();
    const timer = window.setInterval(update, 1000);
    const unsubscribe = appLifecycle.subscribe(state => { if (state === 'ACTIVE') update(); });
    document.addEventListener('visibilitychange', update);
    window.addEventListener('pageshow', update);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('pageshow', update);
    };
  }, [resendAvailableAt]);

  const reset = () => {
    setStep('PHONE');
    setAttemptId('');
    setChallengeId('');
    setCode('');
    setEmailCode('');
    setSchoolCode('');
    setRequiresSchoolCode(false);
    setCooldown(0);
    setResendAvailableAt(0);
    setError('');
    setMessage('');
  };

  const requestCode = async () => {
    const canonicalPhone = normalizeUserPhoneInput(phone);
    if (!canonicalPhone) throw new Error('Geçerli bir Türkiye GSM numarası girin.');
    const response = await api.requestPhoneCentricCode(canonicalPhone);
    if (response.legacyFallbackRequired) {
      if (!allowLegacyFallback) throw new Error('WhatsApp girişi bu telefon için şu anda kullanılamıyor. Doğrulama kodu gönderilmedi. Erişim ayarlarını kontrol etmesi için okul yönetiminizle iletişime geçin.');
      onLegacyFallback(canonicalPhone);
      return;
    }
    setAttemptId(response.attemptId);
    setChallengeId(response.challengeId);
    setCooldown(response.resendAfterSeconds);
    if (getRuntimePlatform() === 'IOS') setResendAvailableAt(Date.now() + response.resendAfterSeconds * 1000);
    setMessage('Lütfen telefonunuza gelen WhatsApp onay kodunu girin.');
    setStep('WHATSAPP_CODE');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (step === 'PHONE') {
        await requestCode();
      } else if (step === 'WHATSAPP_CODE') {
        if (!/^\d{6}$/.test(code)) throw new Error('6 haneli WhatsApp kodunu girin.');
        const verified = await api.verifyPhoneCentricCode({
          attemptId,
          challengeId,
          phone,
          code,
        });
        if (verified.pendingEmail) {
          setRequiresSchoolCode(!!verified.requiresSchoolCode);
          setMessage(verified.message || 'Kayıtlı e-posta adresinize gönderilen kodu girin.');
          setStep('EMAIL_CODE');
        } else if (verified.token && verified.user && verified.memberships) {
          const result = await whatsappLogin(
            { challengeId, phone, code },
            { token: verified.token, user: verified.user, memberships: verified.memberships },
          );
          if (!result.ok) throw new Error('Oturum başlatılamadı. Lütfen tekrar deneyin.');
        } else {
          throw new Error('Doğrulama tamamlanamadı.');
        }
      } else {
        if (!/^\d{6}$/.test(emailCode)) throw new Error('E-postadaki 6 haneli kodu girin.');
        if (requiresSchoolCode && !schoolCode.trim()) throw new Error('E-postadaki okul kodunu girin.');
        const verified = await api.verifyPhoneCentricEmail({ attemptId, phone, emailCode, schoolCode });
        const result = await whatsappLogin(
          { challengeId, phone, code },
          { token: verified.token, user: verified.user, memberships: verified.memberships },
        );
        if (!result.ok) throw new Error('Oturum başlatılamadı. Lütfen tekrar deneyin.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const resend = async () => {
    if (pending.current || cooldown > 0) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await requestCode();
      setCode('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kod yeniden gönderilemedi.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return <div className="form-stack phone-centric-login" aria-labelledby="auth-heading" aria-describedby="phone-centric-description">
    <div className="whatsapp-auth-heading">
      <span className="whatsapp-login-logo"><img src="/whatsapp-login-icon.png" alt="" aria-hidden="true" /></span>
      <p id="phone-centric-description">Doğrulama kodunuz WhatsApp üzerinden gönderilecektir.</p>
    </div>
    {error && <Alert tone="danger">{error}</Alert>}
    {message && <Alert tone={step === 'WHATSAPP_CODE' ? 'info' : 'success'}>{message}</Alert>}
    <form onSubmit={submit} className="form-stack">
      <label className="field" htmlFor="phone-centric-phone">Telefon numaranız
        <div className="field-icon"><Phone size={18} aria-hidden="true" />
          <input id="phone-centric-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={14}
            value={phone} onChange={(event) => setPhone(formatTurkishPhoneInput(event.target.value))}
            placeholder="0555 123 45 67" readOnly={busy || step !== 'PHONE'} required />
        </div>
      </label>
      {step === 'WHATSAPP_CODE' && <label className="field" htmlFor="phone-centric-code">WhatsApp doğrulama kodu
        <div className="field-icon"><ShieldCheck size={18} aria-hidden="true" />
          <input id="phone-centric-code" type="text" inputMode="numeric" autoComplete="one-time-code" enterKeyHint="go"
            maxLength={6} pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6 haneli kod" required />
        </div>
      </label>}
      {step === 'EMAIL_CODE' && <>
        <label className="field" htmlFor="phone-centric-email-code">E-posta doğrulama kodu
          <div className="field-icon"><Mail size={18} aria-hidden="true" />
            <input id="phone-centric-email-code" type="text" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} pattern="[0-9]{6}" value={emailCode}
              onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6 haneli kod" required />
          </div>
        </label>
        {requiresSchoolCode && <label className="field" htmlFor="phone-centric-school-code">Okul kodu
          <input id="phone-centric-school-code" autoComplete="off" value={schoolCode}
            onChange={(event) => setSchoolCode(normalizeSchoolCodeInput(event.target.value))} required />
        </label>}
      </>}
      <Button type="submit" disabled={busy}>{busy ? 'İşleniyor…' : step === 'PHONE' ? 'WhatsApp Kodu Gönder' : step === 'WHATSAPP_CODE' ? 'Kodu Doğrula' : 'Aktivasyonu Tamamla'}</Button>
      {step !== 'PHONE' && <div className="whatsapp-auth-actions">
        <button type="button" onClick={reset} disabled={busy}><ArrowLeft size={16} aria-hidden="true" />Telefonu değiştir</button>
        {step === 'WHATSAPP_CODE' && <button type="button" onClick={resend} disabled={busy || cooldown > 0}>
          {cooldown > 0 ? `Yeniden gönder (${cooldown})` : 'Kodu yeniden gönder'}
        </button>}
      </div>}
    </form>
  </div>;
}
