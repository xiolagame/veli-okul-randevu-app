import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest, canUsePlatformAuthority, isPlatformAdmin } from './auth';
import { getDb } from './database/postgres';
import { auditLogRepository, userRepository } from './repositories';
import { normalizeTurkishPhone } from '../src/utils/phone';
import { licenseReminderOverview, previewManualLicenseReminder, confirmManualLicenseReminder, LicenseReminderError, reminderPhoneFingerprint } from './license-reminders';
import { createLicenseWorkerRequest } from './license-reminder-runner';

const fail=(res:import('express').Response,error:unknown)=>res.status(error instanceof LicenseReminderError?error.status:503)
  .json({code:error instanceof LicenseReminderError?error.code:'LICENSE_REMINDER_UNAVAILABLE',error:'WhatsApp hatırlatma işlemi tamamlanamadı. Bilgileri yenileyin ve tekrar deneyin.'});
export const platformLicenseReminderRouter=Router({mergeParams:true});
platformLicenseReminderRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
platformLicenseReminderRouter.use((req:AuthenticatedRequest,res,next)=>canUsePlatformAuthority(req.user)?next():res.status(403).json({code:'PLATFORM_AUTHORITY_REQUIRED'}));
platformLicenseReminderRouter.get('/',async(req:AuthenticatedRequest,res)=>{
  try{const page=Number(req.query.page||0);if(!Number.isInteger(page)||page<0||page>100000)throw new LicenseReminderError(400,'INVALID_PAGE');res.json(await licenseReminderOverview(String(req.params.schoolId),page));}catch(e){fail(res,e);}
});
platformLicenseReminderRouter.post('/preview',async(req:AuthenticatedRequest,res)=>{
  try{if(req.body&&Object.keys(req.body).length)throw new LicenseReminderError(400,'INVALID_BODY');
    const actor=await userRepository.getById(req.user!.id);if(!actor)throw new LicenseReminderError(403,'PLATFORM_AUTHORITY_REQUIRED');
    res.json(await previewManualLicenseReminder({schoolId:String(req.params.schoolId),actorId:req.user!.id,authVersion:actor.authVersion}));
  }catch(e){fail(res,e);}
});
platformLicenseReminderRouter.post('/confirm',async(req:AuthenticatedRequest,res)=>{
  try{const b=req.body;if(!b||Object.keys(b).some(k=>!['operationId','confirmed'].includes(k))||typeof b.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(b.operationId)||b.confirmed!==true)throw new LicenseReminderError(400,'EXPLICIT_CONFIRMATION_REQUIRED');
    const result=await confirmManualLicenseReminder({schoolId:String(req.params.schoolId),actorId:req.user!.id,operationId:b.operationId,confirmed:true});
    let workerAccepted=false;
    if(result.status==='QUEUED'&&result.shouldWake){
      // Operation was committed first. Repeating this wake-up cannot recreate sends.
      try{if(process.env.CONTEXT==='production')workerAccepted=(await fetch(createLicenseWorkerRequest())).status===202;}catch{/* Keep the durable queue and return a safe pending result. */}
    }
    res.json({...result,workerAccepted});
  }catch(e){fail(res,e);}
});

export const licenseReminderPreferenceRouter=Router();
licenseReminderPreferenceRouter.use(authMiddleware);
licenseReminderPreferenceRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
licenseReminderPreferenceRouter.get('/:schoolId',async(req:AuthenticatedRequest,res)=>{
  try{const db=await getDb(),schoolId=String(req.params.schoolId),userId=req.user!.id;
    const owned=(await db.query(`SELECT m.user_id FROM school_memberships m JOIN schools s ON s.id=m.school_id AND s.disabled_at IS NULL WHERE m.school_id=$1 AND m.user_id=$2 AND m.role='admin' AND m.status='active'`,[schoolId,userId])).rows.length;
    const pref=(await db.query('SELECT revoked_at,phone_fingerprint,consent_at,consent_reference FROM school_license_reminder_recipients WHERE school_id=$1 AND user_id=$2',[schoolId,userId])).rows[0];
    if(isPlatformAdmin(userId)||(!owned&&!pref))throw new LicenseReminderError(404,'PREFERENCE_NOT_FOUND');
    const user=await userRepository.getById(userId),validPhone=!!user?.isPhoneVerified&&!!normalizeTurkishPhone(user.phone);
    const matches=validPhone&&pref?.phone_fingerprint===reminderPhoneFingerprint(userId,user!.phone);
    const evidenceValid=!!pref?.consent_reference?.trim()&&Number.isFinite(Date.parse(pref.consent_at))&&Date.parse(pref.consent_at)<=Date.now();
    const consentStatus=!pref?'MISSING':pref.revoked_at?'REVOKED':!matches?'PHONE_CHANGED':!evidenceValid?'INVALID':'VALID';
    res.json({enabled:!!pref&&!pref.revoked_at&&matches&&evidenceValid,canEnable:!!owned&&validPhone,needsReconfirmation:!!pref&&!pref.revoked_at&&(!matches||!evidenceValid),consentStatus});
  }catch(e){fail(res,e);}
});
licenseReminderPreferenceRouter.put('/:schoolId',async(req:AuthenticatedRequest,res)=>{
  try{if(!req.body||Object.keys(req.body).some(k=>k!=='enabled')||typeof req.body.enabled!=='boolean')throw new LicenseReminderError(400,'INVALID_PREFERENCE');
    const enabled=req.body.enabled,db=await getDb(),schoolId=String(req.params.schoolId),userId=req.user!.id;
    if(isPlatformAdmin(userId))throw new LicenseReminderError(403,'SCHOOL_ADMIN_REQUIRED');
    await db.transaction(async tx=>{
      await tx.query('SELECT id FROM schools WHERE id=$1 FOR UPDATE',[schoolId]);
      const user=(await tx.query<{phone:string;is_phone_verified:boolean}>('SELECT phone,is_phone_verified FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
      if(enabled){
        const member=(await tx.query(`SELECT m.user_id FROM school_memberships m JOIN schools s ON s.id=m.school_id AND s.disabled_at IS NULL WHERE m.school_id=$1 AND m.user_id=$2 AND m.role='admin' AND m.status='active' FOR UPDATE OF m`,[schoolId,userId])).rows.length;
        if(!member||!user?.is_phone_verified||!normalizeTurkishPhone(user.phone))throw new LicenseReminderError(403,'VERIFIED_SCHOOL_ADMIN_REQUIRED');
        await tx.query(`INSERT INTO school_license_reminder_recipients(school_id,user_id,phone_fingerprint,consent_at,consent_reference,revoked_at) VALUES($1,$2,$3,NOW(),'account-self-service:v1',NULL)
          ON CONFLICT(school_id,user_id) DO UPDATE SET phone_fingerprint=EXCLUDED.phone_fingerprint,consent_at=NOW(),consent_reference=EXCLUDED.consent_reference,revoked_at=NULL`,[schoolId,userId,reminderPhoneFingerprint(userId,user.phone)]);
      }else{
        const result=await tx.query('UPDATE school_license_reminder_recipients SET revoked_at=NOW() WHERE school_id=$1 AND user_id=$2 RETURNING user_id',[schoolId,userId]);
        if(!result.rows.length)throw new LicenseReminderError(404,'PREFERENCE_NOT_FOUND');
      }
      await auditLogRepository.createAuditLog({schoolId,actorUserId:userId,actorName:'Okul yöneticisi',action:'license.whatsapp_consent_changed',details:JSON.stringify({enabled})},tx);
    });res.json({enabled});
  }catch(e){fail(res,e);}
});
