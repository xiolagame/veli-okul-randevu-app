import type {ReviewIdentity} from './review-access';
import type {TransactionClient} from './database/postgres';
import crypto from 'node:crypto';
export async function refreshReviewQrScenario(db:TransactionClient,store:'apple'|'google',now=new Date()){
 const schoolId='review-'+store;
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const part=(name:string)=>parts.find(p=>p.type===name)!.value;
 const date=`${part('year')}-${part('month')}-${part('day')}`;
 const start=Math.min(23*60+30,Math.floor((Number(part('hour'))*60+Number(part('minute')))/15)*15);
 const clock=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
 await db.query(`INSERT INTO appointments(id,school_id,teacher_id,teacher_name,teacher_branch,parent_id,parent_name,parent_phone,student_id,student_name,class_name,date,start_time,end_time,status,entry_code,qr_token,notes)
 VALUES($1,$2,$3,'Demo Öğretmen','Matematik',$4,'Demo Veli','sentetik',$5,'Sentetik Öğrenci','5-A',$6,$7,$8,'booked',$9,$10,'Sentetik mağaza inceleme QR örneği')
 ON CONFLICT(id) DO UPDATE SET date=EXCLUDED.date,start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,status='booked',qr_token=EXCLUDED.qr_token,entry_code=EXCLUDED.entry_code`,
 ['scenario-'+store,schoolId,'profile-'+store,'review-'+store+'-parent','student-'+store,date,clock(start),clock(start+15),crypto.randomBytes(4).toString('hex'),'VELIQR1:'+crypto.randomBytes(24).toString('base64url')]);
}
// Provisioning helper for a separately approved, empty review database only.
// No migrations, production connections, random credentials or automatic startup writes.
export async function seedReviewFixtures(db:TransactionClient,identities:ReviewIdentity[]){
 if(identities.length!==8||new Set(identities.map(x=>x.userId)).size!==8||identities.some(x=>typeof x.enabled!=='boolean'||!Number.isInteger(x.version)||x.version<1||!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(x.passwordHash)))throw Error('Eight valid separate review identities required');
 const roles=['admin','teacher','parent','security'] as const;
 for(const store of ['apple','google'] as const){
  const schoolId='review-'+store;
  const accounts=roles.map(role=>{
   const account=identities.find(x=>x.id===`review-${store}-${role}`&&x.store===store&&x.schoolId===schoolId&&x.userId===`review-${store}-${role}`);
   if(!account)throw Error('Invalid synthetic identity mapping');return{...account,role};
  });
  await db.query("INSERT INTO schools(id,name,code,city,district) VALUES($1,$2,$3,'Demo','Sentetik') ON CONFLICT(id) DO NOTHING",[schoolId,store==='apple'?'Apple İnceleme Okulu':'Google İnceleme Okulu','REVIEW-'+store.toUpperCase()]);
  for(const a of accounts){
   await db.query("INSERT INTO users(id,phone,first_name,last_name,email,is_phone_verified,password_hash) VALUES($1,$2,'İnceleme',$3,$4,FALSE,$5) ON CONFLICT(id) DO NOTHING",[a.userId,a.userId.replace('review-',''),a.role,a.userId+'@example.invalid',a.passwordHash]);
   await db.query("INSERT INTO school_memberships(id,school_id,user_id,role,status) VALUES($1,$2,$3,$4,'active') ON CONFLICT(id) DO NOTHING",['mem-'+a.id,schoolId,a.userId,a.role]);
  }
  await db.query("INSERT INTO teacher_profiles(id,school_id,user_id,first_name,last_name,branch) VALUES($1,$2,$3,'Demo','Öğretmen','Matematik') ON CONFLICT(id) DO NOTHING",['profile-'+store,schoolId,'review-'+store+'-teacher']);
  await db.query("INSERT INTO students(id,school_id,name,class_name,student_number) VALUES($1,$2,'Sentetik Öğrenci','5-A','DEMO-01') ON CONFLICT(id) DO NOTHING",['student-'+store,schoolId]);
  await db.query("INSERT INTO student_parent_relations(id,school_id,student_id,parent_user_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",['relation-'+store,schoolId,'student-'+store,'review-'+store+'-parent']);
  for(let day=0;day<7;day++)await db.query("INSERT INTO availability_slots(id,school_id,teacher_id,day_of_week,start_time,end_time,slot_duration) VALUES($1,$2,$3,$4,'09:00','17:00',15) ON CONFLICT(id) DO NOTHING",['availability-'+store+'-'+day,schoolId,'profile-'+store,day]);
  await refreshReviewQrScenario(db,store);
 }
}
