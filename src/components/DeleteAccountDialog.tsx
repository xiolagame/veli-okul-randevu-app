import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Eye, EyeOff, MessageCircle, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import { useApp } from '../context/AppContext';
import { Alert, Button, Dialog, StepIndicator } from './ui';

const CONFIRMATION_PHRASE = 'HESABIMI SİL';

export function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { currentUser, deleteAccount } = useApp();
  const [step, setStep] = useState<0 | 1>(0);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [whatsappChallengeId, setWhatsappChallengeId] = useState('');
  const [whatsappCode, setWhatsappCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const passwordInput = useRef<HTMLInputElement>(null);
  const requiresPassword = currentUser?.deletionVerification !== 'whatsapp';

  useEffect(() => {
    if (step === 1) passwordInput.current?.focus();
  }, [step]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (confirmation.trim() !== CONFIRMATION_PHRASE) {
      setError(`Devam etmek için “${CONFIRMATION_PHRASE}” yazın.`);
      return;
    }
    setError('');
    setPending(true);
    try {
      await deleteAccount({
        ...(requiresPassword ? { password } : { whatsappChallengeId, whatsappCode }),
        confirmation: CONFIRMATION_PHRASE,
        requestId: requestId.current,
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Hesabınız silinemedi. Oturumunuz açık bırakıldı.');
      setPending(false);
    }
  };

  return <Dialog
    title="Hesabımı sil"
    description="Hesabınızı ve kişisel giriş bilgilerinizi kalıcı olarak silin."
    onClose={onClose}
    dismissible={!pending}
    className="account-deletion-dialog"
  >
    <StepIndicator active={step} labels={['Bilgilendirme', 'Kimlik doğrulama']} />
    {step === 0 ? <div className="account-deletion-content">
      <Alert tone="warning"><strong>Bu işlem geri alınamaz.</strong><p className="mt-1">Silme tamamlandığında bu hesapla yeniden giriş yapamazsınız.</p></Alert>
      <section aria-labelledby="deletion-removes-title">
        <h3 id="deletion-removes-title"><Trash2 size={18} aria-hidden="true" />Kalıcı olarak silinecekler</h3>
        <ul className="account-deletion-list">
          <li><Check size={16} aria-hidden="true" />Ad, telefon, e-posta ve parola özeti</li>
          <li><Check size={16} aria-hidden="true" />Okul üyelikleriniz ve veli-öğrenci bağlantılarınız</li>
          <li><Check size={16} aria-hidden="true" />Push cihaz kayıtları, tokenlar ve aktif oturumlar</li>
          <li><Check size={16} aria-hidden="true" />Kişisel destek içeriği ve randevu notları</li>
        </ul>
      </section>
      <section aria-labelledby="deletion-keeps-title">
        <h3 id="deletion-keeps-title"><ShieldCheck size={18} aria-hidden="true" />Anonim olarak korunabilecekler</h3>
        <p>Okulun öğrenci kaydı ile zorunlu randevu, işlem ve güvenlik kayıtları silinmez. Bu kayıtlardaki adınız ve iletişim bilgileriniz kaldırılır; “Silinmiş Kullanıcı” olarak gösterilirsiniz.</p>
      </section>
      <p className="account-deletion-note"><AlertTriangle size={17} aria-hidden="true" />İşlem sunucu tarafından tamamlandıktan sonra bu cihazdaki güvenli oturum da temizlenir. Kayıtlı e-postanız varsa tamamlanma bildirimi gönderilmeye çalışılır.</p>
      <div className="form-actions"><Button variant="secondary" onClick={onClose}>Vazgeç</Button><Button variant="danger" onClick={() => setStep(1)}>Devam et</Button></div>
    </div> : <form className="form-stack account-deletion-form" onSubmit={submit}>
      {error && <Alert tone="danger">{error}</Alert>}
      <Alert><strong>Son güvenlik kontrolü</strong><p className="mt-1">İstek başarısız olursa hesabınızda değişiklik yapılmaz ve oturumunuz açık kalır.</p></Alert>
      {requiresPassword ? <div className="field">
        <label htmlFor="delete-account-password">Mevcut parolanız</label>
        <div className="field-icon"><ShieldCheck size={18} aria-hidden="true" /><input ref={passwordInput} id="delete-account-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={128} /><button type="button" className="icon-button" aria-label={showPassword ? 'Parolayı gizle' : 'Parolayı göster'} aria-pressed={showPassword} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
      </div> : <div className="form-stack">
        {!whatsappChallengeId ? <Button type="button" variant="secondary" disabled={pending} onClick={async () => {
          setError(''); setPending(true);
          try { const result = await api.requestAccountDeletionWhatsappCode(); setWhatsappChallengeId(result.challengeId); }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Doğrulama kodu gönderilemedi.'); }
          finally { setPending(false); }
        }}><MessageCircle size={18} aria-hidden="true" />WhatsApp doğrulama kodu gönder</Button> : <label className="field" htmlFor="delete-account-whatsapp-code">6 haneli WhatsApp kodu<input id="delete-account-whatsapp-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={whatsappCode} onChange={(event) => setWhatsappCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>}
      </div>}
      <label className="field" htmlFor="delete-account-confirmation">Onaylamak için <strong>{CONFIRMATION_PHRASE}</strong> yazın<input id="delete-account-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value.toLocaleUpperCase('tr-TR'))} autoComplete="off" spellCheck={false} required aria-describedby="delete-account-confirmation-hint" /></label>
      <p id="delete-account-confirmation-hint" className="field-hint">Silme işlemi sunucuda tek transaction içinde tamamlanır; tamamlanmadan oturumunuz kapatılmaz.</p>
      <div className="form-actions"><Button variant="secondary" disabled={pending} onClick={() => { setError(''); setStep(0); }}>Geri</Button><Button type="submit" variant="danger" disabled={pending || (requiresPassword ? !password : !whatsappChallengeId || whatsappCode.length !== 6) || confirmation.trim() !== CONFIRMATION_PHRASE}>{pending ? 'Hesap siliniyor…' : 'Hesabımı kalıcı olarak sil'}</Button></div>
    </form>}
  </Dialog>;
}
