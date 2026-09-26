import React, { useState } from 'react';
import { Search, Shield, GraduationCap, CheckCircle2, Clock, AlertCircle, KeyRound } from 'lucide-react';
import { Alert, Button, Dialog, Skeleton } from './ui';
import { TeacherProfile, User } from '../types';
import { normalizeTurkishPhone } from '../utils/phone';
import { ManagementActions } from './ManagementActions';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { StaffDraft, validateStaffForm } from '../utils/staff-form';

export interface StaffCodeTarget {
  type: 'teacher' | 'security';
  id: string;
  label: string;
  phone: string;
}

interface StaffManagementProps {
  teachers: TeacherProfile[];
  securityUsers: User[];
  loading: boolean;
  error: string;
  onIssue: (target: StaffCodeTarget, purpose: 'ACCOUNT_ACTIVATION' | 'PASSWORD_RESET') => void;
  onCreateTeacher: (data: { fullName: string; role: 'teacher' | 'security'; branch?: string; phone: string; email: string }) => Promise<unknown>;
}

export const StaffManagement: React.FC<StaffManagementProps> = ({ teachers, securityUsers, loading, error, onIssue, onCreateTeacher }) => {
  const { currentSchool, refreshSchoolData } = useApp();
  const [search, setSearch] = useState('');
  const [showCreateTeacher, setShowCreateTeacher] = useState(false);
  const [creatingTeacher, setCreatingTeacher] = useState(false);
  const [createTeacherError, setCreateTeacherError] = useState('');
  const [fullName, setFullName] = useState('');
  const [branch, setBranch] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [staffRole, setStaffRole] = useState<StaffDraft['role']>('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof StaffDraft, string>>>({});
  const fieldError = (key: keyof StaffDraft) => fieldErrors[key] ? <span id={'staff-error-' + key} role="alert" className="text-sm text-red-700">{fieldErrors[key]}</span> : null;
  const [resendMessage, setResendMessage] = useState('');
  const query = search.trim().toLocaleLowerCase('tr-TR');

  const submitTeacher = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creatingTeacher) return;
    const errors = validateStaffForm({ role: staffRole, fullName, phone, email, branch });
    setFieldErrors(errors);
    if (Object.keys(errors).length || !staffRole) return;
    setCreatingTeacher(true);
    setCreateTeacherError('');
    try {
      await onCreateTeacher({ fullName: fullName.trim(), role: staffRole, ...(staffRole === 'teacher' ? { branch: branch.trim() } : {}), phone: normalizeTurkishPhone(phone)!, email: email.trim().toLowerCase() });
      setResendMessage('Personel kaydı oluşturuldu. Aktivasyon e-postası gönderildi.');
      setShowCreateTeacher(false);
      setFullName('');
      setBranch('');
      setPhone('');
      setEmail('');
      setStaffRole('');
    } catch (cause) {
      setCreateTeacherError(cause instanceof Error ? cause.message : 'Personel oluşturulamadı.');
    } finally {
      setCreatingTeacher(false);
    }
  };
  const sections = [
    {
      type: 'teacher' as const, title: 'Öğretmenler', Icon: GraduationCap,
      empty: 'Henüz öğretmen tanımlanmamış.',
      description: 'Okulunuzun öğretmen profilleri burada görüntülenecek.',
      records: teachers,
    },
    {
      type: 'security' as const, title: 'Güvenlik Personeli', Icon: Shield,
      empty: 'Henüz güvenlik personeli tanımlanmamış.',
      description: 'Güvenlik QR kontrolü yapacak personel burada görüntülenecek.',
      records: securityUsers,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="section-heading"><div><h3>Öğretmenler ve güvenlik</h3><p>Okulunuzun personel hesaplarını ve aktivasyon e-postalarını yönetin.</p></div></div>
      <label className="relative block">
        <span className="sr-only">Öğretmen veya güvenlik personeli ara</span>
        <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Öğretmen veya güvenlik personeli ara..."
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm" />
      </label>
      {loading && <Skeleton />}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {resendMessage && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{resendMessage}</p>}
      {!loading && !error && sections.map(({ type, title, Icon, empty, description, records }) => {
        const filtered = records.filter((record) =>
          [record.firstName, record.lastName, record.branch || '', record.phone].join(' ').toLocaleLowerCase('tr-TR').includes(query)
        );
        return (
          <section key={type} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="flex items-center gap-2 font-semibold text-slate-800"><Icon className="h-5 w-5 text-indigo-600" />{title} ({records.length})</h4>{type === 'teacher' && <Button onClick={() => { setCreateTeacherError(''); setFieldErrors({}); setShowCreateTeacher(true); }}>+ Personel Ekle</Button>}</div>
            {filtered.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
                <Icon className="mx-auto mb-3 h-8 w-8 text-slate-400" />
                <p className="font-medium text-slate-700">{records.length ? 'Aramanızla eşleşen personel bulunamadı.' : empty}</p>
                {!records.length && <p className="mt-1 text-sm text-slate-500">{description}</p>}
              </div>
            ) : <div className="grid gap-3 lg:grid-cols-2">
              {filtered.map((record) => {
                const phone = normalizeTurkishPhone(record.phone);
                const status = record.accountStatus;
                const actionable = !!phone && (status === 'pending' || status === 'active');
                const label = `${record.firstName} ${record.lastName}`.trim();
                return (
                  <article key={record.id} className="surface min-w-0">
                    <div className="flex gap-3 items-center mb-4"><h5 className="text-base font-bold text-slate-900">{label}</h5></div>
                    <p className="text-sm text-slate-500">{type === 'teacher' ? record.branch : 'Güvenlik'}</p>
                    <p className="mt-2 break-words text-sm text-slate-700">{record.phone || 'Telefon tanımlı değil'}</p>
                    <span className={`mt-3 inline-flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs font-semibold ${!phone ? 'bg-red-50 text-red-700' : status === 'active' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                      {!phone ? <AlertCircle size={15} /> : status === 'active' ? <CheckCircle2 size={15} /> : <Clock size={15} />}{!phone ? 'Telefon eksik veya geçersiz' : status === 'active' ? 'Aktif hesap' : status === 'pending' ? 'Aktivasyon bekliyor' : 'Üyelik aktif değil / Durum doğrulanamadı'}
                    </span>
                    {!phone && <p className="mt-2 text-xs text-slate-500">Aktivasyon kodu oluşturmak için geçerli telefon numarası gereklidir.</p>}
                    {currentSchool && !(type === 'security' && status === 'pending') && <ManagementActions schoolId={currentSchool.id} kind={type} id={record.id}
                      values={{ fullName: label, phone: record.phone || '', ...(type === 'teacher' ? { branch: record.branch || '' } : {}) }} onChanged={refreshSchoolData} />}
                    {status === 'pending' && currentSchool && <Button className="mt-5 w-full" disabled={!actionable} onClick={async () => {
                      try { const result = await api.resendStaffActivation(currentSchool.id, type, record.id); setResendMessage(result.message); }
                      catch (cause) { setResendMessage(cause instanceof Error ? cause.message : 'E-posta yeniden gönderilemedi.'); }
                    }}><KeyRound size={17} />Aktivasyon E-postasını Yeniden Gönder</Button>}
                  </article>
                );
              })}
            </div>}
          </section>
        );
      })}
      {showCreateTeacher && <Dialog title="Yeni Personel Ekle" description="Aktivasyon kodu yalnızca kayıtlı e-posta adresine gönderilir." onClose={() => { if (!creatingTeacher) setShowCreateTeacher(false); }} dismissible={!creatingTeacher}>
        <form className="form-stack" noValidate onSubmit={submitTeacher}>
          <label className="field">Görevi<select aria-label="Görevi" value={staffRole} required aria-invalid={!!fieldErrors.role} aria-describedby="staff-error-role" onChange={(event) => { setStaffRole(event.target.value as StaffDraft['role']); setFieldErrors({}); }}><option value="">Görev seçin</option><option value="teacher">Öğretmen</option><option value="security">Güvenlik</option></select>{fieldError('role')}</label>
          <label className="field" htmlFor="staff-teacher-name">Ad Soyad<input aria-label="Ad Soyad" id="staff-teacher-name" autoComplete="name" maxLength={150} required aria-invalid={!!fieldErrors.fullName} aria-describedby="staff-error-fullName" value={fullName} onChange={(event) => { setFullName(event.target.value); setFieldErrors((previous) => ({ ...previous, fullName: undefined })); }} />{fieldError('fullName')}</label>
          {staffRole === 'teacher' && <label className="field" htmlFor="staff-teacher-branch">Branş<input aria-label="Branş" id="staff-teacher-branch" maxLength={100} required aria-invalid={!!fieldErrors.branch} aria-describedby="staff-error-branch" value={branch} onChange={(event) => { setBranch(event.target.value); setFieldErrors((previous) => ({ ...previous, branch: undefined })); }} />{fieldError('branch')}</label>}
          <label className="field" htmlFor="staff-teacher-phone">Telefon<input aria-label="Telefon" id="staff-teacher-phone" type="tel" autoComplete="tel" placeholder="0555 123 45 67" required aria-invalid={!!fieldErrors.phone} aria-describedby="staff-error-phone" value={phone} onChange={(event) => { setPhone(event.target.value); setFieldErrors((previous) => ({ ...previous, phone: undefined })); }} />{fieldError('phone')}</label>
          <label className="field" htmlFor="staff-email">E-posta<input aria-label="E-posta" id="staff-email" type="email" autoComplete="email" maxLength={150} required aria-invalid={!!fieldErrors.email} aria-describedby="staff-error-email" value={email} onChange={(event) => { setEmail(event.target.value); setFieldErrors((previous) => ({ ...previous, email: undefined })); }} />{fieldError('email')}</label>
          {createTeacherError && <Alert tone="danger">{createTeacherError}</Alert>}
          <div className="form-actions"><Button type="button" variant="secondary" disabled={creatingTeacher} onClick={() => setShowCreateTeacher(false)}>İptal</Button><Button type="submit" disabled={creatingTeacher}>{creatingTeacher ? 'Ekleniyor…' : 'Personel Ekle'}</Button></div>
        </form>
      </Dialog>}
    </div>
  );
};
