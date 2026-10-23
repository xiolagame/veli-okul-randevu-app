import React, { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, MessageCircle, Phone, ShieldCheck, Mail } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { formatTurkishPhoneInput, normalizeUserPhoneInput } from '../utils/phone';
import { Alert, Button } from './ui';

/** One input for all non-platform roles. Target resolution is exclusively server-side. */
export function UnifiedWhatsAppLoginPanel({initialPhone,onPhoneChange,onUsePassword}: {
  initialPhone:string; onPhoneChange:(phone:string)=>void; onUsePassword:()=>void;
}) {
  const { whatsappLogin,completeUnifiedAdminEmail }=useApp();
  const [phone,setPhone]=useState(initialPhone);
  const [challengeId,setChallengeId]=useState('');
  const [adminEmailHandle,setAdminEmailHandle]=useState('');
  const [code,setCode]=useState('');
  const [emailCode,setEmailCode]=useState('');
  const [cooldown,setCooldown]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  useEffect(()=>{
    if(cooldown<=0)return;
    const timer=window.setInterval(()=>setCooldown(v=>Math.max(0,v-1)),1000);
    return ()=>window.clearInterval(timer);
  },[cooldown]);
  const clear=()=>{setChallengeId('');setAdminEmailHandle('');setCode('');setEmailCode('');setCooldown(0);setError('');setMessage('');};
  const request=async()=>{
    const normalized=normalizeUserPhoneInput(phone);
    if(!normalized)throw new Error('Geçerli bir Türkiye GSM numarası girin.');
    const response=await api.requestWhatsappCode({purpose:'auto',phone:normalized});
    setChallengeId(response.challengeId);setCooldown(response.resendAfterSeconds);setMessage(response.message);
    onPhoneChange(phone);
  };
  const submit=async(event:FormEvent)=>{
    event.preventDefault();setError('');setMessage('');setBusy(true);
    try {
      if(adminEmailHandle){
        if(!/^\d{6}$/.test(emailCode))throw new Error('E-postadaki 6 haneli kodu girin.');
        const result=await completeUnifiedAdminEmail({handle:adminEmailHandle,phone,emailCode});
        if(!result.ok)throw new Error('E-posta kodu doğrulanamadı veya süresi doldu.');
      } else if(!challengeId){await request();}
      else {
        if(!/^\d{6}$/.test(code))throw new Error('6 haneli WhatsApp kodunu girin.');
        const verified=await api.verifyWhatsappCode({challengeId,phone,code});
        if(verified.pendingEmail && verified.handle){
          setAdminEmailHandle(verified.handle);setEmailCode('');setMessage(verified.message || 'Kayıtlı e-posta adresinizdeki kodu girin.');
        } else if(verified.token && verified.user && verified.memberships){
          const result=await whatsappLogin({challengeId,phone,code},{token:verified.token,user:verified.user,memberships:verified.memberships});
          if(!result.ok)throw new Error('Oturum başlatılamadı. Tekrar deneyin.');
        } else throw new Error('Doğrulama tamamlanamadı.');
      }
    }catch(cause){setError(cause instanceof Error?cause.message:'İşlem tamamlanamadı.');}
    finally{setBusy(false);}
  };
  const resend=async()=>{
    setBusy(true);setError('');setMessage('');
    try{await request();setCode('');}
    catch(cause){setError(cause instanceof Error?cause.message:'Kod yeniden gönderilemedi.');}
    finally{setBusy(false);}
  };
  return <div className="form-stack" aria-labelledby="unified-whatsapp-heading">
    <div className="whatsapp-auth-heading">
      <span><MessageCircle size={20} aria-hidden="true" /></span>
      <div><h3 id="unified-whatsapp-heading">WhatsApp ile güvenli giriş</h3></div>
    </div>
    {error && <Alert tone="danger">{error}</Alert>}
    {message && <Alert tone="success">{message}</Alert>}
    <form onSubmit={submit} className="form-stack">
      <label className="field" htmlFor="unified-phone">Telefon numaranız
        <div className="field-icon"><Phone size={18} aria-hidden="true" />
          <input id="unified-phone" type="tel" inputMode="numeric" autoComplete="tel" maxLength={14}
            value={phone} onChange={event=>setPhone(formatTurkishPhoneInput(event.target.value))}
            placeholder="0555 123 45 67" readOnly={!!challengeId} required />
        </div>
      </label>
      {challengeId && !adminEmailHandle && <label className="field" htmlFor="unified-code">WhatsApp doğrulama kodu
        <div className="field-icon"><ShieldCheck size={18} aria-hidden="true" />
          <input id="unified-code" type="text" inputMode="numeric" autoComplete="one-time-code" enterKeyHint="go"
            maxLength={6} pattern="[0-9]{6}" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))}
            placeholder="6 haneli kod" required />
        </div>
      </label>}
      {adminEmailHandle && <label className="field" htmlFor="unified-email-code">E-postanıza gönderilen doğrulama kodu
        <div className="field-icon"><Mail size={18} aria-hidden="true" />
          <input id="unified-email-code" inputMode="numeric" type="text" maxLength={6} autoComplete="one-time-code"
            pattern="[0-9]{6}" value={emailCode} onChange={e=>setEmailCode(e.target.value.replace(/\D/g,'').slice(0,6))}
            placeholder="6 haneli e-posta kodu" required />
        </div>
      </label>}
      <Button type="submit" disabled={busy}>{busy?'İşleniyor…':adminEmailHandle?'E-posta kodunu doğrula ve giriş yap':challengeId?'Kodu doğrula ve giriş yap':'WhatsApp kodu gönder'}</Button>
      {challengeId && <div className="whatsapp-auth-actions">
        <button type="button" onClick={clear} disabled={busy}><ArrowLeft size={16} aria-hidden="true" />Telefonu değiştir</button>
        {!adminEmailHandle && <button type="button" onClick={resend} disabled={busy || cooldown>0}>
          {cooldown>0?`Yeniden gönder (${cooldown})`:'Kodu yeniden gönder'}
        </button>}
      </div>}
    </form>
    <button type="button" className="auth-help-link" onClick={onUsePassword}>Platform Yönetimi</button>
  </div>;
}
