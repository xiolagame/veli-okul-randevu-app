import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
// Attach only to the explicitly synthetic loopback lab; never reset or stop it.
const base=process.env.PREVIEW_URL||'http://127.0.0.1:3035';
assert(new URL(base).hostname==='127.0.0.1');
let browser,debugPage;
const watchdog=setTimeout(()=>{console.error('Cache UI test timeout');process.exit(1)},150000);
try{
 const state=await(await fetch(base+'/__local_preview__/state')).json();assert.equal(state.synthetic,true,'Synthetic local lab required');
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});let mode='normal',delayed=0,supportCalls=0;page.setDefaultNavigationTimeout(60000);page.setDefaultTimeout(60000);
 debugPage=page;const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Page error: '+e.message)});page.on('requestfailed',r=>console.log('Request failed: '+new URL(r.url()).pathname));
 await page.route('**/*',async r=>{
  if(new URL(r.request().url()).origin!==base)return r.abort();
  if(r.request().method()==='GET'&&r.request().url().endsWith('/requests'))supportCalls++;
  if(r.request().method()==='GET'&&r.request().url().endsWith('/management/student-records')){
   if(mode==='error')return r.fulfill({status:503,json:{error:'Sentetik ağ hatası'}});
   if(mode==='denied')return r.fulfill({status:403,json:{error:'Sentetik erişim reddi'}});
   if(mode==='slow'){delayed++;const response=await r.fetch();await new Promise(resolve=>setTimeout(resolve,1200));return r.fulfill({response});}
  }
  return r.continue();
 });
 const login=async()=>{
  await page.locator('#phone-centric-phone').fill('05551230001');await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).click();await page.locator('#phone-centric-code').waitFor();
  const s=await(await fetch(base+'/__local_preview__/state')).json();await page.locator('#phone-centric-code').fill(s.otp['+905551230001']);await page.getByRole('button',{name:'Kodu Doğrula',exact:true}).click();await page.locator('.admin-header h2').waitFor();
 };
 const tab=async label=>{await page.locator('.admin-nav').getByRole('button',{name:label,exact:true}).click();await page.locator('.admin-header h2').filter({hasText:label}).waitFor();};
 await page.goto(base+'/login',{waitUntil:'commit'});await login();
 await tab('Öğrenci ve veliler');await page.locator('.student-record-row').first().waitFor();
 await page.clock.install();await page.clock.fastForward(31000);
 await tab('Genel bakış');mode='slow';await tab('Öğrenci ve veliler');
 assert(await page.locator('.student-record-row').first().isVisible());assert.equal(await page.locator('.skeleton-list:visible').count(),0);
 await page.getByText('Kayıtlar güncelleniyor…',{exact:true}).waitFor();await page.waitForResponse(r=>r.url().endsWith('/management/student-records'));assert.equal(delayed,1);
 await page.clock.fastForward(31000);await tab('Genel bakış');mode='error';await tab('Öğrenci ve veliler');
 await page.getByRole('alert').filter({hasText:'Öğrenci kayıtları alınamadı.'}).waitFor();assert(await page.locator('.student-record-row').first().isVisible());
 mode='normal';await tab('Personel');await tab('Öğrenci ve veliler');await page.getByRole('alert').filter({hasText:'Öğrenci kayıtları alınamadı.'}).waitFor({state:'hidden'});
 // Real, synthetic local API writes must evict all dependent snapshots before returning.
 await page.evaluate(async()=>{
  const {api}=await import('/src/services/api.ts');const school='preview-school',key=`/api/schools/${school}/management/student-records`;
  const first=(await api.getManagedStudentRecords(school)).records[0];
  await api.updateManagedRecord(school,'student',first.id,{name:'SENTETİK GÜNCEL ÖĞRENCİ',className:first.className,studentNumber:first.studentNumber,birthDate:first.birthDate || ''});
  if(api.peekCached(key)!==undefined)throw Error('Student write retained old snapshot');
  const edited=(await api.getManagedStudentRecords(school)).records[0];if(edited.name!=='SENTETİK GÜNCEL ÖĞRENCİ')throw Error('Student read stale');
  const parent=edited.parents[0];await api.updateManagedRecord(school,'parent',parent.id,{fullName:'SENTETİK GÜNCEL VELİ',phone:parent.phone});
  if(api.peekCached(key)!==undefined)throw Error('Parent write retained student snapshot');
  const updated=(await api.getManagedStudentRecords(school)).records[0];if(updated.parents[0].fullName!=='SENTETİK GÜNCEL VELİ')throw Error('Parent read stale');
  await api.createStaff(school,{role:'teacher',fullName:'SENTETİK CACHE ÖĞRETMEN',branch:'Matematik',phone:'+905551239999',email:'cache-teacher@example.test'});
  const teacher=(await api.getTeachers(school)).teachers.find(t=>t.phone==='+905551239999');if(!teacher)throw Error('Created staff absent');
  await api.removeManagedRecord(school,'teacher',teacher.id);
  if((await api.getTeachers(school)).teachers.some(t=>t.id===teacher.id))throw Error('Deleted staff remained cached');
 });
 // Pending requests must not paint an old tab under the current heading.
 mode='slow';await page.clock.fastForward(31000);
 for(const name of ['Personel','Öğrenci ve veliler','Genel bakış','Personel','Genel bakış'])await tab(name);
 assert.equal(await page.locator('[aria-label="Öğrenci ve veli yönetimi"]').count(),0);assert(await page.getByRole('heading',{name:'Operasyon Merkezi',exact:true}).isVisible());
 await page.evaluate(async()=>{const {api}=await import('/src/services/api.ts');api.invalidateSchoolReads();});
 mode='denied';await tab('Öğrenci ve veliler');await page.getByRole('alert').filter({hasText:'Öğrenci kayıtları alınamadı.'}).waitFor();assert.equal(await page.locator('.student-record-row').count(),0);
 assert(await page.evaluate(async()=>{const {api}=await import('/src/services/api.ts');return api.peekCached('/api/schools/preview-school/management/student-records')===undefined}));
 mode='normal';await page.locator('.profile-trigger').click();await page.getByRole('button',{name:'Oturumu kapat',exact:true}).click();await page.locator('#phone-centric-phone').waitFor();await login();
 assert(await page.evaluate(async()=>{const {api}=await import('/src/services/api.ts');return api.peekCached('/api/schools/preview-school/management/student-records')===undefined}));
 const supportResponse=page.waitForResponse(r=>r.url().endsWith('/requests')&&r.request().method()==='GET');await tab('Destek / Lisans');assert.equal((await supportResponse).status(),200);
 await page.locator('.skeleton-list:visible').waitFor({state:'hidden'});
 const beforeSupport=supportCalls;await tab('Genel bakış');await tab('Destek / Lisans');assert.equal(await page.locator('.skeleton-list:visible').count(),0);assert.equal(supportCalls,beforeSupport);
 assert.deepEqual(errors,[]);
 console.log('Admin cache UI PASS: stale content retained during slow refresh/503; fresh student/parent/staff CRUD; fast tab races; 403 eviction; logout/relogin separation. Actual local SQL/API, no real messages/device.');
}catch(error){if(debugPage){console.log('Failure page: '+(await debugPage.locator('body').innerText().catch(()=>'' )).slice(0,1800));await debugPage.screenshot({path:'audit/master/navigation-cache-failure.png'}).catch(()=>{});}console.error(error);throw error;}finally{clearTimeout(watchdog);if(browser)await browser.close();}
