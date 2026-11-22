import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { isNativeRuntime } from '../platform/runtime-platform';
import { WebStoreDownloads } from './WebStoreDownloads';
import './web-welcome.css';
// Public-route artwork stays web-only through the existing native module alias.
import './help-presentation.css';

type Props = { children: React.ReactNode; onHelp: () => void; onRequest: () => void };
const hasLoginLink = () => window.location.pathname === '/login' || /^#appointment-review=/.test(window.location.hash);

/** Presentation only. Authentication and native session handling remain in AuthView. */
export function WebWelcome({ children, onHelp, onRequest }: Props) {
  if (isNativeRuntime()) return <>{children}</>;
  return <BrowserWelcome onHelp={onHelp} onRequest={onRequest}>{children}</BrowserWelcome>;
}

function BrowserWelcome({ children, onHelp, onRequest }: Props) {
  const [phase, setPhase] = useState<'welcome' | 'video' | 'login'>(() =>
    hasLoginLink() ? 'login' : 'welcome');
  const [fading, setFading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const entering = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const login = useRef<HTMLDivElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const active = useRef(true);
  const finish = useCallback(() => {
    if (!active.current) return;
    setPhase('login'); setFading(false); entering.current = false;
    window.scrollTo(0, 0);
    if (window.location.pathname !== '/login' && !/^#appointment-review=/.test(window.location.hash)) {
      window.history.pushState(null, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, []);
  useEffect(() => {
    active.current = true;
    const sync = () => { setPhase(hasLoginLink() ? 'login' : 'welcome'); setFading(false); entering.current = false; };
    window.addEventListener('popstate', sync);
    return () => { active.current = false; window.removeEventListener('popstate', sync); };
  }, []);
  useEffect(() => {
    if (phase === 'login') (login.current?.querySelector<HTMLElement>('input') || login.current?.querySelector<HTMLElement>('button, a'))?.focus({ preventScroll: true });
    if (phase !== 'video') return;
    skip.current?.focus();
    // Bounded fallback also covers a stalled download or missing media events.
    const timeout = window.setTimeout(finish, 8000);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => { if (motion.matches) finish(); };
    motion.addEventListener('change', changed);
    const media = video.current;
    try { void media?.play().catch(finish); } catch { finish(); }
    return () => { window.clearTimeout(timeout); motion.removeEventListener('change', changed); media?.pause(); };
  }, [phase, finish]);
  const enter = () => {
    if (phase !== 'welcome' || entering.current) return;
    entering.current = true; setPlaying(false);
    window.scrollTo(0, 0);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else setPhase('video');
  };
  const back = () => {
    window.scrollTo(0, 0);
    window.history.pushState(null, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  return <>
    {phase !== 'login' && <main className="web-welcome" aria-label="VeliRandevu karşılama sayfası" {...(phase === 'video' ? { inert: '' } : {})} aria-hidden={phase === 'video' ? true : undefined}>
      <a className="welcome-skip welcome-skip-desktop" href="#welcome-title">İçeriğe geç</a>
      <a className="welcome-skip welcome-skip-mobile" href="#welcome-mobile-title">İçeriğe geç</a>
      <section className="welcome-artboard" aria-label="VeliRandevu karşılama">
        <img src="/welcome/scene.png" alt="" width="1672" height="941" fetchPriority="high" />
        <div className="welcome-clean-logo" aria-hidden="true" />
        <div className="welcome-clean-menu" aria-hidden="true" />
        <h1 id="welcome-title" tabIndex={-1} className="welcome-accessible">Eğitim, okul ve aileyle güçlenir.</h1>
        <p className="welcome-accessible">Velilerin öğretmenlerden kolayca randevu alabildiği, okulların görüşmeleri yönettiği ve QR kodla güvenli giriş sağladığı dijital randevu sistemi.</p>
        <a className="welcome-hit welcome-hit-brand" href="/" aria-label="VeliRandevu ana sayfa"><img src="/branding/veli-randevu-logo.png" alt="" /><span>VeliRandevu</span></a>
        <nav className="welcome-desktop-menu" aria-label="Ana menü">
          <button onClick={onRequest}>Lisans Talebi</button>
          <button onClick={onHelp}>Destek</button>
          <button onClick={onRequest}>İletişim</button>
        </nav>
        <button className="welcome-hit welcome-hit-explore-top" onClick={onHelp}><span className="welcome-accessible">Platformu İncele</span></button>
        <button className="welcome-hit welcome-hit-login-top" onClick={enter}><span className="welcome-accessible">Giriş Yap</span></button>
        <button className="welcome-hit welcome-hit-explore" onClick={onHelp}><span className="welcome-accessible">Platformu İncele</span></button>
        <button className="welcome-hit welcome-hit-login" onClick={enter}><span className="welcome-accessible">Giriş Yap</span></button>
        <WebStoreDownloads />
      </section>
      <div className="welcome-scene" aria-hidden="true" />
      <header className="welcome-header">
        <a href="/" className="welcome-brand" aria-label="VeliRandevu ana sayfa"><img src="/branding/veli-randevu-logo.png" alt="" /><span>VeliRandevu</span></a>
        <nav aria-label="Ana menü">
          <button onClick={onRequest}>Lisans Talebi</button>
          <button onClick={onHelp}>Destek</button>
          <button onClick={onRequest}>İletişim</button>
        </nav>
        <button className="welcome-button welcome-login-top" onClick={enter}>Giriş Yap</button>
      </header>
      <section className="welcome-hero">
        <div className="welcome-copy">
          <h1 id="welcome-mobile-title" tabIndex={-1}>Eğitim, okul ve aileyle güçlenir.</h1>
          <p>Velilerin öğretmenlerden kolayca randevu alabildiği, okulların görüşmeleri yönettiği ve QR kodla güvenli giriş sağladığı dijital randevu sistemi.</p>
          <div className="welcome-actions"><button className="welcome-button welcome-outline" onClick={onHelp}>Platformu İncele <ArrowRight size={20} aria-hidden="true" /></button><button className="welcome-button" onClick={enter}>Giriş Yap</button></div>
          <WebStoreDownloads />
          <span className="welcome-signature">Okulunuzla güvenli ve düzenli iletişim.</span>
        </div>
      </section>
      <footer className="welcome-footer"><span>Veli Randevu</span><button onClick={onHelp}>Yardım ve yasal bilgiler</button></footer>
    </main>}
    {phase !== 'welcome' && <div ref={login} className={`welcome-auth${phase === 'video' ? ' is-preparing' : ''}${fading ? ' is-ready' : ''}`} {...(phase === 'video' ? { inert: '' } : {})} aria-hidden={phase === 'video' ? true : undefined}>
      <button className="welcome-return" onClick={back}>Karşılama sayfasına dön</button>
      {children}
    </div>}
    {phase === 'video' && <div className={`welcome-transition${fading ? ' is-fading' : ''}${playing ? ' is-playing' : ''}`} role="dialog" aria-modal="true" aria-label="Giriş ekranı açılıyor" onKeyDown={event => { if (event.key === 'Escape') finish(); }}>
      <video ref={video} src="/welcome/transition.mp4" poster="/welcome/scene.png" muted playsInline preload="auto" aria-hidden="true"
        onPlaying={() => setPlaying(true)} onError={finish} onEnded={finish} onTimeUpdate={event => { const v = event.currentTarget; if (Number.isFinite(v.duration) && v.duration - v.currentTime <= 0.5) setFading(true); }} />
      <button ref={skip} className="welcome-video-skip" onClick={finish}>Geçişi atla</button>
      <span className="welcome-video-status" role="status">Giriş ekranınız hazırlanıyor</span>
    </div>}
  </>;
}
