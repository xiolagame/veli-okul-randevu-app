import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {auditThemeContrast} from './theme-contrast-audit.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=String.raw`
const no=async()=>{};window.fixture={role:'parent',empty:false,fail:false,loading:false,scan:'denied',calls:[]};const f=window.fixture;
export const school={id:'review-apple',name:'SENTETİK UZUN OKUL ADI — İSTANBUL EĞİTİM KURUMLARI',code:'DEMO',city:'Demo',district:'Demo'};
const student={id:'student',name:'SENTETİK ÖĞRENCİ UZUN SOYADI',className:'5-A',studentNumber:'DEMO-01'};
const teacher={id:'profile',userId:'review-apple-teacher',firstName:'SENTETİK',lastName:'ÖĞRETMEN UZUN SOYADI',branch:'Matematik',phone:'Sentetik',email:'teacher@example.invalid'};
const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
const appointment={id:'appointment',teacherId:'profile',teacherName:teacher.firstName+' '+teacher.lastName,teacherBranch:teacher.branch,parentId:'review-apple-parent',parentName:'SENTETİK VELİ UZUN SOYADI',parentPhone:'Sentetik',studentName:student.name,className:'5-A',date:tomorrow,startTime:'10:00',endTime:'10:15',status:'booked',createdAt:new Date().toISOString(),qrToken:'VELIQR1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'};
const pending={...appointment,id:'pending',status:'pending'};
const settings={schoolName:school.name,appName:'Veli Randevu',defaultSlotMinutes:15,minSlotMinutes:10,maxBookingDaysAhead:30,allowParentCancel:true};
export const useApp=()=>new Proxy({currentUser:{id:'review-apple-'+(f.role==='platform'?'admin':f.role),role:f.role==='platform'?'admin':f.role,firstName:'SENTETİK',lastName:'İNCELEME',phone:'Sentetik',students:[student],branch:'Matematik',deletionVerification:'whatsapp'},currentSchool:school,schools:[school],platformSchools:[],isPlatformAdmin:f.role==='platform',platformContextActive:false,userMemberships:[{schoolId:school.id,role:f.role,status:'active'}],unreadNotificationCount:1,settings,teachers:f.empty?[]:[teacher],availability:f.empty?[]:Array.from({length:7},(_,i)=>({id:'slot'+i,teacherId:'profile',dayOfWeek:i,startTime:'09:00',endTime:'17:00',slotDurationMinutes:15})),appointments:f.empty?[]:[appointment,pending],notifications:f.empty?[]:[{id:'notice',title:'Sentetik bildirim',message:'Gerçek dış gönderim yapılmaz.',createdAt:new Date().toISOString(),read:false}],getParentClasses:async()=>['5-A'],verifySecurityQr:async()=>({allowed:false,decision:'INVALID',title:'GEÇERSİZ QR KODU',message:'Sentetik QR reddedildi.'}),deleteAccount:async()=>{f.calls.push('delete');}}, {get:(target,key)=>target[key]??(async()=>{if(f.fail)throw Error('Sentetik hata');})});
const response=async(value)=>{if(f.fail)throw Error('Synthetic fixture error');if(f.loading)await new Promise(()=>{});return value;};
export const api=new Proxy({getOccupiedSlots:async()=>response({intervals:[]}),getManagedSchools:async()=>response({schools:[{...school,adminStatus:'active',licenseStatus:'active'}]}),getPlatformSecurity:async()=>response({}),getPlatformAuditLogs:async()=>response({logs:[]}),getPlatformRequests:async()=>response({items:[],total:0,page:0,pageSize:20}),getPlatformUnseenRequestCount:async()=>({count:0}),markPlatformRequestsSeen:async()=>({count:0}),getPlatformPhoneBindingStatus:async()=>response({configured:false}),getPlatformLicenses:async()=>response({items:[],total:0,page:0,pageSize:10,summary:{total:0,active:0,expiring:0,expired:0,suspended:0}}),getLicenseWhatsAppPreference:async()=>response({enabled:false,canEnable:true}),setLicenseWhatsAppPreference:async(id,enabled)=>({enabled}),getLicenseWhatsApp:async()=>response({schoolId:school.id,schoolName:school.name,activeAdminCount:1,eligibleAdminCount:1,recipientCount:1,invalidPhoneCount:0,skipped:[],recipients:[],expiresAt:null,nextAutomaticAt:null,automaticEnabled:false,manualEnabled:false,manualBlockedReason:null,counts:{total:0,accepted:0,delivered:0,failed:0,unknown:0,waiting:0,lastAttemptAt:null,lastSentAt:null},history:[],operations:[],page:0,pageSize:10}),previewLicenseWhatsApp:async()=>response({operationId:'synthetic-preview',schoolName:school.name,recipientCount:1,recipients:[{maskedPhone:'SENTETİK'}],template:'synthetic',language:'tr',days:7,expiryDate:'Demo',live:false,expiresAt:new Date(Date.now()+60000).toISOString()}),confirmLicenseWhatsApp:async()=>response({status:'TEST',workerAccepted:false})},{get:(target,key)=>target[key]||(()=>response({intervals:[]}))});
api.getPlatformRequests=async()=>response({requests:[]});
api.getPlatformSecurity=async()=>response({database:'connected',authConfiguration:'ready',codeSigning:'ready'});
const originalVerify=async()=>{if(f.fail)throw Error('Synthetic QR failure');if(f.loading)await new Promise(()=>{});return{allowed:f.scan==='approved',decision:f.scan==='approved'?'APPROVED':'INVALID',title:f.scan==='approved'?'RANDEVU ONAYLANDI':'GEÇERSİZ QR KODU',message:'Sentetik doğrulama sonucu; gerçek kamera kullanılmadı.',appointment};};
`;
const entry=String.raw`import React from'react';import{createRoot}from'react-dom/client';
import{ParentView}from'./src/components/ParentView';import{TeacherView}from'./src/components/TeacherView';
import{SecurityView}from'./src/components/SecurityView';import{Navbar}from'./src/components/Navbar';
import{DeleteAccountDialog}from'./src/components/DeleteAccountDialog';import{SchoolManagement}from'./src/components/SchoolManagement';
import{LicenseWhatsAppPanel}from'./src/components/LicenseWhatsAppPanel';import{LicenseWhatsAppPreference}from'./src/components/LicenseWhatsAppPreference';
import{school}from'fixture';const root=createRoot(document.getElementById('root'));let key=0;
window.renderRole=(role,scene='main')=>{window.fixture.role=role;root.render(<React.Fragment key={++key}>
<Navbar onOpenAdmin={()=>{}} onOpenNotifications={()=>{}}/>
{scene==='delete'?<DeleteAccountDialog onClose={()=>{}}/>:
scene==='preference'?<section className='surface'><LicenseWhatsAppPreference schoolId={school.id}/></section>:
scene==='license'?<LicenseWhatsAppPanel schoolId={school.id} onClose={()=>{}}/>:
role==='parent'?<ParentView/>:role==='teacher'?<TeacherView/>:role==='security'?<SecurityView/>:
<SchoolManagement initialSection='schools' onClose={()=>{}} onManageSchool={()=>{}} onChanged={async()=>{}}/>}
</React.Fragment>)};window.renderRole('parent');`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{}'},plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/context\/AppContext$|services\/api$|^fixture$/},()=>({path:'fixture',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture.replace("verifySecurityQr:async()=>({allowed:false,decision:'INVALID',title:'GEÇERSİZ QR KODU',message:'Sentetik QR reddedildi.'})","verifySecurityQr:originalVerify"),loader:'js'}));
 b.onResolve({filter:/^qr-scanner$/},()=>({path:'scanner',namespace:'scanner'}));
 b.onLoad({filter:/.*/,namespace:'scanner'},()=>({contents:"export default class Scanner{constructor(video,callback){this.callback=callback}async start(){if(window.fixture.scan==='denied')throw new DOMException('Synthetic camera denial','NotAllowedError');setTimeout(()=>this.callback({data:'VELIQR1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}),10)}stop(){}destroy(){}}",loader:'js'}));
}}]});
const css=fs.readdirSync('dist/client/assets').filter(x=>x.endsWith('.css')).map(x=>fs.readFileSync('dist/client/assets/'+x,'utf8')).join('\n')+fs.readFileSync('src/theme.css','utf8');
const assets=new Set(fs.readdirSync('dist/client/assets'));
const server=http.createServer((req,res)=>{
 if(req.url==='/branding/veli-randevu-logo.png'){res.setHeader('Content-Type','image/png');res.end(fs.readFileSync('public/branding/veli-randevu-logo.png'));return;}
 const asset=req.url?.startsWith('/assets/')?req.url.slice(8):'';
 if(assets.has(asset)){res.setHeader('Content-Type',asset.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(fs.readFileSync('dist/client/assets/'+asset));return;}
 res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/style.css'?css:'<!doctype html><html data-theme="light"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[],rows=[];
fs.mkdirSync('audit/theme-roles',{recursive:true});
try{
 const page=await browser.newPage({reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')||r.request().url().startsWith('data:')?r.continue():r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!window.renderRole);
 const render=async(role,scene='main',flags={})=>{await page.evaluate(({role,scene,flags})=>{Object.assign(window.fixture,{empty:false,fail:false,loading:false,scan:'denied'},flags);window.renderRole(role,scene);},{role,scene,flags});await page.waitForTimeout(70);};
 async function check(name,width,theme){
  const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.theme-switcher button')].map(e=>({label:e.getAttribute('aria-label'),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),text:getComputedStyle(document.documentElement).getPropertyValue('--theme-text').trim(),surface:getComputedStyle(document.documentElement).getPropertyValue('--theme-surface').trim()}));
  assert(metrics.scroll<=width,'Overflow '+name+' '+theme+' '+width);assert(metrics.buttons.every(b=>b.width>=44&&b.height>=44));const lowContrast=await page.evaluate(auditThemeContrast);rows.push({name,theme,...metrics,lowContrast});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`audit/theme-roles/${name}-${theme}-${width}.png`,fullPage:true});
 }
 for(const theme of ['light','dark'])for(const width of [375,820,1180]){
  await render('parent');await page.setViewportSize({width,height:width===820?375:844});await page.getByRole('button',{name:theme==='dark'?'Koyu mod':'Açık mod',exact:true}).first().click();
  for(const role of ['parent','teacher']){
   await render(role);await check(role+'-home',width,theme);
   const tabs=role==='parent'?['Öğretmenler','Randevular','Bildirimler','Profil']:['Randevular','Müsaitlik','Profil'];
   for(const tab of tabs){await page.locator('.role-navigation').getByRole('button',{name:new RegExp(tab)}).click();await check(role+'-'+tab,width,theme);}
   await render(role,'main',{empty:true});await check(role+'-empty',width,theme);
  }
  await render('parent');await page.getByRole('button',{name:'Giriş kartını aç',exact:true}).click();await page.getByRole('dialog').waitFor();await check('parent-qr',width,theme);
  await render('parent');await page.getByRole('button',{name:'Yeni randevu al',exact:true}).click();await page.getByRole('button',{name:/Randevu al/}).first().click();await page.getByRole('dialog').waitFor();await check('parent-booking',width,theme);
  await render('security');await check('security-camera',width,theme);await page.getByRole('button',{name:'QR Kod Tara',exact:true}).click();await page.waitForTimeout(150);await check('security-denied',width,theme);
  for(const scan of ['approved','invalid','loading','fail']){await render('security','main',{scan,[scan]:true});await page.getByRole('button',{name:'QR Kod Tara',exact:true}).click();await page.locator('.camera-result-panel').waitFor();await check('security-qr-'+scan,width,theme);}
  await render('platform');await check('platform-schools',width,theme);
  for(const tab of ['Genel Bakış','Lisans Yönetimi','Gelen Talepler','Sistem Güvenliği','Platform İşlem Günlüğü']){await page.locator('.platform-nav').getByRole('button',{name:tab,exact:true}).click();await page.waitForTimeout(70);await check('platform-'+tab,width,theme);}
  for(const scene of ['delete','preference','license']){await render('admin',scene);await check('admin-'+scene,width,theme);if(scene==='delete'){await page.getByRole('button',{name:'Devam et',exact:true}).click();await check('admin-delete-confirm',width,theme);assert.equal(await page.getByRole('button',{name:'WhatsApp doğrulama kodu gönder'}).count(),0);}}
  for(const state of ['loading','fail']){await render('admin','license',{[state]:true});await check('license-'+state,width,theme);}
 }
 fs.writeFileSync('audit/theme-roles/results.json',JSON.stringify({rows,errors,kind:'Synthetic Chrome fixture; not physical iOS/Android'},null,2));assert.deepEqual(errors,[]);const contrastFailures=rows.filter(r=>r.lowContrast.length);assert.equal(contrastFailures.length,0,'Low contrast: '+JSON.stringify(contrastFailures.map(r=>({name:r.name,theme:r.theme,findings:r.lowContrast.slice(0,4)}))));console.log('Role theme UI PASS: '+rows.length+' scenes; parent/teacher tabs, booking/QR, security camera/denial, platform school, account deletion, license preference/panel/loading/error; light/dark mobile/desktop, measured text contrast.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
