import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { ManagedSchool } from '../types/platform';
import { Alert, Button, Dialog, Skeleton } from './ui';
import { formatDateTime } from '../utils/dates';
import { ShieldCheck, School as SchoolIcon, FileText, Inbox, LayoutDashboard, Trash2 } from 'lucide-react';
import { auditDisplay } from '../utils/audit-display';
import { formatTurkishPhoneInput, isValidTurkishPhoneInput } from '../utils/phone';
import { uppercasePersonNameInput } from '../utils/person-name';
import { normalizeSchoolCodeInput } from '../utils/school-code';
import { formatLicenseCodeInput } from '../utils/license-code';
import { PlatformRequestCenter } from './PlatformRequestCenter';
import { PlatformPhoneBinding } from './PlatformPhoneBinding';
import { LicenseManagement } from './LicenseManagement';

type PlatformManagementSection = 'overview' | 'schools' | 'licenses' | 'requests' | 'security' | 'audit';

export function SchoolManagement({ onClose, onManageSchool, onChanged, initialSection = 'overview' }: { onClose: () => void; onManageSchool: (schoolId: string) => void; onChanged: () => Promise<void>; initialSection?: PlatformManagementSection }) {
  const [schools, setSchools] = useState<ManagedSchool[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  const [changeMessage, setChangeMessage] = useState('Değişiklik kaydedildi ve okul listesi yenilendi.');
  const [target, setTarget] = useState<ManagedSchool | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedSchool | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [adminTarget, setAdminTarget] = useState<ManagedSchool | null>(null);
  const [adminDraft, setAdminDraft] = useState({ fullName: '', phone: '', email: '' });
  const [adminInvitePending, setAdminInvitePending] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');
  const [draft, setDraft] = useState({ name: '', code: '', licenseCode: '', city: '', district: '' });
  const [section, setSection] = useState<PlatformManagementSection>(initialSection);
  const [unseenRequests, setUnseenRequests] = useState(0);
  const [security, setSecurity] = useState<{ database: 'connected' | 'unavailable'; authConfiguration: 'ready' | 'incomplete'; codeSigning: 'ready' | 'incomplete' } | null>(null);
  const [logs, setLogs] = useState<{ id: string; schoolName: string; actorName: string; action: string; details: string; timestamp: string }[]>([]);
  const [clearAuditOpen, setClearAuditOpen] = useState(false);
  const [clearAuditConfirmation, setClearAuditConfirmation] = useState('');
  const load = async () => setSchools((await api.getManagedSchools()).schools);
  useEffect(() => {
    let cancelled = false;
    api.getManagedSchools().then((result) => { if (!cancelled) setSchools(result.schools); })
      .catch(() => { if (!cancelled) setError('Okullar yüklenemedi veya yetkiniz bulunmuyor.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const mutate = async (action: () => Promise<unknown>, successMessage = 'Değişiklik kaydedildi ve okul listesi yenilendi.') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      setChanged(true);
      setChangeMessage(successMessage);
      setTarget(null);
      const refreshResults = await Promise.allSettled([onChanged(), load()]);
      if (refreshResults.some((result) => result.status === 'rejected')) setError('Değişiklik kaydedildi ancak okul listesi yenilenemedi. Yeniden yüklemeyi deneyin.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const close = () => { onClose(); };
  const clearAuditLogs = async () => {
    if (busy || clearAuditConfirmation !== 'TEMİZLE') return;
    setBusy(true); setError('');
    try {
      await api.clearPlatformAuditLogs();
      const result = await api.getPlatformAuditLogs();
      setLogs(result.logs);
      setClearAuditOpen(false); setClearAuditConfirmation('');
      setChangeMessage('Platform işlem günlüğü temizlendi.'); setChanged(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Platform işlem günlüğü temizlenemedi.'); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let cancelled = false;
    if (section === 'security') void api.getPlatformSecurity().then(setSecurity).catch(() => setError('Sistem güvenliği bilgileri alınamadı.'));
    if (section === 'audit') void api.getPlatformAuditLogs().then((result) => setLogs(result.logs)).catch(() => setError('Platform işlem günlüğü yüklenemedi.'));
    const pendingCount = section === 'requests' ? api.markPlatformRequestsSeen() : api.getPlatformUnseenRequestCount();
    void pendingCount.then((result) => { if (!cancelled) setUnseenRequests(result.count); })
      .catch(() => { if (!cancelled) setError(section === 'requests' ? 'Yeni talepler görüntülendi olarak işaretlenemedi.' : 'Yeni talep sayısı yüklenemedi.'); });
    return () => { cancelled = true; };
  }, [section]);
  useEffect(() => { setSection(initialSection); }, [initialSection]);
  return <main id="main-content" className="page-shell platform-management-page">
    <header className="platform-management-header">
      <div><p className="eyebrow">VELİ RANDEVU</p><h1>Platform Yönetimi</h1><p>Platform genel işlemlerini ve okulları buradan yönetin.</p></div>
      <Button variant="secondary" disabled={busy} onClick={close}>Platform alanından çık</Button>
    </header>
    <div className="space-y-5">
      <nav className="platform-nav" aria-label="Platform yönetimi">
        {([{ id: 'overview', label: 'Genel Bakış', Icon: LayoutDashboard }, { id: 'schools', label: 'Okullar', Icon: SchoolIcon }, { id: 'licenses', label: 'Lisans Yönetimi', Icon: FileText }, { id: 'requests', label: 'Gelen Talepler', Icon: Inbox }, { id: 'security', label: 'Sistem Güvenliği', Icon: ShieldCheck }, { id: 'audit', label: 'Platform İşlem Günlüğü', Icon: FileText }] as const).map(({ id, label, Icon }) => <button type="button" key={id} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}><Icon size={17} />{label}{id === 'requests' && unseenRequests > 0 && <span className="platform-unseen-badge" aria-label={`${unseenRequests} yeni talep`}>{unseenRequests > 99 ? '99+' : unseenRequests}</span>}</button>)}
      </nav>
      {section === 'licenses' && <LicenseManagement/>}
      {error && <Alert tone="danger">{error}<Button variant="quiet" disabled={busy} onClick={() => { void load().then(() => setError('')).catch(() => setError('Okullar yüklenemedi.')); }}>Listeyi yeniden yükle</Button></Alert>}
      {changed && <Alert tone="success">{changeMessage}</Alert>}
      {section === 'overview' && <><div className="metric-grid"><article className="metric-card"><strong>{schools.length}</strong><p>Toplam okul</p></article><article className="metric-card"><strong>{schools.filter((school) => !school.disabledAt).length}</strong><p>Aktif</p></article><article className="metric-card"><strong>{schools.filter((school) => !!school.disabledAt).length}</strong><p>Devre dışı</p></article></div><section className="surface platform-overview-action"><div><h2>Okul yönetimi</h2><p>Okul oluşturma, yöneticisini atama ve mevcut okulları yönetme işlemlerine buradan devam edin.</p></div><Button variant="secondary" onClick={() => setSection('schools')}>Okulları Görüntüle</Button></section></>}
      {section === 'schools' && <form className="form-stack platform-school-form surface" onSubmit={(event) => { event.preventDefault(); void mutate(async () => { const result = await api.createSchool(draft); setDraft({ name: '', code: '', licenseCode: '', city: '', district: '' }); setAdminTarget(result.school); setAdminDraft({ fullName: '', phone: '', email: '' }); setAdminInvitePending(false); setAdminMessage('Okul oluşturuldu. Devam etmek için gerçek okul yöneticisini atayın.'); }); }}>
        <h3>Yeni okul ekle</h3>
        <div className="platform-school-fields">{(['name', 'code', 'licenseCode', 'city', 'district'] as const).map((key) => <label className="field" key={key}>{({ name: 'Okul adı', code: 'Okul kodu', licenseCode: 'Lisans Kodu', city: 'İl', district: 'İlçe' })[key]}
          <input required={key !== 'code' && key !== 'licenseCode'} placeholder={key === 'code' || key === 'licenseCode' ? 'Boş bırakılırsa otomatik üretilir' : undefined} disabled={busy} value={draft[key]} maxLength={key === 'name' ? 255 : key === 'code' ? 50 : key === 'licenseCode' ? 64 : 100} pattern={key === 'code' ? '[A-Z0-9_-]{3,50}' : key === 'licenseCode' ? '[A-Z0-9]+(?:-[A-Z0-9]+)*' : undefined}
            autoCapitalize={key === 'licenseCode' ? 'characters' : undefined} autoCorrect={key === 'licenseCode' ? 'off' : undefined} spellCheck={key === 'licenseCode' ? false : undefined}
            onChange={(event) => setDraft({ ...draft, [key]: key === 'code' ? normalizeSchoolCodeInput(event.target.value) : key === 'licenseCode' ? formatLicenseCodeInput(event.target.value) : event.target.value })} />{key === 'licenseCode' && <span className="field-hint">Boş bırakırsanız sistem otomatik oluşturur.</span>}</label>)}</div>
        <p className="field-hint">Okul kodu ve lisans kodu boş bırakılırsa benzersiz değerler backend tarafından üretilir. Okul yöneticisi ayrı bir aktivasyonla atanır.</p>
        <Button type="submit" disabled={busy}>Okul oluştur</Button>
      </form>}
      {section === 'schools' && (loading ? <Skeleton /> : <section className="platform-school-list" aria-label="Okullar">{schools.map((school) => <article className="surface platform-school-row" key={school.id}>
        <h3>{school.name}</h3><p>{school.code} · {school.city} / {school.district}</p>
        <p><strong>Lisans Kodu:</strong> {school.licenseCode || 'Geçiş bekliyor'} · <strong>Durum:</strong> {school.licenseStatus === 'active' ? 'Aktif' : school.licenseStatus === 'legacy' ? 'Legacy / backfill bekliyor' : school.licenseStatus === 'suspended' ? 'Askıya alındı' : 'İptal edildi'}</p>
        <p><span className={`status-badge tone-${school.disabledAt ? 'warning' : 'success'}`}>{school.disabledAt ? `Devre dışı · ${formatDateTime(school.disabledAt)}` : 'Aktif'}</span></p>
        <p><span className={`status-badge tone-${school.adminStatus === 'active' ? 'success' : 'warning'}`}>{school.adminStatus === 'active' ? `Okul Yönetimi Aktif${school.adminName ? ` · ${school.adminName}` : ''}` : school.adminStatus === 'pending' ? `Yönetici Aktivasyonu Bekliyor${school.adminName ? ` · ${school.adminName}` : ''}` : 'Okul yöneticisi atanmamış'}</span></p>
        {school.adminStatus === 'unassigned' && <Button variant="secondary" disabled={busy || !!school.disabledAt} onClick={() => { setAdminTarget(school); setAdminDraft({ fullName: '', phone: '', email: '' }); setAdminInvitePending(false); setAdminMessage(''); }}>Okul Yöneticisi Ata</Button>}
        {school.adminStatus === 'pending' && <Button variant="secondary" disabled={busy || !!school.disabledAt} onClick={() => { setAdminTarget(school); setAdminInvitePending(true); setAdminMessage('Bekleyen aktivasyon e-postası yeniden gönderilebilir.'); }}>Aktivasyon e-postasını yeniden gönder</Button>}
        <Button variant="secondary" disabled={busy || !!school.disabledAt} onClick={() => onManageSchool(school.id)}>Seçili Okulu Yönet</Button>
        <Button variant={school.disabledAt ? 'secondary' : 'danger'} disabled={busy} onClick={() => { setError(''); setTarget(school); }}>{school.disabledAt ? 'Yeniden etkinleştir' : 'Devre dışı bırak'}</Button>
        {school.disabledAt && <Button variant="danger" disabled={busy} onClick={() => { setError(''); setDeleteConfirmation(''); setDeleteTarget(school); }}><Trash2 size={17} />Okulu Kalıcı Olarak Sil</Button>}
      </article>)}</section>)}
      {section === 'security' && <><section className="surface"><h3>Sistem Güvenliği</h3><p>Yalnızca bileşen durumu gösterilir; gizli anahtar değerleri bu ekranda bulunmaz.</p>{security ? <dl className="pass-details mt-4">{([['Veritabanı', security.database === 'connected' ? 'Bağlı' : 'Erişilemiyor'], ['Oturum imzalama yapılandırması', security.authConfiguration === 'ready' ? 'Hazır' : 'Eksik'], ['Aktivasyon kodu imzalama yapılandırması', security.codeSigning === 'ready' ? 'Hazır' : 'Eksik']] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <Skeleton rows={2} />}</section><PlatformPhoneBinding /></>}
      {section === 'audit' && <section className="surface"><div className="section-heading"><h3>Platform İşlem Günlüğü</h3><Button variant="danger" disabled={busy} onClick={() => { setClearAuditConfirmation(''); setClearAuditOpen(true); }}>Platform Günlüğünü Temizle</Button></div>{logs.length ? logs.map((log) => <article key={log.id} className="py-4 border-b"><span className={`status-badge tone-${auditDisplay(log.action, log.details).tone}`}>{auditDisplay(log.action, log.details).label}</span><p className="mt-2">{log.actorName} · {log.schoolName || 'Platform'}</p><p className="text-sm text-slate-500">{formatDateTime(log.timestamp)}</p></article>) : <p className="mt-3 text-sm text-slate-500">Henüz platform işlem kaydı yok.</p>}</section>}
      {section === 'requests' && <PlatformRequestCenter />}
    </div>
    {target && <Dialog title={target.disabledAt ? 'Okulu etkinleştir' : 'Okulu devre dışı bırak'} onClose={() => setTarget(null)} dismissible={!busy}>
      <Alert tone="warning">{target.name}: {target.disabledAt ? 'Mevcut aktif üyeliklerin erişimi yeniden açılır.' : 'Bu okuldaki tüm rollerin erişimi, aktivasyon ve reset işlemleri kapanır. Geçmiş randevular, üyelikler ve ayarlar korunur; hiçbir kayıt silinmez.'} Devam etmek istiyor musunuz?</Alert>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setTarget(null)}>Vazgeç</Button><Button disabled={busy} onClick={() => { void mutate(() => api.setSchoolStatus(target.id, !!target.disabledAt)); }}>Onayla</Button></div>
    </Dialog>}
    {clearAuditOpen && <Dialog title="Platform işlem günlüğünü temizle" description="Yalnızca platform yönetimi işlem kayıtları kalıcı olarak silinecektir. Okulların operasyonel işlem geçmişi korunacaktır." onClose={() => { if (!busy) { setClearAuditOpen(false); setClearAuditConfirmation(''); } }} dismissible={!busy}>
      <div className="form-stack"><label className="field" htmlFor="platform-audit-clear-confirmation">Onaylamak için TEMİZLE yazın.
        <input id="platform-audit-clear-confirmation" autoComplete="off" value={clearAuditConfirmation} disabled={busy} onChange={(event) => setClearAuditConfirmation(event.target.value)} />
      </label>{error && <Alert tone="danger">{error}</Alert>}<div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => { setClearAuditOpen(false); setClearAuditConfirmation(''); }}>Vazgeç</Button><Button variant="danger" disabled={busy || clearAuditConfirmation !== 'TEMİZLE'} onClick={() => void clearAuditLogs()}>{busy ? 'Temizleniyor…' : 'Günlüğü Kalıcı Olarak Temizle'}</Button></div></div>
    </Dialog>}
    {deleteTarget && <Dialog title="Okulu kalıcı olarak sil" description={`${deleteTarget.name} ve okula bağlı veriler silinecektir.`} onClose={() => { setDeleteTarget(null); setDeleteConfirmation(''); }} dismissible={!busy}>
      <div className="form-stack">
        <Alert tone="danger"><strong>Bu işlem geri alınamaz.</strong><p className="mt-2">Bu okula ait öğrenciler, personel ilişkileri, randevular ve diğer okul verileri kalıcı olarak silinecektir.</p></Alert>
        <label className="field" htmlFor="permanent-school-delete-code">Kalıcı silme işlemini onaylamak için <strong>{normalizeSchoolCodeInput(deleteTarget.code)}</strong> yazın.
          <input id="permanent-school-delete-code" autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(normalizeSchoolCodeInput(event.target.value))} />
        </label>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => { setDeleteTarget(null); setDeleteConfirmation(''); }}>Vazgeç</Button><Button variant="danger" disabled={busy || deleteConfirmation !== normalizeSchoolCodeInput(deleteTarget.code)} onClick={() => { void mutate(async () => { await api.deleteSchool(deleteTarget.id); setDeleteTarget(null); setDeleteConfirmation(''); }, 'Okul ve okula bağlı veriler kalıcı olarak silindi.'); }}>{busy ? 'Siliniyor…' : 'KALICI OLARAK SİL'}</Button></div>
      </div>
    </Dialog>}
    {adminTarget && <Dialog title={adminInvitePending ? 'Okul yöneticisi aktivasyonu' : 'Okul Yöneticisi Ata'} description={`${adminTarget.name} için yönetici hesabı, e-posta aktivasyonu tamamlanınca etkinleşir.`} onClose={() => { if (!busy) setAdminTarget(null); }} dismissible={!busy}>
      <div className="form-stack">
        {adminMessage && <Alert tone={adminInvitePending ? 'warning' : 'info'}>{adminMessage}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        {!adminInvitePending ? <>
          <label className="field" htmlFor="school-admin-full-name">Yönetici Ad Soyad<input id="school-admin-full-name" autoComplete="name" maxLength={150} value={adminDraft.fullName} onChange={(event) => setAdminDraft({ ...adminDraft, fullName: uppercasePersonNameInput(event.target.value) })} required /></label>
          <label className="field" htmlFor="school-admin-phone">Telefon<input id="school-admin-phone" type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} placeholder="0555 123 45 67" value={adminDraft.phone} onChange={(event) => setAdminDraft({ ...adminDraft, phone: formatTurkishPhoneInput(event.target.value) })} required /></label>
          <label className="field" htmlFor="school-admin-email">E-posta<input id="school-admin-email" type="email" autoComplete="email" maxLength={150} value={adminDraft.email} onChange={(event) => setAdminDraft({ ...adminDraft, email: event.target.value })} required /></label>
          <p className="field-hint">Parola oluşturulmaz. Yönetici, tek kullanımlık e-posta koduyla kendi parolasını belirler.</p>
          <Button disabled={busy} onClick={() => { if (!isValidTurkishPhoneInput(adminDraft.phone)) { setError('Telefonu 0XXX XXX XX XX biçiminde girin.'); return; } void mutate(async () => {
            const result = await api.createSchoolAdminInvitation(adminTarget.id, adminDraft);
            setAdminInvitePending(true);
            setAdminMessage(result.message);
            setAdminDraft({ ...adminDraft, fullName: '', phone: '', email: '' });
            if (result.emailSent) setAdminTarget(null);
          }); }}>Aktivasyon e-postası gönder</Button>
        </> : <Button disabled={busy || !!adminTarget.disabledAt} onClick={() => { void mutate(async () => {
          const result = await api.resendSchoolAdminActivation(adminTarget.id);
          setAdminMessage(result.message);
          if (result.emailSent) setAdminTarget(null);
        }); }}>Yeniden gönder</Button>}
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setAdminTarget(null)}>Kapat</Button>
      </div>
    </Dialog>}
  </main>;
}
