import express, { type RequestHandler } from 'express';
import crypto from 'node:crypto';
import { verifyPassword } from './passwords';
import type { User, SchoolMembership } from '../src/types';

export interface ReviewIdentity {
  id: string; store: 'apple'|'google'; schoolId: string; userId: string;
  passwordHash: string; version: number; enabled: boolean; loginName?: string;
}
export interface ReviewDependencies {
  identities: () => ReviewIdentity[];
  limit: (key: string, max: number) => Promise<boolean>;
  audit: (event: {action:string; identity:string; result:string}) => Promise<void>;
  user: (id:string) => Promise<(User & {authVersion:number})|null>;
  memberships: (id:string) => Promise<SchoolMembership[]>;
  sign: (identity:ReviewIdentity,user:User & {authVersion:number}) => string;
  verify: (token:string) => {userId:string;schoolId:string;identity:string;version:number;authVersion:number}|null;
}
export function createReviewAccess(d:ReviewDependencies) {
  const router=express.Router();
  router.post('/login',express.json({limit:'4kb'}),async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try {
      const id=typeof req.body?.identity==='string'?req.body.identity.slice(0,80):'';
      const password=typeof req.body?.password==='string'?req.body.password:'';
      const identity=d.identities().find(x=>(x.loginName||x.id)===id&&x.enabled);
      // Login aliases share the canonical identity's existing attempt budget.
      const scope=crypto.createHash('sha256').update(identity?.id||id).digest('hex');
      const allowed=await d.limit('ip:'+req.ip,30) && await d.limit('id:'+scope,8);
      if(!allowed){await d.audit({action:'login',identity:scope,result:'limited'});res.status(429).json({error:'Çok fazla deneme. Lütfen bekleyin.'});return;}
      // Always perform a password hash comparison, including unknown identities.
      const valid=verifyPassword(password.slice(0,128),identity?.passwordHash||'scrypt$00000000000000000000000000000000$'+'0'.repeat(128));
      const user=identity&&valid&&password.length<=128?await d.user(identity.userId):null;
      const memberships=user?await d.memberships(user.id):[];
      if(!identity||!valid||!user||memberships.length!==1||memberships.some(m=>m.schoolId!==identity.schoolId||m.status!=='active'||m.role!==identity.id.split('-').at(-1))){
        await d.audit({action:'login',identity:scope,result:'denied'});res.status(401).json({error:'İnceleme erişimi doğrulanamadı.'});return;
      }
      await d.audit({action:'login',identity:scope,result:'accepted'});
      res.json({token:d.sign(identity,user),user,memberships});
    }catch{res.status(503).json({error:'İnceleme servisi kullanılamıyor.'});}
  });
  const guard:RequestHandler=async(req,res,next)=>{
    if(req.method==='OPTIONS'){next();return;}
    try {
      const token=req.headers.authorization?.replace(/^Bearer /,'')||'';
      const claims=d.verify(token), identity=claims&&d.identities().find(x=>x.id===claims.identity&&x.enabled&&x.version===claims.version&&x.userId===claims.userId&&x.schoolId===claims.schoolId);
      const user=identity?await d.user(identity.userId):null;
      if(!identity||!claims||!user||user.authVersion!==claims.authVersion){res.status(401).json({error:'İnceleme oturumu geçersiz.'});return;}
      const path=req.path;
      const shared=new Set([...d.identities().map(i=>i.userId),'profile-apple','profile-google','student-apple','student-google']);
      if(['DELETE','PATCH'].includes(req.method)&&path.split('/').some(segment=>shared.has(decodeURIComponent(segment)))){res.status(403).json({error:'Paylaşılan demo kimlikleri ve örnek öğrenci korunur. Yeni sentetik kayıtlar üzerinde işlem yapın.'});return;}
      const school=path.match(/^\/api\/schools\/([^/]+)/)?.[1];
      if(school&&decodeURIComponent(school)!==identity.schoolId){res.status(403).json({error:'Demo okul kapsamı dışında.'});return;}
      // Review-only operations run after this guard; never reach production auth handlers.
      const preference=path.match(/^\/api\/auth\/me\/license-reminder-preferences\/([^/]+)$/);
      if(preference&&decodeURIComponent(preference[1])!==identity.schoolId){res.sendStatus(403);return;}
      const permitted=(req.method==='GET'&&['/api/public/schools','/api/platform/capabilities','/api/user/me'].includes(path))
        || (req.method==='POST'&&path==='/api/user/me/deletion')
        || (req.method==='POST'&&path==='/api/review/scenarios/refresh')
        || (!!preference&&['GET','PUT'].includes(req.method))
        || (/^\/api\/mobile\/push\/devices(?:\/[^/]+)?$/.test(path)&&['POST','DELETE'].includes(req.method))
        || (!!school && !/\/(?:send|email|whatsapp|invitations|request-code|reset|push)(?:\/|$)/i.test(path));
      if(!permitted){await d.audit({action:'request',identity:identity.id,result:'scope-denied'});res.status(403).json({error:'Bu işlem inceleme ortamında kullanılamıyor.'});return;}
      const memberships=await d.memberships(user.id);
      if(memberships.length!==1||memberships.some(m=>m.schoolId!==identity.schoolId||m.status!=='active'||m.role!==identity.id.split('-').at(-1))){res.sendStatus(403);return;}
      res.locals.reviewIdentity=identity;
      res.locals.reviewUser=user;
      next();
    }catch{res.sendStatus(503);}
  };
  return {router,guard};
}
