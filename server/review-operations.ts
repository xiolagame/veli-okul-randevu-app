import express from 'express';
import type {ReviewDependencies,ReviewIdentity} from './review-access';
import type {TransactionClient} from './database/postgres';
import {verifyPassword} from './passwords';
import {refreshReviewQrScenario} from './review-fixtures';

type ReviewDatabase=TransactionClient & {transaction:<T>(fn:(tx:TransactionClient)=>Promise<T>)=>Promise<T>};
export function createReviewOperations(d:Pick<ReviewDependencies,'limit'|'audit'> & {database:()=>Promise<ReviewDatabase>}){
 const router=express.Router();router.use(['/api/user/me/deletion','/api/auth/me/license-reminder-preferences/:schoolId','/api/mobile/push/devices','/api/mobile/push/devices/:installationId'],express.json({limit:'4kb'}));
 router.post('/api/review/scenarios/refresh',async(_req,res)=>{
  const identity=res.locals.reviewIdentity as ReviewIdentity;if(!identity)return res.sendStatus(401);
  try{if(!await d.limit('scenario:'+identity.id,10))return res.sendStatus(429);await d.audit({action:'demo-scenario',identity:identity.id,result:'refresh'});await(await d.database()).transaction(tx=>refreshReviewQrScenario(tx,identity.store));res.json({success:true,simulation:true,message:'Bu demo okulunun QR örneği güncellendi. Veli hesabında randevuları yenileyip giriş kartını açın; güvenlik hesabıyla test edin.'});}catch{res.sendStatus(503);}
 });
 router.post('/api/user/me/deletion',async(req,res)=>{
  const identity=res.locals.reviewIdentity as ReviewIdentity;
  if(!identity)return res.sendStatus(401);
  const body=req.body||{};
  if(Object.keys(body).some(k=>!['password','confirmation','requestId'].includes(k))||body.confirmation!=='HESABIMI SİL'||typeof body.password!=='string'||body.password.length>128||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId||''))return res.status(400).json({error:'İnceleme parolası, onay veya istek kimliği geçersiz.'});
  try{
   if(!await d.limit('delete:'+identity.id,5))return res.status(429).json({error:'Çok fazla silme denemesi.'});
   if(!verifyPassword(body.password,identity.passwordHash)){await d.audit({action:'demo-deletion',identity:identity.id,result:'denied'});return res.status(403).json({error:'İnceleme parolası doğrulanamadı.'});}
   await d.audit({action:'demo-deletion',identity:identity.id,result:'authorized'});
   const db=await d.database();
   const completedAt=await db.transaction(async tx=>{
    const locked=await tx.query<{auth_version:number}>('SELECT auth_version FROM users WHERE id=$1 FOR UPDATE',[identity.userId]);
    if(locked.rows[0]?.auth_version!==res.locals.reviewUser.authVersion)throw Error('Stale review session');
    await tx.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[identity.userId]);
    await tx.query('DELETE FROM mobile_push_devices WHERE user_id=$1',[identity.userId]);
    const result=await tx.query<{completed_at:string}>('INSERT INTO review_deletion_receipts(request_id,user_id) VALUES($1,$2) RETURNING completed_at',[body.requestId,identity.userId]);
    return result.rows[0].completed_at;
   });
   try{await d.audit({action:'demo-deletion',identity:identity.id,result:'simulated-sessions-revoked'});}catch{/* The durable DB receipt is already committed; do not misreport a completed revocation as failure. */}
   return res.json({success:true,completed:true,completedAt,alreadyCompleted:false,notificationSent:false,simulation:true,message:'Demo hesap silme simülasyonu tamamlandı. Bu hesabın tüm oturumları kapatıldı; sentetik inceleme hesabı tekrar giriş için korunur. Gerçek mesaj gönderilmedi.'});
  }catch{return res.status(409).json({error:'Demo işlem tamamlanamadı; oturumunuzu yenileyin.'});}
 });
 router.route('/api/auth/me/license-reminder-preferences/:schoolId')
  .all((req,res,next)=>{const i=res.locals.reviewIdentity as ReviewIdentity;if(!i||i.schoolId!==req.params.schoolId||!i.id.endsWith('-admin'))return res.sendStatus(403);next();})
  .get(async(_req,res)=>{try{const rows=await(await d.database()).query<{enabled:boolean}>('SELECT enabled FROM review_preferences WHERE user_id=$1',[res.locals.reviewIdentity.userId]);res.json({enabled:rows.rows[0]?.enabled||false,canEnable:true,simulation:true});}catch{res.sendStatus(503);}})
  .put(async(req,res)=>{if(typeof req.body?.enabled!=='boolean'||Object.keys(req.body).some(k=>k!=='enabled'))return res.sendStatus(400);try{await(await d.database()).query('INSERT INTO review_preferences(user_id,enabled) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled',[res.locals.reviewIdentity.userId,req.body.enabled]);await d.audit({action:'demo-preference',identity:res.locals.reviewIdentity.id,result:req.body.enabled?'enabled':'disabled'});res.json({enabled:req.body.enabled,simulation:true,message:'Yalnız demo tercihi kaydedildi; gerçek bildirim gönderilmez.'});}catch{res.sendStatus(503);}});
 router.all(['/api/mobile/push/devices','/api/mobile/push/devices/:installationId'],async(req,res)=>{
  if(!['POST','DELETE'].includes(req.method))return res.sendStatus(405);
  await d.audit({action:'demo-push',identity:res.locals.reviewIdentity.id,result:'simulated-no-device-stored'});
  res.json({success:true,simulation:true,message:'Demo bildirim işlemi; cihaz tokenı saklanmadı, gönderim yapılmadı.'});
 });
 return router;
}
