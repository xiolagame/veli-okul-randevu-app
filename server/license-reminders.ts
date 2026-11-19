import { createHash, randomUUID } from 'node:crypto';
import { getDb, TransactionClient } from './database/postgres';
import { hashSetupToken } from './activation-codes';
import { normalizeTurkishPhone } from '../src/utils/phone';
import { isPlatformAdmin } from './auth';
import { licenseDeliveryEnabled, sendWhatsAppLicenseReminder, LicenseDeliveryResult } from './whatsapp-license-delivery';
import { getConfiguration } from './whatsapp-cloud';

export type LicenseDatabase = Pick<Awaited<ReturnType<typeof getDb>>, 'query' | 'transaction'>;
export class LicenseReminderError extends Error { constructor(public status: number, public code: string) { super(code); } }
interface LicenseRow { id: string; school_id: string; name: string; disabled_at: string | null; status: string; activated_at: string | null; expires_at: string | null }
interface Target { userId: string; phone: string; fingerprint: string; destinationKey: string; maskedPhone: string }
interface Operation { id: string; school_id: string; license_id: string; actor_user_id: string; actor_auth_version: number; snapshot_hash: string; period_hash: string; reminder_days: number; status: string; live_preview: boolean; expires_at: string; last_wake_at?:string|null;recipient_count?:number;target_keys?:string[] }
export function istanbulDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  return ['year','month','day'].map(key=>parts.find(p=>p.type===key)!.value).join('-');
}
export function reminderDays(expires: string, now: Date): number { return (Date.parse(istanbulDate(new Date(expires)))-Date.parse(istanbulDate(now)))/86400000; }
export function reminderPhoneFingerprint(userId: string, phone: string): string {
  const canonical=normalizeTurkishPhone(phone); if(!canonical) throw new LicenseReminderError(400,'INVALID_PHONE');
  return hashSetupToken(`license-reminder-consent:${userId}:${canonical}`);
}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const period=(row:LicenseRow)=>digest([row.id,row.activated_at&&new Date(row.activated_at).toISOString(),row.expires_at&&new Date(row.expires_at).toISOString()]);
export const maskReminderPhone=(phone: string)=>normalizeTurkishPhone(phone)?.replace(/^(\+90)(\d{3})\d{5}(\d{2})$/,'$1 $2 *** ** $3')||'Telefon eksik/geçersiz';
export function licenseEligibility(row: LicenseRow, now: Date, source:'AUTO'|'MANUAL'):string|null {
  if(row.disabled_at) return 'SCHOOL_DISABLED'; if(row.status!=='active') return 'LICENSE_INACTIVE';
  if(!row.activated_at||Date.parse(row.activated_at)>now.getTime()) return 'LICENSE_NOT_ACTIVATED';
  if(!row.expires_at) return 'NO_EXPIRY'; if(!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=now.getTime()) return 'EXPIRED';
  return source==='AUTO'&&![7,3,1].includes(reminderDays(row.expires_at,now))?'NOT_DUE':null;
}
export async function loadReminderLicense(tx:TransactionClient,schoolId:string,lock=false):Promise<LicenseRow> {
  if(lock) await tx.query('SELECT id FROM schools WHERE id=$1 FOR UPDATE',[schoolId]);
  const row=(await tx.query<LicenseRow>(`SELECT l.*,s.name,s.disabled_at FROM school_licenses l JOIN schools s ON s.id=l.school_id WHERE l.school_id=$1 ${lock?'FOR UPDATE OF l':''}`,[schoolId])).rows[0];
  if(!row) throw new LicenseReminderError(404,'LICENSE_NOT_FOUND'); return row;
}
export async function resolveLicenseRecipients(tx:TransactionClient,schoolId:string,now:Date,lock=false) {
  const admins=(await tx.query<{id:string;phone:string;is_phone_verified:boolean}>(`SELECT u.id,u.phone,u.is_phone_verified FROM school_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.school_id=$1 AND m.role='admin' AND m.status='active' ORDER BY u.id ${lock?'FOR UPDATE OF m,u':''}`,[schoolId])).rows;
  const prefs=(await tx.query<{user_id:string;phone_fingerprint:string;consent_at:string;consent_reference:string;revoked_at:string|null}>(`SELECT user_id,phone_fingerprint,consent_at,consent_reference,revoked_at FROM school_license_reminder_recipients WHERE school_id=$1 ORDER BY user_id ${lock?'FOR UPDATE':''}`,[schoolId])).rows;
  const byUser=new Map(prefs.map(pref=>[pref.user_id,pref]));
  // A second active account with the same destination must not bypass an
  // explicit withdrawal for that phone in this school.
  const revokedPhones=new Set(admins.flatMap(admin=>{
    const phone=normalizeTurkishPhone(admin.phone),pref=byUser.get(admin.id);
    return phone&&pref?.revoked_at&&pref.phone_fingerprint===reminderPhoneFingerprint(admin.id,phone)?[phone]:[];
  }));
  const targets:Target[]=[], skipped:Array<{userId:string;maskedPhone:string;reason:string}>=[];let eligibleAdminCount=0;
  for(const admin of admins) {
    const phone=normalizeTurkishPhone(admin.phone);
    const pref=byUser.get(admin.id),consentTime=pref?Date.parse(pref.consent_at):NaN;
    // Only scoped, current evidence grants permission. OTP proves phone control,
    // not permission to receive license notices; missing evidence fails closed.
    const reason=isPlatformAdmin(admin.id)?'PLATFORM_ACCOUNT':!phone?'INVALID_PHONE':!admin.is_phone_verified?'PHONE_NOT_VERIFIED'
      :pref?.revoked_at||revokedPhones.has(phone)?'CONSENT_REVOKED':!pref?'CONSENT_REQUIRED'
      :!pref.consent_reference?.trim()||!Number.isFinite(consentTime)||consentTime>now.getTime()?'CONSENT_INVALID'
      :pref.phone_fingerprint!==reminderPhoneFingerprint(admin.id,phone)?'PHONE_CONSENT_CHANGED':null;
    if(reason){skipped.push({userId:admin.id,maskedPhone:maskReminderPhone(admin.phone),reason});continue;}
    eligibleAdminCount++;
    const destinationKey=hashSetupToken(`license-reminder-destination:${phone}`);
    if(targets.some(t=>t.destinationKey===destinationKey)){skipped.push({userId:admin.id,maskedPhone:maskReminderPhone(admin.phone),reason:'DUPLICATE_PHONE'});continue;}
    targets.push({userId:admin.id,phone:phone!,fingerprint:reminderPhoneFingerprint(admin.id,phone!),destinationKey,maskedPhone:maskReminderPhone(phone!)});
  }
  return {activeAdminCount:admins.length,eligibleAdminCount,targets,skipped,invalidPhoneCount:skipped.filter(s=>s.reason==='INVALID_PHONE').length};
}
function snapshot(row:LicenseRow,recipients:Awaited<ReturnType<typeof resolveLicenseRecipients>>,now:Date) {
  return digest([period(row),row.name,reminderDays(row.expires_at!,now),recipients.targets.map(t=>[t.userId,t.destinationKey,t.fingerprint]),recipients.skipped]);
}
async function actorValid(tx:TransactionClient,op:Operation) {
  if(!isPlatformAdmin(op.actor_user_id))return false;
  return (await tx.query<{auth_version:number}>('SELECT auth_version FROM users WHERE id=$1 FOR UPDATE',[op.actor_user_id])).rows[0]?.auth_version===op.actor_auth_version;
}
function nextAutomatic(row:LicenseRow,now:Date):string|null {
  if(licenseEligibility(row,now,'MANUAL'))return null;
  return [7,3,1].map(days=>new Date(Date.parse(istanbulDate(new Date(row.expires_at!)))-days*86400000+6*3600000))
    .find(date=>date>now)?.toISOString()||null;
}
export async function licenseReminderOverview(schoolId:string,page=0,db?:LicenseDatabase|TransactionClient,now=new Date()) {
  db=db||await getDb();const row=await loadReminderLicense(db,schoolId),r=await resolveLicenseRecipients(db,schoolId,now);
  const history=(await db.query(`SELECT id,source,operation_id AS "operationId",actor_user_id AS "actorUserId",masked_phone AS "maskedPhone",status,delivery_status AS "deliveryStatus",reason,
    reminder_days AS days,created_at AS "createdAt",completed_at AS "completedAt" FROM school_license_reminder_attempts WHERE school_id=$1 ORDER BY created_at DESC,id LIMIT 25 OFFSET $2`,[schoolId,page*25])).rows;
  const counts=(await db.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='ACCEPTED')::int AS accepted,
    count(*) FILTER(WHERE delivery_status='DELIVERED')::int AS delivered,count(*) FILTER(WHERE status IN ('REJECTED','CONFIG_UNAVAILABLE','INVALIDATED','SKIPPED','DISABLED') OR delivery_status='FAILED')::int AS failed,
    count(*) FILTER(WHERE status IN ('UNKNOWN','DISPATCHING'))::int AS unknown,max(created_at) AS "lastAttemptAt",max(completed_at) FILTER(WHERE status='ACCEPTED') AS "lastSentAt"
    FROM school_license_reminder_attempts WHERE school_id=$1`,[schoolId])).rows[0];
  const waiting=(await db.query<{count:number}>("SELECT count(*)::int AS count FROM school_license_reminder_operations WHERE school_id=$1 AND status='QUEUED'",[schoolId])).rows[0].count;
  const operations=(await db.query(`SELECT id,status,recipient_count AS \"recipientCount\",created_at AS \"createdAt\" FROM school_license_reminder_operations WHERE school_id=$1 ORDER BY created_at DESC,id LIMIT 10`,[schoolId])).rows;
  return {schoolId,schoolName:row.name,activeAdminCount:r.activeAdminCount,eligibleAdminCount:r.eligibleAdminCount,recipientCount:r.targets.length,invalidPhoneCount:r.invalidPhoneCount,
    skipped:r.skipped,recipients:r.targets.map(t=>({userId:t.userId,maskedPhone:t.maskedPhone})),expiresAt:row.expires_at,
    nextAutomaticAt:nextAutomatic(row,now),automaticEnabled:licenseDeliveryEnabled('AUTO'),manualEnabled:licenseDeliveryEnabled('MANUAL'),
    manualBlockedReason:licenseEligibility(row,now,'MANUAL'),counts:{...counts,waiting},history,operations,page,pageSize:25};
}
async function manualPlan(tx:TransactionClient,row:LicenseRow,targets:Target[],now:Date){
 const included:Target[]=[],skipped:Array<{maskedPhone:string;reason:string}>=[];
 for(const target of targets){
  const uncertain=await tx.query(`SELECT id FROM school_license_reminder_attempts WHERE school_id=$1 AND license_id=$2 AND period_hash=$3 AND ((destination_key=$4 AND status IN ('UNKNOWN','DISPATCHING')) OR masked_phone IS NULL)`,[row.school_id,row.id,period(row),target.destinationKey]);
  const cooldown=(await tx.query<{reserved_at:string}>('SELECT reserved_at FROM school_license_reminder_cooldowns WHERE school_id=$1 AND destination_key=$2',[row.school_id,target.destinationKey])).rows[0];
  const reason=uncertain.rows.length?'AMBIGUOUS_PREVIOUS_RESULT':cooldown&&Date.parse(cooldown.reserved_at)>now.getTime()-600000?'COOLDOWN':null;
  if(reason)skipped.push({maskedPhone:target.maskedPhone,reason});else included.push(target);
 }return{included,skipped};
}
export async function previewManualLicenseReminder(input:{schoolId:string;actorId:string;authVersion:number},db?:LicenseDatabase,now=new Date()) {
  db=db||await getDb();return db.transaction(async tx=>{
    const row=await loadReminderLicense(tx,input.schoolId,true);const reason=licenseEligibility(row,now,'MANUAL');if(reason)throw new LicenseReminderError(409,reason);
    const recipients=await resolveLicenseRecipients(tx,row.school_id,now,true);if(!recipients.targets.length)throw new LicenseReminderError(409,'NO_ELIGIBLE_RECIPIENT');
    const plan=await manualPlan(tx,row,recipients.targets,now);
    const op:Operation={id:randomUUID(),school_id:row.school_id,license_id:row.id,actor_user_id:input.actorId,actor_auth_version:input.authVersion,
      snapshot_hash:snapshot(row,recipients,now),period_hash:period(row),reminder_days:reminderDays(row.expires_at!,now),status:'PREVIEW',live_preview:licenseDeliveryEnabled('MANUAL'),recipient_count:plan.included.length,target_keys:plan.included.map(t=>t.destinationKey),expires_at:new Date(now.getTime()+300000).toISOString()};
    if(!await actorValid(tx,op))throw new LicenseReminderError(403,'PLATFORM_AUTHORITY_REQUIRED');
    await tx.query(`INSERT INTO school_license_reminder_operations(id,school_id,license_id,actor_user_id,actor_auth_version,snapshot_hash,period_hash,reminder_days,live_preview,status,expires_at,recipient_count,target_keys)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PREVIEW',$10,$11,$12::jsonb)`,[op.id,op.school_id,op.license_id,op.actor_user_id,op.actor_auth_version,op.snapshot_hash,op.period_hash,op.reminder_days,op.live_preview,op.expires_at,op.recipient_count,JSON.stringify(op.target_keys)]);
    return {operationId:op.id,schoolName:row.name,recipientCount:plan.included.length,blockedRecipients:plan.skipped,recipients:plan.included.map(t=>({maskedPhone:t.maskedPhone})),
      template:'kolayokul_lisans_hatirlatma',language:'tr',days:op.reminder_days,expiryDate:istanbulDate(new Date(row.expires_at!)).split('-').reverse().join('.'),live:op.live_preview,expiresAt:op.expires_at};
  });
}
export async function confirmManualLicenseReminder(input:{schoolId:string;actorId:string;operationId:string;confirmed:boolean},db?:LicenseDatabase,now=new Date()) {
  if(input.confirmed!==true)throw new LicenseReminderError(400,'EXPLICIT_CONFIRMATION_REQUIRED');db=db||await getDb();
  return db.transaction(async tx=>{
    const row=await loadReminderLicense(tx,input.schoolId,true);
    const op=(await tx.query<Operation>('SELECT * FROM school_license_reminder_operations WHERE id=$1 AND school_id=$2 AND actor_user_id=$3 FOR UPDATE',[input.operationId,input.schoolId,input.actorId])).rows[0];
    if(!op)throw new LicenseReminderError(404,'OPERATION_NOT_FOUND');if(!await actorValid(tx,op))throw new LicenseReminderError(403,'PLATFORM_AUTHORITY_REQUIRED');
    if(op.status!=='PREVIEW'){const shouldWake=op.status==='QUEUED'&&(!op.last_wake_at||Date.parse(op.last_wake_at)<=now.getTime()-60000);if(shouldWake)await tx.query('UPDATE school_license_reminder_operations SET last_wake_at=$2 WHERE id=$1',[op.id,now]);return {operationId:op.id,status:op.status,shouldWake};}
    const r=await resolveLicenseRecipients(tx,row.school_id,now,true);
    if(Date.parse(op.expires_at)<=now.getTime()||licenseEligibility(row,now,'MANUAL')||snapshot(row,r,now)!==op.snapshot_hash||op.live_preview!==licenseDeliveryEnabled('MANUAL'))throw new LicenseReminderError(409,'PREVIEW_CHANGED');
    if(!op.target_keys?.length)throw new LicenseReminderError(409,'NO_SENDABLE_RECIPIENT');
    const status=op.live_preview?'QUEUED':'TEST';await tx.query('UPDATE school_license_reminder_operations SET status=$2,confirmed_at=$3,last_wake_at=$3 WHERE id=$1',[op.id,status,now]);
    return {operationId:op.id,status,shouldWake:status==='QUEUED'};
  });
}

