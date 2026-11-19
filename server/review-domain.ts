import crypto from 'node:crypto';
import type {ReviewDb} from './review-auth';
import type {Request} from 'express';
import {evaluateSecurityQr,invalidQrVerification} from './appointment-entry';
import {normalizeTurkishPhone} from '../src/utils/phone';
import {validateRosterRow} from '../src/utils/roster-import';

export const REVIEW_DOMAIN_SCHEMA=`CREATE TABLE review_school_state(school_id text PRIMARY KEY,state jsonb NOT NULL);`;
export type ReviewState={school:any;settings:any;students:any[];teachers:any[];availability:any[];appointments:any[];staff:any[];audit:any[];preferences:Record<string,boolean>};
const categories=['pending-parents','pending-staff','pending-appointments','today','missing','teachers','appointments'];
const id=()=> 'review-'+crypto.randomUUID();
const validId=(s:unknown)=>typeof s==='string'&&/^review-[a-z0-9-]{1,80}$/.test(s);
class DomainError extends Error {constructor(public status:number,public safeMessage:string){super('Review domain operation rejected');}}
const fail=(status:number,message='Bu işlem için yetkiniz yok.'):never=>{throw new DomainError(status,message);};
const text=(v:unknown,max=150)=>typeof v==='string'&&v.trim().length>0&&v.length<=max?v.trim():fail(400,'Alanları kontrol edin.');
const minute=(v:unknown)=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v)?Number(v.slice(0,2))*60+Number(v.slice(3)):fail(400,'Geçerli saat seçin.');
const bodyKeys=(b:any,allowed:string[])=>{if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!allowed.includes(k)))fail(400,'Geçersiz işlem alanı.');};
const withoutQr=(a:any)=>{const{qrToken,...safe}=a;return safe;};
const today=(now:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));

