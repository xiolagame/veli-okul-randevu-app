import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Users, Trash2, Plus, ChevronDown, Check } from 'lucide-react';
import { api } from '../services/api';
import { ALL_CLASSES, MULTI_CLASS_CONFIRMATION, MultiClassRemovalPreview, classSummaries, classTone, SchoolStudentRecord, studentRecordIssues } from '../utils/student-records';
import { normalizeClassName } from '../utils/class-name';
import { classCardColors } from '../utils/class-card-colors';
import { MultiClassChallengeGuard } from '../utils/multi-class-challenge';
import { Alert, Button, Dialog, RecordAction, Skeleton } from './ui';
import { ManagementActions } from './ManagementActions';

export function StudentManagement({ schoolId, schoolName, onChanged = async () => {}, onImport, revision = 0 }: {
  schoolId: string; schoolName: string; onChanged?: () => Promise<void>; onImport: () => void; revision?: number;
}) {
  const [data, setData] = useState<{ schoolId: string; records: SchoolStudentRecord[]; enabled: boolean; multiEnabled: boolean } | null>(null);
  const [multiMode, setMultiMode] = useState(false);
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [multiPreview, setMultiPreview] = useState<MultiClassRemovalPreview | null>(null);
  const [multiChallenge, setMultiChallenge] = useState('');
  const [multiCode, setMultiCode] = useState('');
  const [multiConfirmation, setMultiConfirmation] = useState('');
  const [multiCooldown, setMultiCooldown] = useState(0);
  const [selected, setSelected] = useState(ALL_CLASSES);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [remove, setRemove] = useState<SchoolStudentRecord | null>(null);
  const [preview, setPreview] = useState<{ className: string; studentCount: number; relationCount: number; preservedAccounts: number; removableAccounts: number; appointmentCount: number; qrCount: number; snapshot: string } | null>(null);
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const multiGuard = useRef<MultiClassChallengeGuard | null>(null);
  const load = async () => {
    const revision = ++generation.current;
    const result = await api.getManagedStudentRecords(schoolId);
    if (revision === generation.current) setData({ schoolId, records: result.records, enabled: result.classBulkDeleteEnabled, multiEnabled: result.classBulkDeleteEnabled && result.classMultiDeleteEnabled === true });
  };
  useEffect(() => {
    let active = true;
    const guard = new MultiClassChallengeGuard(id => api.cancelMultiClassRemoval(schoolId, id));
    multiGuard.current = guard;
    setData(null); setSelected(ALL_CLASSES); setSearch(''); setPage(0); setError(''); setExpanded(null); setFilter('all');
    setMultiMode(false); setSelectedClasses([]); setMultiPreview(null); setMultiChallenge(''); setMultiCode(''); setMultiConfirmation(''); setMultiCooldown(0);
    void load().catch(() => { if (active) setError('Öğrenci kayıtları alınamadı.'); });
    return () => { active = false; generation.current += 1; guard.dispose(); };
  }, [schoolId, revision]);
  useEffect(() => {
    if (data && selected !== ALL_CLASSES && !data.records.some((record) => record.className === selected)) setSelected(ALL_CLASSES);
  }, [data, selected]);
  useEffect(() => {
    if (multiCooldown <= 0) return;
    const timer = window.setInterval(() => setMultiCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [multiCooldown]);
  const records = data?.schoolId === schoolId ? data.records : [];
  const classes = useMemo(() => classSummaries(records), [records]);
  const classGroups = useMemo(() => {
    const groups = new Map<string, typeof classes>();
    for (const item of classes) {
      const grade = /^(\d+)/.exec(item.className)?.[1];
      const group = grade ? `${grade}. sınıflar` : 'Diğer sınıflar';
      groups.set(group, [...(groups.get(group) || []), item]);
    }
    return groups;
  }, [classes]);
  const query = search.trim().toLocaleLowerCase('tr-TR');
  const visible = useMemo(() => records.filter((r) => (selected === ALL_CLASSES || r.className === selected) &&
    (filter === 'all' || (filter === 'active' && r.parents.some((p) => p.status === 'active')) || (filter === 'pending' && r.parents.some((p) => p.status === 'pending')) || (filter === 'missing' && studentRecordIssues(r).length > 0)) &&
    [r.name, r.studentNumber, r.className, ...r.parents.flatMap((p) => [p.fullName, p.phone])].join(' ').toLocaleLowerCase('tr-TR').includes(query)), [records, selected, filter, query]);
  const pages = Math.max(1, Math.ceil(visible.length / 25));
  const currentPage = Math.min(page, pages - 1);
  const refresh = async () => { await onChanged(); await load(); setPage(0); };
  const act = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setSuccess('');
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const label = (value: string) => value.replace('-', '/');
  const closeMultiPreview = () => void act(async () => {
    try { await multiGuard.current?.cancel(); }
    catch { throw new Error('Kodun iptali sunucuda doğrulanamadı. Yeniden deneyin. Kod, sunucudaki 5 dakikalık süresi dolana kadar geçerli olabilir.'); }
    setMultiPreview(null); setMultiChallenge(''); setMultiCode(''); setMultiConfirmation('');
  });
  const classButton = (className: string, count: number) => <button type="button" key={className}
    className={`student-class-card class-tone-${className === ALL_CLASSES ? 'purple' : classTone(className)}`}
    style={classCardColors(className, className === ALL_CLASSES)}
    disabled={busy || (multiMode && className === ALL_CLASSES)}
    aria-pressed={multiMode ? selectedClasses.includes(className) : selected === className} onClick={() => {
      if (multiMode) { if (className !== ALL_CLASSES) setSelectedClasses(previous => previous.includes(className) ? previous.filter(name => name !== className) : [...previous, className].sort()); }
      else { setSelected(className); setPage(0); }
    }}>
    <span className="student-class-icon" aria-hidden="true">{multiMode && selectedClasses.includes(className) ? <Check size={18} /> : <Users size={18} />}</span><strong>{className === ALL_CLASSES ? 'Tüm sınıflar' : label(className)}</strong><span className="student-class-count">{count} öğrenci</span>
  </button>;
  return <section className="management-section" aria-label="Öğrenci ve veli yönetimi">
    <div className="section-heading"><div><h3>Öğrenciler ve veliler</h3><p>{schoolName} · {records.length} öğrenci</p></div><Button onClick={onImport}><Plus size={18} aria-hidden="true" />Kayıt ekle</Button></div>
    {error && <Alert tone="danger">{error}</Alert>}
    {success && <Alert tone="success">{success}</Alert>}
    {!data && !error ? <Skeleton /> : <>
      <div className="class-selection-toolbar"><p className="text-sm font-semibold text-slate-700">{multiMode ? 'Silinecek sınıfları tek tek seçin' : 'Sınıf seçin'}</p>{data?.multiEnabled && <Button variant="secondary" disabled={busy} aria-pressed={multiMode} onClick={() => { setMultiMode(value => !value); setSelectedClasses([]); }}>{multiMode ? 'Seçimi iptal et' : 'Toplu silme modu'}</Button>}</div>
      <div className="student-class-all">{classButton(ALL_CLASSES, records.length)}</div>
      <div className="student-class-groups" role="group" aria-label="Sınıflar">{[...classGroups].map(([group, items]) => <div key={group} className="student-class-grid" style={{ '--class-count': items.length } as React.CSSProperties} role="group" aria-label={group}>{items.map((c) => classButton(c.className, c.count))}</div>)}</div>
      {multiMode && <div className="class-removal-actions" aria-label="Çoklu sınıf seçimi"><p role="status">{selectedClasses.length ? selectedClasses.map(label).join(', ') : 'Henüz sınıf seçilmedi'} · {classes.filter(item => selectedClasses.includes(item.className)).reduce((total, item) => total + item.count, 0)} öğrenci</p><Button variant="danger" disabled={busy || selectedClasses.length < 2} onClick={() => void act(async () => {
        setMultiPreview(await api.previewMultiClassRemoval(schoolId, selectedClasses)); setMultiChallenge(''); setMultiCode(''); setMultiConfirmation('');
      })}><Trash2 size={18} aria-hidden="true" />Seçili Sınıfları Sil</Button><p className="text-sm text-slate-600">En az iki ayrı sınıf seçin. Tüm sınıflar otomatik seçilmez.</p></div>}
      {!multiMode && data?.enabled && selected !== ALL_CLASSES && classes.some((c) => c.className === selected) && <div className="class-removal-actions"><Button variant="danger" onClick={() => void act(async () => {
        setPreview(await api.previewClassRemoval(schoolId, selected)); setChallengeId(''); setCode(''); setConfirmation('');
      })} disabled={busy}><Trash2 size={18} aria-hidden="true" />Sınıfı ve Öğrencileri Sil</Button></div>}
      <div className="student-list-filters">
      <label className="field" htmlFor="student-record-search">Öğrenci veya veli ara<div className="field-icon"><Search size={18} aria-hidden="true" /><input id="student-record-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Ad, öğrenci numarası veya telefon" /></div></label>
      <label className="field management-filter">Kayıt filtresi<select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}><option value="all">Tüm kayıtlar</option><option value="pending">Veli hesabı bekleyenler</option><option value="active">Aktif veli hesabı bulunanlar</option><option value="missing">Eksik bilgisi bulunanlar</option></select></label>
      </div>
      <p role="status" className="text-sm text-slate-600">{visible.length} öğrenci listeleniyor.</p>
      <div className="management-list"><table className="management-table"><thead><tr><th>Öğrenci</th><th>Sınıf / No</th><th>Veli</th><th>Telefon</th><th>Hesap durumu</th><th>İşlemler</th></tr></thead><tbody>{visible.slice(currentPage * 25, currentPage * 25 + 25).map((r) => {
        const key = `${r.kind}:${r.id}`, parent = r.parents[0], active = r.parents.some((p) => p.status === 'active'), pendingParent = r.parents.some((p) => p.status === 'pending');
        return <React.Fragment key={key}><tr className="student-record-row"><td data-label="Öğrenci"><strong>{r.name}</strong></td><td data-label="Sınıf / No">{label(r.className)} · {r.studentNumber || '—'}</td><td data-label="Veli">{parent?.fullName || 'Bağlantı yok'}{r.parents.length > 1 && <small> +{r.parents.length - 1} veli</small>}</td><td data-label="Telefon">{parent?.phone || '—'}</td><td data-label="Hesap durumu"><span className={`status-badge tone-${active ? 'success' : 'warning'}`}>{active ? 'Aktif veli' : pendingParent ? 'Hesap bekliyor' : parent?.status === 'deleted' ? 'Hesap silindi' : parent?.status === 'unlinked' ? 'Öğrenci bağlantısı bekliyor' : 'Bağlantı etkin değil'}</span></td><td data-label="İşlemler"><div className="record-actions">
          {r.kind === 'student' && <ManagementActions compact schoolId={schoolId} kind="student" id={r.id} values={{ name: r.name, className: r.className, studentNumber: r.studentNumber, ...(r.birthDate ? { birthDate: r.birthDate } : {}) }} onChanged={refresh} showRemove={false} />}
          {r.kind === 'roster' && parent?.rosterId && parent.status !== 'deleted' && <ManagementActions compact schoolId={schoolId} kind="roster" id={parent.rosterId} values={{ studentName: r.name, className: r.className, studentNumber: r.studentNumber, parentName: parent.fullName, parentPhone: parent.phone, ...(r.birthDate ? { birthDate: r.birthDate } : {}) }} onChanged={refresh} showRemove={false} />}
          <RecordAction label={`${r.name} adlı öğrencinin veli ayrıntılarını göster`} icon={ChevronDown} aria-expanded={expanded === key} onClick={() => setExpanded(expanded === key ? null : key)} />
          <RecordAction danger label={`${r.name} adlı öğrenciyi sil`} icon={Trash2} onClick={() => { setError(''); setRemove(r); }} />
        </div></td></tr>{expanded === key && <tr className="record-detail-row"><td colSpan={6}><div className="record-detail">{studentRecordIssues(r).length > 0 && <Alert tone="warning">{studentRecordIssues(r).join(' · ')}</Alert>}{r.parents.map((p, i) => <div className="record-detail-person" key={p.id || p.rosterId || i}><div><strong>{p.fullName}</strong><p>{p.phone || '—'} · {p.status === 'active' ? 'Aktif veli' : p.status === 'pending' ? 'Hesap oluşturmadı' : p.status === 'deleted' ? 'Hesap silindi' : p.status === 'unlinked' ? 'Öğrenci bağlantısı tamamlanmamış' : 'Üyelik etkin değil'}</p></div>
          {p.id && <ManagementActions compact schoolId={schoolId} kind="parent" id={p.id} values={{ fullName: p.fullName, phone: p.phone }} onChanged={refresh} showRemove={false} />}
          {p.rosterId && p.status !== 'deleted' && <ManagementActions compact schoolId={schoolId} kind="roster" id={p.rosterId} values={{ studentName: r.name, className: r.className, studentNumber: r.studentNumber, parentName: p.fullName, parentPhone: p.phone, ...(r.birthDate ? { birthDate: r.birthDate } : {}) }} onChanged={refresh} showRemove={false} />}
        </div>)}</div></td></tr>}</React.Fragment>;
      })}</tbody></table></div>
      {!visible.length && <Alert>Bu seçimde öğrenci kaydı bulunmuyor.</Alert>}
      {pages > 1 && <nav className="flex flex-wrap gap-3 items-center" aria-label="Öğrenci sayfaları"><Button variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Önceki</Button><span>{currentPage + 1} / {pages}</span><Button variant="secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sonraki</Button></nav>}
    </>}
    {multiPreview && <Dialog title="Seçili sınıfları kalıcı sil" onClose={closeMultiPreview} dismissible={!busy}>
      <div className="form-stack"><p className="font-bold">{schoolName}</p><Alert tone="warning">Seçili sınıfların öğrencileri, veli bağlantıları, bağlı geçmiş ve gelecek randevuları, QR ve bildirim kayıtları kalıcı olarak silinecek. Diğer sınıf, okul veya rollere bağlı veli hesapları korunacak. İşlem geri alınamaz.</Alert>
        {error && <Alert tone="danger">{error}</Alert>}
        <dl className="record-detail"><div><dt>Seçili sınıflar</dt><dd>{multiPreview.classNames.map(label).join(', ')}</dd></div><div><dt>Silinecek öğrenci / veli bağlantısı</dt><dd>{multiPreview.studentCount} / {multiPreview.relationCount}</dd></div><div><dt>Silinebilecek / korunacak veli hesabı</dt><dd>{multiPreview.removableAccounts} / {multiPreview.preservedAccounts}</dd></div><div><dt>Geçmiş ve gelecek tüm randevular / QR</dt><dd>{multiPreview.appointmentCount} / {multiPreview.qrCount}</dd></div><div><dt>Bildirim / push teslimat kaydı</dt><dd>{multiPreview.notificationCount} / {multiPreview.deliveryCount}</dd></div></dl>
        <label className="field">Onaylamak için {MULTI_CLASS_CONFIRMATION} yazın<input value={multiConfirmation} onChange={event => setMultiConfirmation(event.target.value)} autoComplete="off" disabled={busy || !!multiChallenge} /></label>
        {!multiChallenge && multiCooldown > 0 && <p role="status">Yeni kod için {multiCooldown} saniye bekleyin.</p>}
        {!multiChallenge ? <Button variant="danger" disabled={busy || multiCooldown > 0 || multiConfirmation !== MULTI_CLASS_CONFIRMATION} onClick={() => void act(async () => {
          const guard = multiGuard.current;
          const result = await api.requestMultiClassRemovalCode(schoolId, multiPreview.classNames, multiPreview.snapshot, multiConfirmation);
          guard?.attach(result.challengeId);
          if (guard?.isDisposed || guard !== multiGuard.current) return;
          setMultiChallenge(result.challengeId); setMultiCooldown(result.resendAfterSeconds);
        })}>Kapsamı onayla ve kendi WhatsApp telefonuma tek kod gönder</Button> : <>
          <p className="text-sm">Kod 5 dakika geçerlidir. Seçimi değiştirmek kodu geçersiz kılar.</p>
          <label className="field">Çoklu silme WhatsApp kodu<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={multiCode} onChange={event => setMultiCode(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} /></label>
          <Button variant="danger" disabled={busy || !/^\d{6}$/.test(multiCode) || multiConfirmation !== MULTI_CLASS_CONFIRMATION} onClick={() => void act(async () => {
            const result = await api.completeMultiClassRemoval(schoolId, multiPreview.classNames, multiChallenge, multiCode, multiConfirmation);
            multiGuard.current?.forget(multiChallenge);
            setMultiPreview(null); setMultiChallenge(''); setSelectedClasses([]); setMultiMode(false); setSelected(ALL_CLASSES);
            await refresh(); setSuccess('Seçili sınıflar kalıcı olarak silindi. Silinen öğrenci: ' + result.removedCount + ' · Korunan veli hesabı: ' + result.preservedAccounts + ' · Silinen veli hesabı: ' + result.removedAccounts);
          })}>Tek kodla doğrula ve seçili sınıfları sil</Button>
          <Button variant="secondary" disabled={busy || multiCooldown > 0} onClick={() => void act(async () => {
            const guard = multiGuard.current;
            const result = await api.requestMultiClassRemovalCode(schoolId, multiPreview.classNames, multiPreview.snapshot, multiConfirmation);
            guard?.attach(result.challengeId);
            if (guard?.isDisposed || guard !== multiGuard.current) return;
            setMultiChallenge(result.challengeId); setMultiCode(''); setMultiCooldown(result.resendAfterSeconds);
          })}>{multiCooldown > 0 ? `Yeniden gönder (${multiCooldown})` : 'Tek kodu yeniden gönder'}</Button>
        </>}
        <Button variant="secondary" disabled={busy} onClick={closeMultiPreview}>Vazgeç ve doğrulamayı iptal et</Button>
      </div>
    </Dialog>}
    {remove && <Dialog title="Öğrenciyi okuldan kaldır" onClose={() => { if (!busy) setRemove(null); }} dismissible={!busy}>
      <div className="form-stack"><Alert tone="warning">{remove.name} · {label(remove.className)} okul kaydı ve veli-öğrenci eşleşmeleri kaldırılacak. Veli hesapları ve geçmiş randevular korunacak. Gelecek randevular iptal edilecek.</Alert>{error && <Alert tone="danger">{error}</Alert>}
        <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setRemove(null)}>Vazgeç</Button><Button variant="danger" disabled={busy} onClick={() => void act(async () => {
          if (remove.kind === 'student') await api.removeStudent(schoolId, remove.id); else await api.removePendingStudent(schoolId, remove.id);
          setRemove(null); await refresh(); setSuccess('Öğrenci okuldan kaldırıldı. Veli hesapları ve geçmiş randevular korundu.');
        })}>Kaldırmayı onayla</Button></div></div>
    </Dialog>}
    {preview && <Dialog title={`${label(preview.className)} — Kalıcı sınıf silme`} onClose={() => { if (!busy) setPreview(null); }} dismissible={!busy}>
      <div className="form-stack"><p className="font-bold">{schoolName}</p><Alert tone="warning">Bu işlem sınıfı ve öğrencilerini kalıcı olarak silecektir. Başka sınıfta öğrencisi bulunan velilerin hesapları korunacaktır. İşlem geri alınamaz.</Alert>
        {error && <Alert tone="danger">{error}</Alert>}
        <dl className="record-detail"><div><dt>Sınıf / öğrenci</dt><dd>{label(preview.className)} · {preview.studentCount}</dd></div><div><dt>Veli–öğrenci bağlantısı</dt><dd>{preview.relationCount}</dd></div><div><dt>Korunacak veli hesabı</dt><dd>{preview.preservedAccounts}</dd></div><div><dt>Silinebilecek veli hesabı</dt><dd>{preview.removableAccounts}</dd></div><div><dt>Silinecek randevu / QR</dt><dd>{preview.appointmentCount} / {preview.qrCount}</dd></div></dl>
        <label className="field">Onaylamak için {label(preview.className)} yazın<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={busy || !!challengeId} /></label>
        {!challengeId ? <Button variant="danger" disabled={busy || normalizeClassName(confirmation) !== preview.className} onClick={() => void act(async () => {
          const result = await api.requestClassRemovalCode(schoolId, preview.className, preview.snapshot, confirmation); setChallengeId(result.challengeId);
        })}>Kapsamı onayla ve kendi WhatsApp telefonuma kod gönder</Button> : <>
          <label className="field">WhatsApp doğrulama kodu<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
          <Button variant="danger" disabled={busy || !/^\d{6}$/.test(code) || normalizeClassName(confirmation) !== preview.className} onClick={() => void act(async () => {
            const result = await api.completeClassRemoval(schoolId, preview.className, challengeId, code, normalizeClassName(confirmation)!);
            setPreview(null); setSelected(ALL_CLASSES); await refresh(); setSuccess('Sınıf ve öğrencileri başarıyla kalıcı olarak silindi. Sınıf: ' + label(preview.className) + ' · Silinen öğrenci: ' + result.removedCount + ' · Korunan veli hesabı: ' + result.preservedAccounts + ' · Kaldırılan veli hesabı: ' + result.removedAccounts);
          })}>Doğrula ve kalıcı olarak sil</Button>
        </>}
      </div>
    </Dialog>}
  </section>;
}
