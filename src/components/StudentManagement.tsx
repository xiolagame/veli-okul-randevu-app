import React, { useEffect, useRef, useState } from 'react';
import { Search, Users, Trash2, Upload } from 'lucide-react';
import { api } from '../services/api';
import { ALL_CLASSES, classSummaries, classTone, SchoolStudentRecord } from '../utils/student-records';
import { normalizeClassName } from '../utils/class-name';
import { Alert, Button, Dialog, Skeleton } from './ui';
import { ManagementActions } from './ManagementActions';

export function StudentManagement({ schoolId, schoolName, onChanged, onImport }: {
  schoolId: string; schoolName: string; onChanged: () => Promise<void>; onImport: () => void;
}) {
  const [data, setData] = useState<{ schoolId: string; records: SchoolStudentRecord[]; enabled: boolean } | null>(null);
  const [selected, setSelected] = useState(ALL_CLASSES);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [remove, setRemove] = useState<SchoolStudentRecord | null>(null);
  const [preview, setPreview] = useState<{ className: string; studentCount: number; snapshot: string } | null>(null);
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
    setData(null); setSelected(ALL_CLASSES); setSearch(''); setPage(0); setError('');
    void load().catch(() => { if (active) setError('Öğrenci kayıtları alınamadı.'); });
    return () => { active = false; generation.current += 1; };
  }, [schoolId, onChanged]);
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
  return <section className="space-y-5" aria-label="Öğrenci ve veli yönetimi">
    <div className="section-heading"><div><h3>Öğrenciler ve veliler</h3><p>{schoolName} · {records.length} öğrenci</p></div><Button onClick={onImport}><Upload size={18} aria-hidden="true" />Toplu kayıt ekle</Button></div>
    {error && <Alert tone="danger">{error}</Alert>}
    {success && <Alert tone="success">{success}</Alert>}
    {!data && !error ? <Skeleton /> : <>
      <div className="space-y-2"><p className="text-sm font-semibold text-slate-700">Sınıf seçin</p><div className="student-class-all">{classButton(ALL_CLASSES, records.length)}</div></div>
      <div className="student-class-groups" role="group" aria-label="Sınıflar">{[...classGroups].map(([group, items]) => <div key={group} className="student-class-grid" role="group" aria-label={group}>{items.map((c) => classButton(c.className, c.count))}</div>)}</div>
      <label className="field" htmlFor="student-record-search">Öğrenci veya veli ara<div className="field-icon"><Search size={18} aria-hidden="true" /><input id="student-record-search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Ad, öğrenci numarası veya telefon" /></div></label>
      <p role="status" className="text-sm text-slate-600">{visible.length} öğrenci listeleniyor.</p>
      <div className="grid gap-3 xl:grid-cols-2">{visible.slice(currentPage * 25, currentPage * 25 + 25).map((r) => <article className="surface min-w-0" key={`${r.kind}:${r.id}`}>
        <header className="flex flex-wrap justify-between gap-2"><div><h4 className="font-bold">{r.name}</h4><p className="text-sm text-slate-600">{label(r.className)} · No: {r.studentNumber || '—'}</p></div><span className={`status-badge tone-${r.kind === 'student' ? 'success' : 'warning'}`}>{r.kind === 'student' ? 'Kayıtlı öğrenci' : 'Veli hesabı bekleniyor'}</span></header>
        {r.kind === 'student' && <ManagementActions schoolId={schoolId} kind="student" id={r.id} values={{ name: r.name, className: r.className, studentNumber: r.studentNumber, ...(r.birthDate ? { birthDate: r.birthDate } : {}) }} onChanged={refresh} showRemove={false} />}
        {r.parents.map((p, i) => <div className="mt-3 border-t border-slate-200 pt-3" key={p.id || i}><p className="font-semibold">{p.fullName}</p><p className="text-sm break-words">{p.phone || '—'} · {p.status === 'active' ? 'Aktif veli' : p.status === 'pending' ? 'Hesap oluşturmadı' : p.status === 'deleted' ? 'Hesap silindi' : 'Üyelik etkin değil'}</p>
          {p.id && <ManagementActions schoolId={schoolId} kind="parent" id={p.id} values={{ fullName: p.fullName, phone: p.phone }} onChanged={refresh} showRemove={false} />}
          {p.rosterId && p.status !== 'deleted' && <ManagementActions schoolId={schoolId} kind="roster" id={p.rosterId} values={{ studentName: r.name, className: r.className, studentNumber: r.studentNumber, parentName: p.fullName, parentPhone: p.phone, ...(r.birthDate ? { birthDate: r.birthDate } : {}) }} onChanged={refresh} showRemove={false} />}
        </div>)}
        <Button className="mt-4" variant="danger" onClick={() => { setError(''); setRemove(r); }}><Trash2 size={16} aria-hidden="true" />Sil</Button>
      </article>)}</div>
      {!visible.length && <Alert>Bu seçimde öğrenci kaydı bulunmuyor.</Alert>}
      {pages > 1 && <nav className="flex flex-wrap gap-3 items-center" aria-label="Öğrenci sayfaları"><Button variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Önceki</Button><span>{currentPage + 1} / {pages}</span><Button variant="secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sonraki</Button></nav>}
      {data?.enabled && selected !== ALL_CLASSES && classes.some((c) => c.className === selected) && <Button variant="danger" onClick={() => void act(async () => {
        setPreview(await api.previewClassRemoval(schoolId, selected)); setChallengeId(''); setCode(''); setConfirmation('');
      })} disabled={busy}><Trash2 size={18} aria-hidden="true" />Toplu Sınıf Sil</Button>}
    </>}
    {remove && <Dialog title="Öğrenciyi okuldan kaldır" onClose={() => { if (!busy) setRemove(null); }} dismissible={!busy}>
      <div className="form-stack"><Alert tone="warning">{remove.name} · {label(remove.className)} okul kaydı ve veli-öğrenci eşleşmeleri kaldırılacak. Veli hesapları ve geçmiş randevular korunacak. Gelecek randevular iptal edilecek.</Alert>{error && <Alert tone="danger">{error}</Alert>}
        <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setRemove(null)}>Vazgeç</Button><Button variant="danger" disabled={busy} onClick={() => void act(async () => {
          if (remove.kind === 'student') await api.removeStudent(schoolId, remove.id); else await api.removePendingStudent(schoolId, remove.id);
          setRemove(null); await refresh(); setSuccess('Öğrenci okuldan kaldırıldı. Veli hesapları ve geçmiş randevular korundu.');
        })}>Kaldırmayı onayla</Button></div></div>
    </Dialog>}
    {preview && <Dialog title={`${label(preview.className)} — Toplu sınıf silme`} onClose={() => { if (!busy) setPreview(null); }} dismissible={!busy}>
      <div className="form-stack"><p className="font-bold">{schoolName}</p><Alert tone="warning">{label(preview.className)} sınıfındaki {preview.studentCount} öğrencinin okul kayıtları ve veli-öğrenci eşleşmeleri kaldırılacak. Velilerin kullanıcı hesapları ve geçmiş randevular korunacak. Gelecek randevular iptal edilecek. Bu işlem geri alınamayabilir.</Alert>
        {error && <Alert tone="danger">{error}</Alert>}
        {!challengeId ? <Button variant="danger" disabled={busy} onClick={() => void act(async () => {
          const result = await api.requestClassRemovalCode(schoolId, preview.className, preview.snapshot); setChallengeId(result.challengeId);
        })}>Kapsamı onayla ve kendi WhatsApp telefonuma kod gönder</Button> : <>
          <label className="field">WhatsApp doğrulama kodu<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
          <label className="field">Onaylamak için {label(preview.className)} yazın<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
          <Button variant="danger" disabled={busy || !/^\d{6}$/.test(code) || normalizeClassName(confirmation) !== preview.className} onClick={() => void act(async () => {
            await api.completeClassRemoval(schoolId, preview.className, challengeId, code, normalizeClassName(confirmation)!);
            setPreview(null); setSelected(ALL_CLASSES); await refresh(); setSuccess('Sınıf kayıtları kaldırıldı. Veli hesapları ve geçmiş randevular korundu.');
          })}>Doğrula ve sınıf kayıtlarını kaldır</Button>
        </>}
      </div>
    </Dialog>}
  </section>;
}
