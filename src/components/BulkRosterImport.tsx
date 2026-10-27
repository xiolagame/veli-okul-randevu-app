import React, { useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Alert, Button, Dialog } from './ui';
import { api } from '../services/api';
import { useApp } from '../context/AppContext';
import { emptyRosterRow, formatRosterDraftInput, RosterDraft, RosterPreview, ROSTER_HEADERS, validateRosterRow } from '../utils/roster-import';
import { rosterTemplate, ROSTER_TEMPLATE_FILENAME } from '../utils/roster-files';
import { rosterManifest, RosterImportJob, RosterBatchReport, transferRoster } from '../utils/roster-transfer';
import { formatTurkishPhoneInput } from '../utils/phone';
import { uppercasePersonNameInput } from '../utils/person-name';
const keys=['studentName','studentNumber','className','parentName','parentPhone'] as const;
type Field=typeof keys[number];
const formatValue=(key:Field,value:string)=>key==='parentPhone'?formatTurkishPhoneInput(value):key==='studentName'||key==='parentName'?uppercasePersonNameInput(value):key==='className'?value.toLocaleUpperCase('tr-TR'):value;
const fieldPrefixes:Record<Field,string>={studentName:'Öğrenci adı',studentNumber:'Öğrenci numarası',className:'Sınıf/şube',parentName:'Veli adı',parentPhone:'Telefon'};
export function BulkRosterImport({schoolId,onClose,onChanged}:{schoolId:string;onClose:()=>void;onChanged:()=>Promise<void>}) {
 const {currentUser}=useApp();
 const [mode,setMode]=useState<'single'|'bulk'>('single'),[single,setSingle]=useState<RosterDraft>(emptyRosterRow),[singleSaved,setSingleSaved]=useState(false);
 const [fieldErrors,setFieldErrors]=useState<Partial<Record<Field,string>>>({});
 const [records,setRecords]=useState<RosterDraft[]>([]),[preview,setPreview]=useState<RosterPreview[]|null>(null),[fileName,setFileName]=useState(''),[manifest,setManifest]=useState(''),[resumeId,setResumeId]=useState('');
 const [job,setJob]=useState<RosterImportJob|null>(null),[reports,setReports]=useState<RosterBatchReport[]>([]),[reportPage,setReportPage]=useState(0),[reportPages,setReportPages]=useState(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[page,setPage]=useState(0),[readBytes,setReadBytes]=useState(0);
 const [confirmAction,setConfirmAction]=useState<(()=>void)|null>(null);
 const locked=useRef(false),pause=useRef(false),workerRef=useRef<Worker|null>(null),workerTimer=useRef<number|undefined>(),firstInput=useRef<HTMLInputElement>(null),alive=useRef(true);
 const focusFirst=()=>{if(window.matchMedia('(pointer: fine)').matches)firstInput.current?.focus();};
 useEffect(()=>{alive.current=true;const unload=(event:BeforeUnloadEvent)=>{if(locked.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>{alive.current=false;pause.current=true;workerRef.current?.terminate();window.clearTimeout(workerTimer.current);window.removeEventListener('beforeunload',unload);};},[]);
 useEffect(()=>{if(mode==='single'&&!singleSaved&&!busy)focusFirst();},[mode,singleSaved,busy]);
 const confirm=(action:()=>void)=>setConfirmAction(()=>action);
 const close=()=>{if(locked.current)return;if(Object.values(single).some(value=>value.trim())||(records.length&&!job))confirm(onClose);else onClose();};
 const switchMode=(next:typeof mode)=>{if(!locked.current){setMode(next);setError('');setMessage('');}};
 const refresh=async()=>{try{await onChanged();}catch{setError('Kayıt tamamlandı ancak liste yenilenemedi. Yeniden kayıt göndermeden listeyi yenileyin.');}};
 const storageKey=(hash:string)=>`veli-roster-import:${currentUser?.id||'session'}:${schoolId}:${hash}`;
 async function loadFile(file:File){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');setReadBytes(0);setMessage('');setJob(null);setReports([]);
  try {
   const worker=new Worker(new URL('../utils/roster-worker.ts',import.meta.url),{type:'module'});workerRef.current=worker;
   const imported=await new Promise<RosterDraft[]>((resolve,reject)=>{const timer=window.setTimeout(()=>reject(Error('Dosya işleme süresi aşıldı. CSV kullanın veya dosyayı bölün.')),120000);workerTimer.current=timer;worker.onmessage=(event:MessageEvent<{records?:RosterDraft[];error?:string;read?:number}>)=>{if(event.data.read!==undefined){setReadBytes(event.data.read);return;}clearTimeout(timer);event.data.records?resolve(event.data.records):reject(Error(event.data.error||'Dosya okunamadı.'));};worker.onerror=()=>{clearTimeout(timer);reject(Error('Dosya okunamadı.'));};worker.postMessage({file});});
   const formatted=imported.map(formatRosterDraftInput),hash=await rosterManifest(formatted);
   if(!alive.current)return;setRecords(formatted);setManifest(hash);setFileName(file.name);setPreview(null);setPage(0);
   try {setResumeId(localStorage.getItem(storageKey(hash))||'');} catch {setError('Tarayıcı aktarım kimliğini saklayamıyor. İşlem kimliğini not alın; ilerleme sunucuda korunur.');}
  }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'Dosya okunamadı.');}
  finally{window.clearTimeout(workerTimer.current);workerTimer.current=undefined;workerRef.current?.terminate();workerRef.current=null;locked.current=false;if(alive.current)setBusy(false);}
 }
  const saveSingle = async (another: boolean) => {
    if (locked.current || singleSaved) return;
    const validation = validateRosterRow(single);
    setFieldErrors(Object.fromEntries(keys.map(key => [key, validation.errors.find(entry => entry.startsWith(fieldPrefixes[key]))])));
    setError(''); setMessage('');
    if (validation.status === 'invalid') return;
    locked.current = true; setBusy(true);
    try {
      const checked = await api.importRoster(schoolId, [validation.record], true);
      if (!checked.rows.length || checked.rows.some(row => row.status !== 'valid')) { setError(checked.rows.flatMap(row => row.errors).join(' ') || 'Bu kayıt zaten mevcut.'); return; }
      const result = await api.importRoster(schoolId, [validation.record], false);
      if (!result.addedCount) { setError('Kayıt zaten mevcut; yeni kayıt eklenmedi.'); return; }
      setSingle(emptyRosterRow()); setSingleSaved(!another); setFieldErrors({});
      setMessage('Kayıt eklendi. Görünürlük seçili sınıf ve kayıt filtresine bağlıdır.');
      await refresh(); if (another) focusFirst();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kayıt tamamlanamadı.'); }
    finally { locked.current = false; setBusy(false); }
  };

 async function run(){
  if(locked.current||!records.length)return;locked.current=true;pause.current=false;setBusy(true);setError('');setMessage('');
  try {
   const id=job?.id||resumeId||crypto.randomUUID();setResumeId(id);
   try{localStorage.setItem(storageKey(manifest),id);}catch{setError('Aktarım kimliğini not alın; tarayıcı yerel kaydı kullanılamıyor.');}
   let current=await api.startRosterImport(schoolId,id,manifest,records.length);if(!alive.current)return;setJob(current);
   if(current.status==='COMPLETED'){setMessage('Bu aktarım daha önce tamamlandı. Sunucudaki sonuç gösteriliyor; yeni kayıt gönderilmedi.');return;}
   current=await transferRoster(records,current,(id,index,rows)=>api.sendRosterBatch(schoolId,id,index,rows),value=>{if(alive.current)setJob(value);},()=>pause.current||!alive.current);
   if(!alive.current)return;setJob(current);
   setMessage(current.status==='COMPLETED'?`${current.added} kayıt eklendi; ${current.skipped} mevcut kayıt atlandı; ${current.invalid} hatalı kayıt atlandı.`:'Aktarım duraklatıldı. Kaydedilen partiler sunucuda korunuyor.');
   await refresh();
  }catch(cause){if(alive.current)setError((cause instanceof Error?cause.message:'Aktarım durdu.')+' Tamamlanmış partiler korunur. Aynı dosyayla Devam Et düğmesini kullanın.');}
  finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 async function loadReports(next:number){if(!job)return;try{const result=await api.getRosterImportReports(schoolId,job.id,next);setReports(result.reports);setReportPage(next);setReportPages(result.pages);}catch{setError('Hata raporu alınamadı. Yeniden deneyin.');}}
 const download=async()=>{try{const buffer=await rosterTemplate();const url=URL.createObjectURL(new Blob([new Uint8Array(buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const link=document.createElement('a');link.href=url;link.download=ROSTER_TEMPLATE_FILENAME;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setError('Şablon indirilemedi.');}};
 const currentPage=Math.min(page,Math.max(0,Math.ceil(records.length/25)-1));
 return <>
 <Dialog className="record-center" title="Kayıt ekle" description="Tek öğrenci kaydı oluşturun veya Excel / CSV ile toplu kayıt aktarın." onClose={close} dismissible={!busy}>
  <div className="record-center-tabs" role="tablist" aria-label="Kayıt yöntemi">{(['single','bulk']as const).map(tab=><button type="button" role="tab" id={`record-tab-${tab}`} key={tab} aria-selected={mode===tab} aria-controls={`record-panel-${tab}`} disabled={busy} onClick={()=>switchMode(tab)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=tab==='single'?'bulk':'single';switchMode(next);document.getElementById(`record-tab-${next}`)?.focus();}}}>{tab==='single'?'Tekli kayıt':'Toplu kayıt'}</button>)}</div>
  <div className="record-center-content" role="tabpanel" id={`record-panel-${mode}`} aria-labelledby={`record-tab-${mode}`}>
  {error&&<Alert tone="danger">{error}</Alert>}{message&&<Alert tone="info">{message}</Alert>}
  {mode==='single'?singleSaved?<div className="record-center-result"><h3>Kayıt tamamlandı</h3><p>Yeni kayıt ekleyebilir veya öğrenci listesine dönebilirsiniz.</p></div>:
           <form id="single-roster-form" noValidate onSubmit={event => { event.preventDefault(); void saveSingle(false); }} className="record-single-form">
            {keys.map((key, index) => <label className="field" key={key} htmlFor={`single-${key}`}>{ROSTER_HEADERS[index]}<input ref={index === 0 ? firstInput : undefined} id={`single-${key}`} aria-label={ROSTER_HEADERS[index]} value={single[key]} disabled={busy} required={key !== 'studentNumber'} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `error-${key}` : undefined} type={key === 'parentPhone' ? 'tel' : 'text'} inputMode={key === 'parentPhone' ? 'tel' : undefined} placeholder={key === 'parentPhone' ? '0555 123 45 67' : key === 'className' ? '5/C' : undefined} maxLength={key === 'parentPhone' ? 18 : key === 'studentName' || key === 'parentName' ? 150 : 50} onChange={event => { setSingle({ ...single, [key]: formatValue(key, event.target.value) }); setFieldErrors({ ...fieldErrors, [key]: undefined }); }} />{fieldErrors[key] && <span className="record-field-error" id={`error-${key}`}>{fieldErrors[key]}</span>}</label>)}
          </form> : <div className="record-bulk-content">
   <div className="record-file-tools"><Button variant="secondary" disabled={busy} onClick={()=>void download()}><Download size={18} aria-hidden="true"/>Excel Şablonunu İndir</Button><div className="file-picker"><input id="bulk-roster-file" className="sr-only" type="file" accept=".xlsx,.csv" disabled={busy} aria-label="XLSX veya CSV dosyası yükle" onChange={event=>{const file=event.target.files?.[0];if(file){const action=()=>void loadFile(file);if(job?.status==='RUNNING')confirm(action);else action();}event.target.value='';}}/><label className="ui-button ui-button-secondary" htmlFor="bulk-roster-file"><Upload size={18} aria-hidden="true"/>Dosya seç / yükle</label><span aria-live="polite">{fileName||'Dosya seçilmedi'}</span></div><p className="field-hint">Excel veya UTF-8 CSV yükleyin. Kayıt kotası yoktur; aktarım güvenli partiler halinde yapılır.</p></div>
   {busy&&!job&&<p role="status">Dosya / aktarım hazırlanıyor… {readBytes>0?`${Math.ceil(readBytes/1024)} KB okundu`:''}</p>}
   {!!records.length&&<><p role="status">{records.length} öğrenci okundu.</p><label className="field">Devam işlem kimliği (isteğe bağlı)<input value={resumeId} onChange={event=>{setResumeId(event.target.value);setJob(null);}} disabled={busy} autoComplete="off"/></label>
   {job?.status==='COMPLETED'&&<Button variant="secondary" disabled={busy} onClick={()=>{setJob(null);setResumeId('');setMessage('Yeni aktarımda mevcut okul kayıtları tekrar kontrol edilir; mükerrerler atlanır.');}}>Aynı dosyayla yeni aktarım</Button>}
   {preview&&<><p>Önizleme yereldir; okul kayıtları sunucuda her parti için yeniden doğrulanır. Hatalı satırlar atlanır, geçerli kayıtlar eklenir.</p><div className="record-table-scroll" tabIndex={0} aria-label="Kayıt önizleme tablosu"><table className="record-import-table"><thead><tr>{ROSTER_HEADERS.map(h=><th key={h}>{h}</th>)}<th>Durum</th></tr></thead><tbody>{preview.slice(currentPage*25,currentPage*25+25).map((row,i)=><tr key={i}>{keys.map(key=><td key={key}>{row.record[key]||'—'}</td>)}<td>{row.status==='invalid'?row.errors.join(' '):'Doğrulamaya hazır'}</td></tr>)}</tbody></table></div><nav className="management-pagination" aria-label="Önizleme sayfaları"><Button variant="quiet" disabled={busy||currentPage===0} onClick={()=>setPage(currentPage-1)}>Önceki</Button><span>{currentPage+1} / {Math.ceil(records.length/25)}</span><Button variant="quiet" disabled={busy||(currentPage+1)*25>=records.length} onClick={()=>setPage(currentPage+1)}>Sonraki</Button></nav></>}
   {job&&<section className="surface" aria-label="Aktarım ilerlemesi"><p>İşlem kimliği: <code>{job.id}</code></p><progress max={job.totalRows} value={job.processed} aria-label="Aktarım yüzdesi"/><p role="status">Toplam: {job.totalRows} · Kontrol edilen: {job.processed} · Eklenen: {job.added} · Hatalı: {job.invalid} · Atlanan / mükerrer: {job.skipped} · %{Math.floor(job.processed/job.totalRows*100)} · {job.status==='COMPLETED'?'Tamamlandı':busy?'Aktarılıyor':'Devam etmeye hazır'}</p><Button variant="quiet" disabled={busy} onClick={()=>void loadReports(0)}>Hatalı satır raporu</Button></section>}
   {!!reports.length&&<section aria-label="Aktarım hata raporu"><ul>{reports.flatMap(batch=>batch.errors).map(row=><li key={row.row}>Satır {row.row}: {row.errors.join(' ')}</li>)}</ul>{!reports.some(batch=>batch.errors.length>0)&&<p>Bu rapor sayfasında hata yok.</p>}<Button variant="quiet" disabled={reportPage===0} onClick={()=>void loadReports(reportPage-1)}>Önceki rapor</Button><span>{reportPage+1} / {reportPages}</span><Button variant="quiet" disabled={reportPage+1>=reportPages} onClick={()=>void loadReports(reportPage+1)}>Sonraki rapor</Button></section>}
   </>}
  </div>}
  </div>
  <footer className="record-center-footer"><span className="field-hint">{busy?'İşlem sürüyor; tamamlanan partiler sunucuda kaydedilir.':'Kayıtlar seçili okula eklenir.'}</span><div className="record-center-actions"><Button variant="secondary" disabled={busy} onClick={close}>{message||singleSaved?'Kapat':'İptal'}</Button>
  {mode==='single'?singleSaved?<Button onClick={()=>{setSingleSaved(false);setMessage('');}}>Yeni kayıt</Button>:<><Button variant="secondary" disabled={busy} onClick={()=>void saveSingle(true)}>Kaydet ve yeni ekle</Button><Button type="submit" form="single-roster-form" disabled={busy}>Kaydet</Button></>:<>
   {busy&&job?<Button variant="secondary" onClick={()=>{pause.current=true;}}>Bu partiden sonra duraklat</Button>:null}
   {!preview?<Button disabled={busy||!records.length} onClick={()=>{setPreview(records.map(record=>({...validateRosterRow(record),record})));setPage(0);}}>Önizle</Button>:job?.status!=='COMPLETED'&&<Button disabled={busy} onClick={()=>void run()}>{job||resumeId?'Devam Et':'İçe Aktar'}</Button>}
  </>}
  </div></footer>
 </Dialog>
 {confirmAction&&<Dialog title="Kaydedilmemiş veriler" description="Dosya taslağı kaldırılacak. Daha önce tamamlanan aktarım partileri geri alınmaz. Devam etmek istiyor musunuz?" onClose={()=>setConfirmAction(null)}><div className="form-actions"><Button variant="secondary" onClick={()=>setConfirmAction(null)}>Vazgeç</Button><Button variant="danger" onClick={()=>{const action=confirmAction;setConfirmAction(null);action();}}>Devam et</Button></div></Dialog>}
 </>;
}
