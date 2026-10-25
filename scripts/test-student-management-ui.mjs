import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Supply a locally installed Playwright module; no application/test dependency is added.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = process.cwd();
const fixture = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {StudentManagement} from './src/components/StudentManagement';
import {StaffManagement} from './src/components/StaffManagement';
import {BulkRosterImport} from './src/components/BulkRosterImport';
const refresh=async()=>{};
function Harness(){const [school,setSchool]=React.useState('a');const [importing,setImporting]=React.useState(false);return <main style={{padding:16,maxWidth:1200,margin:'auto'}}><button onClick={()=>setSchool('b')}>Switch test school</button><StaffManagement teachers={[]} securityUsers={[]} loading={false} onCreateTeacher={refresh}/><StudentManagement key={school} schoolId={school} schoolName={'TEST SCHOOL '+school} onChanged={refresh} onImport={()=>setImporting(true)}/>{importing&&<BulkRosterImport schoolId={school} onClose={()=>setImporting(false)} onChanged={refresh}/>}</main>}
createRoot(document.getElementById('root')).render(<Harness/>);`;
const result = await build({stdin:{contents:fixture,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"test"'},plugins:[{
  name:'local-api-fixture',setup(b){
    b.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));
    b.onResolve({filter:/context\/AppContext$/},()=>({path:'context',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='context'?`export const useApp=()=>({currentSchool:{id:'a'},refreshSchoolData:async()=>{}});`:`
      const classes=[5,6,7,8].flatMap((grade)=>Array.from({length:grade<7?8:7},(_,i)=>grade+'-'+String.fromCharCode(65+i)));
      const records=Array.from({length:60},(_,i)=>({id:String(i),kind:'student',name:'TEST STUDENT '+i,className:classes[i%30],studentNumber:String(i).padStart(3,'0'),birthDate:'',parents:[]}));
      export const api={getManagedStudentRecords:async(school)=>({records:school==='a'?records:[],classBulkDeleteEnabled:true}),previewClassRemoval:async(school,className)=>({className,studentCount:2,snapshot:'test-snapshot'}),requestClassRemovalCode:async()=>({challengeId:'test-challenge'}),completeClassRemoval:async()=>{}};` }));
  }
}]});
const cssFiles = fs.readdirSync('dist/client/assets').filter((name)=>name.endsWith('.css'));
assert(cssFiles.length, 'Run npm run build before UI tests');
const css = cssFiles.map((name)=>fs.readFileSync(path.join('dist/client/assets',name),'utf8')).join('\n');
const server=http.createServer((req,res)=>{
  const template=decodeURIComponent(req.url||'');
  if(['/PERSONEL_BİLGİ_FORMU.xlsx','/ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx'].includes(template)){
    res.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.end(fs.readFileSync('public'+template));
  }
  res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/bundle.js'?result.outputFiles[0].text:req.url==='/style.css'?css:'<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script></html>');
});
await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();
  const errors=[]; page.on('pageerror',(e)=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('.student-class-grid .student-class-card').last().waitFor();
  assert.equal(await page.locator('.student-class-grid .student-class-card').count(),30);
  assert.equal(await page.locator('.student-class-grid').count(),4);
  assert.equal(await page.locator('.student-class-grid .class-tone-red').count(),7);
  assert.equal(await page.locator('.student-record-row').count(),25);
  const download=page.getByRole('link',{name:'Excel Şablonu İndir'});
  assert.equal(await download.getAttribute('download'),'PERSONEL_BİLGİ_FORMU.xlsx');
  assert.equal(await download.getAttribute('href'),'/PERSONEL_BİLGİ_FORMU.xlsx');
  const [downloaded]=await Promise.all([page.waitForEvent('download'),download.click()]);
  assert.equal(downloaded.suggestedFilename(),'PERSONEL_BİLGİ_FORMU.xlsx');
  assert.deepEqual(fs.readFileSync(await downloaded.path()),fs.readFileSync('public/PERSONEL_BİLGİ_FORMU.xlsx'));
  await page.getByRole('button',{name:'Kayıt ekle',exact:true}).click();
  await page.getByRole('tab',{name:'Toplu kayıt',exact:true}).click();
  const [studentDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Excel Şablonunu İndir',exact:true}).click()]);
  assert.equal(studentDownload.suggestedFilename(),'ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx');
  assert.deepEqual(fs.readFileSync(await studentDownload.path()),fs.readFileSync('public/ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx'));
  await page.keyboard.press('Escape');
  assert.equal(await download.locator('svg').count(),1);
  assert.equal(await page.getByRole('button',{name:'Toplu Personel Ekle'}).locator('svg').count(),1);
  assert.notEqual(await download.evaluate(e=>getComputedStyle(e).backgroundColor),await page.locator('.staff-bulk-upload').evaluate(e=>getComputedStyle(e).backgroundColor));
  await page.getByRole('button',{name:'Toplu Personel Ekle'}).click();
  await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'+ Personel Ekle',exact:true}).click();
  await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button',{name:'Toplu Sınıf Sil',exact:true}).count(),0);
  await page.getByRole('button',{name:'Sonraki',exact:true}).click();
  assert.equal(await page.locator('.student-record-row').count(),25);
  await page.locator('.student-class-grid .student-class-card').first().click();
  assert.equal(await page.locator('.student-record-row').count(),2);
  assert.equal(await page.getByRole('button',{name:'Toplu Sınıf Sil',exact:true}).count(),1);
  await page.getByRole('button',{name:'Toplu Sınıf Sil',exact:true}).click();
  await page.getByRole('button',{name:'Kapsamı onayla ve kendi WhatsApp telefonuma kod gönder'}).click();
  await page.getByLabel('WhatsApp doğrulama kodu').fill('123456');
  await page.getByLabel('Onaylamak için 5/A yazın').fill('6/A');
  assert(await page.getByRole('button',{name:'Doğrula ve sınıf kayıtlarını kaldır'}).isDisabled());
  await page.keyboard.press('Escape');
  await page.locator('.student-class-all button').click();
  for(const width of [375,390,430,768,1440]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'Horizontal overflow at '+width);
    const sizes=await page.locator('.student-class-card').evaluateAll(items=>items.map(e=>({w:e.clientWidth,h:e.clientHeight})));
    assert(sizes.every(s=>s.w>=44&&s.h>=44));
  }
  const screenshot=path.join(os.tmpdir(),'veli-student-classes-desktop.png');
  // Keep all four composited glass rows inside the viewport for visual capture.
  await page.setViewportSize({width:1440,height:1600});
  await page.locator('.student-class-groups').scrollIntoViewIfNeeded();
  await page.screenshot({path:screenshot,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(os.tmpdir(),'veli-student-classes-mobile.png'),fullPage:true});
  await page.getByLabel('Öğrenci veya veli ara').fill('TEST STUDENT 59');
  assert.equal(await page.locator('.student-record-row').count(),1);
  await page.getByRole('button',{name:'Switch test school'}).click();
  await page.locator('.student-class-all button').waitFor();
  assert.equal(await page.locator('.student-class-grid .student-class-card').count(),0);
  assert.equal(await page.locator('.student-record-row').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Staff/student UI: exact template download, distinct icon buttons, existing staff dialogs, 30 dynamic class cards, pagination, selection, search, OTP confirmation, tenant switch and 375/390/430/768/1440px overflow checks PASS. Synthetic UI fixture; no real OTP/API calls.');
  console.log('Visual fixture screenshot: '+screenshot);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
