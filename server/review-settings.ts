import fs from 'node:fs';
export function loadReviewSecretFiles(){
 for(const key of ['REVIEW_DATABASE_URL','REVIEW_JWT_SECRET','REVIEW_IDENTITIES_JSON','SUPABASE_DB_CA_B64']){
  const file=process.env[key+'_FILE'];if(file){if(process.env[key])throw Error('Ambiguous review secret configuration');process.env[key]=fs.readFileSync(file,'utf8').trim();}
 }
}
export function reviewRegistryText(){return process.env.REVIEW_IDENTITIES_JSON_FILE?fs.readFileSync(process.env.REVIEW_IDENTITIES_JSON_FILE,'utf8'):process.env.REVIEW_IDENTITIES_JSON||'[]';}
export function assertReviewDatabaseTarget(){
 if(process.env.NODE_ENV!=='production'||process.env.REVIEW_SERVICE_ENABLED!=='true'||process.env.DATABASE_URL||process.env.JWT_SECRET)throw Error('Separate explicit review environment required');
 const url=new URL(process.env.REVIEW_DATABASE_URL||'');
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!==process.env.REVIEW_DATABASE_HOST||url.pathname!=='/veli_review')throw Error('Explicit isolated database host/name required');
 return url.toString();
}
