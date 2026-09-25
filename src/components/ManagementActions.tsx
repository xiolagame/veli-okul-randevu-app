import React, { useRef, useState } from 'react';
import { Alert, Button, Dialog } from './ui';
import { api } from '../services/api';

interface Props {
  schoolId: string;
  kind: 'teacher' | 'parent' | 'student' | 'security' | 'roster';
  id: string;
  values: Record<string, string>;
  onChanged: () => Promise<void>;
}

const titles = { teacher: 'Öğretmen', parent: 'Veli', student: 'Öğrenci', security: 'Güvenlik personeli', roster: 'Veli ve öğrenci kütüğü' };
const labels: Record<string, string> = { fullName: 'Ad Soyad', name: 'Öğrenci Ad Soyad', phone: 'Telefon', parentName: 'Veli Ad Soyad', parentPhone: 'Veli Telefon', studentName: 'Öğrenci Ad Soyad', branch: 'Branş', className: 'Sınıf', studentNumber: 'Okul No' };

export function ManagementActions({ schoolId, kind, id, values, onChanged }: Props) {
  const [mode, setMode] = useState<'edit' | 'remove' | null>(null);
  const [draft, setDraft] = useState(values);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (mode === 'remove') await api.removeManagedRecord(schoolId, kind, id);
      else await api.updateManagedRecord(schoolId, kind, id, draft);
      await onChanged();
      setMode(null);
      setSuccess(mode === 'remove' ? 'Okul erişimi kaldırıldı.' : 'Bilgiler güncellendi.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.');
    } finally { pending.current = false; setBusy(false); }
  };
  return <div className="mt-3">
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => { setDraft(values); setError(''); setSuccess(''); setMode('edit'); }}>Düzenle</Button>
      {kind !== 'student' && kind !== 'roster' && <Button variant="quiet" onClick={() => { setError(''); setSuccess(''); setMode('remove'); }}>Okuldan Kaldır</Button>}
    </div>
    {success && <p role="status" className="text-sm mt-2">{success}</p>}
    {mode && <Dialog title={`${titles[kind]} — ${mode === 'edit' ? 'Bilgileri düzenle' : 'Okuldan kaldır'}`} onClose={() => { if (!busy) setMode(null); }} dismissible={!busy}>
      <form onSubmit={submit} className="form-stack">
        {mode === 'remove' ? <Alert tone="warning">Bu kişinin bu okuldaki erişimi kaldırılacak. Geçmiş randevular ve diğer okul üyelikleri korunur. {kind === 'teacher' && 'Bu öğretmene ait aktif randevular otomatik olarak iptal edilecektir. '}Devam etmek istiyor musunuz?</Alert> :
          Object.entries(draft).map(([key, value]) => <label className="field" key={key}>{labels[key]}
            <input type={key === 'phone' || key === 'parentPhone' ? 'tel' : 'text'} required={key !== 'studentNumber'} value={value}
              maxLength={key === 'phone' || key === 'parentPhone' ? 30 : key === 'className' || key === 'studentNumber' ? 50 : key === 'branch' ? 100 : 150}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
          </label>)}
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => setMode(null)}>Vazgeç</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Kaydediliyor…' : mode === 'remove' ? 'Kaldırmayı onayla' : 'Değişiklikleri Kaydet'}</Button></div>
      </form>
    </Dialog>}
  </div>;
}
