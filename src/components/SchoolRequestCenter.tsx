import React, { useEffect, useState } from 'react';
import { Clock3, LifeBuoy, Send } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { PlatformRequestItem, PlatformRequestStatus } from '../types/platform';
import { createRequestToken } from '../utils/request-token';
import { formatDateTime } from '../utils/dates';
import { Alert, Button, EmptyState, Skeleton } from './ui';

const categories = ['Teknik Sorun', 'Randevu Sorunu', 'Veli Hesabı', 'Personel Hesabı', 'QR / Güvenlik', 'Lisans', 'Öneri', 'Diğer'] as const;
const statusLabels: Record<PlatformRequestStatus, string> = { NEW: 'Yeni', IN_PROGRESS: 'İşlemde', WAITING_PAYMENT: 'Ödeme Bekleniyor', RESOLVED: 'Çözüldü', ARCHIVED: 'Arşivlendi' };
const typeLabels = { MONTHLY_LICENSE: 'Aylık Lisans (Eski)', YEARLY_LICENSE: 'Yıllık Lisans', CONTACT: 'İletişim', SUPPORT: 'Destek' } as const;

export function SchoolRequestCenter() {
  const { currentSchool, currentUser } = useApp();
  const [mode, setMode] = useState<'SUPPORT' | 'YEARLY_LICENSE'>('SUPPORT');
  const [subject, setSubject] = useState<(typeof categories)[number]>('Teknik Sorun');
  const [message, setMessage] = useState('');
  const [token, setToken] = useState(createRequestToken);
  const [requests, setRequests] = useState<PlatformRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    setError('');
    if (!currentSchool) {
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try { setRequests((await api.getSchoolRequests(currentSchool.id)).requests); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Talepler yüklenemedi.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [currentSchool?.id]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentSchool || busy) return;
    if (!message.trim()) return setError('Lütfen talebinizi açıklayın.');
    setBusy(true); setError(''); setSuccess('');
    try {
      const result = await api.createSchoolRequest(currentSchool.id, { requestToken: token, requestType: mode, subject: mode === 'SUPPORT' ? subject : undefined, message });
      setMessage(''); setToken(createRequestToken());
      setSuccess(result.emailNotificationSent ? 'Talebiniz başarıyla alındı.' : 'Talebiniz kaydedildi; bildirim e-postası gönderilemedi.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Talebiniz gönderilemedi.'); }
    finally { setBusy(false); }
  };

  return <div className="space-y-6">
    <section className="surface max-w-3xl">
      <div className="section-heading"><div><h3>Destek / Lisans Talebi</h3><p>Talebiniz okul ve yönetici bilgilerinizle güvenli şekilde ilişkilendirilir.</p></div><LifeBuoy size={22} className="text-blue-700" /></div>
      <dl className="pass-details mb-6"><div><dt>Okul</dt><dd>{currentSchool?.name}</dd></div><div><dt>Yetkili</dt><dd>{currentUser?.firstName} {currentUser?.lastName}</dd></div></dl>
      <form className="form-stack" onSubmit={submit}>
        {error && <Alert tone="danger"><span role="alert">{error}</span></Alert>}{success && <Alert tone="success"><span role="status">{success}</span></Alert>}
        <label className="field" htmlFor="school-request-type">Talep Türü<select id="school-request-type" value={mode} disabled={busy} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="SUPPORT">Destek Talebi</option><option value="YEARLY_LICENSE">Yıllık Lisans Talebi</option></select></label>
        {mode === 'SUPPORT' && <label className="field" htmlFor="school-request-subject">Konu / Kategori *<select id="school-request-subject" value={subject} disabled={busy} onChange={(event) => setSubject(event.target.value as typeof subject)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>}
        <label className="field" htmlFor="school-request-message">Mesaj *<textarea id="school-request-message" rows={5} maxLength={2000} value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} required /></label>
        <Button type="submit" disabled={busy}>{busy ? 'Gönderiliyor…' : <><Send size={17} />Talebi Gönder</>}</Button>
      </form>
    </section>
    <section className="surface"><div className="section-heading"><div><h3>Taleplerim</h3><p>Yalnız bu okula ait destek ve lisans talepleri.</p></div></div>
      {loading ? <Skeleton /> : requests.length ? <div className="request-list">{requests.map((item) => <article className="request-card" key={item.id}><div><strong>{typeLabels[item.requestType]}</strong><p>{item.subject || item.message}</p><small>{formatDateTime(item.createdAt)}</small></div><span className={`status-badge tone-${item.status === 'RESOLVED' ? 'success' : item.status === 'ARCHIVED' ? 'neutral' : 'warning'}`}>{statusLabels[item.status]}</span></article>)}</div> : <EmptyState icon={Clock3} title="Henüz talebiniz yok" description="Yeni destek veya lisans talebiniz burada görünür." />}
    </section>
  </div>;
}
