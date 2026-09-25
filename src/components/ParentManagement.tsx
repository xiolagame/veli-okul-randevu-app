import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { ManagedParent } from '../types/management';
import { ManagementActions } from './ManagementActions';
import { Alert, Button, Skeleton } from './ui';
import { SchoolRosterRecord } from '../types';
import { normalizeTurkishPhone } from '../utils/phone';

export function ParentManagement({ schoolId, roster, search, onIssue, onChanged }: {
  schoolId: string; roster: SchoolRosterRecord[]; search: string;
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
  return <div className="grid gap-4 lg:grid-cols-2">{parents.filter((parent) =>
    [parent.fullName, parent.phone, ...parent.students.flatMap((student) => [student.name, student.className, student.studentNumber])]
      .join(' ').toLocaleLowerCase('tr-TR').includes(query)
  ).map((parent) => <article className="surface" key={parent.id}>
    <h3>{parent.fullName}</h3><p>{parent.phone}</p><p>{parent.status === 'active' ? 'Aktif veli' : 'Okul erişimi kapalı'}</p>
    <ManagementActions schoolId={schoolId} kind="parent" id={parent.id} values={{ fullName: parent.fullName, phone: parent.phone }} onChanged={refresh} />
    {parent.status === 'active' && roster.some((record) => normalizeTurkishPhone(record.parentPhone) === normalizeTurkishPhone(parent.phone)) &&
      <Button variant="secondary" className="mt-3" onClick={() => {
        const record = roster.find((entry) => normalizeTurkishPhone(entry.parentPhone) === normalizeTurkishPhone(parent.phone));
        if (record) onIssue(record);
      }}>Parola sıfırlama kodu</Button>}
    {parent.students.map((student) => <section key={student.id} className="border-t mt-4 pt-4">
      <h4>{student.name}</h4><p>{student.className} · No {student.studentNumber || '—'}</p>
      <ManagementActions schoolId={schoolId} kind="student" id={student.id} values={{ name: student.name, className: student.className, studentNumber: student.studentNumber }} onChanged={refresh} />
    </section>)}
  </article>)}</div>;
}
