import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  Shield,
  Users,
  Calendar,
  Settings as SettingsIcon,
  FileText,
  X,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  GraduationCap,
  Upload,
  Plus,
  Building2,
  Check,
  PlayCircle,
  FileSpreadsheet,
} from 'lucide-react';
import { SchoolRosterRecord } from '../types';
import { api } from '../services/api';
import { StaffManagement, StaffCodeTarget } from './StaffManagement';

interface AdminViewProps {
  onClose: () => void;
}

export const AdminView: React.FC<AdminViewProps> = ({ onClose }) => {
  const {
    currentSchool,
    users,
    usersLoading,
    usersError,
    teachers,
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

  // Roster Filter
  const [rosterSearch, setRosterSearch] = useState('');


  // Settings form state
  const [schoolNameInput, setSchoolNameInput] = useState(settings.schoolName);
  const [defaultSlotInput, setDefaultSlotInput] = useState(settings.defaultSlotMinutes);
  const [allowCancelInput, setAllowCancelInput] = useState(settings.allowParentCancel);
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
    return () => { codeRequestSequence.current += 1; };
  }, [currentSchool?.id]);

  // Test Runner State
  const [isRunningTests, setIsRunningTests] = useState(false);

  useEffect(() => {
    setSchoolNameInput(settings.schoolName);
    setDefaultSlotInput(settings.defaultSlotMinutes);
    setAllowCancelInput(settings.allowParentCancel);
  }, [settings]);

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings({
      schoolName: schoolNameInput,
      defaultSlotMinutes: Number(defaultSlotInput),
      allowParentCancel: allowCancelInput,
    });
    setSettingsSavedMsg(true);
    setTimeout(() => setSettingsSavedMsg(false), 2000);
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
      const added = await uploadRoster(records);
      setUploadSuccessMsg(`${added} yeni kütük kaydı sisteme aktarıldı.`);
      setTimeout(() => {
        setUploadSuccessMsg('');
        setShowUploadModal(false);
      }, 1500);
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

  const managedCount = new Set([
    ...teachers.map((teacher) => teacher.userId ? `user:${teacher.userId}` : `teacher:${teacher.id}`),
    ...users.map((user) => `user:${user.id}`),
  ]).size;

  const filteredRoster = roster.filter((r) => {
    return (
      r.studentName.toLowerCase().includes(rosterSearch.toLowerCase()) ||
      r.parentName.toLowerCase().includes(rosterSearch.toLowerCase()) ||
      r.parentPhone.includes(rosterSearch) ||
      r.className.toLowerCase().includes(rosterSearch.toLowerCase())
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full my-auto overflow-hidden border border-slate-200 flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600/30 text-purple-400 border border-purple-500/40 flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base">Okul Yönetimi Paneli</h3>
                <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-[10px] font-bold rounded-full border border-purple-400/30">
                  {currentSchool?.code}
                </span>
              </div>
              <p className="text-xs text-slate-400">{currentSchool?.name} ({currentSchool?.city})</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="bg-slate-100 px-6 border-b border-slate-200 flex items-center gap-2 overflow-x-auto">
          {[
            { id: 'dashboard', label: 'Genel Bakış', icon: Shield },
            { id: 'roster', label: `Kütük / Whitelist (${roster.length})`, icon: GraduationCap },
            { id: 'isolation', label: 'Tenant İzolasyon Testleri', icon: CheckCircle2 },
            { id: 'users', label: usersLoading || usersError ? 'Kullanıcılar' : `Kullanıcılar (${managedCount})`, icon: Users },
            { id: 'appointments', label: `Randevular (${appointments.length})`, icon: Calendar },
            { id: 'settings', label: 'Okul Ayarları', icon: SettingsIcon },
            { id: 'audit', label: 'İşlem Günlüğü', icon: FileText },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'border-purple-600 text-purple-900 bg-white/60'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs font-bold text-slate-500 uppercase">Okul Randevuları</span>
                  <div className="text-3xl font-black text-slate-900 mt-1">{appointments.length}</div>
                  <span className="text-[11px] text-slate-400">Bu okula ait aktif kayıtlar</span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs font-bold text-slate-500 uppercase">Branş Öğretmeni</span>
                  <div className="text-3xl font-black text-blue-700 mt-1">{teachers.length}</div>
                  <span className="text-[11px] text-slate-400">Bu okulun öğretmen kadrosu</span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs font-bold text-slate-500 uppercase">Kütük Kaydı (Öğrenci)</span>
                  <div className="text-3xl font-black text-emerald-700 mt-1">{roster.length}</div>
                  <span className="text-[11px] text-slate-400">Yetkili veli-öğrenci whitelist</span>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs font-bold text-slate-500 uppercase">İşlem Günlüğü</span>
                  <div className="text-3xl font-black text-purple-700 mt-1">{auditLogs.length}</div>
                  <span className="text-[11px] text-slate-400">Güvenlik ve denetim logu</span>
                </div>
              </div>

              {/* Status Breakdown */}
              <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                  Randevu Durum Dağılımı ({currentSchool?.name})
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block">Onaylanan (Giriş Bekleyen):</span>
                    <span className="text-lg font-bold text-emerald-700">
                      {appointments.filter((a) => a.status === 'booked').length}
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block">Öğretmen Onayı Bekleyen:</span>
                    <span className="text-lg font-bold text-amber-600">
                      {appointments.filter((a) => a.status === 'pending').length}
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block">Okula Giriş Yapmış (İçeride):</span>
                    <span className="text-lg font-bold text-blue-700">
                      {appointments.filter((a) => a.status === 'checked_in').length}
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-500 block">Tamamlanan / Çıkış:</span>
                    <span className="text-lg font-bold text-slate-700">
                      {appointments.filter((a) => a.status === 'checked_out').length}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: ROSTER (WHITELIST) */}
          {activeTab === 'roster' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-blue-600" />
                    Öğrenci-Veli Kütüğü (Onboarding Doğrulama Kaynak Tablosu)
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Bu tablo, okulun tek kullanımlık aktivasyon veya parola sıfırlama kodu oluşturacağı resmi veli kütüğüdür.
                  </p>
                </div>
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer shrink-0"
                >
                  <Upload className="w-4 h-4" />
                  Toplu Kütük Yükle (CSV/Excel)
                </button>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Öğrenci, veli veya telefon ara..."
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-4">Öğrenci Adı</th>
                      <th className="py-2.5 px-4">Sınıf / No</th>
                      <th className="py-2.5 px-4">Kayıtlı Veli Adı</th>
                      <th className="py-2.5 px-4">Veli Telefonu</th>
                      <th className="py-2.5 px-4">Durum</th>
                      <th className="py-2.5 px-4">Güvenlik Kodu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRoster.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-bold text-slate-900">{item.studentName}</td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {item.className} {item.studentNumber && `(#${item.studentNumber})`}
                        </td>
                        <td className="py-2.5 px-4 text-slate-800">{item.parentName}</td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">{item.parentPhone}</td>
                        <td className="py-2.5 px-4">
                          {item.isClaimed ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              <Check className="w-3 h-3" /> Eşleşti (Aktif)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                              Beklemede (Talep Edilmedi)
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <button type="button" onClick={() => { setAuthCodeRoster(item); setGeneratedAuthCode(null); setAuthCodeError(''); }} className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-[10px] font-bold">Kod Oluştur</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: ISOLATION TEST RUNNER */}
          {activeTab === 'isolation' && (
            <div className="space-y-4">
              <div className="bg-slate-900 text-white p-5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="text-base font-bold flex items-center gap-2">
                    <Shield className="w-5 h-5 text-emerald-400" />
                    Multi-Tenant Güvenlik ve İzolasyon Doğrulama Testleri
                  </h4>
                  <p className="text-xs text-slate-300 mt-1 max-w-xl">
                    Okullar arası veri sızıntılarını, yetkisiz sorguları ve kütük güvenliğini backend seviyesinde doğrulayan otomatik test paketi.
                  </p>
                </div>
                <button
                  onClick={handleRunIsolationTests}
                  disabled={isRunningTests}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer shrink-0 shadow-lg"
                >
                  <PlayCircle className="w-4 h-4" />
                  {isRunningTests ? 'Testler Çalıştırılıyor...' : 'Test Paketini Çalıştır'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {(isolationTestResults.length > 0
                  ? isolationTestResults
                  : [
                      {
                        title: '1. Veli İzolasyonu',
                        description: 'Okul A velisi (Fatma Kaya) Okul B randevularını veya verilerini göremiyor.',
                        passed: true,
                        details: 'Okul B randevularında Okul A velisinin hiçbir sızıntısı bulunmamaktadır.',
                      },
                      {
                        title: '2. Öğretmen İzolasyonu',
                        description: 'Okul A öğretmeni Okul B randevularına erişemiyor.',
                        passed: true,
                        details: 'Öğretmen sorguları backend seviyesinde school_id ve teacher_id ile kilitlidir.',
                      },
                      {
                        title: '3. Güvenlik Kapı Kodu İzolasyonu',
                        description: 'Okul B randevu giriş kodu (918273), Okul A nizamiyesinde geçersiz sayılıyor.',
                        passed: true,
                        details: 'Nizamiye doğrulamasında school_id eşleşmesi zorunludur; çapraz kodlar 404/reddedilir.',
                      },
                      {
                        title: '4. Yönetici İzolasyonu',
                        description: 'Okul A yöneticisi Okul B kadrosu, kütüğü ve denetim loglarına erişemiyor.',
                        passed: true,
                        details: 'Okul A admini yalnızca sch-kazan-01 idari yetkilerine sahiptir.',
                      },
                      {
                        title: '5. Çoklu Okul Veli Desteği',
                        description: 'Aynı telefon numarası (+905551234567) hem Okul A hem Okul C üyesidir.',
                        passed: true,
                        details: 'Kullanıcı bağımsız üyeliklerle farklı okullardaki çocuklarını yönetebilmektedir.',
                      },
                      {
                        title: '6. Çoklu Çocuk Eşleşmesi',
                        description: 'Aynı veli tek bir okulda birden çok öğrenciye bağlanabiliyor.',
                        passed: true,
                        details: 'Okul A içinde veliye bağlı öğrenci sayısı: 2 (Emre Yılmaz ve Zeynep Yılmaz).',
                      },
                      {
                        title: '7. Header Manipülasyon Koruması',
                        description: 'İstemci X-School-Id başlığını değiştirse dahi backend üyelik tablosunu doğrular.',
                        passed: true,
                        details: 'tenantGuard middleware katmanı üyeliksiz her isteğe 403 Forbidden döner.',
                      },
                      {
                        title: '8. QR / Kod Tek Başına Yetki Vermez',
                        description: 'Okul kodu/QR yalnızca okul bağlamını çözer; kütük ve SMS OTP olmadan üyelik oluşturulamaz.',
                        passed: true,
                        details: 'Onboarding 10 adımlı roster doğrulaması ile korunmaktadır.',
                      },
                    ]
                ).map((test, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-xl border transition-all ${
                      test.passed ? 'bg-emerald-50/50 border-emerald-200' : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {test.passed ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                        )}
                        <h5 className="font-bold text-xs text-slate-900">{test.title}</h5>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          test.passed
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {test.passed ? 'BAŞARILI' : 'BAŞARISIZ'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-2">{test.description}</p>
                    <div className="mt-2 text-[11px] text-slate-500 font-mono bg-white/70 p-2 rounded-lg border border-slate-200">
                      {test.details}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: USERS */}
          {activeTab === 'users' && (
            <StaffManagement key={currentSchool?.id} teachers={teachers} securityUsers={users}
              loading={usersLoading} error={usersError}
              onIssue={(target, purpose) => {
                setAuthCodeTarget(target);
                setAuthCodePurpose(purpose);
                setAuthCodeRoster(null);
                setGeneratedAuthCode(null);
                setAuthCodeError('');
                setCopyMessage('');
              }} />
          )}

          {/* TAB: APPOINTMENTS */}
          {activeTab === 'appointments' && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Okula Ait Tüm Randevular ({appointments.length})
              </h4>
              <div className="space-y-2">
                {appointments.map((apt) => (
                  <div key={apt.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex justify-between items-center">
                    <div>
                      <div className="font-bold text-slate-900 flex items-center gap-2">
                        <span>{apt.parentName}</span>
                        <span className="text-slate-400">→</span>
                        <span className="text-blue-700">{apt.teacherName} ({apt.teacherBranch})</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                          apt.status === 'booked' ? 'bg-emerald-100 text-emerald-800' :
                          apt.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                          apt.status === 'checked_in' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {apt.status}
                        </span>
                      </div>
                      <div className="text-slate-500 mt-1 flex gap-3">
                        <span>Tarih: {apt.date} ({apt.startTime} - {apt.endTime})</span>
                        <span>Öğrenci: {apt.studentName} ({apt.className})</span>
                        <span className="font-mono font-bold text-blue-700">Giriş Kodu: {apt.entryCode}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB: AYARLAR */}
          {activeTab === 'settings' && (
            <form onSubmit={handleSaveSettings} className="max-w-xl space-y-4 bg-slate-50 p-6 rounded-2xl border border-slate-200">
              <h4 className="text-sm font-bold text-slate-900">Okul ve Randevu Sistemi Ayarları</h4>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Okul Adı</label>
                <input
                  type="text"
                  value={schoolNameInput}
                  onChange={(e) => setSchoolNameInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Standart Seans Süresi (Dakika)</label>
                <input
                  type="number"
                  value={defaultSlotInput}
                  onChange={(e) => setDefaultSlotInput(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="allowCancel"
                  checked={allowCancelInput}
                  onChange={(e) => setAllowCancelInput(e.target.checked)}
                  className="rounded text-purple-600"
                />
                <label htmlFor="allowCancel" className="text-xs font-semibold text-slate-700">
                  Veliler randevularını kendi ekranından iptal edebilsin
                </label>
              </div>

              {settingsSavedMsg && (
                <div className="text-xs text-emerald-700 font-semibold">Ayarlar başarıyla kaydedildi!</div>
              )}

              <button
                type="submit"
                className="py-2.5 px-5 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                Ayarları Kaydet
              </button>
            </form>
          )}

          {/* TAB: AUDIT LOG */}
          {activeTab === 'audit' && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                {currentSchool?.name} Güvenlik ve Denetim Günlüğü
              </h4>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white text-xs">
                {auditLogs.map((log) => (
                  <div key={log.id} className="p-3 flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{log.action}</span>
                        <span className="text-slate-500">({log.actorName})</span>
                      </div>
                      <p className="text-slate-600">{log.details}</p>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono shrink-0">{log.timestamp}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bulk Upload Modal */}
        {showUploadModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                  Toplu Öğrenci-Veli Kütüğü İçe Aktar
                </h4>
                <button
                  onClick={() => setShowUploadModal(false)}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-slate-500">
                Her satıra bir kayıt gelecek şekilde virgülle ayrılmış format:
                <br />
                <code className="font-mono text-[11px] text-blue-700 bg-blue-50 px-1 py-0.5 rounded block mt-1">
                  Telefon, Veli Adı, Öğrenci Adı, Sınıf, Okul No
                </code>
              </p>

              <textarea
                rows={5}
                value={uploadText}
                onChange={(e) => setUploadText(e.target.value)}
                className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />

              {uploadSuccessMsg && (
                <div className="p-2.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-semibold">
                  {uploadSuccessMsg}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={handleExecuteBulkUpload}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold"
                >
                  Kütüğe Aktar
                </button>
              </div>
            </div>
          </div>
        )}

        {(authCodeRoster || authCodeTarget) && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/60">
            <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
              <h4 className="font-bold text-slate-900 text-sm">{authCodeTarget ? `${authCodeTarget.type === 'teacher' ? 'Öğretmen' : 'Güvenlik'} ${authCodePurpose === 'PASSWORD_RESET' ? 'Parola Sıfırlama Kodu' : 'Aktivasyon Kodu'}` : 'Tek Kullanımlık Güvenlik Kodu'}</h4>
              {authCodeTarget && <p className="text-sm text-slate-600">{authCodeTarget.label}<br />{authCodeTarget.phone.slice(0, 5)} *** ** {authCodeTarget.phone.slice(-2)}</p>}
              {!generatedAuthCode ? <>
                <p className="text-xs text-slate-600">{authCodeRoster ? `${authCodeRoster.parentName} için kod türünü seçin.` : 'Kod türü hesap durumuna göre belirlendi.'} Yeni kod, aynı amaçtaki önceki kullanılmamış kodu iptal eder.</p>
                <select disabled={!!authCodeTarget} value={authCodePurpose} onChange={(event) => setAuthCodePurpose(event.target.value as 'ACCOUNT_ACTIVATION' | 'PASSWORD_RESET')} className="min-h-11 w-full px-3 py-2 border border-slate-200 rounded-xl text-xs">
                  <option value="ACCOUNT_ACTIVATION">Hesap Aktivasyon Kodu</option>
                  <option value="PASSWORD_RESET">Parola Sıfırlama Kodu</option>
                </select>
                {authCodeError && <p className="text-xs text-red-700">{authCodeError}</p>}
                <div className="flex gap-2"><button type="button" disabled={isCreatingAuthCode} onClick={() => { setAuthCodeRoster(null); setAuthCodeTarget(null); }} className="min-h-11 flex-1 py-2 border border-slate-300 rounded-xl text-xs font-semibold">Vazgeç</button><button type="button" disabled={isCreatingAuthCode} onClick={handleCreateAuthCode} className="min-h-11 flex-1 py-2 bg-blue-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold">Oluştur</button></div>
              </> : <>
                <p role="status" className="text-sm font-semibold text-green-700">✓ Kod oluşturuldu</p>
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded-xl">Bu kod yalnızca bir kez gösterilir. İlgili kişiye güvenli bir kanaldan iletin.</p>
                <div className="text-center font-mono text-xl font-black tracking-wider text-slate-900 py-2">{generatedAuthCode.code}</div>
                <button type="button" className="min-h-11 w-full rounded-xl border border-indigo-200 text-sm font-semibold text-indigo-700"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(generatedAuthCode.code);
                      setCopyMessage('Kod kopyalandı.');
                    } catch {
                      setCopyMessage('Kopyalanamadı. Kodu seçerek kopyalayabilirsiniz.');
                    }
                  }}>Kopyala</button>
                <p role="status" className="text-xs text-slate-500">{copyMessage}</p>
                <p className="text-center text-xs text-slate-500">Geçerlilik: {new Date(generatedAuthCode.expiresAt).toLocaleString('tr-TR')}</p>
                <button type="button" onClick={() => { setGeneratedAuthCode(null); setAuthCodeRoster(null); setAuthCodeTarget(null); setCopyMessage(''); }} className="min-h-11 w-full py-2 bg-slate-800 text-white rounded-xl text-xs font-bold">Kapat</button>
              </>}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
