import React, { useEffect, useState } from 'react';
import { Clock3, LifeBuoy, MessageSquare, Send, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { PlatformRequestItem, PlatformRequestStatus, SupportThread } from '../types/platform';
import { createRequestToken } from '../utils/request-token';
import { formatDateTime } from '../utils/dates';
import { Alert, Button, Dialog, EmptyState, Skeleton } from './ui';
import { SupportConversation } from './SupportConversation';

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
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [replyToken, setReplyToken] = useState(createRequestToken);
  const [hideTarget, setHideTarget] = useState<PlatformRequestItem | null>(null);

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

  const openThread = async (requestId: string) => {
    if (!currentSchool) return;
    setThreadLoading(true); setError(''); setSuccess('');
    try { setThread(await api.getSchoolSupportThread(currentSchool.id, requestId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Destek konuşması yüklenemedi.'); }
    finally { setThreadLoading(false); }
  };

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentSchool || !thread || busy || !reply.trim()) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      await api.sendSchoolSupportMessage(currentSchool.id, thread.request.id, { requestToken: replyToken, message: reply });
      setReply(''); setReplyToken(createRequestToken());
      await Promise.all([openThread(thread.request.id), load()]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Mesaj gönderilemedi.'); }
    finally { setBusy(false); }
  };

  const hideRequest = async () => {
    if (!currentSchool || !hideTarget || busy) return;
    setBusy(true); setError('');
    try {
      await api.hideSchoolSupportRequest(currentSchool.id, hideTarget.id);
      setHideTarget(null); setThread(null); setSuccess('Destek talebi geçmişinizden kaldırıldı.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Destek talebi kaldırılamadı.'); }
    finally { setBusy(false); }
  };

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

  const supportRequests = requests.filter((item) => item.requestType === 'SUPPORT');
  const licenseRequests = requests.filter((item) => item.requestType !== 'SUPPORT');

  if (threadLoading) return <section className="surface"><Skeleton /></section>;
  if (thread) return <div className="space-y-5">
    {error && <Alert tone="danger"><span role="alert">{error}</span></Alert>}
    <SupportConversation
      thread={thread}
      message={reply}
      busy={busy}
      backLabel="Destek Geçmişi"
      submitLabel="Gönder"
      onBack={() => { setThread(null); setReply(''); setError(''); }}
      onMessageChange={setReply}
      onSubmit={sendReply}
      actions={(thread.request.status === 'RESOLVED' || thread.request.status === 'ARCHIVED') && <Button variant="danger" onClick={() => setHideTarget(thread.request)}><Trash2 size={17} />Sil</Button>}
    />
    {hideTarget && <Dialog title="Destek talebini kaldır" description="Bu destek talebi yalnızca sizin görünümünüzden kaldırılacaktır." onClose={() => setHideTarget(null)} dismissible={!busy}>
      <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setHideTarget(null)}>Vazgeç</Button><Button variant="danger" disabled={busy} onClick={() => void hideRequest()}>{busy ? 'Kaldırılıyor…' : 'Geçmişten Kaldır'}</Button></div>
    </Dialog>}
  </div>;

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
    <section className="surface"><div className="section-heading"><div><h3>Destek Geçmişi</h3><p>Okulunuzun tüm yöneticileri bu destek konuşmalarını görüntüleyebilir ve yanıtlayabilir.</p></div><MessageSquare size={22} className="text-blue-700" /></div>
      {loading ? <Skeleton /> : supportRequests.length ? <div className="request-list">{supportRequests.map((item) => <button type="button" className="request-card request-card-button" key={item.id} onClick={() => void openThread(item.id)}><div><strong>{item.subject || 'Destek Talebi'}</strong><p>{item.message}</p><small>{item.messageCount} mesaj · Son güncelleme {formatDateTime(item.updatedAt)}</small></div><span className={`status-badge tone-${item.status === 'RESOLVED' ? 'success' : item.status === 'ARCHIVED' ? 'neutral' : 'warning'}`}>{statusLabels[item.status]}</span></button>)}</div> : <EmptyState icon={Clock3} title="Henüz destek talebiniz yok" description="Yeni destek talebiniz ve yanıtları burada görünür." />}
    </section>
    <section className="surface"><div className="section-heading"><div><h3>Lisans Talepleri</h3><p>Yıllık lisans talepleriniz mevcut tek-talep akışıyla gösterilir.</p></div></div>
      {loading ? <Skeleton /> : licenseRequests.length ? <div className="request-list">{licenseRequests.map((item) => <article className="request-card" key={item.id}><div><strong>{typeLabels[item.requestType]}</strong><p>{item.message}</p><small>{formatDateTime(item.createdAt)}</small></div><span className={`status-badge tone-${item.status === 'RESOLVED' ? 'success' : item.status === 'ARCHIVED' ? 'neutral' : 'warning'}`}>{statusLabels[item.status]}</span></article>)}</div> : <EmptyState icon={Clock3} title="Henüz lisans talebiniz yok" description="Yıllık lisans talepleriniz burada görünür." />}
    </section>
  </div>;
}
