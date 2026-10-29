import fs from 'node:fs';
import path from 'node:path';
import {Pool} from 'pg';
import {loadReviewSecretFiles,assertReviewDatabaseTarget,reviewRegistryText} from '../server/review-settings';
import {getPostgresConnectionOptions} from '../server/database/tls';
import {seedReviewFixtures} from '../server/review-fixtures';
import {resetReviewFixtures} from '../server/review-maintenance';
import type {ReviewIdentity} from '../server/review-access';
import type {TransactionClient} from '../server/database/postgres';
import {createReviewAudit} from '../server/review-audit';
async function main(){
 const mode=process.argv[2];
 if(!['--initialize-empty-review-db','--reset-offline-review-only'].includes(mode)||process.env.REVIEW_MAINTENANCE_CONFIRMED!=='isolated-store-review')throw Error('Explicit offline maintenance confirmation required');
 loadReviewSecretFiles();const url=assertReviewDatabaseTarget();
 const audit=createReviewAudit(process.env.REVIEW_AUDIT_FILE||'');await audit({action:'maintenance',identity:'operator',result:mode});
 const identities=JSON.parse(reviewRegistryText()) as ReviewIdentity[];
 const pool=new Pool({...getPostgresConnectionOptions(url,true),max:1});
 try{const client=await pool.connect();try{await client.query('BEGIN');const tx:TransactionClient={query:async(sql,params)=>{const r=await client.query(sql,params);return{rows:r.rows,rowCount:r.rowCount||0};}};
  if(mode==='--initialize-empty-review-db'){
   const existing=await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");if(existing.rows.length)throw Error('Database must be completely empty');
   await client.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $$");
   await client.query(fs.readFileSync('server/database/supabase_schema.sql','utf8'));
   for(const file of fs.readdirSync('server/database/migrations').filter(x=>x.endsWith('.sql')).sort())await client.query(fs.readFileSync(path.join('server/database/migrations',file),'utf8'));
   await client.query(fs.readFileSync('deploy/review/runtime-schema.sql','utf8'));await seedReviewFixtures(tx,identities);
   await client.query(fs.readFileSync('deploy/review/least-privilege.sql','utf8'));
  }else await resetReviewFixtures(tx,identities);
  await client.query('COMMIT');await audit({action:'maintenance',identity:'operator',result:'completed'});console.info('Isolated review maintenance completed. No provider operation performed.');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
 finally{await pool.end();}
}
main().catch(()=>{console.error('Review maintenance refused/failed. No secret details logged.');process.exitCode=1;});
