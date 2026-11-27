import React, { useEffect, useState } from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import { isNativeRuntime } from '../platform/runtime-platform';
import { api } from '../services/api';
import { formatTryAmount, loadYearlyLicensePrice } from '../utils/license-price';
import { formatTurkishPhoneInput, normalizeUserPhoneInput } from '../utils/phone';
import { isBasicEmailAddress } from '../utils/platform-request-ui';
import { getDefaultPublicRequestKind, type PublicRequestKind } from '../utils/public-request-route';
import { createRequestToken } from '../utils/request-token';
import { Alert, Button } from './ui';

function requestLabels(yearlyPriceMinor: number | null): Record<PublicRequestKind, string> {
  return {
    FREE_TRIAL: '1 Haftalık Ücretsiz Deneme',
    YEARLY_LICENSE: yearlyPriceMinor === null ? 'Yıllık Lisans' : `Yıllık Lisans / ${formatTryAmount(yearlyPriceMinor)}`,
    CONTACT: 'İletişim',
  };
}

const emptyForm = { schoolName: '', contactName: '', email: '', phone: '', message: '', companyWebsite: '' };

export function PublicRequestSection({ initialRequestType = getDefaultPublicRequestKind(isNativeRuntime()), onBack, backLabel = 'Giriş ekranına dön' }: { initialRequestType?: PublicRequestKind; onBack: () => void; backLabel?: string }) {
  const [requestType, setRequestType] = useState<PublicRequestKind>(initialRequestType);
  const [form, setForm] = useState(emptyForm);
  const [requestToken, setRequestToken] = useState(createRequestToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [yearlyPriceMinor, setYearlyPriceMinor] = useState<number | null>(null);
  const labels = requestLabels(yearlyPriceMinor);
  // Ücretsiz deneme talebi yalnız web sürümünde sunulur.
  const options = Object.entries(labels).filter(([value]) => value !== 'FREE_TRIAL' || !isNativeRuntime());

  useEffect(() => {
    const controller = new AbortController();
    loadYearlyLicensePrice(controller.signal).then((value) => { if (!controller.signal.aborted) setYearlyPriceMinor(value); });
    return () => controller.abort();
  }, []);

  const reset = () => {
    setRequestType(initialRequestType);
    setForm(emptyForm);
    setRequestToken(createRequestToken());
    setError('');
    setSuccess('');
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!form.schoolName.trim()) return setError('Lütfen okul adını girin.');
    if (!form.contactName.trim()) return setError('Lütfen yetkili adını girin.');
    if (!form.email.trim()) return setError('Lütfen e-posta adresini girin.');
    if (!isBasicEmailAddress(form.email)) return setError('E-posta adresini kontrol edin.');
    if (!form.phone.trim()) return setError('Lütfen telefon numarasını girin.');
    if (!normalizeUserPhoneInput(form.phone)) return setError('Telefon numarasını 0XXX XXX XX XX biçiminde girin.');
    setBusy(true);
    try {
      const result = await api.createPublicRequest({
        requestToken,
        requestType,
        schoolName: form.schoolName,
        contactName: form.contactName,
        email: form.email,
        phone: form.phone,
        message: form.message,
        companyWebsite: form.companyWebsite,
      });
      setSuccess(result.emailNotificationSent
        ? 'Talebiniz başarıyla alındı. En kısa sürede sizinle iletişime geçeceğiz.'
        : 'Talebiniz kaydedildi ancak bildirim e-postası gönderilemedi. Ekibimiz talebinizi panelden görebilir.');
      setForm(emptyForm);
      setRequestToken(createRequestToken());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Talebiniz gönderilemedi. Lütfen tekrar deneyin.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="public-request-section" aria-label="Lisans ve iletişim talep formu">
    <form className="form-stack public-request-form" onSubmit={submit} noValidate>
      <label className="field" htmlFor="request-plan">Talep Türü *<select id="request-plan" value={requestType} disabled={busy || !!success} onChange={(event) => { setRequestType(event.target.value as PublicRequestKind); setError(''); }}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {error && <Alert tone="danger"><span role="alert">{error}</span></Alert>}
      {success && <Alert tone="success"><span role="status">{success}</span></Alert>}
      {!success && <>
        <label className="field" htmlFor="request-school">Okul Adı *<input id="request-school" maxLength={255} autoComplete="organization" value={form.schoolName} onChange={(event) => setForm({ ...form, schoolName: event.target.value })} required /></label>
        <label className="field" htmlFor="request-contact">Yetkili Ad Soyad *<input id="request-contact" maxLength={150} autoComplete="name" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} required /></label>
        <label className="field" htmlFor="request-email">E-posta *<input id="request-email" type="email" maxLength={254} autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
        <label className="field" htmlFor="request-phone">Telefon *<input id="request-phone" type="tel" inputMode="numeric" maxLength={14} autoComplete="tel" placeholder="0555 123 45 67" value={form.phone} onChange={(event) => setForm({ ...form, phone: formatTurkishPhoneInput(event.target.value) })} required /></label>
        <label className="field" htmlFor="request-message">Mesaj<textarea id="request-message" rows={4} maxLength={2000} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></label>
        <label className="request-honeypot" aria-hidden="true">Web sitesi<input tabIndex={-1} autoComplete="off" value={form.companyWebsite} onChange={(event) => setForm({ ...form, companyWebsite: event.target.value })} /></label>
        <div className="form-actions"><Button type="submit" disabled={busy}>{busy ? 'Gönderiliyor…' : <><Send size={17} />Talebi Gönder</>}</Button></div>
      </>}
      {success && <div className="form-actions"><Button variant="secondary" onClick={onBack}><ArrowLeft size={17} />{backLabel}</Button><Button onClick={reset}>Yeni talep oluştur</Button></div>}
    </form>
  </section>;
}
