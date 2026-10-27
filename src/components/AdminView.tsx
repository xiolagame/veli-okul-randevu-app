import { formatDate, getIstanbulDate } from '../utils/dates';
import { appointmentsOnDate, sortAppointmentsForAdmin } from '../utils/admin-filters';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  Shield,
  Users,
  Calendar,
  Settings as SettingsIcon,
  FileText,
  CheckCircle2,
  GraduationCap,
  LifeBuoy,
} from 'lucide-react';
import { Alert, Button, EmptyState, StatusBadge } from './ui';
import { api } from '../services/api';
import { StaffManagement } from './StaffManagement';
import { StudentManagement } from './StudentManagement';
import { AuditManagement } from './AuditManagement';
import { BulkRosterImport } from './BulkRosterImport';
import { SchoolInfo } from './SchoolInfo';
import { SchoolAdminManagement } from './SchoolAdminManagement';
import { validateDefaultSlotMinutes } from '../utils/school-settings';
import { SchoolRequestCenter } from './SchoolRequestCenter';
import { OperationsCenter } from './OperationsCenter';

interface AdminViewProps {
  onManageSchools?: () => void;
}

export const AdminView: React.FC<AdminViewProps> = ({ onManageSchools }) => {
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
    runIsolationTests,
    isolationTestResults,
    isPlatformAdmin,
    platformContextActive,
  } = useApp();

  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'roster' | 'isolation' | 'users' | 'admins' | 'appointments' | 'settings' | 'requests' | 'audit'
  >('dashboard');
  const refreshSection = useRef(refreshSchoolData);
  refreshSection.current = refreshSchoolData;
  const [sectionError, setSectionError] = useState('');
  useEffect(() => {
    let current = true;
    setSectionError('');
    const section = activeTab === 'users' ? 'staff' : activeTab === 'appointments' ? 'appointments' : activeTab === 'audit' ? 'audit' : null;
    if (section && currentSchool) void refreshSection.current(section).catch(() => { if (current) setSectionError('Kayıtlar yüklenemedi. Lütfen tekrar deneyin.'); });
    return () => { current = false; };
  }, [activeTab, currentSchool?.id]);

  const [selectedDate, setSelectedDate] = useState(() => getIstanbulDate());
  const [appointmentMode, setAppointmentMode] = useState<'today' | 'all'>('today');
  const istanbulTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const datedAppointments = useMemo(() => activeTab !== 'appointments' ? [] : appointmentMode === 'today'
    ? appointmentsOnDate(appointments, selectedDate)
    : sortAppointmentsForAdmin(appointments, { date: getIstanbulDate(), time: istanbulTime }), [activeTab, appointmentMode, appointments, selectedDate, istanbulTime]);



  // Settings form state
  const [schoolNameInput, setSchoolNameInput] = useState(settings.schoolName);
  const [defaultSlotInput, setDefaultSlotInput] = useState(String(settings.defaultSlotMinutes));
  const [allowCancelInput, setAllowCancelInput] = useState(settings.allowParentCancel);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsSavedMsg, setSettingsSavedMsg] = useState(false);

  // Bulk Upload Modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [studentRevision, setStudentRevision] = useState(0);
  useEffect(() => {
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


  const navigation = [
    { id: 'dashboard' as const, label: 'Genel bakış', icon: Shield },
    { id: 'roster' as const, label: 'Öğrenci ve veliler', icon: GraduationCap },
    { id: 'users' as const, label: 'Personel', icon: Users },
    { id: 'admins' as const, label: 'Okul Yöneticileri', icon: Shield },
    { id: 'appointments' as const, label: 'Randevular', icon: Calendar },
    { id: 'settings' as const, label: 'Okul ayarları', icon: SettingsIcon },
    ...(!platformContextActive ? [{ id: 'requests' as const, label: 'Destek / Lisans', icon: LifeBuoy }] : []),
    { id: 'audit' as const, label: 'İşlem günlüğü', icon: FileText },
    ...(isPlatformAdmin ? [{ id: 'isolation' as const, label: 'Sistem Güvenliği', icon: CheckCircle2 }] : []),
  ];

  return (
    <div className="admin-backdrop admin-compact admin-no-duplicate-header">
      <section className="admin-panel" aria-label="Okul yönetim paneli">
        <header className="admin-header"><div><h2>{navigation.find((item) => item.id === activeTab)?.label}</h2><p>{platformContextActive ? `Platform Yönetimi · ${currentSchool?.name}` : currentSchool?.name}</p></div></header>
        <nav className="admin-nav" aria-label="Yönetim bölümleri"><p className="eyebrow">{platformContextActive ? 'SEÇİLİ OKUL YÖNETİMİ' : 'OKUL YÖNETİMİ'}</p>{navigation.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={activeTab === id ? 'page' : undefined} onClick={() => setActiveTab(id)}><Icon size={19} /><span>{label}</span></button>)}</nav>
        <label className="admin-mobile-nav" htmlFor="admin-section"><span className="sr-only">Yönetim bölümü</span><select id="admin-section" aria-label="Yönetim bölümü" value={activeTab} onChange={(event) => setActiveTab(event.target.value as typeof activeTab)}>{navigation.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <main id="main-content" className="admin-content">
          {activeTab === 'dashboard' && currentSchool && <SchoolInfo compact key={currentSchool.id} schoolId={currentSchool.id} allowCodeChange={isPlatformAdmin} onCodeChanged={refreshPlatformSchools} />}
          {onManageSchools && <Button variant="secondary" className="mb-5" onClick={onManageSchools}>Okul Yönetimi (Platform)</Button>}
          {activeTab === 'dashboard' && currentSchool && <><div className="dashboard-quick-actions"><Button variant="quiet" onClick={() => setActiveTab('roster')}>Öğrenci kayıtları</Button><Button variant="quiet" onClick={() => setActiveTab('users')}>Personeli yönet</Button><Button variant="quiet" onClick={() => setActiveTab('appointments')}>Randevuları aç</Button></div><OperationsCenter key={currentSchool.id} schoolId={currentSchool.id} onOpenRecords={(kind) => setActiveTab(kind === 'staff' ? 'users' : 'roster')} /></>}
          {sectionError && <Alert tone="danger">{sectionError}<Button variant="quiet" onClick={() => void refreshSchoolData(activeTab === 'audit' ? 'audit' : activeTab === 'appointments' ? 'appointments' : 'staff').then(() => setSectionError('')).catch(() => setSectionError('Kayıtlar yüklenemedi. Lütfen tekrar deneyin.'))}>Tekrar dene</Button></Alert>}

          {activeTab === 'roster' && currentSchool && <StudentManagement key={currentSchool.id} schoolId={currentSchool.id} schoolName={currentSchool.name} revision={studentRevision} onImport={() => { setFormError(''); setShowUploadModal(true); }} />}

          {activeTab === 'users' && <StaffManagement key={currentSchool?.id} teachers={teachers} securityUsers={users} loading={usersLoading} error={usersError} onCreateTeacher={createTeacher} />}

          {activeTab === 'admins' && currentSchool && <SchoolAdminManagement key={currentSchool.id} schoolId={currentSchool.id} schoolName={currentSchool.name} onChanged={async () => { await Promise.all([refreshSchoolData(), refreshPlatformSchools()]); }} />}

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

          {activeTab === 'requests' && !platformContextActive && <SchoolRequestCenter />}

          {activeTab === 'isolation' && isPlatformAdmin && <section className="space-y-5"><div className="surface"><div className="section-heading"><div><h3>Sistem Güvenliği</h3><p>Platform servis yapılandırmalarının güvenli durum özeti.</p></div><Button disabled={isRunningTests} onClick={handleRunIsolationTests}><Shield size={18} />{isRunningTests ? 'Kontroller çalışıyor…' : 'Okul izolasyon kontrolleri'}</Button></div></div>{isolationTestResults.length ? isolationTestResults.map((test, index) => <Alert key={index} tone={test.passed ? 'success' : 'danger'}><strong>{test.title}</strong><p className="mt-2">{test.description}</p><p className="text-xs mt-2">{test.details}</p></Alert>) : <div className="surface"><EmptyState icon={Shield} title="Güvenlik kontrolleri" description="Kontrol sonuçlarını görüntülemek için çalıştırın." /></div>}</section>}
        </main>

        {showUploadModal && currentSchool && <BulkRosterImport key={currentSchool.id} schoolId={currentSchool.id} onClose={() => setShowUploadModal(false)} onChanged={async () => { setStudentRevision((value) => value + 1); }} />}

      </section>
    </div>
  );
};
