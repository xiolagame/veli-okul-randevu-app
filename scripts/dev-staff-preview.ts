// Loopback-only synthetic lab. Never imported by server.ts, Functions or client code.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {createServer as createViteServer} from 'vite';
if(process.env.DATABASE_URL||process.env.NODE_ENV==='production')throw Error('Preview refuses remote/production database');
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'veli-preview-staff-'));
delete process.env.VITE_API_BASE_URL;delete process.env.VITE_REVIEW_API_ORIGIN;
fs.cpSync(path.join(root,'server/database'),path.join(temp,'server/database'),{recursive:true});
fs.rmSync(path.join(temp,'server/database/seed_supabase_migration.sql'),{force:true});process.chdir(temp);
for(const key of Object.keys(process.env))if(/^(FIREBASE|FCM|GOOGLE_APPLICATION_CREDENTIALS|SUPABASE)/.test(key))delete process.env[key];
Object.assign(process.env,{NODE_ENV:'development',JWT_SECRET:crypto.randomBytes(32).toString('hex'),AUTH_CODE_SECRET:crypto.randomBytes(32).toString('hex'),WHATSAPP_AUTH_ENABLED:'true',WHATSAPP_UNIFIED_LOGIN_ENABLED:'true',PHONE_CENTRIC_AUTH_ENABLED:'true',WHATSAPP_PHONE_NUMBER_ID:'123456789',WHATSAPP_ACCESS_TOKEN:'local-preview-only',RESEND_API_KEY:'local-preview-only',EMAIL_FROM:'preview@example.test',CORS_ORIGIN:'http://127.0.0.1:3035'});
const otp=new Map<string,string>();let emailCode='';const messages:{channel:string;recipient:string}[]=[];
globalThis.fetch=async(input,init)=>{
 const url=String(input),body=JSON.parse(String(init?.body||'{}'));
 if(url.startsWith('https://graph.facebook.com/')){otp.set('+'+body.to,body.template.components[0].parameters[0].text);messages.push({channel:'MOCK_WHATSAPP',recipient:'synthetic'});return new Response('{"messages":[{"id":"mock"}]}',{status:200});}
 if(url==='https://api.resend.com/emails'){emailCode=body.html?.match(/>(\d{6})</)?.[1]||'';messages.push({channel:'MOCK_EMAIL',recipient:'synthetic'});return new Response('{}',{status:200});}
 throw Error('Preview external network blocked');
};
const {getDb,closeDatabase}=await import('../server/database/postgres');const db=await getDb();
const {userRepository,membershipRepository,teacherRepository}=await import('../server/repositories');
const school='preview-school';await db.query("INSERT INTO schools(id,name,code,city,district) VALUES($1,'YEREL SENTETİK OKUL','PREVIEW','TEST','TEST')",[school]);
const accounts=[{role:'admin',phone:'+905551230001',name:'YÖNETİCİ'},{role:'teacher',phone:'+905551230002',name:'ÖĞRETMEN'},{role:'parent',phone:'+905551230003',name:'VELİ'},{role:'security',phone:'+905551230004',name:'GÜVENLİK'},{role:'platform',phone:'+905551230005',name:'PLATFORM'}] as const;
for(const a of accounts){
 if(a.role==='teacher'){
  const teacher=await teacherRepository.createPending(school,{firstName:'SENTETİK',lastName:a.name,branch:'Matematik',phone:a.phone,email:'teacher-preview@example.test'});
  for(let day=0;day<7;day++)await db.query("INSERT INTO availability_slots(school_id,teacher_id,day_of_week,start_time,end_time,slot_duration) VALUES($1,$2,$3,'09:00','17:00',15)",[school,teacher.id,day]);
  continue;
 }
 if(a.role==='security'){await db.query("INSERT INTO pending_staff(id,school_id,role,first_name,last_name,phone) VALUES('preview-security',$1,'security','SENTETİK','GÜVENLİK',$2)",[school,a.phone]);continue;}
 const user=await userRepository.create({phone:a.phone,firstName:'SENTETİK',lastName:a.name,isPhoneVerified:true,email:a.role==='platform'?'platform-preview@example.test':a.role==='admin'?'admin-preview@example.test':undefined});
 if(a.role==='platform')process.env.PLATFORM_ADMIN_USER_IDS=user.id;
 else await membershipRepository.createOrActivate({schoolId:school,userId:user.id,role:a.role});
 if(a.role==='parent'){
  await db.query("INSERT INTO students(id,school_id,name,class_name,student_number) VALUES('preview-student',$1,'SENTETİK ÖĞRENCİ','5-A','1')",[school]);
  await db.query("INSERT INTO student_parent_relations(school_id,student_id,parent_user_id) VALUES($1,'preview-student',$2)",[school,user.id]);
 }
}
const {createExpressApp}=await import('../server/app');const app=createExpressApp();
app.get('/__local_preview__/state',(_req,res)=>res.json({synthetic:true,accounts:accounts.map(a=>({role:a.role,phone:a.phone})),otp:Object.fromEntries(otp),emailCode,messages}));
const vite=await createViteServer({root,configFile:path.join(root,'vite.config.ts'),server:{middlewareMode:true,host:'127.0.0.1',hmr:{port:3036,host:'127.0.0.1'}}});app.use(vite.middlewares);
const server=app.listen(3035,'127.0.0.1',()=>console.log('Synthetic local preview ready: http://127.0.0.1:3035/login (no real delivery)'));
async function stop(){server.close();await vite.close();await closeDatabase();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