export async function runLicenseReminderJob(options:{dryRun?:boolean;now?:Date;db?:LicenseDatabase;send?:typeof sendWhatsAppLicenseReminder}={}) {
  const summary={dryRun:options.dryRun===true,disabled:!licenseDeliveryEnabled('AUTO')&&!licenseDeliveryEnabled('MANUAL'),scanned:0,eligible:0,accepted:0,unknown:0,rejected:0,deferred:false,skipped:{} as Record<string,number>};
  if(summary.disabled&&!summary.dryRun)return summary;
  if(!summary.dryRun&&!options.send){try{getConfiguration();}catch{summary.skipped.CONFIG_UNAVAILABLE=1;return summary;}}
  const db=options.db||await getDb(),now=()=>options.now||new Date(),started=Date.now();const skip=(s:string)=>{summary.skipped[s]=(summary.skipped[s]||0)+1;};
  async function dispatch(schoolId:string,target:Target,source:'AUTO'|'MANUAL',op?:Operation) {
    let attemptId:string|undefined;
    try{
      const claim=await db.transaction(async tx=>{
        const row=await loadReminderLicense(tx,schoolId,true);if(licenseEligibility(row,now(),source))return {skip:'LICENSE_CHANGED'};
        const r=await resolveLicenseRecipients(tx,schoolId,now(),true),fresh=r.targets.find(t=>t.destinationKey===target.destinationKey);
        if(!fresh)return {skip:'RECIPIENT_CHANGED'};
        if(op&&(!await actorValid(tx,op)||Date.parse(op.expires_at)<=now().getTime()||snapshot(row,r,now())!==op.snapshot_hash))return {skip:'PREVIEW_CHANGED'};
        const currentPeriod=period(row),days=reminderDays(row.expires_at!,now());
        const legacy=await tx.query(`SELECT id FROM school_license_reminder_attempts WHERE school_id=$1 AND license_id=$2 AND period_hash=$3 AND reminder_days=$4 AND masked_phone IS NULL`,[schoolId,row.id,currentPeriod,days]);
        const prior=await tx.query(`SELECT id FROM school_license_reminder_attempts WHERE school_id=$1 AND license_id=$2 AND period_hash=$3 AND destination_key=$4 AND status IN ('UNKNOWN','DISPATCHING')`,[schoolId,row.id,currentPeriod,fresh.destinationKey]);
        const exists=await tx.query(`SELECT id FROM school_license_reminder_attempts WHERE school_id=$1 AND destination_key=$2 AND ((source='AUTO' AND $3='AUTO' AND license_id=$4 AND period_hash=$5 AND reminder_days=$6) OR (source='MANUAL' AND operation_id=$7))`,[schoolId,fresh.destinationKey,source,row.id,currentPeriod,days,op?.id||null]);
        if(exists.rows.length)return {skip:'ALREADY_ATTEMPTED'};
        const cooldown=(await tx.query<{reserved_at:string}>('SELECT reserved_at FROM school_license_reminder_cooldowns WHERE school_id=$1 AND destination_key=$2 FOR UPDATE',[schoolId,fresh.destinationKey])).rows[0];
        const blockedReason=legacy.rows.length?'LEGACY_TOMBSTONE':prior.rows.length?'AMBIGUOUS_PREVIOUS_RESULT':cooldown&&Date.parse(cooldown.reserved_at)>now().getTime()-600000?'COOLDOWN':null;
        const blocked=!!blockedReason;
        if(blocked&&source==='AUTO')return {skip:blockedReason!};
        const id=randomUUID();
        await tx.query(`INSERT INTO school_license_reminder_attempts(id,school_id,license_id,period_hash,expires_at,reminder_days,recipient_id,phone_fingerprint,status,source,operation_id,actor_user_id,destination_key,masked_phone,reason)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[id,schoolId,row.id,currentPeriod,row.expires_at,days,fresh.userId,fresh.fingerprint,blocked?'SKIPPED':'DISPATCHING',source,op?.id||null,op?.actor_user_id||null,fresh.destinationKey,fresh.maskedPhone,blockedReason]);
        if(blocked)return {skip:blockedReason!};
        await tx.query(`INSERT INTO school_license_reminder_cooldowns(school_id,destination_key,reserved_at) VALUES($1,$2,$3)
          ON CONFLICT(school_id,destination_key) DO UPDATE SET reserved_at=EXCLUDED.reserved_at`,[schoolId,fresh.destinationKey,now()]);
        return {id,currentPeriod,days,fresh};
      });
      if(claim.skip||!claim.id){skip(claim.skip||'ALREADY_ATTEMPTED');return;}attemptId=claim.id;summary.eligible++;
      const outcome=await db.transaction(async tx=>{
        const row=await loadReminderLicense(tx,schoolId,true),r=await resolveLicenseRecipients(tx,schoolId,now(),true),fresh=r.targets.find(t=>t.destinationKey===target.destinationKey);
        const valid=!licenseEligibility(row,now(),source)&&period(row)===claim.currentPeriod&&reminderDays(row.expires_at!,now())===claim.days&&fresh?.userId===claim.fresh!.userId&&fresh?.fingerprint===claim.fresh!.fingerprint
          &&(!op||(await actorValid(tx,op)&&Date.parse(op.expires_at)>now().getTime()&&snapshot(row,r,now())===op.snapshot_hash));
        let result:LicenseDeliveryResult|{status:'INVALIDATED'};
        if(!valid)result={status:'INVALIDATED'};else if(!licenseDeliveryEnabled(source))result={status:'DISABLED'};
        else result=await(options.send||sendWhatsAppLicenseReminder)({phone:fresh!.phone,schoolName:row.name,days:claim.days!,expiryDate:istanbulDate(new Date(row.expires_at!)).split('-').reverse().join('.'),source});
        await tx.query(`UPDATE school_license_reminder_attempts SET status=$2,provider_message_id=$3,completed_at=$4,reason=$5 WHERE id=$1 AND status='DISPATCHING'`,[claim.id,result.status,'messageId'in result?result.messageId||null:null,now(),result.status==='ACCEPTED'?null:result.status]);
        return result.status;
      });
      if(outcome==='ACCEPTED')summary.accepted++;else if(outcome==='UNKNOWN')summary.unknown++;else{summary.rejected++;skip(outcome);}
    }catch{summary.unknown++;skip('SAFE_JOB_ERROR');if(attemptId)try{await db.query("UPDATE school_license_reminder_attempts SET status='UNKNOWN',reason='UNCERTAIN_RESULT',completed_at=$2 WHERE id=$1 AND status='DISPATCHING'",[attemptId,now()]);}catch{/* Keep durable tombstone. */}}
  }
  if(licenseDeliveryEnabled('MANUAL')&&!summary.dryRun){
    const operations=(await db.query<Operation>("SELECT * FROM school_license_reminder_operations WHERE status='QUEUED' ORDER BY created_at LIMIT 100")).rows;
    for(const op of operations){
      let r:Awaited<ReturnType<typeof resolveLicenseRecipients>>;
      try{const row=await loadReminderLicense(db,op.school_id);r=await resolveLicenseRecipients(db,op.school_id,now());
        if(licenseEligibility(row,now(),'MANUAL')||Date.parse(op.expires_at)<=now().getTime()||snapshot(row,r,now())!==op.snapshot_hash||!await actorValid(db,op))throw new Error('STALE');
      }catch{await db.query("UPDATE school_license_reminder_operations SET status='INVALIDATED' WHERE id=$1",[op.id]);skip('PREVIEW_CHANGED');continue;}
      for(const t of r.targets.filter(t=>op.target_keys?.includes(t.destinationKey))){if(Date.now()-started>13*60000){summary.deferred=true;return summary;}await dispatch(op.school_id,t,'MANUAL',op);}
      await db.query(`UPDATE school_license_reminder_operations SET status=CASE WHEN (SELECT count(*) FROM school_license_reminder_attempts WHERE operation_id=$1)>=$2 THEN 'COMPLETED' ELSE 'INVALIDATED' END WHERE id=$1 AND status='QUEUED' AND NOT EXISTS(SELECT 1 FROM school_license_reminder_attempts WHERE operation_id=$1 AND status='DISPATCHING')`,[op.id,op.recipient_count||0]);
    }
  }
  if(!licenseDeliveryEnabled('AUTO')&&!summary.dryRun)return summary;
  let cursor='';for(;;){
    const page=(await db.query<LicenseRow>('SELECT l.*,s.name,s.disabled_at FROM school_licenses l JOIN schools s ON s.id=l.school_id WHERE l.id>$1 ORDER BY l.id LIMIT 100',[cursor])).rows;if(!page.length)break;
    for(const row of page){cursor=row.id;summary.scanned++;const reason=licenseEligibility(row,now(),'AUTO');if(reason){skip(reason);continue;}
      const r=await resolveLicenseRecipients(db,row.school_id,now());for(const s of r.skipped)skip(s.reason);
      for(const t of r.targets){if(Date.now()-started>13*60000){summary.deferred=true;return summary;}if(summary.dryRun){summary.eligible++;continue;}await dispatch(row.school_id,t,'AUTO');}
    }
  }return summary;
}