// All persistence is through the explicitly injected review connection. No normal
// repository, provider client, pool, production credential or outbound request.
export async function reviewDomain(db:ReviewDb,account:any,req:Request,path:string,now:number):Promise<{status:number;body:any}|null>{
 const pref=/^\/auth\/me\/license-reminder-preferences\/(review-[a-z0-9-]+)$/.exec(path);
 const route=/^\/schools\/(review-[a-z0-9-]+)\/(.+)$/.exec(path);
 if(!route&&!pref)return null;
 const schoolId=(route||pref)![1];
 if(schoolId!==account.school_id || (req.headers['x-school-id']&&req.headers['x-school-id']!==schoolId))return{status:403,body:{error:'Başka okula erişilemez.'}};
 try{return await db.transaction(async tx=>{
  const current=(await tx.query('SELECT * FROM review_accounts WHERE id=$1 FOR UPDATE',[account.id])).rows[0];
  if(!current?.active||!current.synthetic||current.version!==account.version||current.role!==account.role||current.school_id!==schoolId)fail(401,'Oturum geçerli değil.');
  const row=(await tx.query('SELECT state FROM review_school_state WHERE school_id=$1 FOR UPDATE',[schoolId])).rows[0];
  if(!row)fail(503,'Demo içerik hazırlanmadı.');
  const s:ReviewState=row.state;
  if(s.school?.id!==schoolId)fail(503,'Demo veri kapsamı geçersiz.');
  const validate=(value:any):void=>{if(Array.isArray(value)){value.forEach(validate);return;}if(!value||typeof value!=='object')return;for(const[k,v]of Object.entries(value)){
   if(k==='schoolId'&&v!==schoolId)fail(503,'Demo veri kapsamı geçersiz.');
   if(['id','userId','parentId','teacherId','studentId'].includes(k)&&v!=null&&!validId(v))fail(503,'Demo kaynak kapsamı geçersiz.');
   if(/password|credential|secret|salt|hash/i.test(k))fail(503,'Demo içerik geçersiz.');validate(v);
  }};validate(s);
  const role=current.role,uid=current.id,teacher=s.teachers.find(t=>t.userId===uid),b=req.body||{},method=req.method;
  let status=200,result:any,changed=false;
  const permit=(...roles:string[])=>{if(!roles.includes(role))fail(403);};
  const audit=(action:string)=>{s.audit.unshift({id:id(),schoolId,action,actorName:'Demo '+role,timestamp:new Date(now).toISOString(),details:'Yalnız sentetik demo işlemidir.'});if(s.audit.length>500)s.audit.length=500;};
  const find=(records:any[],value:unknown)=>{if(!validId(value))fail(404,'Kayıt bulunamadı.');return records.find(r=>r.id===value)||fail(404,'Kayıt bulunamadı.');};
  const appointmentView=()=>s.appointments.filter(a=>role==='parent'?a.parentId===uid:role==='teacher'?a.teacherId===teacher?.id:true).map(a=>role==='parent'?a:withoutQr(a));
  const studentView=()=>s.students.filter(a=>role==='parent'?a.parentId===uid:true).map(({parentId,...a})=>a);
  const sub=route?.[2]||'';
  if(Object.entries(req.query).some(([k,v])=>!['page','q','status','role','date'].includes(k)||Array.isArray(v)||typeof v!=='string'||v.length>200))fail(400,'Geçersiz filtre.');
  if(pref){permit('admin');if(method==='GET')result={enabled:!!s.preferences[uid],canEnable:true,consentStatus:s.preferences[uid]?'VALID':'MISSING'};
   else if(method==='PUT'){bodyKeys(b,['enabled']);if(typeof b.enabled!=='boolean')fail(400);s.preferences[uid]=b.enabled;result={enabled:b.enabled};changed=true;audit('demo.preference.changed');}else fail(403);
  }else if(method==='GET'){
   if(sub==='teachers')result={teachers:s.teachers};
   else if(sub==='students')result={students:studentView()};
   else if(sub==='availability')result={availability:s.availability.map(a=>({...a,slotDurationMinutes:s.settings.defaultSlotMinutes}))};
   else if(sub==='appointments')result={appointments:appointmentView()};
   else if(sub==='settings')result={settings:s.settings};
   else if(sub==='info'){permit('admin');result={school:s.school};}
   else if(sub==='classes'){permit('parent');result={classes:[...new Set(s.students.map(x=>x.className))]};}
   else if(sub==='notifications')result={notifications:[]};
   else if(sub==='audit-logs'){permit('admin','security');result={auditLogs:s.audit};}
   else if(sub==='users'){permit('admin');if(req.query.role!=='security')fail(400);result={users:s.staff.filter(x=>x.role==='security')};}
   else if(sub==='roster'){permit('admin');result={roster:[]};}
   else if(/^teachers\/[^/]+\/occupied-slots$/.test(sub)){
    permit('parent','admin');const tid=sub.split('/')[1];find(s.teachers,tid);result={occupied:s.appointments.filter(a=>a.teacherId===tid&&a.date===req.query.date&&['pending','booked','checked_in'].includes(a.status)).map(a=>({startTime:a.startTime,endTime:a.endTime}))};
   }else if(sub==='management/student-records'){
    permit('admin');result={records:s.students.map(x=>({id:x.id,kind:'student',name:x.name,className:x.className,studentNumber:x.studentNumber||'',birthDate:'',parents:[{id:x.parentId,fullName:'Synthetic Parent',phone:'',status:'active'}]})),classBulkDeleteEnabled:false,classMultiDeleteEnabled:false};
   }else if(/^management\/students\/[^/]+\/removal$/.test(sub)){permit('admin');const row=find(s.students,sub.split('/')[2]);result={studentName:row.name,siblingAccounts:0,preservedAccounts:1,deletedAccounts:0};}
   else if(sub==='management/parents'){permit('admin');const parents=(await tx.query("SELECT id,phone,user_data FROM review_accounts WHERE school_id=$1 AND role='parent' AND synthetic=true",[schoolId])).rows;result={parents:parents.map(a=>({id:a.id,fullName:a.user_data.firstName+' '+a.user_data.lastName,phone:a.phone,status:'active',students:s.students.filter(x=>x.parentId===a.id)}))};}
   else if(sub==='management/admins'){permit('admin');result={admins:[]};}
   else if(sub==='management/operations'||sub.startsWith('management/operations/')){
    permit('admin');const cat=sub.split('/')[2];const items=(c:string)=>c==='teachers'?s.teachers.map(t=>({id:t.id,kind:'staff',name:t.firstName+' '+t.lastName,role:'teacher',branch:t.branch,status:'active',phone:t.phone})):['appointments','pending-appointments','today'].includes(c)?s.appointments.filter(a=>c==='appointments'||(c==='today'?a.date===today(now):a.status==='pending')).map(a=>({id:a.id,kind:'appointment',name:a.studentName,status:a.status,appointment:withoutQr(a)})):[];
    if(!cat)result={counts:Object.fromEntries(categories.map(c=>[c,items(c).length])),statuses:Object.fromEntries(['pending','booked','cancelled','rejected'].map(x=>[x,s.appointments.filter(a=>a.status===x).length]))};
    else{if(!categories.includes(cat))fail(404);const page=Number(req.query.page||0);if(!Number.isInteger(page)||page<0||page>1000)fail(400);const list=items(cat).filter(x=>!req.query.q||JSON.stringify(x).toLocaleLowerCase('tr').includes(String(req.query.q).toLocaleLowerCase('tr'))).filter((x:any)=>!req.query.status||x.status===req.query.status);result={items:list.slice(page*25,page*25+25),total:list.length,page,pageSize:25};}
   }else fail(403);
  }else if(method==='POST'&&sub==='appointments'){
   permit('parent','admin');bodyKeys(b,['teacherId','studentName','className','date','startTime','endTime','notes']);
   const t=find(s.teachers,b.teacherId);if(!t.userId)fail(409,'Bu öğretmen randevu kabul etmiyor.');
   const student=s.students.find(x=>x.name===b.studentName&&x.className===b.className&&(role==='admin'||x.parentId===uid));if(!student)fail(403,'Öğrenci bağlantısı doğrulanamadı.');
   const date=text(b.date,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date<today(now)||date>new Date(now+s.settings.maxBookingDaysAhead*86400000).toISOString().slice(0,10))fail(400,'Geçerli bir randevu günü seçin.');
   const start=minute(b.startTime),end=minute(b.endTime),day=new Date(date+'T12:00:00Z').getUTCDay()||7;
   if(date===today(now)&&start<=minute(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now))))fail(400,'Geçmiş saat seçilemez.');
   if(end-start!==s.settings.defaultSlotMinutes||!s.availability.some(a=>a.teacherId===t.id&&a.dayOfWeek===day&&minute(a.startTime)<=start&&minute(a.endTime)>=end&&(start-minute(a.startTime))%s.settings.defaultSlotMinutes===0))fail(409,'Seçilen saat uygun değil.');
   if(s.appointments.some(a=>a.teacherId===t.id&&a.date===date&&['pending','booked','checked_in'].includes(a.status)&&minute(a.startTime)<end&&minute(a.endTime)>start))fail(409,'Bu saat az önce doldu.');
   if(s.appointments.length>=300)fail(409,'Demo kapasitesi doldu.');
   const a={id:id(),schoolId,teacherId:t.id,teacherName:t.firstName+' '+t.lastName,teacherBranch:t.branch,parentId:student.parentId,parentName:current.user_data.firstName+' '+current.user_data.lastName,parentPhone:current.phone,studentId:student.id,studentName:student.name,className:student.className,date,startTime:b.startTime,endTime:b.endTime,status:'pending',notes:typeof b.notes==='string'?b.notes.slice(0,1000):'',createdAt:new Date(now).toISOString(),qrToken:'review-qr-'+crypto.randomUUID()};s.appointments.push(a);status=201;result={success:true,appointment:role==='parent'?a:withoutQr(a)};changed=true;audit('demo.appointment.created');
  }else if(method==='POST'&&/^appointments\/[^/]+\/(approve|reject|cancel)$/.test(sub)){
   const[,aid,action]=sub.split('/'),a=find(s.appointments,aid);permit(...(action==='cancel'?['parent','teacher','admin']:['teacher']));
   if(role==='parent'&&a.parentId!==uid||role==='teacher'&&a.teacherId!==teacher?.id)fail(403);
   bodyKeys(b,action==='reject'?['reason']:[]);
   if(!['pending','booked'].includes(a.status)||(action!=='cancel'&&a.status!=='pending'))fail(409,'Randevunun durumu değişti.');
   if(action==='cancel'&&role==='parent'&&!s.settings.allowParentCancel)fail(403);
   a.status=action==='approve'?'booked':action==='reject'?'rejected':'cancelled';if(action==='approve')a.approvedAt=new Date(now).toISOString();if(action==='reject')a.rejectionReason=typeof b.reason==='string'?b.reason.slice(0,1000):'';
   result={success:true,appointment:role==='parent'?a:withoutQr(a)};changed=true;audit('demo.appointment.'+action);
  }else if(method==='POST'&&sub==='availability'){
   permit('teacher');bodyKeys(b,['dayOfWeek','startTime','endTime','slotDurationMinutes']);if(!teacher)fail(403);
   const day=Number(b.dayOfWeek),start=minute(b.startTime),end=minute(b.endTime);if(!Number.isInteger(day)||day<1||day>6||end<=start)fail(400);
   if(s.availability.some(a=>a.teacherId===teacher.id&&a.dayOfWeek===day&&minute(a.startTime)<end&&minute(a.endTime)>start))fail(409,'Saat aralığı mevcut.');
   const slot={id:id(),schoolId,teacherId:teacher.id,dayOfWeek:day,startTime:b.startTime,endTime:b.endTime,slotDurationMinutes:s.settings.defaultSlotMinutes};s.availability.push(slot);result={success:true,slot};changed=true;audit('demo.availability.created');
  }else if(method==='DELETE'&&/^availability\/[^/]+$/.test(sub)){
   permit('teacher','admin');const slot=find(s.availability,sub.split('/')[1]);if(role==='teacher'&&slot.teacherId!==teacher?.id)fail(403);s.availability=s.availability.filter(x=>x.id!==slot.id);result={success:true};changed=true;audit('demo.availability.removed');
  }else if(method==='POST'&&sub==='security/qr/verify'){
   permit('security');bodyKeys(b,['qrToken']);const token=typeof b.qrToken==='string'?b.qrToken:'';const a=token.startsWith('review-qr-')?s.appointments.find(a=>a.qrToken===token):null;result=a?evaluateSecurityQr(a,new Date(now)):invalidQrVerification();audit('demo.qr.verified');changed=true;
  }else if(method==='PUT'&&sub==='settings'){
   permit('admin');bodyKeys(b,['schoolName','appName','defaultSlotMinutes','minSlotMinutes','maxBookingDaysAhead','allowParentCancel']);
   if(b.schoolName!==undefined)s.settings.schoolName=text(b.schoolName);if(b.appName!==undefined)s.settings.appName=text(b.appName);
   for(const[k,min,max]of[['defaultSlotMinutes',5,60],['minSlotMinutes',5,60],['maxBookingDaysAhead',1,90]]as const)if(b[k]!==undefined){if(!Number.isInteger(b[k])||b[k]<min||b[k]>max)fail(400);s.settings[k]=b[k];}
   if(b.allowParentCancel!==undefined){if(typeof b.allowParentCancel!=='boolean')fail(400);s.settings.allowParentCancel=b.allowParentCancel;}s.school.settings=s.settings;result={success:true,settings:s.settings};changed=true;audit('demo.settings.changed');
  }else if(method==='POST'&&(sub==='staff'||sub==='teachers')){
   permit('admin');bodyKeys(b,['fullName','role','branch','phone','email']);const role=b.role||'teacher';if(!['teacher','security'].includes(role))fail(403);
   const full=text(b.fullName).split(/\s+/);if(full.length<2)fail(400);const phone=normalizeTurkishPhone(b.phone);if(!phone)fail(400);
   if(s.teachers.some(t=>normalizeTurkishPhone(t.phone)===phone)||s.staff.some(t=>normalizeTurkishPhone(t.phone)===phone))fail(409,'Telefon demo kayıtlarında mevcut.');
   const row={id:id(),schoolId,firstName:full[0],lastName:full.slice(1).join(' '),phone,branch:role==='teacher'?text(b.branch):'',role,accountStatus:'pending'};
   (role==='teacher'?s.teachers:s.staff).push(row);result={success:true,teacher:row,emailSent:false,message:'Sentetik aktivasyon kaydı oluşturuldu; gerçek e-posta gönderilmedi.'};changed=true;audit('demo.staff.created');
  }else if(method==='POST'&&sub==='roster/bulk-upload'){
   permit('admin');bodyKeys(b,['records','preview']);if(!Array.isArray(b.records)||b.records.length<1||b.records.length>100||typeof b.preview!=='boolean')fail(400);
   const rows=b.records.map(validateRosterRow);let added=0;
   if(!b.preview){for(const row of rows){if(row.status==='invalid')continue;const r=row.record;
    if(s.students.some(x=>x.name===r.studentName&&x.className===r.className)){row.status='duplicate';continue;}
    const parent=(await tx.query("SELECT id FROM review_accounts WHERE school_id=$1 AND phone=$2 AND role='parent' AND synthetic=true AND active=true",[schoolId,r.parentPhone])).rows[0];
    if(!parent){row.status='invalid';row.errors.push('Yalnız önceden tanımlı sentetik demo veli telefonu kullanılabilir.');continue;}
    if(s.students.length>=300)fail(409,'Demo kapasitesi doldu.');s.students.push({id:id(),schoolId,parentId:parent.id,name:r.studentName,className:r.className,studentNumber:r.studentNumber});added++;
   }changed=true;audit('demo.student.imported');}result={rows,addedCount:added,skippedCount:rows.length-added};
  }else if(method==='DELETE'&&/^management\/students\/[^/]+\/removal$/.test(sub)){
   permit('admin');const row=find(s.students,sub.split('/')[2]);s.students=s.students.filter(x=>x.id!==row.id);s.appointments=s.appointments.filter(x=>x.studentId!==row.id);result={success:true,preservedAccounts:1,deletedAccounts:0};changed=true;audit('demo.student.removed');
  }else if(method==='PATCH'&&/^management\/(student|teacher|security)\/[^/]+$/.test(sub)){
   permit('admin');const[,kind,rid]=sub.split('/');bodyKeys(b,kind==='student'?['name','className','studentNumber','birthDate']:['firstName','lastName','fullName','phone','email','branch']);const row=find(kind==='student'?s.students:kind==='teacher'?s.teachers:s.staff,rid);
   for(const[k,v]of Object.entries(b)){if(typeof v!=='string'||v.length>150)fail(400);if(k==='phone'&&!normalizeTurkishPhone(v))fail(400);if(k==='fullName'){const names=text(v).split(/\s+/);if(names.length<2)fail(400);row.firstName=names[0];row.lastName=names.slice(1).join(' ');}else row[k]=v.trim();}result={success:true};changed=true;audit('demo.record.updated');
  }else if(method==='POST'&&/^staff\/(teacher|security)\/[^/]+\/resend-activation$/.test(sub)){
   permit('admin');const[,kind,rid]=sub.split('/');find(kind==='teacher'?s.teachers:s.staff,rid);result={success:true,emailSent:false,message:'Demo bildirim kaydı oluşturuldu; gerçek e-posta gönderilmedi.'};audit('demo.email.simulated');changed=true;
  }else if(method==='POST'&&sub==='notifications/read'){bodyKeys(b,[]);result={success:true};audit('demo.notifications.read');changed=true;}
  else fail(403,'Bu dış işlem veya yönetim yetkisi demo kapsamında kapalıdır.');
  if(changed){if(Buffer.byteLength(JSON.stringify(s))>512_000)fail(409,'Demo kapasitesi doldu.');await tx.query('UPDATE review_school_state SET state=$2 WHERE school_id=$1',[schoolId,JSON.stringify(s)]);}
  await tx.query('INSERT INTO review_audit VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),uid,changed?'domain_operation':'domain_read',true,crypto.createHash('sha256').update(req.ip||'unknown').digest('hex'),now]);
  return{status,body:result};
 });}catch(e){try{await db.query('INSERT INTO review_audit VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),account.id,'domain_denied',false,crypto.createHash('sha256').update(req.ip||'unknown').digest('hex'),now]);}catch{}return{status:e instanceof DomainError?e.status:503,body:{error:e instanceof DomainError?e.safeMessage:'Demo işlem tamamlanamadı.'}};}
}
