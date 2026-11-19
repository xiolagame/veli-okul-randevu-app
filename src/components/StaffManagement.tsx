import React, { useState } from 'react';
import { Search, Shield, GraduationCap, CheckCircle2, Clock, AlertCircle, KeyRound, Download, Upload } from 'lucide-react';
import { Alert, Button, Dialog, RecordAction, Skeleton } from './ui';
import { TeacherProfile, User } from '../types';
import { formatTurkishPhoneInput, normalizeTurkishPhone } from '../utils/phone';
import { uppercasePersonNameInput } from '../utils/person-name';
import { ManagementActions } from './ManagementActions';
import { BulkStaffImport } from './BulkStaffImport';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import { StaffDraft, validateStaffForm } from '../utils/staff-form';

interface StaffManagementProps {
  teachers: TeacherProfile[];
  securityUsers: User[];
  loading: boolean;
  error: string;
  onCreateTeacher: (data: { fullName: string; role: 'teacher' | 'security'; branch?: string; phone: string; email: string }) => Promise<unknown>;
}

export const StaffManagement: React.FC<StaffManagementProps> = ({ teachers, securityUsers, loading, error, onCreateTeacher }) => {
  const { currentSchool, refreshSchoolData } = useApp();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState({ teacher: 0, security: 0 });
  const [resending, setResending] = useState<string | null>(null);
  const [showCreateTeacher, setShowCreateTeacher] = useState(false);
  const [showBulkStaffImport, setShowBulkStaffImport] = useState(false);
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
      await onCreateTeacher({ fullName: fullName.trim(), role: staffRole, ...(staffRole === 'teacher' ? { branch: branch.trim() } : {}), phone, email: email.trim().toLowerCase() });
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
    <div className="management-section">
      <div className="section-heading"><div><h3>Öğretmenler ve güvenlik</h3><p>Okulunuzun personel hesaplarını ve aktivasyon e-postalarını yönetin.</p></div></div>
      <label className="relative block">
        <span className="sr-only">Öğretmen veya güvenlik personeli ara</span>
        <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
        <input value={search} onChange={(event) => { setSearch(event.target.value); setPage({ teacher: 0, security: 0 }); }} placeholder="Öğretmen veya güvenlik personeli ara..."
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm" />
      </label>
      {loading && <Skeleton />}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {resendMessage && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{resendMessage}</p>}
      {!loading && !error && sections.map(({ type, title, Icon, empty, description, records }) => {
        const filtered = records.filter((record) =>
          [record.firstName, record.lastName, record.branch || '', record.phone, record.email || ''].join(' ').toLocaleLowerCase('tr-TR').includes(query)
        );
        const pages = Math.max(1, Math.ceil(filtered.length / 25));
        const currentPage = Math.min(page[type], pages - 1);
        return (
          <section key={type} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="flex items-center gap-2 font-semibold text-slate-800"><Icon className="h-5 w-5 text-indigo-600" />{title} ({records.length})</h4>{type === 'teacher' && <div className="staff-import-actions"><a href="/PERSONEL_BİLGİ_FORMU.xlsx" download="PERSONEL_BİLGİ_FORMU.xlsx" className="ui-button staff-template-download"><Download size={18} aria-hidden="true" />Excel Şablonu İndir</a><Button className="staff-bulk-upload" variant="secondary" disabled={!currentSchool} onClick={() => setShowBulkStaffImport(true)}><Upload size={18} aria-hidden="true" />Toplu Personel Ekle</Button><Button onClick={() => { setCreateTeacherError(''); setFieldErrors({}); setShowCreateTeacher(true); }}>+ Personel Ekle</Button></div>}</div>
            {filtered.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
                <Icon className="mx-auto mb-3 h-8 w-8 text-slate-400" />
                <p className="font-medium text-slate-700">{records.length ? 'Aramanızla eşleşen personel bulunamadı.' : empty}</p>
                {!records.length && <p className="mt-1 text-sm text-slate-500">{description}</p>}
              </div>
            ) : <div className="management-list"><table className="management-table"><thead><tr><th>Ad Soyad</th><th>Görev / Branş</th><th>Telefon</th><th>E-posta</th><th>Durum</th><th>İşlemler</th></tr></thead><tbody>
              {filtered.slice(currentPage * 25, currentPage * 25 + 25).map((record) => {
                const phone = normalizeTurkishPhone(record.phone);
                const status = record.accountStatus;
                const actionable = !!phone && (status === 'pending' || status === 'active');
                const label = `${record.firstName} ${record.lastName}`.trim();
                return (
                  <tr key={record.id} className="staff-record-row"><td data-label="Ad Soyad"><strong>{label}</strong></td><td data-label="Görev / Branş">{type === 'teacher' ? `Öğretmen · ${record.branch || 'Branş eksik'}` : 'Güvenlik'}</td><td data-label="Telefon">{record.phone || 'Telefon tanımlı değil'}</td><td data-label="E-posta">{record.email || '—'}</td><td data-label="Durum"><span className={`status-badge tone-${!phone ? 'danger' : status === 'active' ? 'success' : 'warning'}`}>
                      {!phone ? <AlertCircle size={15} /> : status === 'active' ? <CheckCircle2 size={15} /> : <Clock size={15} />}{!phone ? 'Telefon eksik veya geçersiz' : status === 'active' ? 'Aktif hesap' : status === 'pending' ? 'Aktivasyon bekliyor' : 'Üyelik aktif değil / Durum doğrulanamadı'}
                    </span></td><td data-label="İşlemler"><div className="record-actions">
                    {currentSchool && <ManagementActions compact schoolId={currentSchool.id} kind={type} id={record.id}
                      values={{ fullName: label, phone: record.phone || '', email: record.email || '', ...(type === 'teacher' ? { branch: record.branch || '' } : {}) }} onChanged={refreshSchoolData} />}
                    {status === 'pending' && currentSchool && <RecordAction label={`${label} için aktivasyon e-postasını yeniden gönder`} icon={KeyRound} disabled={!actionable || resending !== null} onClick={async () => {
                      setResending(record.id);
                      try { const result = await api.resendStaffActivation(currentSchool.id, type, record.id); setResendMessage(result.message); }
                      catch (cause) { setResendMessage(cause instanceof Error ? cause.message : 'E-posta yeniden gönderilemedi.'); }
                      finally { setResending(null); }
                    }} />}
                  </div></td></tr>
                );
              })}
            </tbody></table></div>}
            {pages > 1 && <nav className="management-pagination" aria-label={`${title} sayfaları`}><Button variant="secondary" disabled={currentPage === 0} onClick={() => setPage({ ...page, [type]: currentPage - 1 })}>Önceki</Button><span>{currentPage + 1} / {pages} · {filtered.length} kayıt</span><Button variant="secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage({ ...page, [type]: currentPage + 1 })}>Sonraki</Button></nav>}
          </section>
        );
      })}
      {showBulkStaffImport && currentSchool && (
        <BulkStaffImport
          schoolId={currentSchool.id}
          existing={[...teachers, ...securityUsers]}
          onClose={() => setShowBulkStaffImport(false)}
          onChanged={refreshSchoolData}
        />
      )}
      {showCreateTeacher && <Dialog title="Yeni Personel Ekle" description="Aktivasyon kodu yalnızca kayıtlı e-posta adresine gönderilir." onClose={() => { if (!creatingTeacher) setShowCreateTeacher(false); }} dismissible={!creatingTeacher}>
        <form className="form-stack" noValidate onSubmit={submitTeacher}>
          <label className="field">Görevi<select aria-label="Görevi" value={staffRole} required aria-invalid={!!fieldErrors.role} aria-describedby="staff-error-role" onChange={(event) => { setStaffRole(event.target.value as StaffDraft['role']); setFieldErrors({}); }}><option value="">Görev seçin</option><option value="teacher">Öğretmen</option><option value="security">Güvenlik</option></select>{fieldError('role')}</label>
          <label className="field" htmlFor="staff-teacher-name">Ad Soyad<input aria-label="Ad Soyad" id="staff-teacher-name" autoComplete="name" maxLength={150} required aria-invalid={!!fieldErrors.fullName} aria-describedby="staff-error-fullName" value={fullName} onChange={(event) => { setFullName(uppercasePersonNameInput(event.target.value)); setFieldErrors((previous) => ({ ...previous, fullName: undefined })); }} />{fieldError('fullName')}</label>
          {staffRole === 'teacher' && <label className="field" htmlFor="staff-teacher-branch">Branş<input aria-label="Branş" id="staff-teacher-branch" maxLength={100} required aria-invalid={!!fieldErrors.branch} aria-describedby="staff-error-branch" value={branch} onChange={(event) => { setBranch(event.target.value); setFieldErrors((previous) => ({ ...previous, branch: undefined })); }} />{fieldError('branch')}</label>}
          <label className="field" htmlFor="staff-teacher-phone">Telefon<input aria-label="Telefon" id="staff-teacher-phone" type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} placeholder="0555 123 45 67" required aria-invalid={!!fieldErrors.phone} aria-describedby="staff-error-phone" value={phone} onChange={(event) => { setPhone(formatTurkishPhoneInput(event.target.value)); setFieldErrors((previous) => ({ ...previous, phone: undefined })); }} />{fieldError('phone')}</label>
          <label className="field" htmlFor="staff-email">E-posta<input aria-label="E-posta" id="staff-email" type="email" autoComplete="email" maxLength={150} required aria-invalid={!!fieldErrors.email} aria-describedby="staff-error-email" value={email} onChange={(event) => { setEmail(event.target.value); setFieldErrors((previous) => ({ ...previous, email: undefined })); }} />{fieldError('email')}</label>
          {createTeacherError && <Alert tone="danger">{createTeacherError}</Alert>}
          <div className="form-actions"><Button type="button" variant="secondary" disabled={creatingTeacher} onClick={() => setShowCreateTeacher(false)}>İptal</Button><Button type="submit" disabled={creatingTeacher}>{creatingTeacher ? 'Ekleniyor…' : 'Personel Ekle'}</Button></div>
        </form>
      </Dialog>}
    </div>
  );
};
