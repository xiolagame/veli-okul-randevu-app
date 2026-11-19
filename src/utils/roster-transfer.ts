import { ROSTER_BATCH_SIZE, RosterDraft } from './roster-import';
export interface RosterImportJob { id:string; manifestHash:string; totalRows:number; nextBatch:number; processed:number; added:number; skipped:number; invalid:number; status:'RUNNING'|'COMPLETED'; batchSize:number }
export interface RosterBatchReport { index:number; processed:number; added:number; skipped:number; invalid:number; errors:Array<{row:number;errors:string[]}> }
export async function rosterDigest(value:string) { const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join(''); }
export async function rosterManifest(records:RosterDraft[]) {
 let chain='';for(let i=0;i<records.length;i+=ROSTER_BATCH_SIZE)chain=await rosterDigest(chain+':'+await rosterDigest(JSON.stringify(records.slice(i,i+ROSTER_BATCH_SIZE))));return chain;
}
export async function transferRoster(records:RosterDraft[],initial:RosterImportJob,send:(id:string,index:number,records:RosterDraft[])=>Promise<{job:RosterImportJob;batch:RosterBatchReport}>,progress:(job:RosterImportJob)=>void,paused:()=>boolean) {
 let job=initial;
 while(job.status!=='COMPLETED'&&!paused()) {
  const result=await send(job.id,job.nextBatch,records.slice(job.nextBatch*ROSTER_BATCH_SIZE,(job.nextBatch+1)*ROSTER_BATCH_SIZE));
  job=result.job;progress(job);
 }
 return job;
}
