import { formatDate, formatDateTime, getIstanbulDate } from '../utils/dates';
import { appointmentsOnDate } from '../utils/admin-filters';
import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  Shield,
  Users,
  Calendar,
  Settings as SettingsIcon,
  FileText,
  X,
  CheckCircle2,
  Clock,
  GraduationCap,
  Upload,
  Check,
} from 'lucide-react';
import { Alert, Button, Dialog, EmptyState, Metric, StatusBadge } from './ui';
import { SchoolRosterRecord } from '../types';
import { api } from '../services/api';
import { StaffManagement, StaffCodeTarget } from './StaffManagement';
import { ParentManagement } from './ParentManagement';
import { AuditManagement } from './AuditManagement';
import { ManagementActions } from './ManagementActions';

interface AdminViewProps {
  onManageSchools?: () => void;
  onClose: () => void;
}

export const AdminView: React.FC<AdminViewProps> = ({ onClose, onManageSchools }) => {
  const {
    currentSchool,
    refreshSchoolData,
    users,
    usersLoading,
    usersError,
    teachers,
    createTeacher,
    appointments,
    settings,
    updateSettings,
    auditLogs,
    roster,
    uploadRoster,
    runIsolationTests,
    isolationTestResults,
  } = useApp();

  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'roster' | 'isolation' | 'users' | 'appointments' | 'settings' | 'audit'
  >('dashboard');

  const [selectedDate, setSelectedDate] = useState(() => getIstanbulDate());
  const [selectedClass, setSelectedClass] = useState('');
  const [parentClasses, setParentClasses] = useState<string[]>([]);
  const classOptions = [...new Set([...parentClasses, ...roster.map((record) => record.className)])].sort((left, right) => left.localeCompare(right, 'tr', { numeric: true }));
  const datedAppointments = appointmentsOnDate(appointments, selectedDate);

  // Roster Filter
  const [rosterSearch, setRosterSearch] = useState('');


  // Settings form state
  const [schoolNameInput, setSchoolNameInput] = useState(settings.schoolName);
  const [defaultSlotInput, setDefaultSlotInput] = useState(settings.defaultSlotMinutes);
  const [allowCancelInput, setAllowCancelInput] = useState(settings.allowParentCancel);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState(false);

  // Bulk Upload Modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadText, setUploadText] = useState(
    `+905557778899, Merve Doğan, Ece Doğan, 7-A, 612\n+905556665544, Hasan Yurt, Ali Yurt, 8-B, 804`
  );
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState('');
  const [authCodeRoster, setAuthCodeRoster] = useState<SchoolRosterRecord | null>(null);
  const [authCodeTarget, setAuthCodeTarget] = useState<StaffCodeTarget | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [authCodePurpose, setAuthCodePurpose] = useState<'ACCOUNT_ACTIVATION' | 'PASSWORD_RESET'>('ACCOUNT_ACTIVATION');
  const [generatedAuthCode, setGeneratedAuthCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [authCodeError, setAuthCodeError] = useState('');
  const [isCreatingAuthCode, setIsCreatingAuthCode] = useState(false);
  const codeRequestSequence = useRef(0);
  useEffect(() => {
    codeRequestSequence.current += 1;
    setIsCreatingAuthCode(false);
    setAuthCodeRoster(null);
    setAuthCodeTarget(null);
    setGeneratedAuthCode(null);
    setAuthCodeError('');
    setCopyMessage('');
    setSelectedClass('');
    setParentClasses([]);
    setSelectedDate(getIstanbulDate());
    return () => { codeRequestSequence.current += 1; };
  }, [currentSchool?.id]);

  // Test Runner State
  const [isRunningTests, setIsRunningTests] = useState(false);

  useEffect(() => {
    setSchoolNameInput(settings.schoolName);
    setDefaultSlotInput(settings.defaultSlotMinutes);
    setAllowCancelInput(settings.allowParentCancel);
  }, [settings]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
    await updateSettings({
      schoolName: schoolNameInput,
      defaultSlotMinutes: Number(defaultSlotInput),
      allowParentCancel: allowCancelInput,
    });
    setSettingsSavedMsg(true);
    setTimeout(() => setSettingsSavedMsg(false), 2000);
    } catch {
      setFormError('Ayarlar kaydedilemedi. Lütfen tekrar deneyin.');
    } finally {
      setSaving(false);
    }
  };

  const handleExecuteBulkUpload = async () => {
    const lines = uploadText.trim().split('\n');
    const records: Partial<SchoolRosterRecord>[] = [];

    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length >= 3) {
        records.push({
          parentPhone: parts[0],
          parentName: parts[1],
          studentName: parts[2],
          className: parts[3] || 'Genel',
          studentNumber: parts[4] || '',
        });
      }
    }

    if (records.length > 0) {
      setSaving(true);
      setFormError('');
      try {
      const added = await uploadRoster(records);
      setUploadSuccessMsg(`${added} yeni kütük kaydı sisteme aktarıldı.`);
      setTimeout(() => {
        setUploadSuccessMsg('');
        setShowUploadModal(false);
      }, 1500);
      } catch {
        setFormError('Kayıtlar aktarılamadı. Biçimi kontrol edip yeniden deneyin.');
      } finally {
        setSaving(false);
      }
    }
  };

  const handleCreateAuthCode = async () => {
    if (!currentSchool || (!authCodeRoster && !authCodeTarget)) return;
    const sequence = ++codeRequestSequence.current;
    setAuthCodeError('');
    setIsCreatingAuthCode(true);
    try {
      const result = await api.createAuthCode(currentSchool.id, authCodeRoster?.id || '', authCodePurpose, authCodeTarget || undefined);
      if (sequence !== codeRequestSequence.current) return;
      setGeneratedAuthCode({ code: result.code, expiresAt: result.expiresAt });
    } catch (requestError: any) {
      if (sequence !== codeRequestSequence.current) return;
      setAuthCodeError(requestError.message || 'Güvenlik kodu oluşturulamadı.');
    } finally {
      if (sequence === codeRequestSequence.current) setIsCreatingAuthCode(false);
    }
  };

  const handleRunIsolationTests = async () => {
    setIsRunningTests(true);
    try {
      await runIsolationTests();
    } finally {
      setIsRunningTests(false);
    }
  };

  const filteredRoster = roster.filter((r) => {
    if (r.isClaimed || !selectedClass || r.className !== selectedClass) return false;
    return (
      r.studentName.toLowerCase().includes(rosterSearch.toLowerCase()) ||
      r.parentName.toLowerCase().includes(rosterSearch.toLowerCase()) ||
      r.parentPhone.includes(rosterSearch) ||
      r.className.toLowerCase().includes(rosterSearch.toLowerCase())
    );
  });

  const closeCode = () => {
    if (isCreatingAuthCode) return;
    setGeneratedAuthCode(null);
    setAuthCodeRoster(null);
    setAuthCodeTarget(null);
    setCopyMessage('');
  };
  const navigation = [
    { id: 'dashboard' as const, label: 'Genel bakış', icon: Shield },
    { id: 'roster' as const, label: 'Öğrenci ve veliler', icon: GraduationCap },
    { id: 'users' as const, label: 'Personel', icon: Users },
    { id: 'appointments' as const, label: 'Randevular', icon: Calendar },
    { id: 'settings' as const, label: 'Okul ayarları', icon: SettingsIcon },
    { id: 'audit' as const, label: 'İşlem günlüğü', icon: FileText },
    { id: 'isolation' as const, label: 'Güvenlik kontrolü', icon: CheckCircle2 },
  ];

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]') && !showUploadModal && !authCodeRoster && !authCodeTarget) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose, showUploadModal, authCodeRoster, authCodeTarget]);

  return (
    <div className="admin-backdrop">
      <section className="admin-panel" aria-label="Okul yönetim paneli">
        <header className="admin-header"><div><h2>{navigation.find((item) => item.id === activeTab)?.label}</h2><p>{currentSchool?.name}</p></div><button type="button" onClick={onClose} className="icon-button" aria-label="Yönetim panelini kapat"><X size={22} /></button></header>
        <nav className="admin-nav" aria-label="Yönetim bölümleri"><p className="eyebrow">OKUL YÖNETİMİ</p>{navigation.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={activeTab === id ? 'page' : undefined} onClick={() => setActiveTab(id)}><Icon size={19} /><span>{label}</span></button>)}</nav>
        <label className="admin-mobile-nav" htmlFor="admin-section"><span className="sr-only">Yönetim bölümü</span><select id="admin-section" value={activeTab} onChange={(event) => setActiveTab(event.target.value as typeof activeTab)}>{navigation.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <main id="main-content" className="admin-content">
          {onManageSchools && <Button variant="secondary" className="mb-5" onClick={onManageSchools}>Okul Yönetimi (Platform)</Button>}
          {activeTab === 'dashboard' && <div className="space-y-7">
            <section className="hero-card"><div><p className="eyebrow">OKULUNUZ BİR BAKIŞTA</p><h2>İletişim güçlü, işler düzenli.</h2><p>Görüşmeleri ve okulunuzun hesaplarını tek yerden yönetin.</p></div><Button onClick={() => setActiveTab('users')}><Users size={18} />Personeli yönet</Button></section>
            <div className="metric-grid"><Metric icon={Calendar} label="Bugünkü randevu" value={appointments.filter((appointment) => appointment.date === getIstanbulDate()).length} /><Metric icon={Clock} label="Onay bekleyen" value={appointments.filter((appointment) => appointment.status === 'pending').length} /><Metric icon={GraduationCap} label="Öğretmen" value={teachers.length} /></div>
            <div className="grid lg:grid-cols-2 gap-6">
              <section className="surface"><div className="section-heading"><div><h3>Hesap yönetimi</h3><p>Okulunuzdaki mevcut kayıtlar</p></div><Users size={21} className="text-blue-700" /></div><dl className="pass-details"><div><dt>Aktif öğretmen hesabı</dt><dd>{teachers.filter((teacher) => teacher.accountStatus === 'active').length}</dd></div><div><dt>Aktivasyon bekleyen personel</dt><dd>{usersLoading || usersError ? '—' : [...teachers, ...users].filter((record) => record.accountStatus === 'pending').length}</dd></div><div><dt>Güvenlik personeli</dt><dd>{usersLoading || usersError ? '—' : users.length}</dd></div><div><dt>Öğrenci–veli kütüğü</dt><dd>{roster.length}</dd></div></dl><Button variant="quiet" className="mt-5" onClick={() => setActiveTab('roster')}>Öğrenci ve veli kayıtlarını aç</Button></section>
              <section className="surface"><div className="section-heading"><h3>Görüşmelerin durumu</h3></div><div className="space-y-4">{(['pending', 'booked', 'checked_in', 'checked_out'] as const).map((status) => <div key={status} className="flex items-center justify-between gap-4"><StatusBadge status={status} /><strong className="text-xl">{appointments.filter((appointment) => appointment.status === status).length}</strong></div>)}</div><Button variant="quiet" className="mt-5" onClick={() => setActiveTab('appointments')}>Tüm randevuları aç</Button></section>
            </div>
          </div>}

          {activeTab === 'roster' && <section className="space-y-5">
            <label className="field" htmlFor="parent-class">Sınıf seçin<select id="parent-class" value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)}>
              <option value="">Önce sınıf seçin</option>{classOptions.map((className) => <option key={className} value={className}>{className}</option>)}
            </select></label>
            <label className="field" htmlFor="parent-search">Seçili sınıfta ara<input id="parent-search" value={rosterSearch} onChange={(event) => setRosterSearch(event.target.value)} placeholder="Öğrenci, veli veya telefon" /></label>
            {currentSchool && <ParentManagement key={currentSchool.id} schoolId={currentSchool.id} roster={roster} search={rosterSearch} selectedClass={selectedClass} onClassesChange={setParentClasses}
              onChanged={refreshSchoolData} onIssue={(record) => { setAuthCodeRoster(record); setAuthCodePurpose('PASSWORD_RESET'); setGeneratedAuthCode(null); setAuthCodeError(''); }} />}
            <div className="section-heading"><div><h3>Öğrenci ve veli kütüğü</h3><p>Okul kayıtlarını ve velilerin hesap aktivasyonlarını yönetin.</p></div><Button onClick={() => { setFormError(''); setShowUploadModal(true); }}><Upload size={17} />Toplu kayıt ekle</Button></div>
            {filteredRoster.length ? <div className="surface !p-0 overflow-hidden"><table className="w-full text-left"><thead className="bg-slate-50 text-slate-500 text-xs"><tr><th>Öğrenci</th><th>Sınıf / No</th><th>Veli</th><th>Telefon</th><th>Hesap</th><th><span className="sr-only">İşlem</span></th></tr></thead><tbody className="divide-y divide-slate-200">{filteredRoster.map((item) => <tr key={item.id}><td data-label="Öğrenci" className="font-semibold">{item.studentName}</td><td data-label="Sınıf / No">{item.className} {item.studentNumber && `· ${item.studentNumber}`}</td><td data-label="Veli">{item.parentName}</td><td data-label="Telefon">{item.parentPhone}</td><td><span className={`status-badge tone-${item.isClaimed ? 'success' : 'warning'}`}>{item.isClaimed ? <Check size={14} /> : <Clock size={14} />}{item.isClaimed ? 'Aktif' : 'Bekliyor'}</span></td><td><Button variant="secondary" onClick={() => { setAuthCodeRoster(item); setGeneratedAuthCode(null); setAuthCodeError(''); }}>Kod oluştur</Button>{currentSchool && <ManagementActions schoolId={currentSchool.id} kind="roster" id={item.id} values={{ parentName: item.parentName, parentPhone: item.parentPhone, studentName: item.studentName, className: item.className, studentNumber: item.studentNumber || '' }} onChanged={refreshSchoolData} />}</td></tr>)}</tbody></table></div> : <div className="surface"><EmptyState icon={GraduationCap} title={!selectedClass ? 'Önce sınıf seçin' : 'Bu sınıfta eşleşen bekleyen kayıt bulunamadı'} description="Kayıt ekleyebilir veya farklı bir arama yapabilirsiniz." /></div>}
          </section>}

          {activeTab === 'users' && <StaffManagement key={currentSchool?.id} teachers={teachers} securityUsers={users} loading={usersLoading} error={usersError} onCreateTeacher={createTeacher} onIssue={(target, purpose) => { setAuthCodeTarget(target); setAuthCodePurpose(purpose); setAuthCodeRoster(null); setGeneratedAuthCode(null); setAuthCodeError(''); setCopyMessage(''); }} />}

          {activeTab === 'appointments' && <section className="space-y-5">
            <div className="section-heading"><div><h3>Okulunuzun görüşmeleri</h3><p>{formatDate(selectedDate)} · {datedAppointments.length} randevu</p></div></div>
            <div className="flex flex-wrap items-end gap-3"><label className="field" htmlFor="admin-appointment-date">Görüşme tarihi<input id="admin-appointment-date" type="date" required value={selectedDate} onChange={(event) => setSelectedDate(event.target.value || getIstanbulDate())} /></label><Button variant="secondary" onClick={() => setSelectedDate(getIstanbulDate())}>Bugün</Button></div>
            {datedAppointments.length ? datedAppointments.map((appointment) => <article key={appointment.id} className="appointment-card"><div className="appointment-time"><strong>{appointment.startTime}</strong><span>{formatDate(appointment.date)}</span></div><div className="appointment-detail"><div className="appointment-top"><div><h3>{appointment.teacherName}</h3><p>{appointment.teacherBranch} · Veli: {appointment.parentName}</p></div><StatusBadge status={appointment.status} /></div><p className="mt-3">{appointment.studentName} · {appointment.className}</p></div></article>) : <div className="surface"><EmptyState icon={Calendar} title="Seçili günde randevu bulunmuyor" description="Başka bir tarih seçerek o günün görüşmelerini görebilirsiniz." /></div>}
          </section>}

          {activeTab === 'settings' && <section className="surface max-w-2xl"><div className="section-heading"><div><h3>Okul ve görüşme ayarları</h3><p>Okulunuzun randevu tercihlerini düzenleyin.</p></div></div><form onSubmit={handleSaveSettings} className="form-stack">
            <label className="field" htmlFor="settings-school">Okul adı<input id="settings-school" value={schoolNameInput} onChange={(event) => setSchoolNameInput(event.target.value)} /></label>
            <label className="field" htmlFor="settings-duration">Standart görüşme süresi (dakika)<input id="settings-duration" type="number" value={defaultSlotInput} onChange={(event) => setDefaultSlotInput(Number(event.target.value))} /></label>
            <label htmlFor="allowCancel" className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl text-sm"><input type="checkbox" id="allowCancel" checked={allowCancelInput} onChange={(event) => setAllowCancelInput(event.target.checked)} /><span>Veliler kendi randevularını iptal edebilsin</span></label>
            {formError && <Alert tone="danger">{formError}</Alert>}{settingsSavedMsg && <Alert tone="success">Ayarlarınız kaydedildi.</Alert>}
            <Button type="submit" disabled={saving}>{saving ? 'Kaydediliyor…' : 'Değişiklikleri kaydet'}</Button>
          </form></section>}

          {activeTab === 'audit' && currentSchool && <AuditManagement key={currentSchool.id} schoolId={currentSchool.id} logs={auditLogs} onChanged={refreshSchoolData} />}

          {activeTab === 'isolation' && <section className="space-y-5"><div className="surface"><div className="section-heading"><div><h3>Okul verilerinin güvenliği</h3><p>Mevcut okul ayrımı kontrollerini çalıştırın.</p></div><Button disabled={isRunningTests} onClick={handleRunIsolationTests}><Shield size={18} />{isRunningTests ? 'Kontrol ediliyor…' : 'Kontrolleri çalıştır'}</Button></div></div>{isolationTestResults.length ? isolationTestResults.map((test, index) => <Alert key={index} tone={test.passed ? 'success' : 'danger'}><strong>{test.title}</strong><p className="mt-2">{test.description}</p><p className="text-xs mt-2">{test.details}</p></Alert>) : <div className="surface"><EmptyState icon={Shield} title="Henüz kontrol çalıştırılmadı" description="Sonuçlar, kontrol tamamlandığında burada gösterilir." /></div>}</section>}
        </main>

        {showUploadModal && <Dialog wide title="Öğrenci ve veli kayıtlarını aktarın" description="Her satırda bir kayıt olacak şekilde virgülle ayrılmış verilerinizi yapıştırın." onClose={() => setShowUploadModal(false)} dismissible={!saving}><div className="form-stack"><Alert>Telefon, Veli adı, Öğrenci adı, Sınıf, Okul numarası</Alert><label className="field" htmlFor="roster-upload">Kayıtlar<textarea id="roster-upload" rows={7} value={uploadText} onChange={(event) => setUploadText(event.target.value)} className="font-mono" /></label>{formError && <Alert tone="danger">{formError}</Alert>}{uploadSuccessMsg && <Alert tone="success">{uploadSuccessMsg}</Alert>}<div className="form-actions"><Button variant="secondary" disabled={saving} onClick={() => setShowUploadModal(false)}>Vazgeç</Button><Button disabled={saving} onClick={handleExecuteBulkUpload}>{saving ? 'Aktarılıyor…' : 'Kütüğe aktar'}</Button></div></div></Dialog>}

        {(authCodeRoster || authCodeTarget) && <Dialog title={authCodePurpose === 'PASSWORD_RESET' ? 'Parola sıfırlama kodu' : 'Hesap aktivasyonu'} onClose={closeCode} dismissible={!isCreatingAuthCode}>
          <div className="flex gap-3 items-center mb-6"><span className="avatar"><Shield size={22} /></span><div><h3 className="font-bold text-sm">{authCodeTarget?.label || authCodeRoster?.parentName}</h3><p className="text-sm text-slate-500">{(authCodeTarget?.phone || authCodeRoster?.parentPhone || '').slice(0, 5)} *** ** {(authCodeTarget?.phone || authCodeRoster?.parentPhone || '').slice(-2)}</p></div></div>
          {!generatedAuthCode ? <div className="form-stack"><p className="text-sm text-slate-600">Yeni kod oluşturulduğunda aynı amaçla verilen önceki kullanılmamış kod iptal edilir.</p><label className="field" htmlFor="code-purpose">Kod türü<select id="code-purpose" disabled={!!authCodeTarget} value={authCodePurpose} onChange={(event) => setAuthCodePurpose(event.target.value as 'ACCOUNT_ACTIVATION' | 'PASSWORD_RESET')}><option value="ACCOUNT_ACTIVATION">Hesap aktivasyonu</option><option value="PASSWORD_RESET">Parola sıfırlama</option></select></label>{authCodeError && <Alert tone="danger">{authCodeError}</Alert>}<div className="form-actions"><Button variant="secondary" disabled={isCreatingAuthCode} onClick={closeCode}>Vazgeç</Button><Button disabled={isCreatingAuthCode} onClick={handleCreateAuthCode}>{isCreatingAuthCode ? 'Oluşturuluyor…' : 'Kod oluştur'}</Button></div></div> : <>
            <Alert tone="success">Kod oluşturuldu.</Alert><div className="code-display">{generatedAuthCode.code}</div>
            <Button variant="secondary" className="w-full" onClick={async () => { try { await navigator.clipboard.writeText(generatedAuthCode.code); setCopyMessage('Kod kopyalandı.'); } catch { setCopyMessage('Kopyalanamadı. Kodu seçerek kopyalayabilirsiniz.'); } }}>Kodu kopyala</Button>
            <p role="status" className="text-sm text-center text-blue-700 my-3">{copyMessage}</p><Alert tone="warning">Bu kod tek kullanımlıktır ve yalnızca burada gösterilir. İlgili kişiye güvenli bir kanaldan iletin.</Alert><p className="text-xs text-center text-slate-500 my-5">Son kullanım: {formatDateTime(generatedAuthCode.expiresAt)}</p><Button className="w-full" onClick={closeCode}>Tamam</Button>
          </>}
        </Dialog>}
      </section>
    </div>
  );
};
