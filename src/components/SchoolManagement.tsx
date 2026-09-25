import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { ManagedSchool } from '../types/platform';
import { Alert, Button, Dialog, Skeleton } from './ui';
import { formatDateTime } from '../utils/dates';

export function SchoolManagement({ onClose }: { onClose: () => void }) {
  const [schools, setSchools] = useState<ManagedSchool[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  const [target, setTarget] = useState<ManagedSchool | null>(null);
  const [draft, setDraft] = useState({ name: '', code: '', city: '', district: '' });
  const load = async () => setSchools((await api.getManagedSchools()).schools);
  useEffect(() => {
    let cancelled = false;
    api.getManagedSchools().then((result) => { if (!cancelled) setSchools(result.schools); })
      .catch(() => { if (!cancelled) setError('Okullar yüklenemedi veya yetkiniz bulunmuyor.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const mutate = async (action: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      setChanged(true);
      setTarget(null);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.'); }
    finally { pending.current = false; setBusy(false); }
  };
  const close = () => {
    if (changed) window.location.reload();
    else onClose();
  };
  return <Dialog wide title="Okul Yönetimi" description="Yalnızca yetkili platform yöneticileri içindir. Okul kayıtları kalıcı olarak silinmez." onClose={close} dismissible={!busy}>
    <div className="space-y-5">
      {error && <Alert tone="danger">{error}<Button variant="quiet" disabled={busy} onClick={() => { void load().then(() => setError('')).catch(() => setError('Okullar yüklenemedi.')); }}>Listeyi yeniden yükle</Button></Alert>}
      {changed && <Alert tone="success">Değişiklik kaydedildi. Bu pencere kapatılınca okul listeniz ve erişim bilgileriniz yenilenecek.</Alert>}
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void mutate(async () => { await api.createSchool(draft); setDraft({ name: '', code: '', city: '', district: '' }); }); }}>
        <h3>Yeni okul ekle</h3>
        {(['name', 'code', 'city', 'district'] as const).map((key) => <label className="field" key={key}>{({ name: 'Okul adı', code: 'Okul kodu', city: 'İl', district: 'İlçe' })[key]}
          <input required={key !== 'code'} placeholder={key === 'code' ? 'Boş bırakılırsa otomatik üretilir' : undefined} disabled={busy} value={draft[key]} maxLength={key === 'name' ? 255 : key === 'code' ? 50 : 100} pattern={key === 'code' ? '[A-Za-z0-9_-]{3,50}' : undefined}
            onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
        <p className="field-hint">Kod boş bırakılırsa benzersiz bir kod üretilir. Elle giriş: 3–50 harf, rakam, tire veya alt çizgi. Yeni okulda hesabınıza okul yöneticisi üyeliği eklenir.</p>
        <Button type="submit" disabled={busy}>Okul oluştur</Button>
      </form>
      {loading ? <Skeleton /> : schools.map((school) => <article className="surface" key={school.id}>
        <h3>{school.name}</h3><p>{school.code} · {school.city} / {school.district}</p>
        <p>{school.disabledAt ? `Pasif · ${formatDateTime(school.disabledAt)}` : 'Aktif'}</p>
        <Button variant={school.disabledAt ? 'secondary' : 'danger'} disabled={busy} onClick={() => { setError(''); setTarget(school); }}>{school.disabledAt ? 'Yeniden etkinleştir' : 'Devre dışı bırak'}</Button>
      </article>)}
      <Button variant="secondary" disabled={busy} onClick={close}>Kapat</Button>
    </div>
    {target && <Dialog title={target.disabledAt ? 'Okulu etkinleştir' : 'Okulu devre dışı bırak'} onClose={() => setTarget(null)} dismissible={!busy}>
      <Alert tone="warning">{target.name}: {target.disabledAt ? 'Mevcut aktif üyeliklerin erişimi yeniden açılır.' : 'Bu okuldaki tüm rollerin erişimi, aktivasyon ve reset işlemleri kapanır. Geçmiş randevular, üyelikler ve ayarlar korunur; hiçbir kayıt silinmez.'} Devam etmek istiyor musunuz?</Alert>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setTarget(null)}>Vazgeç</Button><Button disabled={busy} onClick={() => { void mutate(() => api.setSchoolStatus(target.id, !!target.disabledAt)); }}>Onayla</Button></div>
    </Dialog>}
  </Dialog>;
}
