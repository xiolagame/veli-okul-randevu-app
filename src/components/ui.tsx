import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, CheckCircle2, Clock, LogIn, LogOut, X, XCircle, type LucideIcon } from 'lucide-react';
import type { AppointmentStatus } from '../types';
import { registerBackHandler } from '../platform/back-navigation';
import {ThemeSwitcher} from './ThemeSwitcher';

export function Brand({ light = false }: { light?: boolean }) {
  return <div className={`brand ${light ? 'brand-light' : ''}`}><img className="brand-logo" src="/branding/veli-randevu-logo.png" alt="" /><span className="brand-name">Veli Randevu</span><ThemeSwitcher/></div>;
}

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' }) {
  return <button type={type} className={`ui-button ui-button-${variant} ${className}`} {...props} />;
}

export function Alert({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'success' | 'danger' | 'warning' }) {
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;
  return <div role={tone === 'danger' ? 'alert' : 'status'} className={`ui-alert tone-${tone}`}><Icon aria-hidden="true" size={19} /><div>{children}</div></div>;
}

export function RecordAction({ label, icon: Icon, danger = false, ...props }: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { label: string; icon: LucideIcon; danger?: boolean }) {
  return <button type="button" {...props} aria-label={label} title={props.title || label} className={`record-action ${danger ? 'record-action-danger' : ''}`}><Icon size={17} aria-hidden="true" /></button>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action && <div className="page-action">{action}</div>}</div>;
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={26} aria-hidden="true" /></span><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}

const statuses: Record<AppointmentStatus, { label: string; tone: string; icon: LucideIcon }> = {
  pending: { label: 'Onay bekliyor', tone: 'warning', icon: Clock },
  booked: { label: 'Onaylandı', tone: 'success', icon: CheckCircle2 },
  checked_in: { label: 'Giriş yapıldı', tone: 'info', icon: LogIn },
  checked_out: { label: 'Tamamlandı', tone: 'neutral', icon: LogOut },
  cancelled: { label: 'İptal edildi', tone: 'neutral', icon: XCircle },
  rejected: { label: 'Reddedildi', tone: 'danger', icon: XCircle },
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { label, tone, icon: Icon } = statuses[status];
  return <span className={`status-badge tone-${tone}`}><Icon size={14} aria-hidden="true" />{label}</span>;
}

export function Metric({ label, value, icon: Icon, detail, onClick, actionLabel = 'randevuları göster' }: { label: string; value: React.ReactNode; icon: LucideIcon; detail?: string; onClick?: () => void; actionLabel?: string }) {
  const content = <><div className="metric-top"><span>{label}</span><Icon size={19} aria-hidden="true" /></div><strong>{value}</strong>{detail && <p>{detail}</p>}</>;
  return onClick ? <button type="button" className="metric-card metric-card-button" onClick={onClick} aria-label={`${label}: ${value} — ${actionLabel}`}>{content}</button> : <div className="metric-card">{content}</div>;
}

export function RoleNavigation<Tab extends string>({ items, active, onChange }: { items: { id: Tab; label: string; icon: LucideIcon; count?: number }[]; active: Tab; onChange: (tab: Tab) => void }) {
  return <nav className="role-navigation" aria-label="Sayfa menüsü">{items.map(({ id, label, icon: Icon, count }) => <button type="button" key={id} aria-current={active === id ? 'page' : undefined} onClick={() => onChange(id)}><span className="nav-icon"><Icon size={20} aria-hidden="true" />{!!count && <span className="nav-count">{count}</span>}</span><span>{label}</span></button>)}</nav>;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="skeleton-list" role="status" aria-label="Bilgiler yükleniyor">{Array.from({ length: rows }, (_, index) => <div key={index} className="skeleton-card"><span /><div><span /><span /></div></div>)}</div>;
}

const dialogStack: symbol[] = [];
let bodyOverflow = '';

export function Dialog({ title, description, onClose, children, wide = false, dismissible = true, className = '' }: { title: string; description?: string; onClose: () => void; children: React.ReactNode; wide?: boolean; dismissible?: boolean; className?: string }) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const marker = Symbol();
    const previousFocus = document.activeElement as HTMLElement | null;
    if (!dialogStack.length) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    dialogStack.push(marker);
    const unregisterBackHandler = registerBackHandler(() => {
      if (dialogStack.at(-1) === marker && dismissible) close.current();
    });
    panel.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (dialogStack.at(-1) !== marker) return;
      if (event.key === 'Escape' && dismissible) {
        event.preventDefault();
        close.current();
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []).filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current))) {
          event.preventDefault();
          (last || panel.current)?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      unregisterBackHandler();
      dialogStack.splice(dialogStack.indexOf(marker), 1);
      if (!dialogStack.length) document.body.style.overflow = bodyOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [dismissible]);

  return createPortal(<div className="dialog-backdrop" onMouseDown={(event) => { if (dismissible && event.target === event.currentTarget) onClose(); }}><div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1} className={`dialog-panel ${wide ? 'dialog-wide' : ''} ${className}`}><header className="dialog-heading"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><button type="button" className="icon-button" disabled={!dismissible} onClick={onClose} aria-label="Pencereyi kapat"><X size={21} /></button></header><div className="dialog-body">{children}</div></div></div>, document.body);
}

export function StepIndicator({ active, labels }: { active: number; labels: string[] }) {
  return <ol className="steps" aria-label="İşlem adımları">{labels.map((label, index) => <li key={label} className={index <= active ? 'step-active' : ''} aria-current={index === active ? 'step' : undefined}><span>{index < active ? <Check size={14} /> : index + 1}</span>{label}</li>)}</ol>;
}
