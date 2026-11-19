import React, { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, MessageCircle, Phone, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { formatTurkishPhoneInput, normalizeUserPhoneInput } from '../utils/phone';
import { normalizeSchoolCodeInput } from '../utils/school-code';
import { Alert, Button } from './ui';

type Purpose = 'login' | 'parent_registration' | 'staff_activation';

const labels: Record<Purpose, { title: string; action: string }> = {
  login: { title: 'WhatsApp ile giriş', action: 'WhatsApp kodu gönder' },
  parent_registration: { title: 'Veli hesabını etkinleştir', action: 'Veli doğrulama kodu gönder' },
  staff_activation: { title: 'Personel hesabını etkinleştir', action: 'Personel doğrulama kodu gönder' },
};

export function WhatsAppAuthPanel({ initialPhone, onPhoneChange, onUsePassword }: {
  initialPhone: string;
  onPhoneChange: (phone: string) => void;
  onUsePassword: () => void;
}) {
  const { whatsappLogin } = useApp();
  const [purpose, setPurpose] = useState<Purpose>('login');
  const [phone, setPhone] = useState(initialPhone);
  const [schoolCode, setSchoolCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  const resetChallenge = () => {
    setChallengeId('');
    setCode('');
    setCountdown(0);
    setError('');
    setMessage('');
  };

  const choosePurpose = (next: Purpose) => {
    setPurpose(next);
    setSchoolCode('');
    resetChallenge();
  };

  const requestCode = async () => {
    const normalized = normalizeUserPhoneInput(phone);
    if (!normalized) throw new Error('Geçerli bir Türkiye GSM numarası girin.');
    if (purpose !== 'login' && !schoolCode) throw new Error('Okul kodunu girin.');
    const result = await api.requestWhatsappCode({ purpose, phone: normalized, schoolCode: purpose === 'login' ? undefined : schoolCode });
    setChallengeId(result.challengeId);
    setCountdown(result.resendAfterSeconds);
    setMessage(result.message);
    onPhoneChange(phone);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setPending(true);
    try {
      if (!challengeId) {
        await requestCode();
      } else {
        if (!/^\d{6}$/.test(code)) throw new Error('6 haneli doğrulama kodunu girin.');
        const result = await whatsappLogin({ challengeId, phone, code });
        if (!result.ok) throw new Error(result.reason === 'INVALID_CREDENTIALS'
          ? 'Kod geçersiz veya süresi dolmuş olabilir.'
          : 'Güvenli oturum başlatılamadı. Bağlantınızı kontrol edip tekrar deneyin.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.');
    } finally {
      setPending(false);
    }
  };

  const resend = async () => {
    setError('');
    setMessage('');
    setPending(true);
    try { await requestCode(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Kod yeniden gönderilemedi.'); }
    finally { setPending(false); }
  };

  return <div className="form-stack" aria-labelledby="whatsapp-auth-title">
    <div className="whatsapp-auth-tabs" role="tablist" aria-label="WhatsApp doğrulama türü">
      {(['login', 'parent_registration', 'staff_activation'] as Purpose[]).map((item) =>
        <button key={item} type="button" role="tab" aria-selected={purpose === item} className={purpose === item ? 'active' : ''} onClick={() => choosePurpose(item)}>
          {item === 'login' ? 'Giriş' : item === 'parent_registration' ? 'Veli ilk giriş' : 'Personel ilk giriş'}
        </button>)}
    </div>
    <div className="whatsapp-auth-heading">
      <span><MessageCircle size={20} aria-hidden="true" /></span>
      <div><h3 id="whatsapp-auth-title">{labels[purpose].title}</h3><p>Tek kullanımlık kod yalnız kayıtlı WhatsApp numaranıza gönderilir.</p></div>
    </div>
    {error && <Alert tone="danger">{error}</Alert>}
    {message && <Alert tone="success">{message}</Alert>}
    <form className="form-stack" onSubmit={submit}>
      {purpose !== 'login' && <label className="field" htmlFor="whatsapp-school-code">Okul kodu
        <input id="whatsapp-school-code" value={schoolCode} onChange={(event) => setSchoolCode(normalizeSchoolCodeInput(event.target.value))} autoComplete="off" readOnly={!!challengeId} required />
      </label>}
      <label className="field" htmlFor="whatsapp-phone">Telefon numaranız
        <div className="field-icon"><Phone size={18} aria-hidden="true" /><input id="whatsapp-phone" type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} value={phone} onChange={(event) => setPhone(formatTurkishPhoneInput(event.target.value))} placeholder="0555 123 45 67" readOnly={!!challengeId} required /></div>
      </label>
      {challengeId && <label className="field" htmlFor="whatsapp-code">6 haneli WhatsApp kodu
        <div className="field-icon"><ShieldCheck size={18} aria-hidden="true" /><input id="whatsapp-code" inputMode="numeric" autoComplete="one-time-code" enterKeyHint="go" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required /></div>
      </label>}
      <Button type="submit" disabled={pending}>{pending ? 'İşleniyor…' : challengeId ? 'Kodu doğrula ve giriş yap' : labels[purpose].action}</Button>
      {challengeId && <div className="whatsapp-auth-actions">
        <button type="button" onClick={resetChallenge}><ArrowLeft size={16} aria-hidden="true" />Telefonu değiştir</button>
        <button type="button" onClick={resend} disabled={pending || countdown > 0}>{countdown > 0 ? `Yeniden gönder (${countdown})` : 'Kodu yeniden gönder'}</button>
      </div>}
    </form>
    <button type="button" className="auth-help-link" onClick={onUsePassword}>Okul Yöneticisi / parola ile giriş</button>
  </div>;
}
