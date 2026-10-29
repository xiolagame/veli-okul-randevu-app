import React,{useEffect,useState}from'react';
import{api}from'../services/api';
import{Button}from'./ui';
export function LicenseWhatsAppPreference({schoolId}:{schoolId:string}){
 const[value,setValue]=useState<{enabled:boolean;canEnable:boolean;needsReconfirmation?:boolean}|null>(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let current=true;void api.getLicenseWhatsAppPreference(schoolId).then(v=>{if(current){setValue(v);setChecked(v.enabled);}}).catch(()=>{if(current)setError('WhatsApp tercihi alınamadı. Bağlantınızı ve yetkinizi kontrol edin.');});return()=>{current=false;};},[schoolId]);
 if(!value)return <p role="status">{error||"WhatsApp tercihi yükleniyor…"}</p>;
 async function save(){if(busy)return;setBusy(true);setMessage('');try{const r=await api.setLicenseWhatsAppPreference(schoolId,checked);setValue(v=>v&&({...v,enabled:r.enabled,needsReconfirmation:false}));setMessage(r.enabled?'WhatsApp lisans bilgilendirme izniniz kaydedildi.':'WhatsApp lisans bilgilendirme izniniz geri çekildi.');}catch{setMessage('Tercih kaydedilemedi. Üyeliğinizi ve doğrulanmış telefonunuzu kontrol edin.');}finally{setBusy(false);}}
 return <section className="license-whatsapp-preference rounded-xl border border-slate-200 p-3 text-sm form-stack" aria-label="WhatsApp lisans bildirimleri"><strong>WhatsApp lisans bildirimleri</strong><p>Bu okulun lisans bitiş hatırlatmalarını hesabımdaki doğrulanmış telefonuma WhatsApp üzerinden almak istiyorum. İznimi buradan geri çekebilirim.</p>
 {value.needsReconfirmation&&<p>Telefonunuz değişti; izninizi yeniden onaylamanız gerekiyor.</p>}
 {!value.canEnable&&<p>İzin açmak için aktif okul yöneticisi üyeliği ve doğrulanmış telefon gerekir.</p>}
 <label className="flex items-start gap-3"><input type="checkbox" checked={checked} disabled={busy||(!value.canEnable&&!value.enabled)} onChange={e=>setChecked(e.target.checked)}/><span>Yalnız lisans bilgilendirme mesajlarına izin veriyorum.</span></label>
 <Button variant="secondary" disabled={busy||checked===value.enabled&&!value.needsReconfirmation} onClick={()=>void save()}>{busy?'Kaydediliyor…':'Tercihimi kaydet'}</Button><p role="status">{message}</p></section>;
}
