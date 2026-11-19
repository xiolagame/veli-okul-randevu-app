import {getRuntimePlatform} from '../platform/runtime-platform';
import {NativeLicenseWhatsAppPanel} from './LicenseWhatsAppPanel.native';
import React,{useEffect,useRef,useState}from'react';
import{api}from'../services/api';
import{Alert,Button,Dialog}from'./ui';
import type{LicenseReminderOverview,LicenseReminderPreview}from'../types/license-reminders';
import {LicenseReminderContent,licenseReminderReasons as reasons} from './LicenseReminderContent';
import './license-whatsapp.css';
function WebLicenseWhatsAppPanel({schoolId,onClose}:{schoolId:string;onClose:()=>void}){
 const[data,setData]=useState<LicenseReminderOverview|null>(null),[page,setPage]=useState(0),[reload,setReload]=useState(0),[error,setError]=useState(''),[message,setMessage]=useState('');
 const[preview,setPreview]=useState<LicenseReminderPreview|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false);const pending=useRef(false),generation=useRef(0),mounted=useRef(true),previewPanel=useRef<HTMLElement>(null),content=useRef<HTMLDivElement>(null),hadPreview=useRef(false);
 useEffect(()=>{if(preview){previewPanel.current?.focus({preventScroll:true});previewPanel.current?.scrollIntoView({block:'nearest',behavior:'instant'});}else if(hadPreview.current){content.current?.querySelector<HTMLButtonElement>('.license-reminder-toolbar button')?.focus({preventScroll:true});}hadPreview.current=!!preview;},[preview]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 useEffect(()=>{const current=++generation.current;setError('');void api.getLicenseWhatsApp(schoolId,page).then(value=>{if(current===generation.current)setData(value)}).catch(()=>{if(current===generation.current)setError('Hatırlatma bilgileri alınamadı. Bağlantınızı kontrol edip tekrar deneyin.');});return()=>{generation.current++;}},[schoolId,page,reload]);
 useEffect(()=>{if(!data||(data.counts.waiting===0&&!data.history.some(r=>r.status==='DISPATCHING')))return;let attempts=0;const timer=window.setInterval(()=>{if(++attempts>20){window.clearInterval(timer);return;}setReload(v=>v+1)},3000);return()=>window.clearInterval(timer);},[data?.counts.waiting,data?.history.some(r=>r.status==='DISPATCHING')]);
 async function prepare(){if(pending.current)return;pending.current=true;setBusy(true);setError('');try{const value=await api.previewLicenseWhatsApp(schoolId);if(mounted.current){setPreview(value);setConfirmed(false);}}catch{if(mounted.current)setError('Önizleme oluşturulamadı. Lisansı, alıcı bilgilerini ve bağlantıyı kontrol edin.');}finally{pending.current=false;if(mounted.current)setBusy(false);}}
 async function send(){if(!preview||!confirmed||pending.current)return;pending.current=true;setBusy(true);setError('');try{const result=await api.confirmLicenseWhatsApp(schoolId,preview.operationId);if(mounted.current){setPreview(null);setMessage(result.status==='TEST'?'Test tamamlandı. Gerçek WhatsApp gönderimi kapalı; Meta API çağrılmadı.':result.workerAccepted?'Gönderim kuyruğa alındı. Her alıcının sonucu geçmişte gösterilecek.':'İşlem kayıtlı. Gönderimin güncel durumunu yenileyin; yeni bir gönderim başlatmayın.');setReload(v=>v+1);}}catch{if(mounted.current)setError('Onay tamamlanamadı veya önizleme değişti. Durumu yenileyin; sonuç belirsizse yeni gönderim başlatmayın.');}finally{pending.current=false;if(mounted.current)setBusy(false);}}
 return <Dialog title="WhatsApp Lisans Hatırlatmaları" description="Seçili okulun lisans bildirim durumu." className="license-reminder-dialog" wide dismissible={!busy} onClose={onClose}><div ref={content} className="license-whatsapp">
 {error&&<Alert tone="danger">{error}</Alert>}{message&&<Alert tone="success">{message}</Alert>}
 {!data?<><p role="status">WhatsApp bilgileri yükleniyor…</p>{error&&<Button variant="quiet" onClick={()=>setReload(v=>v+1)}>Tekrar dene</Button>}</>:<LicenseReminderContent data={data} busy={busy} onPrepare={()=>void prepare()} onPrevious={()=>setPage(v=>v-1)} onNext={()=>setPage(v=>v+1)} onRefresh={()=>setReload(v=>v+1)}/>}
 {preview&&<section ref={previewPanel} tabIndex={-1} className="license-reminder-preview" aria-label="WhatsApp gönderim onayı"><h3>Mesaj önizlemesi</h3><p>Onaylı şablon: {preview.template} · {preview.language}</p><p>Şablona gönderilecek alanlar:</p><dl className="license-details"><dt>Okul</dt><dd>{preview.schoolName}</dd><dt>Kalan takvim günü</dt><dd>{preview.days}</dd><dt>Lisans bitişi</dt><dd>{preview.expiryDate}</dd></dl><p>{preview.recipientCount} tekil alıcı: {preview.recipients.map(r=>r.maskedPhone).join(', ')}</p>
 {preview.blockedRecipients?.map((r,i)=><p key={i}>{r.maskedPhone} · {reasons[r.reason]||r.reason}</p>)}
 <Alert>{preview.live?'Onayınızdan sonra gerçek WhatsApp mesajları gönderilecek.':'TEST MODU: Meta API’ye mesaj gönderilmeyecek.'}</Alert>
 <label className="flex items-start gap-3"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>Seçili okulun güncel bilgilerini, alıcı sayısını ve {preview.live?'gerçek gönderimi':'test işlemini'} açıkça onaylıyorum.</span></label>
 <div className="flex flex-wrap gap-3"><Button disabled={!confirmed||busy||preview.recipientCount===0} onClick={()=>void send()}>{busy?'İşleniyor…':preview.live?'Onayla ve gönder':'Testi onayla'}</Button><Button variant="quiet" disabled={busy} onClick={()=>setPreview(null)}>Vazgeç</Button></div></section>}
 </div></Dialog>;
}

export function LicenseWhatsAppPanel(props:{schoolId:string;onClose:()=>void}){return getRuntimePlatform()==='WEB'?<WebLicenseWhatsAppPanel {...props}/>:<NativeLicenseWhatsAppPanel {...props}/>;}
