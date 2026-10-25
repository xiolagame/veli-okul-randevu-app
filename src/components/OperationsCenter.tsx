import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Calendar, ChevronRight, Clock, GraduationCap, KeyRound, RefreshCw, UserRound, TriangleAlert } from 'lucide-react';
import { api } from '../services/api';
import { OperationCategory, OperationItem, OperationPage, OperationSummary } from '../types/operations';
import { AppointmentStatus } from '../types';
import { formatDate } from '../utils/dates';
import { displayStoredTurkishPhone } from '../utils/phone';
import { Alert, Button, Dialog, Metric, RecordAction, Skeleton, StatusBadge } from './ui';
import { ManagementActions } from './ManagementActions';

const categories = [
  { id: 'pending-parents', title: 'Hesap oluşturmayı bekleyen veliler', description: 'Kayıtlı telefonlarına bağlı global hesabı bulunmayan veliler. Aynı telefon bir kez sayılır.', icon: UserRound },
  { id: 'pending-staff', title: 'Aktivasyon bekleyen personel', description: 'Mevcut personel hesap durumuna göre etkinleşmeyi bekleyen öğretmen ve güvenlik kayıtları.', icon: GraduationCap },
  { id: 'pending-appointments', title: 'Onay bekleyen randevular', description: 'Tüm tarihlerde öğretmen onayı bekleyen randevular. Okul yönetimi burada yalnız görüntüleyebilir.', icon: Clock },
  { id: 'today', title: 'Bugünkü görüşmeler', description: 'İstanbul tarihine göre bugünün tüm randevuları; iptal ve ret durumları dahildir. Saat sırasıyla gösterilir.', icon: Calendar },
  { id: 'missing', title: 'Eksik bilgi içeren kayıtlar', description: 'Zorunlu alan veya bağlantı sorunu bulunan öğrenci, veli ve personel kayıtları. İsteğe bağlı öğrenci numarası ve doğum tarihi aranmaz.', icon: TriangleAlert },
] as const;
const allTitles: Record<OperationCategory, string> = { ...Object.fromEntries(categories.map((c) => [c.id, c.title])), teachers: 'Öğretmenler', appointments: 'Randevular' } as Record<OperationCategory, string>;
const statuses: AppointmentStatus[] = ['pending', 'booked', 'checked_in', 'checked_out', 'cancelled', 'rejected'];
const statusLabels = ['Onay bekliyor', 'Onaylandı', 'Giriş yapıldı', 'Tamamlandı', 'İptal edildi', 'Reddedildi'];

