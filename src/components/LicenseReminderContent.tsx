import React from 'react';
import { CalendarClock, CheckCircle2, Clock3, History, MessageCircle, ShieldCheck, Users } from 'lucide-react';
import { Alert, Button } from './ui';
import type { LicenseReminderOverview } from '../types/license-reminders';

export const licenseReminderReasons: Record<string,string> = {
 CONSENT_REQUIRED:'İletişim izni bulunmuyor', CONSENT_REVOKED:'İletişim izni geri çekilmiş', CONSENT_INVALID:'İzin kanıtı geçersiz veya ileri tarihli', PHONE_CONSENT_CHANGED:'Telefon değişmiş; yeni telefon için izin gerekli', PHONE_NOT_VERIFIED:'Telefon doğrulanmamış', INVALID_PHONE:'Telefon numarası eksik veya geçersiz', DUPLICATE_PHONE:'Tekrarlanan telefon; tek alıcı olarak sayıldı', PLATFORM_ACCOUNT:'Platform hesabı okul alıcısı değildir', COOLDOWN:'Son 10 dakika içinde gönderim denendi', AMBIGUOUS_PREVIOUS_RESULT:'Önceki gönderim sonucu belirsiz; inceleme gerekiyor', LEGACY_TOMBSTONE:'Eski gönderim kaydı var; mükerrer koruması etkin', ALREADY_ATTEMPTED:'Bu gönderim daha önce işlendi', LICENSE_NOT_ACTIVATED:'Lisans henüz etkinleştirilmemiş', LICENSE_INACTIVE:'Lisans aktif değil', SCHOOL_DISABLED:'Okul pasif', EXPIRED:'Lisansın süresi dolmuş', NO_EXPIRY:'Lisans bitiş tarihi yok', REJECTED:'Sağlayıcı isteği reddetti', UNKNOWN:'Sonuç belirsiz; otomatik tekrar yapılmaz', UNCERTAIN_RESULT:'Sonuç belirsiz; otomatik tekrar yapılmaz', CONFIG_UNAVAILABLE:'Gönderim servisi yapılandırması hazır değil', INVALIDATED:'Lisans, izin veya yetki değişti; gönderim durduruldu', RECIPIENT_CHANGED:'Alıcı bilgisi veya izni değişti', DISABLED:'Gerçek gönderim özelliği kapalı', PREVIEW_CHANGED:'Bilgiler değişti; yeniden önizleme gerekiyor',
};
export const reminderTime=(value:string|null|undefined)=>value?new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'—';
export function reminderDeliveryState(row:LicenseReminderOverview['history'][number]) {
 if(row.deliveryStatus==='DELIVERED')return {label:'Teslim edildi',tone:'success'};
 if(row.deliveryStatus==='FAILED')return {label:'Başarısız',tone:'danger'};
 if(row.status==='ACCEPTED')return {label:'API kabul etti',tone:'success'};
 if(row.status==='UNKNOWN')return {label:'Sonuç belirsiz',tone:'warning'};
 if(row.status==='DISPATCHING')return {label:'İşleniyor',tone:'info'};
 return {label:'Başarısız / atlandı',tone:'danger'};
}
export function LicenseReminderContent({data,busy,onPrepare,onPrevious,onNext,onRefresh}:{data:LicenseReminderOverview;busy:boolean;onPrepare:()=>void;onPrevious:()=>void;onNext:()=>void;onRefresh:()=>void}) {
 const missing=data.skipped.filter(r=>r.reason==='CONSENT_REQUIRED').length;
 const revoked=data.skipped.filter(r=>r.reason==='CONSENT_REVOKED').length;
 const invalidEvidence=data.skipped.filter(r=>['CONSENT_INVALID','PHONE_CONSENT_CHANGED'].includes(r.reason)).length;
 const blocked=data.skipped.filter(r=>r.reason!=='DUPLICATE_PHONE').length;
 const latest=data.counts.waiting?{label:'İşleniyor',tone:'info'}:data.history[0]?reminderDeliveryState(data.history[0]):{label:'Henüz gönderilmedi',tone:'neutral'};
 return <>
  <div className="license-reminder-toolbar"><p className="license-reminder-school">{data.schoolName}</p><Button variant="quiet" disabled={busy} onClick={onRefresh}>Durumu yenile</Button></div>
  <dl className="license-reminder-summary" aria-label="Hatırlatma özeti">
   <div><Users aria-hidden="true"/><dt>Aktif yönetici</dt><dd>{data.activeAdminCount}</dd></div>
   <div className="is-eligible"><CheckCircle2 aria-hidden="true"/><dt>Uygun alıcı</dt><dd>{data.recipientCount}</dd></div>
   <div className="is-permission"><ShieldCheck aria-hidden="true"/><dt>İzin kanıtı eksik</dt><dd>{missing}</dd></div>
   <div className={`is-delivery tone-${latest.tone}`}><MessageCircle aria-hidden="true"/><dt>Son gönderim</dt><dd>{latest.label}</dd></div>
  </dl>
  <section className="license-reminder-section" aria-labelledby="license-reminder-plan"><h3 id="license-reminder-plan"><CalendarClock size={19} aria-hidden="true"/>Lisans ve hatırlatma planı</h3>
   <dl className="license-reminder-plan"><div><dt>Lisans bitişi</dt><dd>{reminderTime(data.expiresAt)}</dd></div><div><dt>Sonraki otomatik zaman</dt><dd>{reminderTime(data.nextAutomaticAt)}</dd></div><div><dt>Otomatik plan</dt><dd>7, 3 ve 1 gün kala · Türkiye saatiyle 09.00</dd></div><div><dt>Otomatik gönderim</dt><dd><span className={`license-delivery-badge tone-${data.automaticEnabled?'success':'neutral'}`}>{data.automaticEnabled?'Etkin':'Kapalı'}</span></dd></div></dl>
  </section>
  <section className="license-reminder-manual" aria-labelledby="license-reminder-manual-title"><div><h3 id="license-reminder-manual-title">Manuel hatırlatma</h3><p>Önce güncel alıcıları ve mesaj alanlarını inceleyin. Onayınız olmadan gönderim başlamaz.</p></div>
   <Button disabled={busy||!!data.manualBlockedReason||data.recipientCount===0} onClick={onPrepare}><MessageCircle size={18} aria-hidden="true"/>WhatsApp Hatırlatması Gönder</Button>
   {data.manualBlockedReason&&<p role="status">{licenseReminderReasons[data.manualBlockedReason]||data.manualBlockedReason}</p>}
   {!data.manualBlockedReason&&data.recipientCount===0&&<p role="status">Uygun alıcı yok. Alıcı uygunluğu bölümündeki izin ve telefon durumlarını kontrol edin.</p>}
   {!data.manualEnabled&&<p className="license-reminder-test" role="status">Önizleme/test modu: Gerçek manuel WhatsApp gönderimi kapalı.</p>}
  </section>
  <details className="license-reminder-section" open={blocked>0}><summary tabIndex={0}><ShieldCheck size={19} aria-hidden="true"/><span>Alıcı uygunluğu</span><span>{data.recipientCount} uygun · {blocked} engellenmiş</span></summary>
   <dl className="license-reminder-counts"><div><dt>İzni geçerli ve doğrulanmış yönetici</dt><dd>{data.eligibleAdminCount}</dd></div><div><dt>Tekil uygun telefon / alıcı</dt><dd>{data.recipientCount}</dd></div><div><dt>Engellenmiş yönetici</dt><dd>{blocked}</dd></div><div><dt>İznini geri çekmiş</dt><dd>{revoked}</dd></div><div><dt>İzin kanıtı güncel/geçerli değil</dt><dd>{invalidEvidence}</dd></div><div><dt>Eksik/geçersiz telefon</dt><dd>{data.invalidPhoneCount}</dd></div></dl>
   <p className="license-reminder-guidance">İzin eksikse okul yöneticisi kendi hesabında <strong>Hesap menüsü → WhatsApp lisans bildirimleri</strong> alanından tercihini kaydedebilir. Platform yöneticisi başkası adına izin veremez. Geçerli izin tekrar istenmez; geri çekilen izin kendiliğinden açılmaz.</p>
   <ul className="license-recipient-list">{data.recipients.map(r=><li key={r.userId}><span>{r.maskedPhone}</span><span className="license-delivery-badge tone-success">Uygun</span></li>)}{data.skipped.map(r=><li key={r.userId}><span>{r.maskedPhone}</span><span>{licenseReminderReasons[r.reason]||r.reason}</span></li>)}</ul>
   {!data.recipients.length&&!data.skipped.length&&<p>Bu okul için aktif yönetici alıcısı bulunmuyor.</p>}
  </details>
  <Alert>Teslimat webhook’u bağlı değil. API kabulü, mesajın teslim edildiği anlamına gelmez.</Alert>
  <details className="license-reminder-section"><summary tabIndex={0}><History size={19} aria-hidden="true"/><span>Gönderim geçmişi</span><span>{data.counts.total} kayıt</span></summary>
   <dl className="license-reminder-counts"><div><dt>API kabul etti</dt><dd>{data.counts.accepted}</dd></div><div><dt>Teslim edildi</dt><dd>{data.counts.delivered}</dd></div><div><dt>Başarısız / atlandı</dt><dd>{data.counts.failed}</dd></div><div><dt>Sonuç belirsiz / işleniyor</dt><dd>{data.counts.unknown}</dd></div></dl>
   <div className="license-history-list">{data.history.map(row=>{const state=reminderDeliveryState(row);return <article key={row.id}><header><strong>{row.source==='MANUAL'?'Manuel':'Otomatik'}</strong><span className={`license-delivery-badge tone-${state.tone}`}>{state.label}</span></header><p>{row.maskedPhone||'Eski kayıt · alıcı bilgisi yok'}</p><time dateTime={row.createdAt}>{reminderTime(row.createdAt)}</time><small>Lisans bitimine {row.days} gün</small>{row.reason&&<p>{licenseReminderReasons[row.reason]||row.reason}</p>}</article>;})}{!data.history.length&&<p>Henüz gönderim kaydı yok.</p>}</div>
   <nav className="license-reminder-pagination" aria-label="WhatsApp geçmiş sayfaları"><Button variant="quiet" disabled={data.page===0||busy} onClick={onPrevious}>Önceki kayıtlar</Button><span>{data.page+1}. sayfa</span><Button variant="quiet" disabled={(data.page+1)*data.pageSize>=data.counts.total||busy} onClick={onNext}>Sonraki kayıtlar</Button></nav>
  </details>
  {!!data.operations?.length&&<details className="license-reminder-section"><summary tabIndex={0}><Clock3 size={19} aria-hidden="true"/><span>Manuel işlem kayıtları</span><span>{data.operations.length} son işlem</span></summary><ul className="license-operation-list">{data.operations.map(op=><li key={op.id}><time dateTime={op.createdAt}>{reminderTime(op.createdAt)}</time><span>{op.recipientCount} alıcı</span><strong>{op.status==='INVALIDATED'?'Gönderim durduruldu':op.status==='TEST'?'Test tamamlandı':op.status==='QUEUED'?'İşleniyor':op.status==='COMPLETED'?'İşlendi; alıcı sonuçlarını inceleyin':'Onay bekliyor'}</strong></li>)}</ul></details>}
 </>;
}
