import React, { useState } from 'react';
import { Search, Shield, GraduationCap, CheckCircle2, Clock, AlertCircle, KeyRound } from 'lucide-react';
import { Alert, Button, Dialog, Skeleton } from './ui';
import { TeacherProfile, User } from '../types';
import { normalizeTurkishPhone } from '../utils/phone';

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
  onCreateTeacher: (data: { fullName: string; branch: string; phone: string }) => Promise<unknown>;
}

export const StaffManagement: React.FC<StaffManagementProps> = ({ teachers, securityUsers, loading, error, onIssue, onCreateTeacher }) => {
  const [search, setSearch] = useState('');
  const [showCreateTeacher, setShowCreateTeacher] = useState(false);
  const [creatingTeacher, setCreatingTeacher] = useState(false);
  const [createTeacherError, setCreateTeacherError] = useState('');
  const [fullName, setFullName] = useState('');
  const [branch, setBranch] = useState('');
  const [phone, setPhone] = useState('');
  const query = search.trim().toLocaleLowerCase('tr-TR');

  const submitTeacher = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creatingTeacher) return;
    if (!normalizeTurkishPhone(phone)) {
      setCreateTeacherError('Geçerli bir Türkiye GSM numarası girin.');
      return;
    }
    setCreatingTeacher(true);
    setCreateTeacherError('');
    try {
      await onCreateTeacher({ fullName, branch, phone });
      setShowCreateTeacher(false);
      setFullName('');
      setBranch('');
      setPhone('');
    } catch (cause) {
      setCreateTeacherError(cause instanceof Error ? cause.message : 'Öğretmen oluşturulamadı.');
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
      <div className="section-heading"><div><h3>Öğretmenler ve güvenlik</h3><p>Okulunuzun personel hesaplarını ve erişim kodlarını yönetin.</p></div></div>
      <label className="relative block">
        <span className="sr-only">Öğretmen veya güvenlik personeli ara</span>
        <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Öğretmen veya güvenlik personeli ara..."
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm" />
      </label>
      {loading && <Skeleton />}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {!loading && !error && sections.map(({ type, title, Icon, empty, description, records }) => {
        const filtered = records.filter((record) =>
          [record.firstName, record.lastName, record.branch || '', record.phone].join(' ').toLocaleLowerCase('tr-TR').includes(query)
        );
        return (
          <section key={type} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="flex items-center gap-2 font-semibold text-slate-800"><Icon className="h-5 w-5 text-indigo-600" />{title} ({records.length})</h4>{type === 'teacher' && <Button onClick={() => { setCreateTeacherError(''); setShowCreateTeacher(true); }}>+ Öğretmen Ekle</Button>}</div>
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
                    <div className="flex gap-3 items-center mb-4"><span className="avatar">{record.firstName[0]}{record.lastName[0]}</span><h5 className="font-semibold text-slate-900">{label}</h5></div>
                    <p className="text-sm text-slate-500">{type === 'teacher' ? record.branch : 'Güvenlik'}</p>
                    <p className="mt-2 break-words text-sm text-slate-700">{record.phone || 'Telefon tanımlı değil'}</p>
                    <span className={`mt-3 inline-flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs font-semibold ${!phone ? 'bg-red-50 text-red-700' : status === 'active' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                      {!phone ? <AlertCircle size={15} /> : status === 'active' ? <CheckCircle2 size={15} /> : <Clock size={15} />}{!phone ? 'Telefon eksik veya geçersiz' : status === 'active' ? 'Aktif hesap' : status === 'pending' ? 'Aktivasyon bekliyor' : 'Üyelik aktif değil / Durum doğrulanamadı'}
                    </span>
                    {!phone && <p className="mt-2 text-xs text-slate-500">Aktivasyon kodu oluşturmak için geçerli telefon numarası gereklidir.</p>}
                    <Button variant={status === 'active' ? 'secondary' : 'primary'} disabled={!actionable}
                      onClick={() => onIssue({ type, id: record.id, label, phone: record.phone }, status === 'active' ? 'PASSWORD_RESET' : 'ACCOUNT_ACTIVATION')}
                      className="mt-5 w-full"><KeyRound size={17} />
                      {status === 'active' ? 'Parola Sıfırlama Kodu' : 'Aktivasyon Kodu Oluştur'}
                    </Button>
                  </article>
                );
              })}
            </div>}
          </section>
        );
      })}
      {showCreateTeacher && <Dialog title="Yeni Öğretmen Ekle" description="Öğretmen profili oluşturulur; hesap daha sonra aktivasyon koduyla etkinleştirilir." onClose={() => { if (!creatingTeacher) setShowCreateTeacher(false); }} dismissible={!creatingTeacher}>
        <form className="form-stack" onSubmit={submitTeacher}>
          <label className="field" htmlFor="staff-teacher-name">Ad Soyad<input id="staff-teacher-name" autoComplete="name" maxLength={150} required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
          <label className="field" htmlFor="staff-teacher-branch">Branş<input id="staff-teacher-branch" maxLength={100} required value={branch} onChange={(event) => setBranch(event.target.value)} /></label>
          <label className="field" htmlFor="staff-teacher-phone">Telefon<input id="staff-teacher-phone" type="tel" autoComplete="tel" placeholder="0555 123 45 67" required value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          {createTeacherError && <Alert tone="danger">{createTeacherError}</Alert>}
          <div className="form-actions"><Button type="button" variant="secondary" disabled={creatingTeacher} onClick={() => setShowCreateTeacher(false)}>İptal</Button><Button type="submit" disabled={creatingTeacher}>{creatingTeacher ? 'Ekleniyor…' : 'Öğretmeni Ekle'}</Button></div>
        </form>
      </Dialog>}
    </div>
  );
};
