import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, KeyRound, Plus, Shield, Trash2, Pencil } from 'lucide-react';
import { api } from '../services/api';
import { ManagedSchoolAdmin } from '../types/management';
import { displayStoredTurkishPhone, formatTurkishPhoneInput, isValidTurkishPhoneInput } from '../utils/phone';
import { uppercasePersonNameInput } from '../utils/person-name';
import { Alert, Button, Dialog, EmptyState, RecordAction, Skeleton } from './ui';

type FormMode = { kind: 'create' } | { kind: 'edit' | 'remove'; admin: ManagedSchoolAdmin } | null;

export function SchoolAdminManagement({ schoolId, schoolName = 'Seçili okul', onChanged }: { schoolId: string; schoolName?: string; onChanged: () => Promise<void> }) {
  const [admins, setAdmins] = useState<ManagedSchoolAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<FormMode>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [resending, setResending] = useState(false);
  const filtered = admins.filter((admin) => [admin.fullName, admin.phone, admin.email].join(' ').toLocaleLowerCase('tr-TR').includes(search.trim().toLocaleLowerCase('tr-TR')));
  const pages = Math.max(1, Math.ceil(filtered.length / 25)), currentPage = Math.min(page, pages - 1);
  const activeCount = useMemo(() => admins.filter((admin) => admin.status === 'active').length, [admins]);

  const load = useCallback(async () => {
    const result = await api.getManagedSchoolAdmins(schoolId);
    setAdmins(result.admins);
  }, [schoolId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getManagedSchoolAdmins(schoolId).then((result) => { if (!cancelled) setAdmins(result.admins); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Okul yöneticileri yüklenemedi.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [schoolId]);

  const openCreate = () => { setMode({ kind: 'create' }); setFullName(''); setPhone(''); setEmail(''); setError(''); };
  const openEdit = (admin: ManagedSchoolAdmin) => {
    setMode({ kind: 'edit', admin }); setFullName(admin.fullName); setPhone(displayStoredTurkishPhone(admin.phone)); setEmail(admin.email); setError('');
  };
  const refresh = async () => { await Promise.all([load(), onChanged()]); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mode || busy) return;
    setError(''); setBusy(true);
    try {
      if (mode.kind === 'remove') {
        await api.removeManagedSchoolAdmin(schoolId, mode.admin.id);
        setMessage('Okul yöneticisinin bu okuldaki yetkisi kaldırıldı.');
      } else {
        if (fullName.trim().split(/\s+/).length < 2) throw new Error('Ad ve soyad girin.');
        if (!isValidTurkishPhoneInput(phone)) throw new Error('Telefonu 0XXX XXX XX XX biçiminde girin.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Geçerli bir e-posta adresi girin.');
        const data = { fullName: fullName.trim(), phone, email: email.trim().toLowerCase() };
        const result = mode.kind === 'create'
          ? await api.createManagedSchoolAdmin(schoolId, data)
          : await api.updateManagedSchoolAdmin(schoolId, mode.admin.id, data);
        setMessage(result.message);
      }
      setMode(null);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.'); }
    finally { setBusy(false); }
  };

  if (loading) return <Skeleton />;
  return <section className="management-section">
    <div className="section-heading"><div><h3>Okul Yöneticileri</h3><p>Bu okulun yönetim yetkisine sahip kişileri ve bekleyen aktivasyonları yönetin.</p></div><Button onClick={openCreate}><Plus size={18} />Yeni Yönetici</Button></div>
    {message && <Alert tone="success">{message}</Alert>}
    {error && !mode && <Alert tone="danger">{error}</Alert>}
    <label className="field">Okul yöneticisi ara<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Ad, telefon veya e-posta" /></label>
    {error && !mode && <Button variant="secondary" onClick={() => { setError(''); void load().catch(() => setError('Okul yöneticileri yüklenemedi.')); }}>Tekrar dene</Button>}
    {!error && !filtered.length ? <EmptyState icon={Shield} title={admins.length ? 'Eşleşen yönetici bulunmuyor' : 'Okul yöneticisi bulunmuyor'} description="Aramanızı kontrol edin veya ilk yöneticiyi ekleyin." /> : <div className="management-list"><table className="management-table"><thead><tr><th>Ad Soyad</th><th>Telefon</th><th>E-posta</th><th>Bağlı Okul</th><th>Durum</th><th>İşlemler</th></tr></thead><tbody>
      {filtered.slice(currentPage * 25, currentPage * 25 + 25).map((admin) => <tr key={admin.id} className="school-admin-record-row"><td data-label="Ad Soyad"><strong>{admin.fullName}</strong></td><td data-label="Telefon">{displayStoredTurkishPhone(admin.phone)}</td><td data-label="E-posta">{admin.email}</td><td data-label="Bağlı Okul">{schoolName}</td><td data-label="Durum"><span className={`status-badge tone-${admin.status === 'active' ? 'success' : 'warning'}`}>{admin.status === 'active' ? <CheckCircle2 size={15} /> : <Clock size={15} />}{admin.status === 'active' ? 'Aktif' : 'Aktivasyon bekliyor'}</span></td><td data-label="İşlemler"><div className="record-actions"><RecordAction label={`${admin.fullName} adlı yöneticiyi düzenle`} icon={Pencil} onClick={() => openEdit(admin)} />{admin.status === 'pending' && <RecordAction label={`${admin.fullName} için aktivasyon e-postasını yeniden gönder`} icon={KeyRound} disabled={resending} onClick={async () => { setError(''); setResending(true); try { const result = await api.resendManagedSchoolAdminActivation(schoolId, admin.id); setMessage(result.message); } catch (cause) { setError(cause instanceof Error ? cause.message : 'E-posta gönderilemedi.'); } finally { setResending(false); } }} />}<RecordAction danger label={`${admin.fullName} adlı yöneticiyi okuldan kaldır`} icon={Trash2} disabled={admin.status === 'active' && activeCount <= 1} title={admin.status === 'active' && activeCount <= 1 ? 'Son etkin yönetici kaldırılamaz.' : undefined} onClick={() => { setMode({ kind: 'remove', admin }); setError(''); }} /></div></td></tr>)}
    </tbody></table></div>}
    {pages > 1 && <nav className="management-pagination" aria-label="Yönetici sayfaları"><Button variant="secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Önceki</Button><span>{currentPage + 1} / {pages}</span><Button variant="secondary" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Sonraki</Button></nav>}
    {mode && <Dialog title={mode.kind === 'create' ? 'Yeni Okul Yöneticisi' : mode.kind === 'edit' ? 'Yönetici Bilgilerini Düzenle' : 'Yöneticiyi Okuldan Kaldır'} onClose={() => { if (!busy) setMode(null); }} dismissible={!busy}>
      <form className="form-stack" onSubmit={submit}>
        {mode.kind === 'remove' ? <Alert tone="warning">{mode.admin.fullName} adlı kişinin bu okuldaki yönetim yetkisi kaldırılacak. Başka okul ve rol ilişkileri korunur.</Alert> : <>
          <label className="field">Ad Soyad<input autoComplete="name" maxLength={150} value={fullName} onChange={(event) => setFullName(uppercasePersonNameInput(event.target.value))} required /></label>
          <label className="field">Telefon<input type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} placeholder="0555 123 45 67" value={phone} onChange={(event) => setPhone(formatTurkishPhoneInput(event.target.value))} required /></label>
          <label className="field">E-posta<input type="email" autoComplete="email" maxLength={150} value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        </>}
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => setMode(null)}>Vazgeç</Button><Button type="submit" variant={mode.kind === 'remove' ? 'danger' : 'primary'} disabled={busy}>{busy ? 'Kaydediliyor…' : mode.kind === 'remove' ? 'Kaldırmayı Onayla' : mode.kind === 'create' ? 'Yönetici Ekle' : 'Değişiklikleri Kaydet'}</Button></div>
      </form>
    </Dialog>}
  </section>;
}
