import React, { useEffect, useRef, useState } from 'react';
import { Search, Users, Trash2, Plus, ChevronDown } from 'lucide-react';
import { api } from '../services/api';
import { ALL_CLASSES, classSummaries, classTone, SchoolStudentRecord, studentRecordIssues } from '../utils/student-records';
import { normalizeClassName } from '../utils/class-name';
import { Alert, Button, Dialog, RecordAction, Skeleton } from './ui';
import { ManagementActions } from './ManagementActions';

export function StudentManagement({ schoolId, schoolName, onChanged, onImport, revision = 0 }: {
  schoolId: string; schoolName: string; onChanged: () => Promise<void>; onImport: () => void; revision?: number;
}) {
  const [data, setData] = useState<{ schoolId: string; records: SchoolStudentRecord[]; enabled: boolean } | null>(null);
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
  const load = async () => {
    const revision = ++generation.current;
    const result = await api.getManagedStudentRecords(schoolId);
    if (revision === generation.current) setData({ schoolId, records: result.records, enabled: result.classBulkDeleteEnabled });
  };
  useEffect(() => {
    let active = true;
    setData(null); setSelected(ALL_CLASSES); setSearch(''); setPage(0); setError(''); setExpanded(null); setFilter('all');
    void load().catch(() => { if (active) setError('Öğrenci kayıtları alınamadı.'); });
    return () => { active = false; generation.current += 1; };
  }, [schoolId, revision]);
  useEffect(() => {
    if (data && selected !== ALL_CLASSES && !data.records.some((record) => record.className === selected)) setSelected(ALL_CLASSES);
  }, [data, selected]);
  const records = data?.schoolId === schoolId ? data.records : [];
  const classes = classSummaries(records);
  const classGroups = new Map<string, typeof classes>();
  for (const item of classes) {
    const grade = /^(\d+)/.exec(item.className)?.[1];
    const group = grade ? `${grade}. sınıflar` : 'Diğer sınıflar';
    classGroups.set(group, [...(classGroups.get(group) || []), item]);
  }
  const query = search.trim().toLocaleLowerCase('tr-TR');
  const visible = records.filter((r) => (selected === ALL_CLASSES || r.className === selected) &&
    (filter === 'all' || (filter === 'active' && r.parents.some((p) => p.status === 'active')) || (filter === 'pending' && r.parents.some((p) => p.status === 'pending')) || (filter === 'missing' && studentRecordIssues(r).length > 0)) &&
    [r.name, r.studentNumber, r.className, ...r.parents.flatMap((p) => [p.fullName, p.phone])].join(' ').toLocaleLowerCase('tr-TR').includes(query));
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
  const classButton = (className: string, count: number) => <button type="button" key={className}
    className={`student-class-card class-tone-${className === ALL_CLASSES ? 'purple' : classTone(className)}`}
    aria-pressed={selected === className} onClick={() => { setSelected(className); setPage(0); }}>
    <span className="student-class-icon" aria-hidden="true"><Users size={18} /></span><strong>{className === ALL_CLASSES ? 'Tüm sınıflar' : label(className)}</strong><span className="student-class-count">{count} öğrenci</span>
  </button>;
  return <section className="management-section" aria-label="Öğrenci ve veli yönetimi">
    <div className="section-heading"><div><h3>Öğrenciler ve veliler</h3><p>{schoolName} · {records.length} öğrenci</p></div><Button onClick={onImport}><Plus size={18} aria-hidden="true" />Kayıt ekle</Button></div>
    {error && <Alert tone="danger">{error}</Alert>}
    {success && <Alert tone="success">{success}</Alert>}
    {!data && !error ? <Skeleton /> : <>
      <div className="space-y-2"><p className="text-sm font-semibold text-slate-700">Sınıf seçin</p><div className="student-class-all">{classButton(ALL_CLASSES, records.length)}</div></div>
      <div className="student-class-groups" role="group" aria-label="Sınıflar">{[...classGroups].map(([group, items]) => <div key={group} className="student-class-grid" style={{ '--class-count': items.length } as React.CSSProperties} role="group" aria-label={group}>{items.map((c) => classButton(c.className, c.count))}</div>)}</div>
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
      {data?.enabled && selected !== ALL_CLASSES && classes.some((c) => c.className === selected) && <Button variant="danger" onClick={() => void act(async () => {
        setPreview(await api.previewClassRemoval(schoolId, selected)); setChallengeId(''); setCode(''); setConfirmation('');
      })} disabled={busy}><Trash2 size={18} aria-hidden="true" />Sınıfı ve Öğrencileri Sil</Button>}
    </>}
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
