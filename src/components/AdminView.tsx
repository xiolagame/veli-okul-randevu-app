import { formatDate, getIstanbulDate } from '../utils/dates';
import { appointmentsOnDate, sortAppointmentsForAdmin } from '../utils/admin-filters';
import React, { useState, useEffect } from 'react';
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
import { Alert, Button, EmptyState, Metric, StatusBadge } from './ui';
import { api } from '../services/api';
import { StaffManagement } from './StaffManagement';
import { ParentManagement } from './ParentManagement';
import { AuditManagement } from './AuditManagement';
import { ManagementActions } from './ManagementActions';
import { BulkRosterImport } from './BulkRosterImport';
import { SchoolInfo } from './SchoolInfo';
import { SchoolAdminManagement } from './SchoolAdminManagement';
import { validateDefaultSlotMinutes } from '../utils/school-settings';

interface AdminViewProps {
  onManageSchools?: () => void;
  onClose: () => void;
}

export const AdminView: React.FC<AdminViewProps> = ({ onClose, onManageSchools }) => {
  const {
    currentSchool,
    refreshSchoolData,
    refreshPlatformSchools,
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
    runIsolationTests,
    isolationTestResults,
    isPlatformAdmin,
    platformContextActive,
  } = useApp();

  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'roster' | 'isolation' | 'users' | 'admins' | 'appointments' | 'settings' | 'audit'
  >('dashboard');

  const [selectedDate, setSelectedDate] = useState(() => getIstanbulDate());
  const [appointmentMode, setAppointmentMode] = useState<'today' | 'all'>('today');
  const [selectedClass, setSelectedClass] = useState('');
  const [parentClasses, setParentClasses] = useState<string[]>([]);
  const classOptions = [...new Set([...parentClasses, ...roster.map((record) => record.className)])].sort((left, right) => left.localeCompare(right, 'tr', { numeric: true }));
  const istanbulTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const datedAppointments = appointmentMode === 'today'
    ? appointmentsOnDate(appointments, selectedDate)
    : sortAppointmentsForAdmin(appointments, { date: getIstanbulDate(), time: istanbulTime });

  // Roster Filter
  const [rosterSearch, setRosterSearch] = useState('');


  // Settings form state
  const [schoolNameInput, setSchoolNameInput] = useState(settings.schoolName);
  const [defaultSlotInput, setDefaultSlotInput] = useState(String(settings.defaultSlotMinutes));
  const [allowCancelInput, setAllowCancelInput] = useState(settings.allowParentCancel);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState(false);

  // Bulk Upload Modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  useEffect(() => {
    setSelectedClass('');
    setParentClasses([]);
    setSelectedDate(getIstanbulDate());
    setAppointmentMode('today');
  }, [currentSchool?.id]);

  // Test Runner State
  const [isRunningTests, setIsRunningTests] = useState(false);

  useEffect(() => {
    setSchoolNameInput(settings.schoolName);
    setDefaultSlotInput(String(settings.defaultSlotMinutes));
    setAllowCancelInput(settings.allowParentCancel);
  }, [settings]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const duration = validateDefaultSlotMinutes(defaultSlotInput, settings.minSlotMinutes);
    if (duration === null) {
      setFormError(`Görüşme süresi en az ${settings.minSlotMinutes} dakika olan tam sayı olmalıdır.`);
      return;
    }
    setSaving(true);
    setFormError('');
    try {
    await updateSettings({
      schoolName: schoolNameInput,
      defaultSlotMinutes: duration,
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

  const navigation = [
    { id: 'dashboard' as const, label: 'Genel bakış', icon: Shield },
    { id: 'roster' as const, label: 'Öğrenci ve veliler', icon: GraduationCap },
    { id: 'users' as const, label: 'Personel', icon: Users },
    { id: 'admins' as const, label: 'Okul Yöneticileri', icon: Shield },
    { id: 'appointments' as const, label: 'Randevular', icon: Calendar },
    { id: 'settings' as const, label: 'Okul ayarları', icon: SettingsIcon },
    { id: 'audit' as const, label: 'İşlem günlüğü', icon: FileText },
    ...(isPlatformAdmin ? [{ id: 'isolation' as const, label: 'Sistem Güvenliği', icon: CheckCircle2 }] : []),
  ];

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]') && !showUploadModal) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose, showUploadModal]);

  return (
    <div className="admin-backdrop">
      <section className="admin-panel" aria-label="Okul yönetim paneli">
        <header className="admin-header"><div><h2>{navigation.find((item) => item.id === activeTab)?.label}</h2><p>{platformContextActive ? `Platform Yönetimi · ${currentSchool?.name}` : currentSchool?.name}</p></div><button type="button" onClick={onClose} className="icon-button" aria-label="Yönetim panelini kapat"><X size={22} /></button></header>
        <nav className="admin-nav" aria-label="Yönetim bölümleri"><p className="eyebrow">{platformContextActive ? 'SEÇİLİ OKUL YÖNETİMİ' : 'OKUL YÖNETİMİ'}</p>{navigation.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={activeTab === id ? 'page' : undefined} onClick={() => setActiveTab(id)}><Icon size={19} /><span>{label}</span></button>)}</nav>
        <label className="admin-mobile-nav" htmlFor="admin-section"><span className="sr-only">Yönetim bölümü</span><select id="admin-section" value={activeTab} onChange={(event) => setActiveTab(event.target.value as typeof activeTab)}>{navigation.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <main id="main-content" className="admin-content">
          {activeTab === 'dashboard' && currentSchool && <SchoolInfo key={currentSchool.id} schoolId={currentSchool.id} allowCodeChange={isPlatformAdmin} onCodeChanged={refreshPlatformSchools} />}
          {onManageSchools && <Button variant="secondary" className="mb-5" onClick={onManageSchools}>Okul Yönetimi (Platform)</Button>}
          {activeTab === 'dashboard' && <div className="space-y-7">
            <section className="hero-card"><div><p className="eyebrow">OKULUNUZ VE AİLE ARASINDAKİ</p><h2>Kolay ve güvenilir randevu sistemi.</h2><p>Görüşmeleri ve okulunuzun hesaplarını tek yerden yönetin.</p></div><Button onClick={() => setActiveTab('users')}><Users size={18} />Personeli yönet</Button></section>
            <div className="metric-grid"><Metric icon={Calendar} label="Bugünkü randevu" value={appointments.filter((appointment) => appointment.date === getIstanbulDate()).length} /><Metric icon={Clock} label="Onay bekleyen" value={appointments.filter((appointment) => appointment.status === 'pending').length} /><Metric icon={GraduationCap} label="Öğretmen" value={teachers.length} /></div>
            <div className="grid lg:grid-cols-2 gap-6">
              <section className="surface"><div className="section-heading"><div><h3>Hesap yönetimi</h3><p>Okulunuzdaki mevcut kayıtlar</p></div><Users size={21} className="text-blue-700" /></div><dl className="pass-details"><div><dt>Aktif öğretmen hesabı</dt><dd>{teachers.filter((teacher) => teacher.accountStatus === 'active').length}</dd></div><div><dt>Aktivasyon bekleyen personel</dt><dd>{usersLoading || usersError ? '—' : [...teachers, ...users].filter((record) => record.accountStatus === 'pending').length}</dd></div><div><dt>Güvenlik personeli</dt><dd>{usersLoading || usersError ? '—' : users.length}</dd></div><div><dt>Hesap oluşturmayı bekleyen kayıtlar</dt><dd>{roster.filter((record) => !record.isClaimed).length}</dd></div></dl><Button variant="quiet" className="mt-5" onClick={() => setActiveTab('roster')}>Öğrenci ve veli kayıtlarını aç</Button></section>
              <section className="surface"><div className="section-heading"><h3>Görüşmelerin durumu</h3></div><div className="space-y-4">{(['pending', 'booked', 'checked_in', 'checked_out'] as const).map((status) => <div key={status} className="flex items-center justify-between gap-4"><StatusBadge status={status} /><strong className="text-xl">{appointments.filter((appointment) => appointment.status === status).length}</strong></div>)}</div><Button variant="quiet" className="mt-5" onClick={() => setActiveTab('appointments')}>Tüm randevuları aç</Button></section>
            </div>
          </div>}

          {activeTab === 'roster' && <section className="space-y-5">
            <label className="field" htmlFor="parent-class">Sınıf seçin<select id="parent-class" value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)}>
              <option value="">Önce sınıf seçin</option>{classOptions.map((className) => <option key={className} value={className}>{className}</option>)}
            </select></label>
            <label className="field" htmlFor="parent-search">Seçili sınıfta ara<input id="parent-search" value={rosterSearch} onChange={(event) => setRosterSearch(event.target.value)} placeholder="Öğrenci, veli veya telefon" /></label>
            {currentSchool && <ParentManagement key={currentSchool.id} schoolId={currentSchool.id} search={rosterSearch} selectedClass={selectedClass} onClassesChange={setParentClasses} onChanged={refreshSchoolData} />}
            <div className="section-heading"><div><h3>Hesap Oluşturmayı Bekleyen Kayıtlar</h3><p>Toplu kayıtla eklenip henüz veli hesabıyla eşleşmeyen öğrenci/veli bilgileri.</p></div><Button onClick={() => { setFormError(''); setShowUploadModal(true); }}><Upload size={17} />Toplu kayıt ekle</Button></div>
            {filteredRoster.length ? <div className="surface !p-0 overflow-hidden"><table className="w-full text-left"><thead className="bg-slate-50 text-slate-500 text-xs"><tr><th>Öğrenci</th><th>Sınıf / No</th><th>Veli</th><th>Telefon</th><th>Hesap</th><th><span className="sr-only">İşlem</span></th></tr></thead><tbody className="divide-y divide-slate-200">{filteredRoster.map((item) => <tr key={item.id}><td data-label="Öğrenci" className="font-bold text-slate-900">{item.studentName}</td><td data-label="Sınıf / No">{item.className} {item.studentNumber && `· ${item.studentNumber}`}</td><td data-label="Veli">{item.parentName}</td><td data-label="Telefon">{item.parentPhone}</td><td><span className={`status-badge tone-${item.isClaimed ? 'success' : 'warning'}`}>{item.isClaimed ? <Check size={14} /> : <Clock size={14} />}{item.isClaimed ? 'Aktif hesap' : 'Hesap oluşturmadı'}</span></td><td>{currentSchool && <ManagementActions schoolId={currentSchool.id} kind="roster" id={item.id} values={{ parentName: item.parentName, parentPhone: item.parentPhone, studentName: item.studentName, className: item.className, studentNumber: item.studentNumber || '' }} onChanged={refreshSchoolData} />}</td></tr>)}</tbody></table></div> : <div className="surface"><EmptyState icon={GraduationCap} title={!selectedClass ? 'Önce sınıf seçin' : 'Hesap oluşturmayı bekleyen kayıt yok'} description={!selectedClass ? 'Bekleyen kayıtları görmek için önce sınıf seçin.' : 'Bu sınıfa toplu kayıtla eklenmiş ve henüz veli hesabıyla eşleşmemiş öğrenci/veli bilgisi bulunmuyor.'} /></div>}
          </section>}

          {activeTab === 'users' && <StaffManagement key={currentSchool?.id} teachers={teachers} securityUsers={users} loading={usersLoading} error={usersError} onCreateTeacher={createTeacher} />}

          {activeTab === 'admins' && currentSchool && <SchoolAdminManagement key={currentSchool.id} schoolId={currentSchool.id} onChanged={async () => { await Promise.all([refreshSchoolData(), refreshPlatformSchools()]); }} />}

          {activeTab === 'appointments' && <section className="space-y-5">
            <div className="section-heading"><div><h3>Okulunuzun görüşmeleri</h3><p>{appointmentMode === 'today' ? formatDate(selectedDate) : 'Tüm tarihler'} · {datedAppointments.length} randevu</p></div></div>
            <div className="flex flex-wrap items-end gap-3"><label className="field" htmlFor="admin-appointment-date">Görüşme tarihi<input id="admin-appointment-date" type="date" required value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value || getIstanbulDate()); setAppointmentMode('today'); }} /></label><Button variant={appointmentMode === 'today' ? 'primary' : 'secondary'} aria-pressed={appointmentMode === 'today'} onClick={() => { setSelectedDate(getIstanbulDate()); setAppointmentMode('today'); }}>Bugün</Button><Button variant={appointmentMode === 'all' ? 'primary' : 'secondary'} aria-pressed={appointmentMode === 'all'} onClick={() => setAppointmentMode('all')}>Tüm Randevular</Button></div>
            {datedAppointments.length ? datedAppointments.map((appointment) => <article key={appointment.id} className="appointment-card"><div className="appointment-time"><strong>{appointment.startTime}</strong><span>{formatDate(appointment.date)}</span></div><div className="appointment-detail"><div className="appointment-top"><div><h3>{appointment.teacherName}</h3><p>{appointment.teacherBranch} · Veli: {appointment.parentName}</p></div><StatusBadge status={appointment.status} /></div><p className="mt-3">{appointment.studentName} · {appointment.className}</p></div></article>) : <div className="surface"><EmptyState icon={Calendar} title={appointmentMode === 'today' ? 'Seçili günde randevu bulunmuyor' : 'Kayıtlı randevu bulunmuyor'} description={appointmentMode === 'today' ? 'Başka bir tarih seçerek o günün görüşmelerini görebilirsiniz.' : 'Okulunuz için henüz randevu kaydı oluşturulmamış.'} /></div>}
          </section>}

          {activeTab === 'settings' && <section className="surface max-w-2xl"><div className="section-heading"><div><h3>Okul ve görüşme ayarları</h3><p>Okulunuzun randevu tercihlerini düzenleyin.</p></div></div><form onSubmit={handleSaveSettings} className="form-stack">
            <label className="field" htmlFor="settings-school">Okul adı<input id="settings-school" value={schoolNameInput} onChange={(event) => setSchoolNameInput(event.target.value)} /></label>
            <label className="field" htmlFor="settings-duration">Standart görüşme süresi (dakika)<input id="settings-duration" type="number" min={settings.minSlotMinutes} step="1" inputMode="numeric" value={defaultSlotInput} onChange={(event) => { setDefaultSlotInput(event.target.value); setFormError(''); }} /><span className="field-hint">En az {settings.minSlotMinutes} dakika. Alanı temizleyip yeni değeri doğrudan yazabilirsiniz.</span></label>
            <label htmlFor="allowCancel" className="flex items-start gap-3 p-4 bg-slate-50 rounded-xl text-sm"><input type="checkbox" id="allowCancel" checked={allowCancelInput} onChange={(event) => setAllowCancelInput(event.target.checked)} /><span>Veliler kendi randevularını iptal edebilsin</span></label>
            {formError && <Alert tone="danger">{formError}</Alert>}{settingsSavedMsg && <Alert tone="success">Ayarlarınız kaydedildi.</Alert>}
            <Button type="submit" disabled={saving}>{saving ? 'Kaydediliyor…' : 'Değişiklikleri kaydet'}</Button>
          </form></section>}

          {activeTab === 'audit' && currentSchool && <AuditManagement key={currentSchool.id} schoolId={currentSchool.id} logs={auditLogs} onChanged={refreshSchoolData} />}

          {activeTab === 'isolation' && isPlatformAdmin && <section className="space-y-5"><div className="surface"><div className="section-heading"><div><h3>Sistem Güvenliği</h3><p>Platform servis yapılandırmalarının güvenli durum özeti.</p></div><Button disabled={isRunningTests} onClick={handleRunIsolationTests}><Shield size={18} />{isRunningTests ? 'Kontroller çalışıyor…' : 'Okul izolasyon kontrolleri'}</Button></div></div>{isolationTestResults.length ? isolationTestResults.map((test, index) => <Alert key={index} tone={test.passed ? 'success' : 'danger'}><strong>{test.title}</strong><p className="mt-2">{test.description}</p><p className="text-xs mt-2">{test.details}</p></Alert>) : <div className="surface"><EmptyState icon={Shield} title="Güvenlik kontrolleri" description="Kontrol sonuçlarını görüntülemek için çalıştırın." /></div>}</section>}
        </main>

        {showUploadModal && currentSchool && <BulkRosterImport key={currentSchool.id} schoolId={currentSchool.id} onClose={() => setShowUploadModal(false)} onChanged={refreshSchoolData} />}

      </section>
    </div>
  );
};
