import React, { useEffect, useState } from 'react';
import { Inbox, Mail } from 'lucide-react';
import { api } from '../services/api';
import { PlatformRequestItem, PlatformRequestStatus, PlatformRequestType } from '../types/platform';
import { formatDateTime } from '../utils/dates';
import { filterPlatformRequests, getPlatformRequestStatusOptions } from '../utils/platform-request-ui';
import { Alert, Button, Dialog, EmptyState, Skeleton } from './ui';

const statusLabels: Record<PlatformRequestStatus, string> = { NEW: 'Yeni', IN_PROGRESS: 'İşlemde', WAITING_PAYMENT: 'Ödeme Bekleniyor', RESOLVED: 'Çözüldü', ARCHIVED: 'Arşiv' };
const typeLabels: Record<PlatformRequestType, string> = { MONTHLY_LICENSE: 'Aylık Lisans (Eski)', YEARLY_LICENSE: 'Yıllık Lisans', CONTACT: 'İletişim', SUPPORT: 'Destek' };
const activeRequestTypes: PlatformRequestType[] = ['YEARLY_LICENSE', 'CONTACT', 'SUPPORT'];
const sourceLabels = { PUBLIC: 'Public Form', SCHOOL_ADMIN: 'Okul Yönetimi' } as const;

export function PlatformRequestCenter() {
  const [status, setStatus] = useState('');
  const [requestType, setRequestType] = useState('');
  const [requests, setRequests] = useState<PlatformRequestItem[]>([]);
  const [selected, setSelected] = useState<PlatformRequestItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const result = await api.getPlatformRequests({ status: status || undefined, requestType: requestType || undefined });
      setRequests(filterPlatformRequests(result.requests, status as '' | 'ALL' | PlatformRequestStatus, requestType as '' | PlatformRequestType));
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Gelen talepler yüklenemedi.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [status, requestType]);

  const updateStatus = async (nextStatus: PlatformRequestStatus) => {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      const updated = (await api.updatePlatformRequestStatus(selected.id, nextStatus)).request;
      setSelected(updated);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Talep durumu güncellenemedi.'); }
    finally { setBusy(false); }
  };

  return <section className="space-y-5">
    <div className="filter-bar">
      <label className="field" htmlFor="platform-request-status">Durum<select id="platform-request-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Aktif Talepler</option><option value="ALL">Tümü</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field" htmlFor="platform-request-type">Talep Türü<select id="platform-request-type" value={requestType} onChange={(event) => setRequestType(event.target.value)}><option value="">Tüm Türler</option>{activeRequestTypes.map((value) => <option key={value} value={value}>{typeLabels[value]}</option>)}</select></label>
    </div>
    {error && <Alert tone="danger"><span role="alert">{error}</span></Alert>}
    {loading ? <Skeleton /> : requests.length ? <div className="request-list">{requests.map((item) => <button type="button" className="request-card request-card-button" key={item.id} onClick={() => setSelected(item)}><div><strong>{typeLabels[item.requestType]} · {item.schoolName}</strong><p>{item.subject || item.message || 'Mesaj bulunmuyor.'}</p><small>{sourceLabels[item.source]} · {formatDateTime(item.createdAt)}</small></div><span className={`status-badge tone-${item.status === 'RESOLVED' ? 'success' : item.status === 'ARCHIVED' ? 'neutral' : 'warning'}`}>{statusLabels[item.status]}</span></button>)}</div> : <EmptyState icon={Inbox} title="Bu filtrede talep yok" description="Yeni talepler geldiğinde burada görüntülenir." />}
    {selected && <Dialog wide title={typeLabels[selected.requestType]} description={`${sourceLabels[selected.source]} · ${formatDateTime(selected.createdAt)}`} onClose={() => setSelected(null)} dismissible={!busy}>
      {error && <Alert tone="danger">{error}</Alert>}
      <dl className="pass-details request-detail"><div><dt>Okul</dt><dd>{selected.schoolName}</dd></div><div><dt>Yetkili</dt><dd>{selected.contactName}</dd></div><div><dt>E-posta</dt><dd>{selected.email || '—'}</dd></div><div><dt>Telefon</dt><dd>{selected.phone || '—'}</dd></div><div><dt>Öğretmen Sayısı</dt><dd>{selected.teacherCount || '—'}</dd></div><div><dt>Konu</dt><dd>{selected.subject || '—'}</dd></div></dl>
      <div className="request-message"><strong>Mesaj</strong><p>{selected.message || 'Mesaj bulunmuyor.'}</p></div>
      <label className="field" htmlFor="platform-request-next-status">Durum<select id="platform-request-next-status" value={selected.status} disabled={busy} onChange={(event) => void updateStatus(event.target.value as PlatformRequestStatus)}>{getPlatformRequestStatusOptions(selected.status, selected.requestType).map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label>
      <div className="form-actions">{selected.email && <a className="ui-button ui-button-secondary" href={`mailto:${selected.email}?subject=${encodeURIComponent(`VELİ RANDEVU — ${typeLabels[selected.requestType]}`)}`}><Mail size={17} />E-posta Yaz</a>}<Button variant="secondary" onClick={() => setSelected(null)}>Kapat</Button></div>
    </Dialog>}
  </section>;
}
