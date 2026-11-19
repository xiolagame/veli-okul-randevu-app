import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { RequestHandler } from 'express';
import { Pool } from 'pg';
import { normalizeTurkishPhone } from '../src/utils/phone';
import {reviewDomain,REVIEW_DOMAIN_SCHEMA} from './review-domain';

// A separate, read-only demo surface. No imports of production repositories,
// OTP/provider clients or normal JWT signing helpers are permitted here.
export interface ReviewDb {
  query(sql: string, args?: any[]): Promise<{ rows: any[] }>;
  transaction<T>(run: (tx: ReviewDb) => Promise<T>): Promise<T>;
}
export interface ReviewConfig {
  enabled: boolean; key: string; epoch: number;
  registry: { phone: string; userId: string; schoolId: string; role: 'parent'|'teacher'|'security'|'admin' }[];
}
const scrypt = promisify(crypto.scrypt);
export async function hashReviewCredential(code: string, salt: string): Promise<string> {
  return (await scrypt(code, salt, 32) as Buffer).toString('hex');
}
export const REVIEW_LOCAL_SCHEMA = `
CREATE TABLE review_environment (id text PRIMARY KEY CHECK(id='synthetic-only'), enabled boolean NOT NULL DEFAULT true);
CREATE TABLE review_accounts (
 id text PRIMARY KEY, phone text UNIQUE NOT NULL, school_id text NOT NULL,
 role text NOT NULL, synthetic boolean NOT NULL DEFAULT true,
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
 salt text NOT NULL, credential_hash text NOT NULL,
 user_data jsonb NOT NULL, school_data jsonb NOT NULL, views jsonb NOT NULL,
 failures integer NOT NULL DEFAULT 0, failure_start bigint NOT NULL DEFAULT 0,
 locked_until bigint NOT NULL DEFAULT 0, last_request bigint NOT NULL DEFAULT 0);
CREATE TABLE review_challenges (
 id text PRIMARY KEY, attempt_id text UNIQUE NOT NULL, account_id text NOT NULL,
 version integer NOT NULL, epoch integer NOT NULL, expires bigint NOT NULL,
 consumed boolean NOT NULL DEFAULT false, tries integer NOT NULL DEFAULT 0);
CREATE TABLE review_sessions (
 id text PRIMARY KEY, account_id text NOT NULL, expires bigint NOT NULL,
 revoked boolean NOT NULL DEFAULT false);
CREATE TABLE review_limits (id text PRIMARY KEY, count integer NOT NULL, started bigint NOT NULL);
CREATE TABLE review_audit (
 id text PRIMARY KEY, account_id text NOT NULL, event text NOT NULL,
 success boolean NOT NULL, ip_hash text NOT NULL, created bigint NOT NULL);`+REVIEW_DOMAIN_SCHEMA;

class ReviewFailure extends Error {
  constructor(public status: number) { super('Review access unavailable'); }
}
const digest = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const equal = (a: string, b: string) => {
  const x=Buffer.from(a), y=Buffer.from(b);
  return x.length===y.length && crypto.timingSafeEqual(x,y);
};
const WINDOW=15*60_000, TTL=5*60_000, SESSION=15*60_000;
const ID=/^review-[a-z0-9-]{1,80}$/;
const UUID=/^[a-f0-9-]{36}$/i;
const ISS='veli-play-review';
const parseBody=(token:string) => {
  try { if(token.length>4096)return null;return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()); }
  catch { return null; }
};
function validateConfig(c:ReviewConfig) {
  if(c.key.length<32 || !Number.isSafeInteger(c.epoch) || c.epoch<1 || c.registry.length>20)throw new ReviewFailure(503);
  // Identity references only; datasets/projections belong in the review DB.
  if(Buffer.byteLength(JSON.stringify(c.registry))>1024)throw new ReviewFailure(503);
  if(c.key===process.env.JWT_SECRET || c.key===process.env.AUTH_CODE_SECRET)throw new ReviewFailure(503);
  const phones=new Set(),users=new Set();
  for(const r of c.registry) {
    if(normalizeTurkishPhone(r.phone)!==r.phone || !ID.test(r.userId) || !ID.test(r.schoolId) ||
      !['parent','teacher','security','admin'].includes(r.role) || phones.has(r.phone) || users.has(r.userId))throw new ReviewFailure(503);
    phones.add(r.phone);users.add(r.userId);
    if((process.env.PLATFORM_ADMIN_USER_IDS||'').split(',').map(x=>x.trim()).includes(r.userId))throw new ReviewFailure(503);
  }
}

