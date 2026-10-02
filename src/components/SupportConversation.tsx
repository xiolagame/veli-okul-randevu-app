import React from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import type { SupportThread } from '../types/platform';
import { formatDateTime } from '../utils/dates';
import { Button } from './ui';

interface SupportConversationProps {
  thread: SupportThread;
  message: string;
  busy: boolean;
  backLabel: string;
  submitLabel: string;
  onBack: () => void;
  onMessageChange: (message: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  actions?: React.ReactNode;
}

export function SupportConversation({
  thread,
  message,
  busy,
  backLabel,
  submitLabel,
  onBack,
  onMessageChange,
  onSubmit,
  actions,
}: SupportConversationProps) {
  const readOnly = thread.request.status === 'RESOLVED' || thread.request.status === 'ARCHIVED';
  return <section className="surface support-thread">
    <header className="support-thread-header">
      <button type="button" className="support-back" onClick={onBack}><ArrowLeft size={18} />{backLabel}</button>
      <div>
        <span className="eyebrow">Destek konuşması</span>
        <h3>{thread.request.subject || 'Destek Talebi'}</h3>
        <p>{thread.request.schoolName}</p>
      </div>
      {actions && <div className="support-thread-actions">{actions}</div>}
    </header>
    <div className="support-messages" aria-label="Destek mesajları">
      {thread.messages.map((item) => {
        const platform = item.senderKind === 'PLATFORM_ADMIN';
        return <article className={`support-message ${platform ? 'support-message-platform' : 'support-message-school'}`} key={item.id}>
          <header><strong>{platform ? 'Veli Randevu Destek' : 'Okul Yönetimi'}</strong><time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time></header>
          <p>{item.message}</p>
        </article>;
      })}
    </div>
    {readOnly ? <div className="support-readonly" role="status">{thread.request.status === 'ARCHIVED' ? 'Bu destek talebi arşivlendi. Konuşma geçmişi salt okunur durumdadır.' : 'Bu destek talebi çözümlendi. Konuşma geçmişi salt okunur durumdadır.'}</div> : <form className="support-composer" onSubmit={onSubmit}>
      <label className="field" htmlFor={`support-reply-${thread.request.id}`}>Mesajınız
        <textarea id={`support-reply-${thread.request.id}`} rows={4} maxLength={4000} value={message} disabled={busy} onChange={(event) => onMessageChange(event.target.value)} required />
        <small>{message.length}/4000</small>
      </label>
      <Button type="submit" disabled={busy || !message.trim()}>{busy ? 'Gönderiliyor…' : <><Send size={17} />{submitLabel}</>}</Button>
    </form>}
  </section>;
}
