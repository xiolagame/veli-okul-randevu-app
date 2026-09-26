import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { ManagedParent } from '../types/management';
import { ManagementActions } from './ManagementActions';
import { Alert, Button, Skeleton } from './ui';
import { SchoolRosterRecord } from '../types';
import { normalizeTurkishPhone } from '../utils/phone';
import { parentsInClass } from '../utils/admin-filters';

export function ParentManagement({ schoolId, roster, search, selectedClass, onClassesChange, onIssue, onChanged }: {
  schoolId: string; roster: SchoolRosterRecord[]; search: string;
  selectedClass: string; onClassesChange: (classes: string[]) => void;
  onIssue: (record: SchoolRosterRecord) => void; onChanged: () => Promise<void>;
}) {
  const [parents, setParents] = useState<ManagedParent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    const result = await api.getManagedParents(schoolId);
    setParents(result.parents);
  }, [schoolId]);
  useEffect(() => {
    onClassesChange([...new Set(parents.flatMap((parent) => parent.students.map((student) => student.className)))]);
  }, [parents, onClassesChange]);
  useEffect(() => {
    let cancelled = false;
    api.getManagedParents(schoolId).then((result) => { if (!cancelled) setParents(result.parents); })
      .catch(() => { if (!cancelled) setError('Veli bilgileri yüklenemedi.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [schoolId]);
  if (loading) return <Skeleton />;
  if (error) return <Alert tone="danger">{error}<Button onClick={() => { void load().catch(() => setError('Veli bilgileri yüklenemedi.')); }}>Tekrar dene</Button></Alert>;
  const refresh = async () => { await load(); await onChanged(); };
  const query = search.trim().toLocaleLowerCase('tr-TR');
  if (!selectedClass) return <Alert>Öğrenci ve veli kayıtlarını görmek için önce sınıf seçin.</Alert>;
  const visibleParents = parentsInClass(parents, selectedClass).filter((parent) =>
    [parent.fullName, parent.phone, ...parent.students.flatMap((student) => [student.name, student.className, student.studentNumber])]
      .join(' ').toLocaleLowerCase('tr-TR').includes(query)
  );
  if (!visibleParents.length) return <Alert>Bu sınıfta aramanıza uygun aktif hesap kaydı bulunamadı. Bekleyen kütük kayıtları aşağıdadır.</Alert>;
  return <div className="grid gap-4 lg:grid-cols-2">{visibleParents.map((parent) => <article className="surface" key={parent.id}>
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold text-slate-900">{parent.fullName}</h3><p className="mt-1 text-sm text-slate-600">{parent.phone}</p></div><span className={`status-badge tone-${parent.status === 'active' ? 'success' : 'neutral'}`}>{parent.status === 'active' ? 'Aktif' : 'Devre dışı'}</span></header>
    <ManagementActions schoolId={schoolId} kind="parent" id={parent.id} values={{ fullName: parent.fullName, phone: parent.phone }} onChanged={refresh} />
    {parent.status === 'active' && roster.some((record) => normalizeTurkishPhone(record.parentPhone) === normalizeTurkishPhone(parent.phone)) &&
      <Button variant="secondary" className="mt-3" onClick={() => {
        const record = roster.find((entry) => normalizeTurkishPhone(entry.parentPhone) === normalizeTurkishPhone(parent.phone));
        if (record) onIssue(record);
      }}>Parola sıfırlama kodu</Button>}
    {parent.students.length > 0 && <section className="mt-5 border-t border-slate-200 pt-4"><p className="mb-3 text-sm font-semibold text-slate-700">Öğrencileri</p><div className="space-y-3">{parent.students.map((student) => <div key={student.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h4 className="text-base font-bold text-slate-900">{student.name}</h4><p className="mt-1 text-sm text-slate-600">{student.className} · No {student.studentNumber || '—'}</p>
      <ManagementActions schoolId={schoolId} kind="student" id={student.id} values={{ name: student.name, className: student.className, studentNumber: student.studentNumber || '', birthDate: student.birthDate || '' }} onChanged={refresh} />
    </div>)}</div></section>}
  </article>)}</div>;
}