export function createReviewGateway(config:()=>ReviewConfig, database:()=>ReviewDb, now=()=>Date.now(), interactive:()=>boolean=()=>false):RequestHandler {
  return async(req,res,next)=>{
    const token=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';
    const claims=parseBody(token);
    const path=req.path.replace(/^\/(?:api|\.netlify\/functions\/api)(?=\/|$)/,'');
    let c:ReviewConfig;
    try { c=config(); } catch { res.status(503).json({error:'İnceleme erişimi kullanılamıyor.'});return; }
    const phone=normalizeTurkishPhone(req.body?.phone);
    const entry=c.registry.find(x=>x.phone===phone);
    const isPhonePost=req.method==='POST' && ['/auth/phone/request-code','/auth/phone/verify-code','/auth/phone/verify-email'].includes(path);
    const reviewToken=claims?.iss===ISS;
    // Normal identities never depend on the review database or signing key.
    if(!reviewToken && !(isPhonePost && entry)){next();return;}
    res.set('Cache-Control','no-store');
    let auditDb:ReviewDb|undefined;
    try {
      if(!c.enabled)throw new ReviewFailure(reviewToken?401:503);
      validateConfig(c);
      if(req.headers['x-forwarded-for'] && !req.ip)throw new ReviewFailure(403);
      const ipHash=digest(req.ip||req.socket.remoteAddress||'unknown');
      const db=database();
      auditDb=db;
      const environment=await db.query("SELECT id FROM review_environment WHERE id='synthetic-only' AND enabled=true");
      if(environment.rows.length!==1)throw new ReviewFailure(503);
      const current=now();
      const event=async(tx:ReviewDb,id:string,name:string,success:boolean)=>{
        await tx.query('INSERT INTO review_audit VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),id,name,success,ipHash,current]);
      };
      const limit=async(tx:ReviewDb,key:string,max:number)=>{
        const id=digest(key);
        const r=await tx.query(`INSERT INTO review_limits(id,count,started) VALUES($1,1,$2)
          ON CONFLICT(id) DO UPDATE SET count=CASE WHEN review_limits.started <= $2-$3 THEN 1 ELSE review_limits.count+1 END,
          started=CASE WHEN review_limits.started <= $2-$3 THEN $2 ELSE review_limits.started END RETURNING count`,[id,current,WINDOW]);
        return Number(r.rows[0].count)<=max;
      };
      const checkAccount=(a:any,r:ReviewConfig['registry'][number]|undefined)=>{
        if(!a || !r || !a.synthetic || !a.active || a.id!==r.userId || a.phone!==r.phone || a.school_id!==r.schoolId || a.role!==r.role)throw new ReviewFailure(401);
        if(a.user_data?.id!==r.userId || a.user_data?.phone!==r.phone || a.school_data?.id!==r.schoolId)throw new ReviewFailure(503);
        if(!/^[a-f0-9]{64}$/.test(a.credential_hash) || !/^[a-f0-9]{32,128}$/.test(a.salt))throw new ReviewFailure(503);
      };
      const publicUser=(a:any)=>({id:a.id,phone:a.phone,firstName:String(a.user_data.firstName),lastName:String(a.user_data.lastName),isPhoneVerified:true,deletionVerification:'credential'});
      const validateView=(value:unknown,school:string):void=>{
        if(Array.isArray(value)){for(const v of value)validateView(v,school);return;}
        if(!value || typeof value!=='object')return;
        for(const [k,v]of Object.entries(value)){
          if(k==='schoolId' && v!==school)throw new ReviewFailure(503);
          if(['id','userId','parentId','teacherId','studentId'].includes(k) && v!==undefined && (typeof v!=='string'||!ID.test(v)))throw new ReviewFailure(503);
          if(/password|token|secret|credential|salt|hash/i.test(k))throw new ReviewFailure(503);
          validateView(v,school);
        }
      };
      const memberships=(a:any)=>[{id:'review-membership-'+a.id,userId:a.id,schoolId:a.school_id,role:a.role,status:'active',joinedAt:'2026-01-01T00:00:00Z'}];
      if(isPhonePost && entry) {
        if(path==='/auth/phone/verify-email')throw new ReviewFailure(403);
        const result=await db.transaction(async tx=>{
          const a=(await tx.query('SELECT * FROM review_accounts WHERE id=$1 FOR UPDATE',[entry.userId])).rows[0];
          checkAccount(a,entry);
          const ipOk=await limit(tx,ipHash+':'+path,30);
          const accountOk=await limit(tx,a.id+':'+path,20);
          if(!ipOk || !accountOk || Number(a.locked_until)>current){await event(tx,a.id,'rate_denied',false);return{status:429};}
          if(path==='/auth/phone/request-code') {
            if(Number(a.last_request)>current-60_000){await event(tx,a.id,'cooldown',false);return{status:429};}
            const attemptId=crypto.randomUUID(), challengeId=crypto.randomUUID();
            await tx.query('INSERT INTO review_challenges(id,attempt_id,account_id,version,epoch,expires) VALUES($1,$2,$3,$4,$5,$6)',[challengeId,attemptId,a.id,a.version,c.epoch,current+TTL]);
            await tx.query('UPDATE review_accounts SET last_request=$2 WHERE id=$1',[a.id,current]);
            await event(tx,a.id,'challenge_issued',true);
            return{status:200,body:{success:true,deliveryStatus:'unconfirmed',attemptId,challengeId,expiresInSeconds:300,resendAfterSeconds:60}};
          }
          const b=req.body||{};
          const challenge=UUID.test(b.attemptId||'')&&UUID.test(b.challengeId||'')
            ?(await tx.query('SELECT * FROM review_challenges WHERE id=$1 AND attempt_id=$2 FOR UPDATE',[b.challengeId,b.attemptId])).rows[0]:null;
          const bound=challenge && challenge.account_id===a.id && challenge.version===a.version && challenge.epoch===c.epoch &&
            !challenge.consumed && Number(challenge.expires)>current && challenge.tries<5;
          const credential=typeof b.code==='string' && /^\d{6}$/.test(b.code)
            ?await hashReviewCredential(b.code,a.salt):'';
          if(!bound || !equal(credential,a.credential_hash)) {
            if(challenge?.account_id===a.id)await tx.query('UPDATE review_challenges SET tries=tries+1 WHERE id=$1',[challenge.id]);
            const failures=Number(a.failure_start)>current-WINDOW?Number(a.failures)+1:1;
            await tx.query('UPDATE review_accounts SET failures=$2,failure_start=$3,locked_until=$4 WHERE id=$1',[a.id,failures,failures===1?current:a.failure_start,failures>=5?current+WINDOW:0]);
            await event(tx,a.id,'verification_failed',false);return{status:401};
          }
          const consumed=await tx.query('UPDATE review_challenges SET consumed=true WHERE id=$1 AND consumed=false RETURNING id',[challenge.id]);
          if(consumed.rows.length!==1)return{status:401};
          const jti=crypto.randomUUID();
          await tx.query('INSERT INTO review_sessions(id,account_id,expires) VALUES($1,$2,$3)',[jti,a.id,current+SESSION]);
          const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
          const body=Buffer.from(JSON.stringify({iss:ISS,aud:'veli-review-readonly',sub:a.id,school:a.school_id,role:a.role,v:a.version,epoch:c.epoch,jti,exp:Math.floor((current+SESSION)/1000)})).toString('base64url');
          const sig=crypto.createHmac('sha256',c.key).update(header+'.'+body).digest('base64url');
          await event(tx,a.id,'verification_succeeded',true);
          return{status:200,body:{success:true,token:header+'.'+body+'.'+sig,user:publicUser(a),memberships:memberships(a)}};
        });
        res.status(result.status).json(result.body||{error:result.status===429?'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.':'Kod geçersiz veya süresi dolmuş olabilir.'});return;
      }
      const [head,body,sig,...extra]=token.split('.');
      if(extra.length || !sig || !equal(sig,crypto.createHmac('sha256',c.key).update(head+'.'+body).digest('base64url')) ||
        claims.aud!=='veli-review-readonly' || !Number.isInteger(claims.exp) || claims.exp*1000<=current || claims.epoch!==c.epoch)throw new ReviewFailure(401);
      const a=(await db.query('SELECT * FROM review_accounts WHERE id=$1',[claims.sub])).rows[0];
      checkAccount(a,c.registry.find(r=>r.userId===claims.sub));
      const session=(await db.query('SELECT * FROM review_sessions WHERE id=$1 AND account_id=$2',[claims.jti,a.id])).rows[0];
      if(claims.v!==a.version || claims.school!==a.school_id || claims.role!==a.role || !session || session.revoked || Number(session.expires)<=current)throw new ReviewFailure(401);
      if(req.method==='POST' && path==='/auth/review/logout'){
        await db.query('UPDATE review_sessions SET revoked=true WHERE id=$1',[claims.jti]);
        await event(db,a.id,'logout',true);res.json({success:true});return;
      }
      if(req.headers['x-school-id'] && req.headers['x-school-id']!==a.school_id)throw new ReviewFailure(403);
      if(interactive()){
        const result=await reviewDomain(db,a,req,path,current);
        if(result){res.status(result.status).json(result.body);return;}
      }
      if(req.method!=='GET'){
        await event(db,a.id,'scope_denied',false);throw new ReviewFailure(403);
      }
      // Default-deny before ANY production router, including all future routes.
      let payload:unknown;
      if(path==='/user/me')payload={user:publicUser(a),memberships:memberships(a)};
      else if(path==='/public/schools'){validateView(a.school_data,a.school_id);payload={schools:[a.school_data]};}
      else if(path==='/platform/capabilities')payload={manageSchools:false};
      else {
        const m=/^\/schools\/(review-[a-z0-9-]+)\/(teachers|students|availability|appointments|notifications|settings|classes|info|audit-logs|roster)$/.exec(path);
        if(!m || m[1]!==a.school_id || Object.keys(req.query).some(k=>k!=='page')){
          await event(db,a.id,'scope_denied',false);throw new ReviewFailure(403);
        }
        if((['info','roster'].includes(m[2]) && a.role!=='admin') || (m[2]==='audit-logs' && !['admin','security'].includes(a.role)))throw new ReviewFailure(403);
        payload=a.views[m[2]];
        if(!payload)throw new ReviewFailure(403);
        validateView(payload,a.school_id);
      }
      await event(db,a.id,'read',true);res.json(payload);
    } catch(e) {
      const status=e instanceof ReviewFailure?e.status:503;
      if(auditDb)try{
        await auditDb.query('INSERT INTO review_audit VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),'unverified','request_denied',false,digest(req.ip||req.socket.remoteAddress||'unknown'),now()]);
      }catch{/* A failed audit store must never expose inputs or enable access. */}
      // Do not serialize database errors, input, tokens or credential material.
      res.status(status).json({error:status===403?'İnceleme hesabında bu işlem kullanılamıyor.':'İnceleme erişimi kullanılamıyor.'});
    }
  };
}

function runtimeConfig():ReviewConfig {
  const registry=JSON.parse(process.env.REVIEW_ACCOUNT_REGISTRY||'[]');
  if(!Array.isArray(registry) || registry.some(x=>!x || typeof x.phone!=='string' || typeof x.userId!=='string' || typeof x.schoolId!=='string' || typeof x.role!=='string'))throw new Error('Invalid review configuration');
  return{enabled:process.env.REVIEW_AUTH_ENABLED==='true',key:process.env.REVIEW_JWT_SECRET||'',epoch:Number(process.env.REVIEW_AUTH_EPOCH||'0'),registry};
}
let pool:Pool|undefined;
function runtimeDb():ReviewDb {
  const url=process.env.REVIEW_DATABASE_URL, ca=process.env.REVIEW_DATABASE_CA_B64;
  if(!url || !ca)throw new Error('Review database is not configured');
  const review=new URL(url), prod=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
  if(prod && review.hostname===prod.hostname && review.pathname===prod.pathname)throw new Error('Separate review database required');
  const pem=Buffer.from(ca,'base64').toString();
  if(!pem.startsWith('-----BEGIN CERTIFICATE-----'))throw new Error('Review CA required');
  for(const k of ['sslmode','sslcert','sslkey','sslrootcert'])review.searchParams.delete(k);
  pool||=new Pool({connectionString:review.toString(),ssl:{ca:pem,rejectUnauthorized:true},max:3});
  const wrap=(query:ReviewDb['query']):ReviewDb=>({query,transaction:async run=>{
    const client=await pool!.connect();try{await client.query('BEGIN');const tx:ReviewDb={query:(q,p)=>client.query(q,p),transaction:async()=>{throw new Error('Nested transaction');}};const v=await run(tx);await client.query('COMMIT');return v;}
    catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }});
  return wrap((q,p)=>pool!.query(q,p));
}
export const reviewGateway=createReviewGateway(runtimeConfig,runtimeDb,()=>Date.now(),()=>process.env.REVIEW_INTERACTIVE_ENABLED==='true');
