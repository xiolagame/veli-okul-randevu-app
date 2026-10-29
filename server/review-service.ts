// Separate deployment only. NEVER mount this service on the production API.
import express from 'express';
import cors from 'cors';
import {createReviewAccess,type ReviewIdentity,type ReviewDependencies} from './review-access';
import {createReviewOperations} from './review-operations';
import {createReviewAudit} from './review-audit';
import {installReviewOutboundDeny} from './review-outbound';
import {assertReviewDatabaseTarget,reviewRegistryText} from './review-settings';

export async function createReviewService(){
  if(process.env.NODE_ENV!=='production')throw Error('Review service requires explicit production mode and dedicated PostgreSQL; use injected fixtures in tests');
  if(process.env.REVIEW_SERVICE_ENABLED!=='true')throw Error('Review service disabled');
  if(process.env.DATABASE_URL)throw Error('DATABASE_URL must be absent: use a separate review deployment');
  if(!process.env.REVIEW_DATABASE_URL||!process.env.REVIEW_JWT_SECRET||process.env.REVIEW_JWT_SECRET.length<48)throw Error('Dedicated review database and signing key required');
  if(process.env.JWT_SECRET)throw Error('Production JWT key must not exist in review deployment');
  assertReviewDatabaseTarget();
  const audit=createReviewAudit(process.env.REVIEW_AUDIT_FILE||'');
  for(const key of ['WHATSAPP_ACCESS_TOKEN','RESEND_API_KEY','FCM_FIREBASE_PRIVATE_KEY','GOOGLE_APPLICATION_CREDENTIALS','PLATFORM_ADMIN_USER_IDS']){
    if(process.env[key])throw Error('Production authority/outbound credentials forbidden');
  }
  const origins=(process.env.REVIEW_ALLOWED_ORIGINS||'').split(',').map(o=>o.trim()).filter(Boolean);
  if(!origins.length||origins.includes('*'))throw Error('Explicit review CORS origins required');
  process.env.DATABASE_URL=process.env.REVIEW_DATABASE_URL;
  process.env.JWT_SECRET=process.env.REVIEW_JWT_SECRET;
  process.env.CORS_ORIGIN=origins.join(',');
  process.env.WHATSAPP_AUTH_ENABLED='false';
  process.env.PHONE_CENTRIC_AUTH_ENABLED='false';
  process.env.WHATSAPP_LICENSE_REMINDERS_ENABLED='false';
  installReviewOutboundDeny();
  const {createExpressApp}=await import('./app');
  const {getDb}=await import('./database/postgres');
  const {userRepository,membershipRepository}=await import('./repositories');
  const {createToken,verifyToken}=await import('./auth');
  const identities=()=>{
    const rows=JSON.parse(reviewRegistryText()) as ReviewIdentity[];
    if(rows.length!==8||new Set(rows.map(x=>x.id)).size!==rows.length||rows.some(x=>!/^review-(apple|google)-(admin|teacher|parent|security)$/.test(x.id)||x.schoolId!=='review-'+x.store||x.userId!==x.id||!x.id.startsWith('review-'+x.store+'-')||!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(x.passwordHash)||typeof x.enabled!=='boolean'||!Number.isInteger(x.version)||x.version<1))throw Error('Invalid review registry');
    return rows;
  };
  identities();
  const database=await getDb();
  const marker=await database.query<{id:string}>('SELECT id FROM review_environment');
  if(marker.rows.length!==1||marker.rows[0].id!=='isolated-store-review')throw Error('Review database marker required');
  const scope=await database.query<{count:string}>("SELECT COUNT(*)::text AS count FROM schools WHERE id NOT IN ('review-apple','review-google')");
  const users=await database.query<{count:string}>(`SELECT COUNT(*)::text AS count FROM users u WHERE NOT(u.id=ANY($1::text[])) AND
   (NOT EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=u.id) OR EXISTS(SELECT 1 FROM school_memberships m WHERE m.user_id=u.id AND m.school_id NOT IN ('review-apple','review-google')))`,[identities().map(i=>i.userId)]);
  if(Number(scope.rows[0].count)||Number(users.rows[0].count))throw Error('Non-review records found; refusing service');
  const dependencies:ReviewDependencies={
    identities,user:userRepository.getById.bind(userRepository),memberships:membershipRepository.getMembershipsByUserId.bind(membershipRepository),
    limit:async(key,max)=>{
      const scope=(await import('node:crypto')).createHmac('sha256',process.env.REVIEW_JWT_SECRET!).update(key).digest('hex');
      const result=await(await getDb()).query<{attempts:number}>(`INSERT INTO auth_rate_limits(scope_hash,attempts,window_started_at) VALUES($1,1,NOW())
       ON CONFLICT(scope_hash) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.window_started_at<NOW()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts+1 END,
       window_started_at=CASE WHEN auth_rate_limits.window_started_at<NOW()-interval '15 minutes' THEN NOW() ELSE auth_rate_limits.window_started_at END RETURNING attempts`,[scope]);
      return Number(result.rows[0].attempts)<=max;
    },
    audit,
    sign:(identity,user)=>{
      const payload={userId:user.id,phone:user.phone,auth_version:user.authVersion,auth_method:'phone_centric' as const,
        iss:'veli-review',aud:'veli-review-api',review:{identity:identity.id,schoolId:identity.schoolId,version:identity.version}};
      return createToken(payload,3600);
    },
    verify:token=>{
      const verified=verifyToken(token);if(!verified)return null;
      const data=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
      if(data.iss!=='veli-review'||data.aud!=='veli-review-api'||!data.review)return null;
      return {...data.review,userId:verified.userId,authVersion:verified.auth_version};
    }
  };
  const access=createReviewAccess(dependencies);
  const app=express();
  app.disable('x-powered-by');
  if(process.env.REVIEW_TRUST_PROXY_HOPS==='1')app.set('trust proxy',1);
  app.get('/healthz',(_req,res)=>res.json({status:'up',environment:'synthetic-review'}));
  app.get('/readyz',async(_req,res)=>{res.setHeader('Cache-Control','no-store');try{if(!identities().some(i=>i.enabled))throw Error('No enabled identity');await database.query('SELECT 1');await audit({action:'health',identity:'service',result:'ready'});res.json({ready:true});}catch{res.status(503).json({ready:false});}});
  app.use(cors({origin:origins,allowedHeaders:['Content-Type','Authorization','X-School-Id']}));
  app.use('/api/review',access.router);
  app.use(access.guard);
  app.use(createReviewOperations({...dependencies,database:getDb}));
  app.use(createExpressApp());
  return app;
}
