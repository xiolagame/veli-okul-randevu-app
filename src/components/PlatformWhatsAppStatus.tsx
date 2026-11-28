import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, RefreshCw, Search } from 'lucide-react';
import { api } from '../services/api';
import type { WhatsAppStatusReport } from '../types/platform';
import { formatDateTime } from '../utils/dates';
import { formatTurkishPhoneInput } from '../utils/phone';
import { describeWhatsAppDelivery } from '../utils/whatsapp-delivery';
import { Alert, Button, EmptyState, Skeleton } from './ui';

// Platform yönetimine özel web ekranı: giriş kodlarının telefona ulaşıp ulaşmadığını gösterir.
export function PlatformWhatsAppStatus() {
  const [draft, setDraft] = useState('');
  const [phone, setPhone] = useState('');
  const [report, setReport] = useState<WhatsAppStatusReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latestCall = useRef(0);

  const load = async (target: string) => {
    const call = ++latestCall.current;
    setLoading(true); setError('');
    try {
      const result = await api.getPlatformWhatsAppStatus(target || undefined);
      if (call === latestCall.current) setReport(result);
    } catch (cause) {
      if (call === latestCall.current) { setReport(null); setError(cause instanceof Error ? cause.message : 'WhatsApp teslim durumu yüklenemedi.'); }
    } finally { if (call === latestCall.current) setLoading(false); }
  };
  useEffect(() => { void load(''); }, []);

  const search = (target: string) => { setPhone(target); void load(target); };

  return <section className="space-y-5">
    <section className="surface">
      <h3 className="font-bold text-lg">WhatsApp Teslim Durumu</h3>
      <p className="field-hint">Giriş kodu mesajlarının telefona ulaşıp ulaşmadığını gösterir. Kayıtlar 30 gün saklanır.</p>
      <form className="whatsapp-status-search mt-4" onSubmit={(event) => { event.preventDefault(); search(draft.trim()); }}>
        <label className="field" htmlFor="whatsapp-status-phone">Telefon numarası
          <input id="whatsapp-status-phone" type="tel" inputMode="tel" autoComplete="off" placeholder="0XXX XXX XX XX" value={draft} onChange={(event) => setDraft(formatTurkishPhoneInput(event.target.value))} />
        </label>
        <Button type="submit" disabled={loading}><Search size={17} aria-hidden="true" />Ara</Button>
        {phone && <Button variant="secondary" disabled={loading} onClick={() => { setDraft(''); search(''); }}>Tümünü göster</Button>}
        <Button variant="secondary" disabled={loading} onClick={() => void load(phone)}><RefreshCw size={17} aria-hidden="true" />Yenile</Button>
      </form>
    </section>
    {error && <Alert tone="danger"><span role="alert">{error}</span></Alert>}
    {report && !report.configured && <Alert tone="warning">Teslim takibi henüz kurulmadı: WhatsApp işletme panelindeki bildirim ayarı ve sunucu anahtarları tanımlanmalı.</Alert>}
    {report?.configured && !report.lastReportAt && <Alert tone="warning">Henüz WhatsApp’tan durum bildirimi gelmedi. Kurulumdan sonra gönderilen ilk kodla birlikte görünür.</Alert>}
    {loading ? <Skeleton /> : report && <>
      {phone && <p className="field-hint">{report.codeRequests.length
        ? `Bu numara için son 30 günde ${report.codeRequests.length >= 20 ? 'en az 20' : report.codeRequests.length} kod isteği var; sonuncusu ${formatDateTime(report.codeRequests[0])}.`
        : 'Bu numara için son 30 günde kod isteği yok.'}</p>}
      {report.messages.length ? <section className="surface whatsapp-status-list" aria-label="Mesajlar">{report.messages.map((message) => {
        const view = describeWhatsAppDelivery(message);
        return <article className="whatsapp-status-row" key={message.id}>
          <div><strong>{message.name || 'Kayıtlı ad yok'}</strong><small>{formatTurkishPhoneInput(message.phone)} · {formatDateTime(message.createdAt)}</small></div>
          <span className={`status-badge tone-${view.tone}`}>{view.label}</span>
          {view.explanation && <p className="whatsapp-status-error">{view.explanation}</p>}
        </article>;
      })}</section> : <EmptyState icon={MessageCircle} title="Teslim kaydı yok" description={phone ? 'Bu numara için henüz durum bildirimi gelmedi.' : 'Durum bildirimleri geldikçe burada görünür.'} />}
    </>}
  </section>;
}
