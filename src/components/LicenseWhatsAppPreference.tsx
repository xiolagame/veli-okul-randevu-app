import {getRuntimePlatform} from '../platform/runtime-platform';
import {NativeLicenseWhatsAppPreference} from './LicenseWhatsAppPreference.native';
import React,{useEffect,useRef,useState}from'react';
import{api}from'../services/api';
import{Button}from'./ui';
import{MessageCircle}from'lucide-react';
import './license-whatsapp.css';
type Preference=Awaited<ReturnType<typeof api.getLicenseWhatsAppPreference>>;
function WebLicenseWhatsAppPreference({schoolId}:{schoolId:string}){
 const[value,setValue]=useState<Preference|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[retry,setRetry]=useState(0);
 const generation=useRef(0),pending=useRef(false);
 useEffect(()=>{const current=++generation.current;setValue(null);setError('');setMessage('');void api.getLicenseWhatsAppPreference(schoolId).then(v=>{if(current===generation.current)setValue(v)}).catch(()=>{if(current===generation.current)setError('Bildirim tercihiniz alınamadı. Tekrar deneyebilirsiniz.');});return()=>{generation.current++;};},[schoolId,retry]);
 async function save(enabled:boolean){if(pending.current||!value)return;pending.current=true;const current=generation.current;setBusy(true);setError('');setMessage('');try{const r=await api.setLicenseWhatsAppPreference(schoolId,enabled);if(current===generation.current){setValue(v=>v&&({...v,enabled:r.enabled,needsReconfirmation:false,consentStatus:r.enabled?'VALID':'REVOKED'}));setMessage(r.enabled?'WhatsApp lisans bilgilendirme izniniz kaydedildi.':'WhatsApp lisans bilgilendirme izniniz geri çekildi.');}}catch{if(current===generation.current)setError('Tercih kaydedilemedi. Mevcut izniniz değiştirilmedi; tekrar deneyebilirsiniz.');}finally{pending.current=false;if(current===generation.current)setBusy(false);}}
 const status=value?.enabled?'Etkin':value?.consentStatus==='REVOKED'?'İzin geri çekilmiş':value?.needsReconfirmation?'Telefon için izin yenilenmeli':'Henüz etkin değil';
 return <section data-license-preference tabIndex={-1} className="license-preference" aria-label="WhatsApp lisans bildirimleri"><header><strong><MessageCircle size={18} aria-hidden="true"/> WhatsApp lisans bildirimleri</strong>{value&&<span className={`license-delivery-badge tone-${value.enabled?'success':'neutral'}`}>{status}</span>}</header>
 <p>Bu okulun lisans bitişinden 7, 3 ve 1 gün önce, kayıtlı ve doğrulanmış WhatsApp telefonunuza hatırlatma alabilirsiniz. Tercihiniz isteğe bağlıdır; giriş ve aktivasyonunuzu etkilemez.</p>
 {!value&&!error&&<p role="status">Tercihiniz yükleniyor…</p>}
 {value?.enabled&&<p>İzniniz kayıtlı. Sonraki hatırlatmalar için yeniden onay vermeniz gerekmez. Gönderimler sistem ayarlarına bağlıdır.</p>}
 {value?.consentStatus==='REVOKED'&&<p>İzniniz geri çekilmiş durumda. Siz yeniden izin vermedikçe lisans mesajı gönderilmez.</p>}
 {value?.needsReconfirmation&&<p>Telefonunuz veya izin kanıtınız değişmiş. Bu telefon için yeni izin vermeden mesaj gönderilmez.</p>}
 {value&&!value.canEnable&&!value.enabled&&<p>İzin vermek için aktif okul yöneticisi üyeliği ve doğrulanmış telefon gerekir.</p>}
 {value&&<div className="license-preference-actions">{value.enabled?<Button variant="secondary" disabled={busy} onClick={()=>void save(false)}>{busy?'Kaydediliyor…':'İznimi geri çek'}</Button>:<Button disabled={busy||!value.canEnable} onClick={()=>void save(true)}>{busy?'Kaydediliyor…':'WhatsApp lisans hatırlatmalarına izin ver'}</Button>}</div>}
 <p>Yalnızca bu okulun WhatsApp lisans bildirimlerini kapsar. İzninizi buradan istediğiniz zaman geri çekebilirsiniz.</p>
 {error&&<div role="alert"><p>{error}</p>{!value&&<Button variant="quiet" onClick={()=>setRetry(v=>v+1)}>Tekrar dene</Button>}</div>}<p role="status">{message}</p></section>;
}

export function LicenseWhatsAppPreference(props:{schoolId:string}){return getRuntimePlatform()==='WEB'?<WebLicenseWhatsAppPreference {...props}/>:<NativeLicenseWhatsAppPreference {...props}/>;}
