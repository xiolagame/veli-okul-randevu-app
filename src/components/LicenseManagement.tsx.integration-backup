import React, { useEffect, useRef, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock, Search, School, PauseCircle, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import { Alert, Button, Dialog, Skeleton } from './ui';
import type { LicenseChange, LicensePage, PlatformLicense } from '../types/licenses';
import { extendLicenseCalendar, licenseExpiryFromDay, licenseLastDay, licenseStatusLabels } from '../utils/license-management';
import { formatDateTime } from '../utils/dates';

const displayTime = (value: string | null) => value ? formatDateTime(value) : '—';
export function LicenseManagement() {
  const [filters, setFilters] = useState({ q:'', status:'', threshold:30, sort:'priority', problems:false, page:0 });
  const [search, setSearch] = useState('');
  const [data, setData] = useState<LicensePage | null>(null);
  const [loading, setLoading] = useState(true), [error,setError] = useState(''), [success,setSuccess] = useState('');
  const [reload,setReload] = useState(0), [selected,setSelected] = useState<PlatformLicense | null>(null);
  const [editing,setEditing] = useState<{ license: PlatformLicense; action: LicenseChange['action']; now: Date } | null>(null);
  const [expiry,setExpiry] = useState(''), [note,setNote] = useState(''), [confirmed,setConfirmed] = useState(false);
  const [busy,setBusy] = useState(false), [formError,setFormError] = useState('');
  const pending = useRef(false), generation = useRef(0);
  useEffect(() => { const timer = window.setTimeout(() => setFilters(value => value.q===search?value:{...value,q:search,page:0}),250); return () => window.clearTimeout(timer); },[search]);
  useEffect(() => {
    const sequence = ++generation.current;
    setLoading(true); setError('');
    void api.getPlatformLicenses(filters).then(result => { if (sequence === generation.current) setData(result); })
      .catch(() => { if (sequence === generation.current) setError('Lisans listesi alınamadı. Bağlantınızı ve yetkinizi kontrol edip tekrar deneyin.'); })
      .finally(() => { if (sequence === generation.current) setLoading(false); });
    return () => { generation.current++; };
  },[filters,reload]);
  function open(license: PlatformLicense, action: LicenseChange['action']) {
    setEditing({license,action,now:new Date()}); setExpiry(license.expiresAt || ''); setNote(''); setConfirmed(false); setFormError('');
  }
  const shortening = !!editing && editing.action === 'expiry' && !!expiry && (!editing.license.expiresAt || Date.parse(expiry)<Date.parse(editing.license.expiresAt));
  const expiredResume = !!editing && editing.action === 'resume' && editing.license.expired;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || pending.current) return;
    pending.current=true; setBusy(true); setFormError('');
    try {
      const {license,action} = editing;
      if ((action!=='expiry' || shortening) && !confirmed) throw new Error('İşlemi ayrıca onaylayın.');
      const result = await api.updatePlatformLicense(license.schoolId,{action,expectedRevision:license.revision,note,
        ...(action==='expiry'?{expiresAt:expiry,confirmedShortening:confirmed}: {})});
      setSuccess('Lisans değişikliği kaydedildi. İşlem günlüğü kaydı: '+result.auditId);
      setSelected(null); setEditing(null); setReload(value=>value+1);
    } catch (cause) { setFormError(cause instanceof Error?cause.message:'Lisans değiştirilemedi.'); }
    finally { pending.current=false; setBusy(false); }
  }
  const patch = (value: Partial<typeof filters>) => setFilters(previous=>({...previous,...value,page:0}));
  const badge = (license: PlatformLicense) => <span className={`license-badge license-${license.viewStatus}`}>{licenseStatusLabels[license.viewStatus]}</span>;
  const remaining = (license: PlatformLicense) => !license.licenseId?'—':license.expired?'Süre doldu':license.remainingDays===null?'Süresiz':`${license.remainingDays} gün`;
  const actions = (license: PlatformLicense) => license.licenseId ? <div className="license-actions"><Button variant="secondary" onClick={()=>open(license,'expiry')}>Lisansı Düzenle</Button>
    {license.status==='active' && <Button variant="quiet" onClick={()=>open(license,'suspend')}>Durdur</Button>}
    {license.status==='suspended' && <Button variant="quiet" onClick={()=>open(license,'resume')}>Yeniden Etkinleştir</Button>}</div> : <span className="text-sm">Legacy erişim korunuyor</span>;
  return <section className="license-management" aria-label="Lisans Yönetimi">
    <header className="section-heading"><div><p className="eyebrow">PLATFORM / LİSANSLAR</p><h2>Lisans Yönetimi</h2><p>Okulların lisans sürelerini izleyin ve erişim durumlarını güvenle yönetin.</p></div></header>
    {success && <Alert tone="success">{success}</Alert>}
    {error && <Alert tone="danger">{error}<Button variant="quiet" onClick={()=>setReload(value=>value+1)}>Tekrar dene</Button></Alert>}
    <div className="license-metrics">{[
      {label:'Toplam okul',key:'total',icon:School,status:''},{label:'Aktif lisans',key:'active',icon:CheckCircle2,status:'active'},
      {label:'Süresi yaklaşan lisans',key:'expiring',icon:Clock,status:'expiring'}, {label:'Süresi dolan lisans',key:'expired',icon:AlertTriangle,status:'expired'},
      {label:'Manuel durdurulan lisans',key:'suspended',icon:PauseCircle,status:'suspended'},
    ].map(item=><article key={item.key} className={`license-metric license-${item.key}`}><item.icon size={23} aria-hidden="true"/><div><span>{item.label}</span><strong>{data?data.summary[item.key as keyof LicensePage['summary']]:'—'}</strong></div></article>)}</div>
    <p className="text-sm text-slate-600">Aktif sayısı yaklaşan lisansları da içerir. Süresi dolan sayısı, durdurulmuş olsa bile bitişi geçmiş lisansları kapsar.</p>
    <div className="license-filters">
      <label className="field">Okul adına göre ara<div className="field-icon"><Search size={17} aria-hidden="true"/><input value={search} maxLength={100} onChange={event=>setSearch(event.target.value)} placeholder="Okul adı…" /></div></label>
      <label className="field">Lisans durumu<select aria-label="Lisans durumu" value={filters.status} onChange={event=>patch({status:event.target.value})}><option value="">Tümü</option>{Object.entries(licenseStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field">Yaklaşan bitiş eşiği<select aria-label="Yaklaşan bitiş eşiği" value={filters.threshold} onChange={event=>patch({threshold:Number(event.target.value)})}>{[7,15,30].map(value=><option key={value} value={value}>{value} gün</option>)}</select></label>
      <label className="field">Sıralama<select aria-label="Sıralama" value={filters.sort} onChange={event=>patch({sort:event.target.value})}><option value="priority">Önce dikkat gerektirenler</option><option value="asc">Bitiş tarihi artan</option><option value="desc">Bitiş tarihi azalan</option></select></label>
      <label className="license-checkbox"><input type="checkbox" checked={filters.problems} onChange={event=>patch({problems:event.target.checked})}/>Yalnız sorunlu lisanslar</label>
      <Button variant="quiet" onClick={()=>{setSearch('');setFilters({q:'',status:'',threshold:30,sort:'priority',problems:false,page:0});}}>Filtreleri temizle</Button>
    </div>
    {loading && <p role="status">Lisans bilgileri güncelleniyor…</p>}
    {!data && loading ? <Skeleton/> : data && <>
      <div className="license-table-wrap"><table className="license-table"><thead><tr>{['Okul adı','Lisans referansı','Lisans başlangıcı','Lisans bitişi','Kalan süre','Durum','İşlemler'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{data.items.map(license=><tr key={license.schoolId}>
        <td data-label="Okul adı"><button className="license-school" onClick={()=>setSelected(license)}><School size={18} aria-hidden="true"/><span><strong>{license.schoolName}</strong><small>{license.schoolCode}{license.schoolDisabledAt?' · Okul pasif':''}</small></span></button></td>
        <td data-label="Lisans referansı"><code>{license.licenseCode||'Kayıt yok (legacy)'}</code></td>
        <td data-label="Başlangıç">{displayTime(license.activatedAt)}</td><td data-label="Bitiş">{license.expiresAt?displayTime(license.expiresAt):license.licenseId?'Süresiz':'—'}</td>
        <td data-label="Kalan süre">{remaining(license)}</td><td data-label="Durum">{badge(license)}</td><td data-label="İşlemler">{actions(license)}</td>
      </tr>)}</tbody></table></div>
      {!data.items.length && <Alert>Bu filtrelerde okul lisansı bulunmuyor.</Alert>}
      <nav className="license-pagination" aria-label="Lisans sayfaları"><Button variant="secondary" disabled={loading||filters.page===0} onClick={()=>setFilters(value=>({...value,page:Math.max(0,value.page-1)}))}>Önceki</Button><span>{data.total} okul · {filters.page+1} / {Math.max(1,Math.ceil(data.total/data.pageSize))}</span><Button variant="secondary" disabled={loading||(filters.page+1)*data.pageSize>=data.total} onClick={()=>setFilters(value=>({...value,page:value.page+1}))}>Sonraki</Button></nav>
    </>}
    {selected && <Dialog title="Lisans ayrıntıları" onClose={()=>setSelected(null)}><div className="form-stack"><h3>{selected.schoolName}</h3>{badge(selected)}
      <dl className="license-details"><dt>Lisans referansı</dt><dd>{selected.licenseCode||'Legacy — lisans kaydı yok'}</dd><dt>Başlangıç</dt><dd>{displayTime(selected.activatedAt)}</dd><dt>Bitiş (Türkiye)</dt><dd>{selected.expiresAt?displayTime(selected.expiresAt):'Süresiz / kayıt yok'}</dd><dt>Kalan süre</dt><dd>{remaining(selected)}</dd><dt>Son güncelleme (UTC)</dt><dd>{selected.updatedAt||'—'}</dd></dl>
      {selected.expired && <Alert tone="warning">Bitiş zamanı geçmiş. Yeniden etkinleştirme süreyi uzatmaz.</Alert>}
      {selected.schoolDisabledAt && <Alert tone="warning">Okul ayrıca pasifleştirilmiş. Lisans düzenlemek okulu yeniden etkinleştirmez.</Alert>}
      {!selected.licenseId && <Alert>Mevcut legacy erişim politikası korunur. Bu panel eksik lisans kaydı oluşturmaz.</Alert>}
      {actions(selected)}</div></Dialog>}
    {editing && <Dialog title={editing.action==='expiry'?'Lisans Süresini Güncelle':editing.action==='suspend'?'Lisansı Durdur':'Lisansı Yeniden Etkinleştir'} dismissible={!busy} onClose={()=>{if(!busy)setEditing(null);}}>
      <form className="form-stack license-edit" onSubmit={save}><h3>{editing.license.schoolName}</h3>{badge(editing.license)}<p>Mevcut bitiş: {editing.license.expiresAt?displayTime(editing.license.expiresAt):'Süresiz'}</p>
        {formError && <Alert tone="danger">{formError}<Button variant="quiet" disabled={busy} onClick={()=>{setEditing(null);setSelected(null);setReload(value=>value+1);}}>Güncel listeyi yükle</Button></Alert>}
        {editing.action==='expiry'?<>
          <label className="field">Yeni bitiş günü<input type="date" required disabled={busy} value={expiry?licenseLastDay(expiry):''} onChange={event=>{try{setExpiry(licenseExpiryFromDay(event.target.value));setFormError('');}catch{setExpiry('');}}}/></label>
          <div className="license-actions">{[1,3,6,12].map(months=><Button key={months} variant="secondary" disabled={busy} onClick={()=>setExpiry(extendLicenseCalendar(editing.license.expiresAt,months,editing.now))}>{months===12?'+1 yıl':`+${months} ay`}</Button>)}</div>
          <p className="text-sm">Aktif lisans mevcut bitişinden; süresi dolmuş veya süresiz lisans bu pencerenin açıldığı zamandan uzatılır. Ay sonları son geçerli güne sabitlenir. Tarih seçici, seçilen günün tamamını kapsar; sonraki Türkiye saati 00:00 hariçtir.</p>
          <Alert><CalendarClock size={17} aria-hidden="true"/>Kesin yeni bitiş (Türkiye, hariç): {expiry?displayTime(expiry):'Tarih seçin'}</Alert>
          {shortening&&<label className="license-checkbox"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={busy}/>Süre kısalmasını / süresiz lisansın tarihli olmasını ayrıca onaylıyorum.</label>}
        </>:<><Alert tone="warning">{editing.action==='suspend'?'Okulun tenant API erişimi mevcut lisans kontrolleriyle engellenecek. Öğrenci, veli, öğretmen, randevu, QR ve bildirim verileri silinmeyecek. Platform yönetimi erişimi korunur.':'Bu işlem yalnız durdurmayı kaldırır; bitiş tarihini uzatmaz. Okulun ayrıca pasif olması erişimi engellemeye devam eder.'}</Alert>
          {expiredResume&&<Alert tone="danger">Lisansın süresi dolmuş. Önce Lisansı Düzenle işleminden gelecekte bir bitiş belirleyin.</Alert>}
          <label className="license-checkbox"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={busy}/>Bu okul için işlemi onaylıyorum.</label>
        </>}
        <label className="field">{editing.action==='suspend'?'Durdurma nedeni':'Yönetici işlem notu (isteğe bağlı)'}<textarea value={note} onChange={event=>setNote(event.target.value)} maxLength={500} minLength={editing.action==='suspend'?3:undefined} required={editing.action==='suspend'} disabled={busy}/></label>
        <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={()=>setEditing(null)}>Vazgeç</Button><Button type="submit" variant={editing.action==='suspend'?'danger':'primary'} disabled={busy||expiredResume||((editing.action!=='expiry'||shortening)&&!confirmed)||(editing.action==='expiry'&&(!expiry||Date.parse(expiry)<=Date.now()))}>{busy?'Kaydediliyor…':'Kaydet'}</Button></div>
      </form>
    </Dialog>}
  </section>;
}