export function OperationsCenter({ schoolId, onOpenRecords }: { schoolId: string; onOpenRecords: (kind: 'student' | 'staff') => void }) {
  const [summary, setSummary] = useState<OperationSummary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [active, setActive] = useState<OperationCategory | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<OperationPage | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const mounted = useRef(true);
  const inFlightSummary = useRef<Promise<void> | null>(null);
  const loadSummary = useCallback(() => {
    if (inFlightSummary.current) return inFlightSummary.current;
    const pending = api.getOperationSummary(schoolId).then((result) => {
      if (mounted.current) { setSummary(result); setSummaryError(''); }
    }).catch(() => { if (mounted.current) setSummaryError('Operasyon özeti alınamadı.'); })
      .finally(() => { inFlightSummary.current = null; });
    inFlightSummary.current = pending;
    return pending;
  }, [schoolId]);
  useEffect(() => { mounted.current = true; void loadSummary(); return () => { mounted.current = false; }; }, [loadSummary]);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(0); }, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    let current = true;
    setData(null); setError(''); setExpanded(null);
    if (active) void api.getOperationPage(schoolId, active, page, query, status).then((result) => {
      if (current) {
        const lastPage = Math.max(0, Math.ceil(result.total / result.pageSize) - 1);
        if (page > lastPage) { setPage(lastPage); return; }
        setData(result);
        if (!query && !status) setSummary((old) => old ? { ...old, counts: { ...old.counts, [active]: result.total } } : old);
      }
    }).catch(() => { if (current) setError('Kayıtlar alınamadı. Lütfen tekrar deneyin.'); });
    return () => { current = false; };
  }, [schoolId, active, page, query, status, retry]);
  const open = (category: OperationCategory, filter = '') => { setData(null); setError(''); setSearch(''); setQuery(''); setStatus(filter); setPage(0); setNotice(''); setActive(category); };
  const refresh = async () => { await loadSummary(); setRetry((value) => value + 1); };
  const count = (category: OperationCategory) => summary ? summary.counts[category] : '—';
  const renderDetail = (item: OperationItem) => <div className="record-detail">
    {item.activationCreatedAt && <p className="field-hint">Geçerli aktivasyon daveti kaydı: {new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.activationCreatedAt))}</p>}
    {item.appointment && <><dl className="operation-details"><div><dt>Öğrenci</dt><dd>{item.appointment.studentName} · {item.appointment.className}</dd></div><div><dt>Veli</dt><dd>{item.appointment.parentName}</dd></div><div><dt>Öğretmen</dt><dd>{item.appointment.teacherName}</dd></div><div><dt>Tarih / Saat</dt><dd>{formatDate(item.appointment.date)} · {item.appointment.startTime}–{item.appointment.endTime}</dd></div></dl>{item.appointment.notes && <p className="whitespace-pre-wrap break-words">{item.appointment.notes}</p>}<p className="field-hint">Onay ve ret işlemleri yalnız mevcut öğretmen yetkileriyle yapılabilir.</p></>}
    {item.students?.map((student) => <div className="record-detail-person" key={student.id}><div><strong>{student.name}</strong><p>{student.className} · No: {student.studentNumber || '—'}</p></div><ManagementActions compact schoolId={schoolId} kind="roster" id={student.id} values={{ studentName: student.name, className: student.className, studentNumber: student.studentNumber, parentName: item.name, parentPhone: item.phone || '', ...(student.birthDate ? { birthDate: student.birthDate } : {}) }} onChanged={refresh} showRemove={false} /></div>)}
    {item.issues && <Alert tone="warning">{item.issues.join(' · ')}</Alert>}
    {item.editKind && item.values && <ManagementActions compact schoolId={schoolId} kind={item.editKind} id={item.id} values={item.values} onChanged={refresh} showRemove={false} />}
    {item.role && item.status === 'pending' && <Button variant="secondary" disabled={resending} onClick={async () => {
      setResending(true); setNotice(''); setNoticeError(false); try { const result = await api.resendStaffActivation(schoolId, item.role!, item.id); setNotice(result.message); } catch (cause) { setNoticeError(true); setNotice(cause instanceof Error ? cause.message : 'E-posta yeniden gönderilemedi.'); } finally { setResending(false); }
    }}><KeyRound size={16} />Mevcut aktivasyon e-postasını yeniden gönder</Button>}
    {!item.appointment && <Button variant="quiet" onClick={() => { setActive(null); onOpenRecords(item.role ? 'staff' : 'student'); }}>İlgili okul kayıtlarını aç</Button>}
  </div>;
  return <div className="school-dashboard">
    {summaryError && <Alert tone="danger">{summaryError} <Button variant="quiet" onClick={() => void loadSummary()}>Tekrar dene</Button></Alert>}
    <div className="metric-grid"><Metric icon={Calendar} label="Bugünkü randevu" value={count('today')} onClick={() => open('today')} /><Metric icon={Clock} label="Onay bekleyen" value={count('pending-appointments')} onClick={() => open('pending-appointments')} /><Metric icon={GraduationCap} label="Öğretmen" actionLabel="öğretmenleri göster" value={count('teachers')} onClick={() => open('teachers')} /></div>
    <div className="operation-overview-grid"><section className="surface operation-center" aria-label="Operasyon Merkezi"><div className="section-heading"><div><h3>Operasyon Merkezi</h3><p>İşlem gerektiren kayıtları inceleyin.</p></div><RecordAction label="Operasyon özetini yenile" icon={RefreshCw} onClick={() => void loadSummary()} /></div>
      {!summary && !summaryError && <span role="status">Özet yükleniyor…</span>}
      {categories.map(({ id, title, icon: Icon }) => <button type="button" className="operation-category" key={id} onClick={() => open(id)}><Icon size={18} aria-hidden="true" /><span>{title}</span><strong>{count(id)}</strong><ChevronRight size={16} aria-hidden="true" /></button>)}
    </section><section className="surface operation-status"><div className="section-heading"><div><h3>Görüşmelerin Durumu</h3><p>Tüm tarihler</p></div></div>{statuses.map((value) => <button type="button" className="operation-status-row" key={value} onClick={() => open('appointments', value)}><StatusBadge status={value} /><strong>{summary ? summary.statuses[value] || 0 : '—'}</strong></button>)}</section></div>
    {active && <Dialog className="operations-drawer" title={allTitles[active]} description={categories.find((c) => c.id === active)?.description || 'Yetkili olduğunuz okulun kayıtları.'} onClose={() => setActive(null)}>
      <div className="management-section"><label className="field">Kayıtlarda ara<input value={search} maxLength={100} placeholder="Ad, sınıf veya iletişim bilgisi" onChange={(event) => setSearch(event.target.value)} /></label>
        {(active === 'today' || active === 'appointments') && <label className="field">Randevu durumu<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="">Tüm durumlar</option>{statuses.map((value, index) => <option key={value} value={value}>{statusLabels[index]}</option>)}</select></label>}
        {notice && <Alert tone={noticeError ? 'danger' : 'success'}>{notice}</Alert>}{error ? <Alert tone="danger">{error}<Button variant="quiet" onClick={() => setRetry((value) => value + 1)}>Tekrar dene</Button></Alert> : !data ? <Skeleton /> : <>
          <p role="status">{data.total} kayıt · {page + 1} / {Math.max(1, Math.ceil(data.total / data.pageSize))}</p>
          {!data.items.length ? <Alert>Bu kapsamda kayıt bulunmuyor.</Alert> : <div className="operation-results">{data.items.map((item) => {
            const key = `${item.kind}:${item.role || ''}:${item.id}`, meeting = item.appointment;
            return <div className="operation-result" key={key}><button type="button" className="operation-result-toggle" aria-expanded={expanded === key} onClick={() => setExpanded(expanded === key ? null : key)}><span><strong>{item.name}</strong><small>{meeting ? `${formatDate(meeting.date)} ${meeting.startTime} · ${meeting.teacherName} · Veli: ${meeting.parentName}` : item.role ? `${item.role === 'teacher' ? 'Öğretmen' : 'Güvenlik'} · ${item.branch || '—'} · ${displayStoredTurkishPhone(item.phone || '')} · ${item.email || '—'}` : `${displayStoredTurkishPhone(item.phone || '')}${item.students ? ' · ' + item.students.map((s) => `${s.name} (${s.className})`).join(', ') : ''}${item.issues ? ' · ' + item.issues.join(', ') : ''}`}</small></span>{meeting ? <StatusBadge status={meeting.status} /> : <ChevronRight size={18} aria-hidden="true" />}</button>{expanded === key && renderDetail(item)}</div>;
          })}</div>}
          {data.total > data.pageSize && <nav className="management-pagination" aria-label="Operasyon sayfaları"><Button variant="secondary" disabled={!page} onClick={() => setPage(page - 1)}>Önceki</Button><Button variant="secondary" disabled={(page + 1) * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Sonraki</Button></nav>}
        </>}
      </div>
    </Dialog>}
  </div>;
}
