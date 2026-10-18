import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { getRuntimePlatform } from '../platform/runtime-platform';
import { canStartRefreshGesture, isRefreshPull } from '../platform/pull-to-refresh';
import { Button } from './ui';

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
  const [pullHint, setPullHint] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const gesture = useRef<{ x: number; y: number; eligible: boolean } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const runRefresh = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage('');
    try {
      await refresh();
      if (mounted.current) setMessage('Veriler güncellendi.');
    } catch {
      if (mounted.current) setMessage('Yenileme tamamlanamadı. Tekrar deneyin.');
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
      setPullHint(start.eligible && isRefreshPull(deltaX, deltaY));
    },
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      const start = gesture.current;
      gesture.current = null;
      setPullHint(false);
      if (!start?.eligible || !enabled || !ios || event.changedTouches.length !== 1 || document.querySelector('[role="dialog"], [data-qr-camera]')) return;
      const deltaX = event.changedTouches[0].clientX - start.x;
      const deltaY = event.changedTouches[0].clientY - start.y;
      if (isRefreshPull(deltaX, deltaY)) void runRefresh();
    },
    onTouchCancel: () => { gesture.current = null; setPullHint(false); },
  };

  const control = ios && enabled ? <div className="home-refresh" role="status" aria-live="polite">
    <Button variant="quiet" disabled={busy} onClick={() => { void runRefresh(); }}><RefreshCw size={17} aria-hidden="true" />{busy ? 'Yenileniyor…' : 'Yenile'}</Button>
    {pullHint && !busy && <span>Bırakın, yenilensin.</span>}
    {message && <span>{message}</span>}
  </div> : null;
  return { touchHandlers, control };
}
