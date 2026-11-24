import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, ArrowRight, BadgeHelp, Calendar, Users, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { Alert, Brand, Button } from './ui';
import { getRuntimePlatform } from '../platform/runtime-platform';
import { setAndroidLoginSurface } from '../platform/android-system-bars';
import { PhoneCentricLoginPanel } from './PhoneCentricLoginPanel';
import {ReviewLogin} from './ReviewLogin';
import { resolveLoginEntry } from '../platform/login-capability-policy';

interface AuthViewProps {
  onSuccess?: () => void;
  onOpenOnboarding?: () => void;
  onOpenPublicRequest: () => void;
  onOpenHelp: () => void;
}

// Giriş yalnız telefon numarası + WhatsApp koduyla yapılır; başka bilgi istenmez.
export const AuthView: React.FC<AuthViewProps> = ({ onOpenPublicRequest, onOpenHelp }) => {
  const { authStorageError, accountDeletionNotice } = useApp();
  const [whatsappAuthEnabled, setWhatsappAuthEnabled] = useState(false);
  const [phoneCentricAuthEnabled, setPhoneCentricAuthEnabled] = useState(false);
  const [capabilitiesStatus, setCapabilitiesStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [capabilitiesRetry, setCapabilitiesRetry] = useState(0);
  const authSideRef = useRef<HTMLElement>(null);
  const [loginStep, setLoginStep] = useState<'PHONE' | 'WHATSAPP_CODE' | 'EMAIL_CODE'>('PHONE');
  const loginEntry = resolveLoginEntry(capabilitiesStatus, phoneCentricAuthEnabled);
  // iOS may collect the phone while capabilities load; sending remains gated.
  const usePhoneCentricLogin = loginEntry === 'phone' || (getRuntimePlatform() === 'IOS' && (capabilitiesStatus === 'loading' || capabilitiesStatus === 'error'));

  useEffect(() => {
    if (getRuntimePlatform() !== 'ANDROID') return;
    setAndroidLoginSurface(true);
    return () => setAndroidLoginSurface(false);
  }, []);

  useEffect(() => {
    let active = true;
    let completed = false;
    const controller = getRuntimePlatform() === 'IOS' ? new AbortController() : undefined;
    const timeout = controller ? window.setTimeout(() => {
      if (!active || completed) return;
      completed = true;
      setCapabilitiesStatus('error');
      controller.abort();
    }, 8000) : undefined;
    setCapabilitiesStatus('loading');
    api.getAuthCapabilities(controller?.signal).then((result) => {
      if (!active || completed) return;
      if (getRuntimePlatform() !== 'WEB' && (
        typeof result?.whatsappAuthEnabled !== 'boolean' ||
        (result.phoneCentricAuthEnabled !== undefined && typeof result.phoneCentricAuthEnabled !== 'boolean')
      )) throw new Error('Invalid authentication capabilities');
      if (active) {
        completed = true;
        window.clearTimeout(timeout);
        setWhatsappAuthEnabled(result.whatsappAuthEnabled);
        setPhoneCentricAuthEnabled(!!result.phoneCentricAuthEnabled && (getRuntimePlatform() !== 'IOS' || result.whatsappAuthEnabled));
        setCapabilitiesStatus('ready');
      }
    }).catch(() => { if (active && !completed) { completed = true; window.clearTimeout(timeout); setCapabilitiesStatus('error'); } });
    return () => { active = false; window.clearTimeout(timeout); controller?.abort(); };
  }, [capabilitiesRetry]);

  useEffect(() => {
    if (getRuntimePlatform() !== 'IOS') return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    let focusTimer: number | undefined;
    const updateViewport = () => {
      const inset = Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height);
      authSideRef.current?.style.setProperty('--auth-keyboard-inset', `${inset}px`);
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement) || !authSideRef.current?.contains(focused) || !focused.matches('input, select, textarea, button')) return;
      const bottom = focused.getBoundingClientRect().bottom;
      const visibleBottom = viewport.offsetTop + viewport.height;
      if (bottom > visibleBottom - 20) window.scrollBy(0, bottom - visibleBottom + 20);
    };
    const onFocus = () => {
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(updateViewport, 280);
    };
    viewport.addEventListener('resize', updateViewport);
    viewport.addEventListener('scroll', updateViewport);
    const authSide = authSideRef.current;
    authSide?.addEventListener('focusin', onFocus);
    updateViewport();
    return () => {
      window.clearTimeout(focusTimer);
      viewport.removeEventListener('resize', updateViewport);
      viewport.removeEventListener('scroll', updateViewport);
      authSide?.removeEventListener('focusin', onFocus);
    };
  }, []);

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
      <main className={`auth-form-side${getRuntimePlatform() === 'IOS' ? ' auth-form-side-ios' : ''}${usePhoneCentricLogin ? ' auth-form-side-phone' : ''}`} ref={authSideRef}>
        <div className={`auth-form-wrap${usePhoneCentricLogin ? ' auth-form-wrap-phone' : ''}${loginStep !== 'PHONE' ? ' auth-form-wrap-code' : ''}`}>
          <div className="auth-mobile-brand"><Brand /></div>
          <span className="eyebrow">VELİ RANDEVU'YA HOŞ GELDİNİZ</span>
          <h2 id="auth-heading">Okulunuza Hoş Geldiniz</h2>
          {accountDeletionNotice && <div className="mb-5"><Alert tone="success">{accountDeletionNotice}</Alert></div>}
          {!accountDeletionNotice && authStorageError && <div className="mb-5"><Alert tone="danger">Güvenli oturuma erişilemiyor. Lütfen tekrar deneyin.</Alert></div>}
          {getRuntimePlatform() === 'IOS' && capabilitiesStatus === 'error' && <Alert tone="danger">Giriş seçenekleri alınamadı. Bağlantınızı kontrol edip tekrar deneyin. <button type="button" onClick={() => setCapabilitiesRetry((value) => value + 1)}>Tekrar dene</button></Alert>}
          {!usePhoneCentricLogin && (loginEntry === 'loading' || loginEntry === 'error') ? (loginEntry === 'loading'
            ? <p role="status">Giriş seçenekleri yükleniyor…</p>
            : <Alert tone="danger">Giriş seçenekleri alınamadı. <button type="button" onClick={() => setCapabilitiesRetry((value) => value + 1)}>Tekrar dene</button></Alert>)
            : usePhoneCentricLogin
              ? <PhoneCentricLoginPanel onStepChange={setLoginStep} requestEnabled={getRuntimePlatform() !== 'IOS' || (capabilitiesStatus === 'ready' && whatsappAuthEnabled && phoneCentricAuthEnabled)} checkingCapabilities={getRuntimePlatform() === 'IOS' && capabilitiesStatus === 'loading'} />
              : <Alert tone="danger">WhatsApp ile giriş şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.</Alert>}
          {import.meta.env?.VITE_REVIEW_API_ORIGIN && (getRuntimePlatform() !== "IOS") && <ReviewLogin/>}
          <button type="button" className="auth-help-link" onClick={onOpenHelp} aria-label="Yardım, Kullanım Rehberi ve Yasal Bilgiler"><span className="auth-help-label-full">Yardım, Kullanım Rehberi ve Yasal Bilgiler</span><span className="auth-help-label-android" aria-hidden="true">Yardım ve yasal bilgiler</span><ArrowRight size={16} aria-hidden="true" /></button>
          <div className="public-request-cta">
            <div className="public-request-cta-copy"><BadgeHelp size={20} aria-hidden="true" /><div><h3>Veli Randevu ile tanışın</h3><p>Yıllık lisans hakkında bilgi alın veya bize ulaşın.</p></div></div>
            <Button variant="secondary" className="w-full" onClick={onOpenPublicRequest}>Lisans / İletişim<ArrowRight size={17} /></Button>
          </div>
        </div>
      </main>
    </div>
  );
};
