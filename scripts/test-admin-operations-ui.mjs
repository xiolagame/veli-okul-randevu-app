import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{AppProvider,useApp}from'./src/context/AppContext';import{AdminView}from'./src/components/AdminView';
function TestApp(){const app=useApp();return app.currentSchool?<AdminView/>:<p>Test oturumu yükleniyor</p>}createRoot(document.getElementById('root')).render(<AppProvider><TestApp/></AppProvider>);`;
const apiFixture = `
const calls=[];let fixed=false;window.opsTest={calls,failSummary:false,failPage:false};
const settings={schoolName:'TEST SCHOOL',appName:'Veli Randevu',defaultSlotMinutes:15,minSlotMinutes:10,maxBookingDaysAhead:30,allowParentCancel:true};
const school={id:'school-a',name:'TEST SCHOOL',code:'TEST001',city:'Test',district:'Test',settings};
const phone='+905551234567';const member={id:'membership',userId:'admin',schoolId:school.id,role:'admin',status:'active',joinedAt:'2026-01-01'};
const staff=Array.from({length:80},(_,i)=>({id:'teacher-'+i,firstName:'TEST',lastName:'TEACHER '+String(i).padStart(2,'0'),phone,email:'teacher@example.test',branch:'Math',accountStatus:'pending'}));
staff[1].lastName='ÇOK UZUN BİR SOYADI VE İKİNCİ ADI OLAN ÖĞRETMEN';staff[1].email='very.long.teacher.contact.address.for.responsive.testing@example.test';
const records=Array.from({length:1000},(_,i)=>({id:'student-'+i,kind:'student',name:'TEST STUDENT '+String(i).padStart(4,'0'),className:(5+i%4)+'-A',studentNumber:String(i).padStart(4,'0'),birthDate:'',parents:[{id:'parent-'+i,fullName:'TEST PARENT '+i,phone,status:'active'}]}));
const meeting=(id,time,status)=>({id,kind:'appointment',name:'TEST STUDENT',appointment:{id,studentName:'TEST STUDENT',parentName:'TEST PARENT',teacherName:'TEST TEACHER',className:'5-A',date:'2026-10-25',startTime:time,endTime:'11:00',status,notes:'Synthetic note'}});
const all={
 'pending-parents':[{id:'roster-one',kind:'parent',name:'BEKLEYEN VELİ',phone,status:'pending',students:[{id:'r1',name:'FIRST CHILD',className:'5-A',studentNumber:'001'},{id:'r2',name:'SECOND CHILD',className:'6-A',studentNumber:'002'}]}],
 'pending-staff':staff.map(s=>({id:s.id,kind:'staff',name:s.firstName+' '+s.lastName,phone,email:s.email,branch:s.branch,role:'teacher',status:'pending',editKind:'teacher',values:{fullName:s.firstName+' '+s.lastName,phone,email:s.email,branch:s.branch}})),
 'pending-appointments':[meeting('later','10:00','pending')],today:[meeting('early','08:00','booked'),meeting('later','10:00','pending')],
 missing:[{id:'missing-student',kind:'missing',name:'MISSING STUDENT',issues:['Sınıf eksik'],editKind:'student',values:{name:'MISSING STUDENT',className:'',studentNumber:'003'}}]
};all.teachers=all['pending-staff'];all.appointments=all.today;
const importJobs=new Map();
function summary(){return {counts:Object.fromEntries(Object.entries(all).map(([key,values])=>[key,key==='missing'&&fixed?0:values.length])),statuses:{booked:1,pending:1}}}
export const api=new Proxy({}, {get(_,name){return async(...args)=>{calls.push({name,args});switch(name){
case'getMe':return{user:{id:'admin',firstName:'TEST',lastName:'ADMIN',phone,isPhoneVerified:true},memberships:[member]};
case'getPublicSchools':return{schools:[school]};case'getPlatformCapabilities':return{manageSchools:false};
case'getSchoolInfo':return{school};case'getSettings':return{settings};case'getNotifications':return{notifications:[]};
case'getOperationSummary':if(window.opsTest.failSummary)throw Error('Synthetic summary error');return summary();
case'getOperationPage':{if(window.opsTest.failPage)throw Error('Synthetic page error');const[,category,page,q,status]=args;let items=(category==='missing'&&fixed?[]:all[category]||[]).filter(item=>(!q||JSON.stringify(item).toLocaleLowerCase('tr-TR').includes(q.toLocaleLowerCase('tr-TR')))&&(!status||item.appointment?.status===status));return{items:items.slice(page*25,page*25+25),total:items.length,page,pageSize:25}}
case'getTeachers':return{teachers:staff};case'getSecurityUsers':return{users:[{id:'security',firstName:'TEST',lastName:'SECURITY',phone,email:'security@example.test',accountStatus:'pending'}]};
case'createStaff':{const data=args[1];staff.unshift({id:'created-teacher',firstName:'NEW',lastName:'TEACHER',phone:data.phone,email:data.email,branch:data.branch,accountStatus:'pending'});return{success:true,message:'Synthetic create accepted'}};
case'getManagedStudentRecords':if(window.opsTest.holdRecords)await new Promise(resolve=>window.opsTest.releaseRecords=resolve);return{records:[...records],classBulkDeleteEnabled:false};
case'startRosterImport':{const[,id,manifestHash,totalRows]=args;const job={id,manifestHash,totalRows,nextBatch:0,processed:0,added:0,skipped:0,invalid:0,status:'RUNNING',batchSize:100};importJobs.set(id,job);return job;}
case'sendRosterBatch':{const[,id,index,rows]=args;const job=importJobs.get(id);for(const row of rows)records.push({id:'imported-'+records.length,kind:'roster',name:row.studentName,className:row.className,studentNumber:row.studentNumber,birthDate:'',parents:[{rosterId:'imported-roster',fullName:row.parentName,phone:row.parentPhone,status:'pending'}]});Object.assign(job,{nextBatch:index+1,processed:rows.length,added:rows.length,status:'COMPLETED'});return{job,batch:{index,processed:rows.length,added:rows.length,skipped:0,invalid:0,errors:[]}};}
case'importRoster':{const rows=args[1].map(record=>({record,status:'valid',errors:[]}));if(!args[2]){for(const row of rows){records.push({id:'imported-'+records.length,kind:'roster',name:row.record.studentName,className:row.record.className,studentNumber:row.record.studentNumber,birthDate:'',parents:[{rosterId:'imported-roster',fullName:row.record.parentName,phone:row.record.parentPhone,status:'pending'}]})}}return{rows,addedCount:args[2]?0:rows.length,skippedCount:0}}
case'getManagedSchoolAdmins':return{admins:[{id:'admin-one',fullName:'ACTIVE ADMIN',phone,email:'admin@example.test',status:'active'},{id:'admin-two',fullName:'PENDING ADMIN',phone,email:'pending@example.test',status:'pending'}]};
case'getAppointments':return{appointments:all.today.map(i=>i.appointment)};case'getAuditLogs':return{auditLogs:[]};
case'updateManagedRecord':fixed=true;return{success:true};case'resendStaffActivation':return{message:'Test e-postası isteği tamamlandı.'};
default:throw Error('Unexpected fixture API method: '+String(name));}}}});`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife',
  define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env': '{"PROD":false,"DEV":true}' }, plugins: [{ name: 'isolated-api', setup(b) {
    b.onLoad({filter:/BulkRosterImport\.tsx$/},args=>({contents:fs.readFileSync(args.path,'utf8').replace("new URL('../utils/roster-worker.ts',import.meta.url)","new URL('/roster-worker.js', location.origin)"),loader:'tsx',resolveDir:path.dirname(args.path)}));
    b.onResolve({ filter: /services\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: apiFixture }));
  } }] });
const worker=await build({entryPoints:['src/utils/roster-worker.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const css = fs.readdirSync('dist/client/assets').filter(n => n.endsWith('.css')).map(n => fs.readFileSync(path.join('dist/client/assets', n), 'utf8')).join('\n');
const server = http.createServer((req, res) => {
  res.setHeader('content-type', req.url?.endsWith('.js') ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/roster-worker.js' ? worker.outputFiles[0].text : req.url === '/bundle.js' ? bundle.outputFiles[0].text : req.url === '/style.css' ? css : '<!doctype html><html lang="tr" data-theme="'+(process.env.UI_THEME==='dark'?'dark':'light')+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script>localStorage.setItem("veli_auth_token","local-session-fixture");localStorage.setItem("veli_active_school_id","school-a");</script><script src="/bundle.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.getByRole('button', { name: /^Hesap oluşturmayı bekleyen veliler/ }).waitFor();
  await page.evaluate(() => { document.documentElement.dataset.runtimePlatform = 'ios'; });
  for (const width of [375, 390, 430, 507, 768, 820, 1024, 1180]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `iOS admin overflow at ${width}`);
    if (width < 768) {
      assert.equal(await page.locator('.admin-header').evaluate(e => e.getBoundingClientRect().height), 1, 'duplicate mobile header must not occupy a layout row');
      assert(await page.getByLabel('Yönetim bölümü', { exact: true }).isVisible());
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForFunction(() => window.opsTest.calls.some(c => c.name === 'getOperationSummary'));
  assert.equal(await page.getByText('Kolay ve güvenilir randevu sistemi.').count(), 0);
  assert.equal(await page.getByText('Hesap yönetimi', { exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.opsTest.calls.filter(c => ['getTeachers', 'getSecurityUsers', 'getRoster', 'getStudents', 'getAppointments', 'getAvailability', 'getAuditLogs'].includes(c.name))), [], 'dashboard bootstrap must not load full school lists');
  assert.equal(await page.evaluate(()=>window.opsTest.calls.filter(c=>c.name==='getOperationPage').length),0,'detail pages must load on demand');
  const operationRegion = page.getByRole('region', { name: 'Operasyon Merkezi' });
  assert.equal(await operationRegion.locator('.operation-category').count(), 5);
  assert((await operationRegion.boundingBox()).y < 768);
  await page.getByRole('button',{name:/^Öğretmen:/}).click();
  await page.getByRole('dialog').getByRole('heading',{name:'Öğretmenler',exact:true}).waitFor();
  await page.getByRole('dialog').locator('.operation-result').first().waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Hesap oluşturmayı bekleyen veliler/ }).click();
  const drawer = page.getByRole('dialog'); await drawer.getByText('BEKLEYEN VELİ', { exact: true }).waitFor();
  await drawer.getByRole('button', { name: /BEKLEYEN VELİ/ }).click();
  assert.equal(await drawer.getByText('FIRST CHILD', { exact: true }).count(), 1);
  assert.equal(await drawer.getByText('SECOND CHILD', { exact: true }).count(), 1);
  await drawer.getByLabel('Kayıtlarda ara').fill('no-matching-record');
  await drawer.getByText('Bu kapsamda kayıt bulunmuyor.').waitFor();
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
  assert(await page.getByRole('button', { name: /^Hesap oluşturmayı bekleyen veliler/ }).evaluate(e => e === document.activeElement));
  for (const name of ['Aktivasyon bekleyen personel', 'Onay bekleyen randevular', 'Bugünkü görüşmeler', 'Eksik bilgi içeren kayıtlar']) {
    await page.getByRole('button', { name: new RegExp('^' + name) }).click();
    await drawer.locator('.operation-result').first().waitFor();
    if (name === 'Aktivasyon bekleyen personel') {
      assert.equal(await drawer.locator('.operation-result').count(), 25);
      await drawer.getByRole('button', { name: 'Sonraki', exact: true }).click(); await drawer.getByText('80 kayıt · 2 / 4').waitFor();
      await drawer.locator('.operation-result-toggle').first().click();
      await drawer.getByRole('button', { name: /kaydını düzenle/ }).click();
      assert.equal(await page.getByRole('dialog').count(), 2); await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 1);
    }
    if (name === 'Onay bekleyen randevular') assert.equal(await drawer.getByRole('button', { name: /^(Onayla|Reddet)$/ }).count(), 0);
    if (name === 'Bugünkü görüşmeler') {
      assert((await drawer.locator('.operation-result-toggle').first().innerText()).includes('08:00'));
      await drawer.getByLabel('Randevu durumu').selectOption('pending');
      await page.waitForFunction(() => document.querySelectorAll('.operation-result').length === 1);
    }
    if (name === 'Eksik bilgi içeren kayıtlar') {
      await drawer.locator('.operation-result-toggle').first().click(); await drawer.getByRole('button', { name: /kaydını düzenle/ }).click();
      const editor = page.getByRole('dialog').last(); await editor.getByLabel('Sınıf').fill('5-A');
      await editor.getByRole('button', { name: 'Değişiklikleri Kaydet' }).click();
      await drawer.getByText('Bu kapsamda kayıt bulunmuyor.').waitFor();
    }
    await page.keyboard.press('Escape');
  }
  assert((await page.getByRole('button', { name: /^Eksik bilgi içeren kayıtlar/ }).innerText()).includes('0'));
  await page.evaluate(() => { window.opsTest.failPage = true; });
  await page.getByRole('button', { name: /^Hesap oluşturmayı bekleyen veliler/ }).click(); await drawer.getByText('Kayıtlar alınamadı. Lütfen tekrar deneyin.').waitFor();
  await page.evaluate(() => { window.opsTest.failPage = false; }); await drawer.getByRole('button', { name: 'Tekrar dene' }).click(); await drawer.locator('.operation-result').first().waitFor(); await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(os.tmpdir(), 'veli-operations-desktop.png'), fullPage: true });
  for (const width of [375, 390, 430, 768, 820, 1024, 1180, 1366, 1920]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1080 });
    await page.getByRole('button', { name: /^Hesap oluşturmayı bekleyen veliler/ }).click(); await drawer.locator('.operation-result').first().waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert((await drawer.boundingBox()).width <= width);
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('navigation', { name: 'Yönetim bölümleri' }).getByRole('button', { name: 'Öğrenci ve veliler', exact: true }).click();
  await page.locator('.student-record-row').first().waitFor(); assert.equal(await page.locator('.student-record-row').count(), 25);
  const rowHeight = (await page.locator('.student-record-row').first().boundingBox()).height;
  assert(rowHeight <= 70, 'Desktop row must remain compact; measured height: ' + rowHeight);
  await page.screenshot({path:path.join(os.tmpdir(),'veli-student-compact-desktop.png')});
  await page.getByLabel('Kayıt filtresi').selectOption('pending'); await page.getByText('Bu seçimde öğrenci kaydı bulunmuyor.').waitFor();
  await page.getByLabel('Kayıt filtresi').selectOption('all');
  await page.getByRole('button', { name: 'TEST STUDENT 0000 adlı öğrenciyi sil', exact: true }).click(); await drawer.waitFor();
  assert((await drawer.innerText()).includes('Veli hesapları ve geçmiş randevular korunacak')); await drawer.getByRole('button', { name: 'Vazgeç' }).click();
  const loadsBeforeImport=await page.evaluate(()=>window.opsTest.calls.filter(call=>call.name==='getManagedStudentRecords').length);
  await page.getByRole('button',{name:'Kayıt ekle',exact:true}).click();
  await page.getByRole('tab',{name:'Toplu kayıt',exact:true}).click();
  await drawer.getByLabel('XLSX veya CSV dosyası yükle').setInputFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from('Öğrenci Ad Soyad,Öğrenci No,Sınıf/Şube,Veli Ad Soyad,Veli Telefonu\nIMPORTED STUDENT,1001,7-D,IMPORTED PARENT,05551234567')});
  await drawer.getByText('1 öğrenci okundu.',{exact:true}).waitFor();
  await drawer.getByRole('button',{name:'Önizle',exact:true}).click();
  await drawer.getByRole('button',{name:'İçe Aktar',exact:true}).click();
  await drawer.getByText('1 kayıt eklendi; 0 mevcut kayıt atlandı; 0 hatalı kayıt atlandı.',{exact:true}).waitFor();
  await page.getByText('1001 öğrenci listeleniyor.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.opsTest.calls.filter(call=>call.name==='getManagedStudentRecords').length),loadsBeforeImport+1,'bulk import must refresh the student list exactly once');
  await drawer.getByRole('button',{name:'Kapat',exact:true}).click();
  await page.getByRole('navigation', { name: 'Yönetim bölümleri' }).getByRole('button', { name: 'Personel', exact: true }).click();
  await page.locator('.staff-record-row').first().waitFor(); assert.equal(await page.locator('.staff-record-row').count(), 26);
  await page.getByRole('button', { name: 'TEST TEACHER 00 adlı kişiyi okuldan kaldır', exact: true }).click(); await drawer.waitFor(); await drawer.getByRole('button', { name: 'Vazgeç' }).click();
  await page.getByRole('navigation', { name: 'Yönetim bölümleri' }).getByRole('button', { name: 'Okul Yöneticileri', exact: true }).click();
  await page.locator('.school-admin-record-row').first().waitFor(); assert.equal(await page.locator('.school-admin-record-row').count(), 2);
  assert(await page.getByRole('button', { name: 'ACTIVE ADMIN adlı yöneticiyi okuldan kaldır' }).isDisabled());
  for (const width of [375, 390, 430, 768, 820, 1024, 1180, 1440]) {
    await page.setViewportSize({ width, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  for (const width of [375,390,430]) {
    await page.setViewportSize({width,height:844});
    for (const section of ['roster','users','admins']) {
      await page.getByLabel('Yönetim bölümü',{exact:true}).selectOption(section);
      await page.locator(section==='roster'?'.student-record-row':section==='users'?'.staff-record-row':'.school-admin-record-row').first().waitFor();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),section+' overflow at '+width);
      const targets=await page.locator('.record-action').evaluateAll(buttons=>buttons.map(button=>({w:button.clientWidth,h:button.clientHeight})));
      assert(targets.every(target=>target.w>=42&&target.h>=42)); // 44px border-box touch targets.
      if(width===390) await page.screenshot({path:path.join(os.tmpdir(),'veli-'+section+'-compact-mobile.png')});
    }
  }
  await page.setViewportSize({width:1366,height:768});
  const nav=page.getByRole('navigation',{name:'Yönetim bölümleri'});
  await nav.getByRole('button',{name:'Personel',exact:true}).click();
  await page.locator('.staff-record-row').first().waitFor();
  const beforeCreate=await page.evaluate(()=>window.opsTest.calls.length);
  await page.getByRole('button',{name:'+ Personel Ekle',exact:true}).click();
  await drawer.getByLabel('Görevi',{exact:true}).selectOption('teacher');
  for(const [label,value] of [['Ad Soyad','NEW TEACHER'],['Branş','Math'],['Telefon','05551234567'],['E-posta','new@example.test']])await drawer.getByLabel(label,{exact:true}).fill(value);
  await drawer.getByRole('button',{name:'Personel Ekle',exact:true}).click();
  await page.locator('.staff-record-row').filter({hasText:'NEW TEACHER'}).waitFor();
  assert.deepEqual(await page.evaluate(i=>window.opsTest.calls.slice(i).map(c=>c.name),beforeCreate),['createStaff','getTeachers','getSecurityUsers'],'staff creation must refresh only scoped staff data');
  // Navigation must render while the scoped data request is still unresolved.
  await page.evaluate(()=>{window.opsTest.holdRecords=true;});
  await nav.getByRole('button',{name:'Öğrenci ve veliler',exact:true}).click();
  await page.getByRole('heading',{name:'Öğrenci ve veliler',exact:true}).waitFor();
  await page.waitForFunction(()=>typeof window.opsTest.releaseRecords==='function');
  assert.equal(await page.locator('.student-record-row').count(),0);
  await page.evaluate(()=>{window.opsTest.holdRecords=false;window.opsTest.releaseRecords();});
  await page.locator('.student-record-row').first().waitFor();
  const samples=[];
  for(let i=0;i<12;i++)for(const label of ['Personel','Öğrenci ve veliler']){
    const ms=await page.evaluate(async label=>{
      const button=[...document.querySelectorAll('nav[aria-label="Yönetim bölümleri"] button')].find(e=>e.textContent.trim()===label);
      const start=performance.now();button.click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      if(![...document.querySelectorAll('h1,h2,h3')].some(e=>e.textContent.trim()===label))throw Error('Navigation shell not visible');
      return performance.now()-start;
    },label);
    samples.push(ms);await page.locator(label==='Personel'?'.staff-record-row':'.student-record-row').first().waitFor();
  }
  samples.sort((a,b)=>a-b);
  console.log('Local mocked navigation shell (24 revisits): '+JSON.stringify({p50Ms:+samples[11].toFixed(2),p95Ms:+samples[22].toFixed(2)}));
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{window.opsTest.failSummary=true;});
  await page.getByLabel('Yönetim bölümü',{exact:true}).selectOption('dashboard');
  await page.getByText('Operasyon özeti alınamadı.',{exact:false}).waitFor();
  assert((await page.getByRole('button',{name:/^Hesap oluşturmayı bekleyen veliler/}).innerText()).includes('—'));
  await page.evaluate(()=>{window.opsTest.failSummary=false;});
  await page.getByRole('button',{name:'Tekrar dene',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.operation-category strong')?.textContent==='1');
  assert.deepEqual(errors, []);
  console.log('Admin UI: actual AppProvider lazy bootstrap, five operation drawers, canonical count fixtures, search/filter/pagination, nested edit, update refresh, failure retry, focus/ESC, compact student/staff/admin lists and mobile/desktop overflow PASS. Synthetic API fixtures; no real messages or production calls.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
