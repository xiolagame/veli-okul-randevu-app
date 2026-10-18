import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { getRuntimePlatform } from '../platform/runtime-platform';
import { canStartRefreshGesture, isRefreshPull } from '../platform/pull-to-refresh';

function hasNestedScroll(target: EventTarget | null, container: HTMLElement): boolean {
  for (let element = target instanceof Element ? target : null; element && element !== container; element = element.parentElement) {
    const style = window.getComputedStyle(element);
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 2) return true;
  }
  return false;
}

export function useHomeRefresh(enabled: boolean, refresh: () => Promise<void>) {
  const ios = getRuntimePlatform() === 'IOS';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const busyRef = useRef(false);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const gesture = useRef<{ x: number; y: number; eligible: boolean } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, []);

  const runRefresh = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage('');
    try {
      await refresh();
    } catch {
      if (mounted.current) {
        setMessage('Yenileme tamamlanamadı. Tekrar deneyin.');
        messageTimer.current = setTimeout(() => { if (mounted.current) setMessage(''); }, 4000);
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const touchHandlers = {
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      if (!ios || !enabled || busyRef.current || event.touches.length !== 1) { gesture.current = null; return; }
      const target = event.target;
      const atTop = (document.scrollingElement?.scrollTop ?? window.scrollY) <= 2;
      const modalOpen = !!document.querySelector('[role="dialog"], [data-qr-camera]');
      const interactive = target instanceof Element && !!target.closest('button, input, select, textarea, a');
      const eligible = canStartRefreshGesture({ atTop, modalOpen, interactive, nestedScroll: hasNestedScroll(target, event.currentTarget) });
      gesture.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, eligible };
    },
    onTouchMove: (event: TouchEvent<HTMLElement>) => {
      const start = gesture.current;
      if (!start?.eligible || event.touches.length !== 1) return;
      const deltaX = event.touches[0].clientX - start.x;
      const deltaY = event.touches[0].clientY - start.y;
      if (Math.abs(deltaX) > 16 && Math.abs(deltaX) > Math.abs(deltaY)) start.eligible = false;
    },
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      const start = gesture.current;
      gesture.current = null;
      if (!start?.eligible || !enabled || !ios || event.changedTouches.length !== 1 || document.querySelector('[role="dialog"], [data-qr-camera]')) return;
      const deltaX = event.changedTouches[0].clientX - start.x;
      const deltaY = event.changedTouches[0].clientY - start.y;
      if (isRefreshPull(deltaX, deltaY)) void runRefresh();
    },
    onTouchCancel: () => { gesture.current = null; },
  };

  const control = ios && enabled && (busy || message) ? <div className="home-refresh" role={message ? 'alert' : 'status'} aria-label={busy ? 'Veriler yenileniyor' : undefined}>
    {busy ? <RefreshCw size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <span>{message}</span>}
  </div> : null;
  return { touchHandlers, control };
}
