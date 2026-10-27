import { Router } from 'express';
import { createHash } from 'node:crypto';
import { AuthenticatedRequest, canUsePlatformAuthority } from './auth';
import { getDb, TransactionClient } from './database/postgres';
import { schoolLicenseRepository } from './repositories';
import { processRosterImportTransaction } from './roster-import';
import { ROSTER_BATCH_SIZE } from '../src/utils/roster-import';

class ImportError extends Error { constructor(public status: number,message: string){super(message);} }
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
type Job = { id:string; school_id:string; actor_user_id:string; manifest_hash:string; chain_hash:string; total_rows:string; next_batch:number; processed:string; added:string; skipped:string; invalid:string; status:'RUNNING'|'COMPLETED' };
const view=(j:Job)=>({id:j.id,manifestHash:j.manifest_hash,totalRows:Number(j.total_rows),nextBatch:j.next_batch,processed:Number(j.processed),added:Number(j.added),skipped:Number(j.skipped),invalid:Number(j.invalid),status:j.status,batchSize:ROSTER_BATCH_SIZE});
async function authorize(tx:TransactionClient,req:AuthenticatedRequest){
 const schoolId=req.membership!.schoolId;
 if(!(await tx.query('SELECT id FROM schools WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',[schoolId])).rows.length || !await schoolLicenseRepository.isAccessAllowed(schoolId,tx))throw new ImportError(403,'Okula erişilemiyor.');
 if(!(canUsePlatformAuthority(req.user)&&req.platformTargetSchoolId===schoolId) && !(await tx.query("SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role='admin' AND status='active' FOR SHARE",[schoolId,req.user!.id])).rows.length)throw new ImportError(403,'Aktarım yetkiniz yok.');
}
async function load(tx:TransactionClient,req:AuthenticatedRequest){
 const job=(await tx.query<Job>('SELECT * FROM roster_import_jobs WHERE id=$1 AND school_id=$2 AND actor_user_id=$3 FOR UPDATE',[req.params.jobId,req.membership!.schoolId,req.user!.id])).rows[0];
 if(!job)throw new ImportError(404,'Aktarım bulunamadı.');return job;
}
export const rosterImportJobsRouter=Router({mergeParams:true});
function respond(error:unknown,res:import('express').Response){res.status(error instanceof ImportError?error.status:500).json({error:error instanceof ImportError?error.message:'Aktarım tamamlanamadı. Kaydedilen ilerlemeyi sorgulayıp tekrar deneyin.'});}
rosterImportJobsRouter.post('/',async(req:AuthenticatedRequest,res)=>{try{
 const {id,manifestHash,totalRows}=req.body||{};
 if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)||typeof manifestHash!=='string'||!/^[a-f0-9]{64}$/.test(manifestHash)||!Number.isSafeInteger(totalRows)||totalRows<1)throw new ImportError(400,'Aktarım bilgilerini kontrol edin.');
 const result=await(await getDb()).transaction(async tx=>{await authorize(tx,req);
  await tx.query('INSERT INTO roster_import_jobs(id,school_id,actor_user_id,manifest_hash,total_rows) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[id,req.membership!.schoolId,req.user!.id,manifestHash,totalRows]);
  const job=(await tx.query<Job>('SELECT * FROM roster_import_jobs WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(job.school_id!==req.membership!.schoolId||job.actor_user_id!==req.user!.id)throw new ImportError(404,'Aktarım bulunamadı.');
  if(job.manifest_hash!==manifestHash||Number(job.total_rows)!==totalRows)throw new ImportError(409,'Bu işlem kimliği farklı bir dosyaya ait.');return view(job);
 });res.json(result);
}catch(error){respond(error,res);}});
rosterImportJobsRouter.get('/:jobId',async(req:AuthenticatedRequest,res)=>{try{res.json(await(await getDb()).transaction(async tx=>{await authorize(tx,req);return view(await load(tx,req));}));}catch(error){respond(error,res);}});
rosterImportJobsRouter.get('/:jobId/reports',async(req:AuthenticatedRequest,res)=>{try{
 const page=Number(req.query.page??0);if(!Number.isSafeInteger(page)||page<0)throw new ImportError(400,'Geçersiz rapor sayfası.');
 res.json(await(await getDb()).transaction(async tx=>{await authorize(tx,req);const job=await load(tx,req);const reports=await tx.query<{result:object}>('SELECT result FROM roster_import_batches WHERE job_id=$1 ORDER BY batch_index LIMIT 20 OFFSET $2',[job.id,page*20]);return{reports:reports.rows.map(r=>r.result),pages:Math.ceil(job.next_batch/20)};}));
}catch(error){respond(error,res);}});
rosterImportJobsRouter.post('/:jobId/batches',async(req:AuthenticatedRequest,res)=>{try{
 const {index,records}=req.body||{};
 if(!Number.isSafeInteger(index)||index<0||!Array.isArray(records)||!records.length||records.length>ROSTER_BATCH_SIZE)throw new ImportError(400,'Geçersiz aktarım partisi.');
 const hash=digest(JSON.stringify(records));
 const result=await(await getDb()).transaction(async tx=>{await authorize(tx,req);const job=await load(tx,req);
  const old=(await tx.query<{payload_hash:string;result:object}>('SELECT payload_hash,result FROM roster_import_batches WHERE job_id=$1 AND batch_index=$2',[job.id,index])).rows[0];
  if(old){if(old.payload_hash!==hash)throw new ImportError(409,'Tamamlanan partinin içeriği değiştirilemez.');return{job:view(job),batch:old.result,replayed:true};}
  if(job.status==='COMPLETED'||index!==job.next_batch||records.length!==Math.min(ROSTER_BATCH_SIZE,Number(job.total_rows)-Number(job.processed)))throw new ImportError(409,'Parti sırası uyuşmuyor. Aktarım durumunu yenileyin.');
  const chain=digest(job.chain_hash+':'+hash),processed=Number(job.processed)+records.length;
  if(processed===Number(job.total_rows)&&chain!==job.manifest_hash)throw new ImportError(409,'Dosya içeriği aktarım başlangıcıyla uyuşmuyor.');
  const imported=await processRosterImportTransaction(tx,job.school_id,records,false,'Yetkili yönetici',req.user!.id,true);
  const batch={index,processed:records.length,added:imported.addedCount,skipped:imported.skippedCount,invalid:imported.rows.filter(r=>r.status==='invalid').length,
   errors:imported.rows.flatMap((r,i)=>r.status==='invalid'?[{row:Number(job.processed)+i+1,errors:r.errors.map(error=>error.replace(/^Satır \d+: /,''))}]:[])};
  await tx.query('INSERT INTO roster_import_batches(job_id,batch_index,payload_hash,result)VALUES($1,$2,$3,$4::jsonb)',[job.id,index,hash,JSON.stringify(batch)]);
  const updated=(await tx.query<Job>(`UPDATE roster_import_jobs SET chain_hash=$2,next_batch=next_batch+1,processed=$3,added=added+$4,skipped=skipped+$5,invalid=invalid+$6,status=$7,updated_at=NOW() WHERE id=$1 RETURNING *`,[job.id,chain,processed,batch.added,batch.skipped,batch.invalid,processed===Number(job.total_rows)?'COMPLETED':'RUNNING'])).rows[0];
  return{job:view(updated),batch,replayed:false};
 });res.json(result);
}catch(error){respond(error,res);}});
