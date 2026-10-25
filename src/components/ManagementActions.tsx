import React, { useRef, useState } from 'react';
import { Alert, Button, Dialog } from './ui';
import { api } from '../services/api';
import { displayStoredTurkishPhone, formatTurkishPhoneInput, isValidTurkishPhoneInput } from '../utils/phone';
import { formatBirthDateInput, formatIsoBirthDateForInput, parseBirthDateInputToIso } from '../utils/birth-date';
import { uppercasePersonNameInput } from '../utils/person-name';

interface Props {
  schoolId: string;
  kind: 'teacher' | 'parent' | 'student' | 'security' | 'roster';
  id: string;
  values: Record<string, string>;
  onChanged: () => Promise<void>;
  showRemove?: boolean;
}

const titles = { teacher: 'Öğretmen', parent: 'Veli', student: 'Öğrenci', security: 'Güvenlik personeli', roster: 'Veli ve öğrenci kütüğü' };
const labels: Record<string, string> = { fullName: 'Ad Soyad', name: 'Öğrenci Ad Soyad', phone: 'Telefon', email: 'E-posta', parentName: 'Veli Ad Soyad', parentPhone: 'Veli Telefon', studentName: 'Öğrenci Ad Soyad', branch: 'Branş', className: 'Sınıf', studentNumber: 'Okul No', birthDate: 'Doğum Tarihi' };

export function ManagementActions({ schoolId, kind, id, values, onChanged, showRemove = true }: Props) {
  const [mode, setMode] = useState<'edit' | 'remove' | null>(null);
  const initialDraft = Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
    key === 'phone' || key === 'parentPhone' ? displayStoredTurkishPhone(value) : key === 'birthDate' ? formatIsoBirthDateForInput(value) : value]));
  const [draft, setDraft] = useState(initialDraft);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [studentImpact, setStudentImpact] = useState<{ studentName: string; siblingAccounts: number; preservedAccounts: number; deletedAccounts: number } | null>(null);
  const openRemoval = async () => {
    setError(''); setSuccess(''); setStudentImpact(null); setMode('remove');
    if (kind === 'student') {
      try { setStudentImpact(await api.previewStudentRemoval(schoolId, id)); }
      catch { setError('Silme etkisi belirlenemedi. Lütfen tekrar deneyin.'); }
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (mode === 'remove' && kind === 'student') await api.removeStudent(schoolId, id);
      else if (mode === 'remove') await api.removeManagedRecord(schoolId, kind, id);
      else {
        if (['phone', 'parentPhone'].some((key) => key in draft && !isValidTurkishPhoneInput(draft[key]))) throw new Error('Telefonu 0XXX XXX XX XX biçiminde girin.');
        const birthDate = draft.birthDate ? parseBirthDateInputToIso(draft.birthDate) : null;
        if (draft.birthDate && !birthDate) throw new Error('Doğum tarihini GG/AA/YYYY biçiminde kontrol edin.');
        await api.updateManagedRecord(schoolId, kind, id, { ...draft, ...('birthDate' in draft ? { birthDate: birthDate || '' } : {}) });
      }
      await onChanged();
      setMode(null);
      setSuccess(mode === 'remove' ? kind === 'student' ? 'Öğrenci okuldan kaldırıldı.' : kind === 'teacher' ? 'Öğretmen ve ilişkili kayıtlar sistemden silindi.' : 'Okul erişimi kaldırıldı.' : 'Bilgiler güncellendi.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.');
    } finally { pending.current = false; setBusy(false); }
  };
  return <div className="mt-3">
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => { setDraft(initialDraft); setError(''); setSuccess(''); setMode('edit'); }}>Düzenle</Button>
      {showRemove && kind !== 'roster' && <Button variant="danger" onClick={() => { void openRemoval(); }}>{kind === 'student' ? 'Öğrenciyi okuldan kaldır' : 'Okuldan Kaldır'}</Button>}
    </div>
    {success && <p role="status" className="text-sm mt-2">{success}</p>}
    {mode && <Dialog title={`${titles[kind]} — ${mode === 'edit' ? 'Bilgileri düzenle' : 'Okuldan kaldır'}`} onClose={() => { if (!busy) setMode(null); }} dismissible={!busy}>
      <form onSubmit={submit} className="form-stack">
        {mode === 'remove' ? <Alert tone="warning">{kind === 'student' ? studentImpact ? <>{studentImpact.studentName} okul kaydı ve veli-öğrenci eşleşmeleri kaldırılacak. Veli hesapları ve geçmiş randevular korunacak; gelecekteki randevular iptal edilecektir.</> : 'Silme etkisi kontrol ediliyor…' : kind === 'teacher' ? 'Bu öğretmen sistemden kaldırılacaktır. Öğretmene ait randevular, müsaitlik bilgileri ve personel kayıtları silinecektir. Bu işlem geri alınamaz. Devam etmek istiyor musunuz?' : 'Bu kişinin bu okuldaki erişimi kaldırılacak. Geçmiş randevular ve diğer okul üyelikleri korunur. Devam etmek istiyor musunuz?'}</Alert> :
          Object.entries(draft).map(([key, value]) => <label className="field" key={key}>{labels[key]}
            <input type={key === 'phone' || key === 'parentPhone' ? 'tel' : key === 'email' ? 'email' : 'text'} inputMode={key === 'phone' || key === 'parentPhone' || key === 'birthDate' ? 'numeric' : undefined} placeholder={key === 'birthDate' ? 'GG/AA/YYYY' : key === 'phone' || key === 'parentPhone' ? '0543 222 22 22' : undefined} required={key !== 'studentNumber' && key !== 'birthDate'} value={value}
              maxLength={key === 'phone' || key === 'parentPhone' ? 14 : key === 'birthDate' ? 10 : key === 'className' || key === 'studentNumber' ? 50 : key === 'branch' ? 100 : 150}
              onChange={(event) => setDraft({ ...draft, [key]: key === 'phone' || key === 'parentPhone' ? formatTurkishPhoneInput(event.target.value) : key === 'birthDate' ? formatBirthDateInput(event.target.value) : ['fullName', 'name', 'parentName', 'studentName'].includes(key) ? uppercasePersonNameInput(event.target.value) : event.target.value })} />
          </label>)}
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => setMode(null)}>Vazgeç</Button>
          <Button type="submit" variant={mode === 'remove' ? 'danger' : 'primary'} disabled={busy || (mode === 'remove' && kind === 'student' && !studentImpact)}>{busy ? 'Kaydediliyor…' : mode === 'remove' ? 'Kaldırmayı onayla' : 'Değişiklikleri Kaydet'}</Button></div>
      </form>
    </Dialog>}
  </div>;
}
