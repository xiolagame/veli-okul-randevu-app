import {PGlite} from '@electric-sql/pglite';
import crypto from 'node:crypto';
import express from 'express';
import {createReviewGateway,hashReviewCredential,REVIEW_LOCAL_SCHEMA,type ReviewConfig,type ReviewDb} from '../server/review-auth';

// Ephemeral, synthetic credentials only. Do not print or persist these values.
export async function reviewFixture(interactive=false,dataDir?:string) {
  const pg=new PGlite(dataDir);await pg.exec(REVIEW_LOCAL_SCHEMA);
  await pg.query("INSERT INTO review_environment(id) VALUES('synthetic-only')");
  const db:ReviewDb={query:(q,p)=>pg.query(q,p),transaction:run=>pg.transaction(tx=>run({query:(q,p)=>tx.query(q,p),transaction:async()=>{throw Error('nested');}}))};
  let time=Date.now();const schoolId='review-school';
  const config:ReviewConfig={enabled:true,key:crypto.randomBytes(48).toString('hex'),epoch:1,registry:[]};
  const codes:Record<string,string>={};
  const settings={schoolName:'Synthetic Review School',appName:'Veli Randevu',defaultSlotMinutes:15,minSlotMinutes:5,maxBookingDaysAhead:30,allowParentCancel:true};
  const school={id:schoolId,name:settings.schoolName,code:'REVIEW',city:'Synthetic',district:'Synthetic',settings};
  const teacher={id:'review-teacher-profile',schoolId,userId:'review-teacher',firstName:'Synthetic',lastName:'Teacher',phone:'905551110102',branch:'Matematik',accountStatus:'active'};
  const student={id:'review-student',schoolId,name:'Synthetic Student',className:'5-A'};
  const appointment={id:'review-appointment',schoolId,teacherId:teacher.id,teacherName:'Synthetic Teacher',teacherBranch:'Matematik',parentId:'review-parent',parentName:'Synthetic Parent',parentPhone:'905551110101',studentId:student.id,studentName:student.name,className:student.className,date:new Date(time+86400000).toISOString().slice(0,10),startTime:'09:00',endTime:'09:15',status:'pending',createdAt:new Date(time).toISOString()};
  for(const [i,role]of(['parent','teacher','admin','security']as const).entries()) {
    const id='review-'+role,phone='+90555111010'+(i+1);codes[role]=String(crypto.randomInt(0,1_000_000)).padStart(6,'0');
    const salt=crypto.randomBytes(32).toString('hex');const hash=await hashReviewCredential(codes[role],salt);
    config.registry.push({phone,userId:id,schoolId,role});
    const user={id,phone,firstName:'Synthetic',lastName:role};
    const views={teachers:{teachers:[teacher]},students:{students:[student]},appointments:{appointments:[appointment]},
      availability:{availability:[{id:'review-slot',schoolId,teacherId:teacher.id,dayOfWeek:1,startTime:'09:00',endTime:'10:00',slotDurationMinutes:15}]},
      notifications:{notifications:[]},settings:{settings},classes:{classes:['5-A']},info:{school},'audit-logs':{auditLogs:[]},roster:{roster:[]}};
    await pg.query('INSERT INTO review_accounts(id,phone,school_id,role,salt,credential_hash,user_data,school_data,views) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,phone,schoolId,role,salt,hash,JSON.stringify(user),JSON.stringify(school),JSON.stringify(views)]);
  }
  if(interactive){const seed=(await pg.query("SELECT views FROM review_accounts WHERE id='review-parent'")).rows[0].views as any;
   await pg.query('INSERT INTO review_school_state VALUES($1,$2)',[schoolId,JSON.stringify({school,settings,students:[{...student,parentId:'review-parent'}],teachers:[teacher],availability:[1,2,3,4,5,6].map(day=>({id:'review-slot-'+day,schoolId,teacherId:teacher.id,dayOfWeek:day,startTime:'08:00',endTime:'17:00',slotDurationMinutes:15})),appointments:[{...appointment,qrToken:'review-qr-'+crypto.randomUUID()}],staff:[],audit:[],preferences:{}})]);
  }
  let normalCalls=0;const app=express();app.use(express.json());
  app.get('/api/public/auth-capabilities',(_req,res)=>res.json({whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}));
  // Test-only IP variation proves account limits survive distributed attempts.
  app.use((req,_res,next)=>{if(req.headers['x-test-ip'])Object.defineProperty(req,'ip',{value:String(req.headers['x-test-ip'])});next();});
  app.use(createReviewGateway(()=>config,()=>db,()=>time,()=>interactive));
  app.use((_req,res)=>{normalCalls++;res.status(401).json({error:'Normal fixture authorization required'});});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const address=server.address();if(!address||typeof address==='string')throw Error('Address');
  const origin='http://127.0.0.1:'+address.port;
  const request=async(path:string,body?:unknown,token?:string,extra:Record<string,string>={},method?:string)=>{
    const r=await fetch(origin+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
    return{status:r.status,body:await r.json()};
  };
  const reset=async()=>{await pg.query('UPDATE review_accounts SET failures=0,failure_start=0,locked_until=0,last_request=0,active=true,version=1');await pg.query('DELETE FROM review_limits');config.enabled=true;config.epoch=1;};
  const login=async(role='parent')=>{
    const entry=config.registry.find(x=>x.role===role)!;
    const challenge=await request('/api/auth/phone/request-code',{phone:entry.phone});
    if(challenge.status!==200)throw Error('Synthetic challenge unavailable');
    const data={phone:entry.phone,attemptId:challenge.body.attemptId,challengeId:challenge.body.challengeId,code:codes[role]};
    const verified=await request('/api/auth/phone/verify-code',data);return{...verified,data};
  };
  return{pg,db,config,codes,origin,request,reset,login,schoolId,server,advance:(ms:number)=>{time+=ms;},normalCalls:()=>normalCalls,close:async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();}};
}
