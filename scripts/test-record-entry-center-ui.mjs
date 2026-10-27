import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = process.cwd();
const { default: writeXlsxFile } = await import('write-excel-file/universal');
const syntheticWorkbook=Buffer.from(await (await writeXlsxFile([[...['Öğrenci Ad Soyad','Öğrenci No','Sınıf/Şube','Veli Ad Soyad','Veli Telefonu','Doğum Tarihi'].map(value=>({type:String,value}))],[...['ÖRNEK ÖĞRENCİ','0001','5-A','ÖRNEK VELİ','05551234567','2014-03-14'].map(value=>({type:String,value}))]],{sheet:'Kayıtlar'}).toBlob()).arrayBuffer());
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{BulkRosterImport}from'./src/components/BulkRosterImport';function Test(){const[open,setOpen]=React.useState(false);return <><button onClick={()=>setOpen(true)}>Kayıt ekle</button>{open&&<BulkRosterImport schoolId="fixture-school" onClose={()=>setOpen(false)} onChanged={async()=>{window.recordTest.refreshes++;if(window.recordTest.failRefresh)throw Error('fixture')}}/>}</>}createRoot(document.getElementById('root')).render(<Test/>);`;
const apiFixture = `import{validateRosterRow}from'${root.replaceAll('\\','/')}/src/utils/roster-import';
window.recordTest={calls:[],refreshes:0,fail:false,failRefresh:false,hold:false,release:null};
const jobs=new Map();export const api={startRosterImport:async(school,id,manifestHash,totalRows)=>{if(!jobs.has(id))jobs.set(id,{id,manifestHash,totalRows,nextBatch:0,processed:0,added:0,skipped:0,invalid:0,status:'RUNNING',batchSize:100,reports:[]});return{...jobs.get(id)};},getRosterImportReports:async(school,id)=>({reports:jobs.get(id).reports,pages:1}),sendRosterBatch:async(school,id,index,records)=>{const j=jobs.get(id);if(index!==j.nextBatch)throw Error('Bad fixture sequence');const rows=records.map(validateRosterRow),invalid=rows.filter(r=>r.status==='invalid').length;j.nextBatch++;j.processed+=rows.length;j.invalid+=invalid;j.added+=rows.length-invalid;j.status=j.processed===j.totalRows?'COMPLETED':'RUNNING';const batch={index,processed:rows.length,added:rows.length-invalid,skipped:0,invalid,errors:rows.flatMap((r,i)=>r.status==='invalid'?[{row:index*100+i+1,errors:r.errors}]:[])};j.reports.push(batch);window.recordTest.calls.push({index});if(index===1&&!window.recordTest.lost){window.recordTest.lost=true;throw Error('Synthetic response timeout after commit');}return{job:{...j},batch};},importRoster:async(school,records,preview)=>{const t=window.recordTest;t.calls.push({school,records,preview});if(t.hold)await new Promise(resolve=>t.release=resolve);if(t.fail)throw Error('Kayıt işlemi şu anda tamamlanamıyor.');const rows=records.map(validateRosterRow);if(records.some(row=>row.studentNumber==='DUP'))rows[0]={...rows[0],status:'duplicate',errors:['Bu kayıt zaten mevcut.']};return{rows,addedCount:preview?0:rows.filter(row=>row.status==='valid').length,skippedCount:0};}};`;
const bundle = await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',logLevel:'silent',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'isolated-registration-test',setup(b){
 b.onResolve({filter:/context\/AppContext$/},()=>({path:'context',namespace:'context'}));
 b.onLoad({filter:/.*/,namespace:'context'},()=>({loader:'js',contents:"export const useApp=()=>({currentUser:{id:'fixture-user'}});"}));
 b.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:apiFixture,loader:'ts',resolveDir:root}));
 b.onLoad({filter:/BulkRosterImport\.tsx$/},args=>({contents:fs.readFileSync(args.path,'utf8').replace("new URL('../utils/roster-worker.ts',import.meta.url)","new URL('/roster-worker.js', location.origin)"),loader:'tsx',resolveDir:path.dirname(args.path)}));
}}]});
const worker = await build({entryPoints:['src/utils/roster-worker.ts'],bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'});
const css=fs.readdirSync('dist/client/assets').filter(name=>name.endsWith('.css')).map(name=>fs.readFileSync('dist/client/assets/'+name,'utf8')).join('\n');
const server=http.createServer((req,res)=>{
 if(['/ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx','/ogrenci-veli-bilgi-formu.xlsx'].includes(decodeURIComponent(req.url||''))){res.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return res.end(fs.readFileSync('public/ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx'));}
 const body=req.url==='/bundle.js'?bundle.outputFiles[0].text:req.url==='/roster-worker.js'?worker.outputFiles[0].text:req.url==='/style.css'?css:'<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script></html>';
 res.setHeader('content-type',req.url?.endsWith('.js')?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1366,height:768}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
 await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(()=>{document.documentElement.dataset.runtimePlatform='ios';});
 const center=page.getByRole('dialog',{name:'Kayıt ekle',exact:true});
 const open=async()=>{await page.getByRole('button',{name:'Kayıt ekle',exact:true}).click();await center.waitFor();};
 const fill=async(number='001')=>{for(const[label,value]of[['Öğrenci Ad Soyad','ÖRNEK ÖĞRENCİ'],['Öğrenci No',number],['Sınıf/Şube','5/C'],['Veli Ad Soyad','ÖRNEK VELİ'],['Veli Telefonu','05551234567']])await center.getByLabel(label,{exact:true}).fill(value);};
 await open();assert.equal(await center.getByRole('tab',{name:'Tekli kayıt',exact:true}).getAttribute('aria-selected'),'true');
 assert.equal(await center.locator('form input').count(),5);assert.equal(await center.getByLabel('Doğum Tarihi',{exact:true}).count(),0);
 await center.getByRole('button',{name:'Kaydet',exact:true}).click();assert.equal(await center.locator('input[aria-invalid="true"]').count(),4);assert.equal(await page.evaluate(()=>window.recordTest.calls.length),0);
 await fill();await center.getByRole('tab',{name:'Toplu kayıt',exact:true}).click();await center.getByRole('tab',{name:'Tekli kayıt',exact:true}).click();assert.equal(await center.getByLabel('Öğrenci No',{exact:true}).inputValue(),'001');
 await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Kaydedilmemiş veriler',exact:true}).waitFor();await page.getByRole('button',{name:'Vazgeç',exact:true}).click();assert.equal(await center.getByLabel('Öğrenci No',{exact:true}).inputValue(),'001');
 await page.evaluate(()=>window.recordTest.fail=true);await center.getByRole('button',{name:'Kaydet',exact:true}).click();await center.getByRole('alert').waitFor();assert.equal(await center.getByLabel('Öğrenci No',{exact:true}).inputValue(),'001');
 await page.evaluate(()=>{window.recordTest.fail=false;window.recordTest.hold=true;window.recordTest.calls=[];});
 await center.getByRole('button',{name:'Kaydet ve yeni ekle',exact:true}).click();await page.waitForFunction(()=>!!window.recordTest.release);
 assert(await center.getByRole('button',{name:'Kaydet',exact:true}).isDisabled());assert(await center.getByRole('tab',{name:'Toplu kayıt',exact:true}).isDisabled());
 await center.locator('form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 assert.equal(await page.evaluate(()=>window.recordTest.calls.length),1);
 await page.evaluate(()=>{window.recordTest.hold=false;window.recordTest.release();});await center.getByText('Kayıt eklendi.',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>window.recordTest.calls.length),2);assert.equal(await page.evaluate(()=>window.recordTest.refreshes),1);assert.equal(await center.getByLabel('Öğrenci Ad Soyad',{exact:true}).inputValue(),'');
 const posted=await page.evaluate(()=>window.recordTest.calls[1]);assert.equal(posted.school,'fixture-school');assert.equal(posted.records[0].parentPhone,'+905551234567');assert.equal(posted.records[0].studentNumber,'001');assert.equal(posted.records[0].className,'5-C');
 await fill('DUP');await center.getByRole('button',{name:'Kaydet',exact:true}).click();await center.getByText('Bu kayıt zaten mevcut.',{exact:true}).waitFor();assert.equal(await center.getByLabel('Öğrenci No',{exact:true}).inputValue(),'DUP');
 await fill('002');await page.evaluate(()=>window.recordTest.failRefresh=true);await center.getByRole('button',{name:'Kaydet',exact:true}).click();await center.getByText('Kayıt tamamlandı',{exact:true}).waitFor();await center.getByText('Kayıt tamamlandı ancak liste yenilenemedi.',{exact:false}).waitFor();assert.equal(await center.getByRole('button',{name:'Kaydet',exact:true}).count(),0);
 await page.evaluate(()=>window.recordTest.failRefresh=false);await center.getByRole('button',{name:'Kapat',exact:true}).click();
 await open();await center.getByRole('tab',{name:'Toplu kayıt',exact:true}).click();
 for(const name of['Dosyadan aktar','Elle giriş / Yapıştır'])assert.equal(await center.getByRole('button',{name,exact:true}).count(),0);
 assert.equal(await center.getByText('Dosya ve aktarım yardımı',{exact:true}).count(),0);
 const[download]=await Promise.all([page.waitForEvent('download'),center.getByRole('button',{name:'Excel Şablonunu İndir',exact:true}).click()]);assert.equal(download.suggestedFilename(),'ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx');assert.deepEqual(fs.readFileSync(await download.path()),fs.readFileSync('public/ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx'));
 await center.getByLabel('XLSX veya CSV dosyası yükle').setInputFiles({name:'legacy.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:syntheticWorkbook});await center.getByText('legacy.xlsx',{exact:true}).waitFor();await center.getByRole('button',{name:'Önizle',exact:true}).click();assert.equal(await center.locator('tbody tr').count(),1);
 const csv='Öğrenci Ad Soyad,Öğrenci No,Sınıf/Şube,Veli Ad Soyad,Veli Telefonu\n'+Array.from({length:501},(_,i)=>['ÖRNEK ÖĞRENCİ '+i,String(i).padStart(5,'0'),'5/A','ÖRNEK VELİ',i===0?'bad':'05551234567'].join(',')).join('\n');
 await center.getByLabel('XLSX veya CSV dosyası yükle').setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await center.getByText('501 öğrenci okundu.',{exact:true}).waitFor();await center.getByRole('button',{name:'Önizle',exact:true}).click();assert.equal(await center.locator('tbody tr').count(),25);await center.getByText('Telefon numarası geçersiz.',{exact:true}).waitFor();
 for(const width of[375,390,430,507,768,820,1024,1180,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const box=await center.locator('.record-bulk-content').boundingBox();assert(Math.abs(box.x+box.width/2-width/2)<20,'bulk content must be centered');}
 await center.getByRole('button',{name:'İçe Aktar',exact:true}).click();await center.getByRole('alert').filter({hasText:'Tamamlanmış partiler korunur'}).waitFor();assert.equal(await page.evaluate(()=>window.recordTest.calls.filter(c=>c.index===1).length),1);
 await center.getByRole('button',{name:'Devam Et',exact:true}).click();await center.getByText('500 kayıt eklendi; 0 mevcut kayıt atlandı; 1 hatalı kayıt atlandı.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.recordTest.calls.filter(c=>c.index===1).length),1,'resume must use server state after the response was lost');
 await center.getByRole('button',{name:'Hatalı satır raporu',exact:true}).click();await center.getByText('Satır 1: Telefon numarası geçersiz.',{exact:true}).waitFor();
 assert(await page.evaluate(()=>Object.values(localStorage).every(value=>!value.includes('05551234567'))),'resume metadata must not persist roster PII');
 await center.getByRole('button',{name:'Kapat',exact:true}).click();await open();await center.getByRole('tab',{name:'Toplu kayıt',exact:true}).click();
 await center.getByLabel('XLSX veya CSV dosyası yükle').setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await center.getByText('501 öğrenci okundu.',{exact:true}).waitFor();assert(await center.getByLabel('Devam işlem kimliği (isteğe bağlı)').inputValue());const sendsBefore=await page.evaluate(()=>window.recordTest.calls.length);await center.getByRole('button',{name:'Önizle',exact:true}).click();await center.getByRole('button',{name:'Devam Et',exact:true}).click();await center.getByText('Bu aktarım daha önce tamamlandı.',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>window.recordTest.calls.length),sendsBefore,'remount and same-file resume must not resend a completed job');
 await center.getByRole('button',{name:'Kapat',exact:true}).click();await open();await fill('003');for(const width of[375,390,430,507,768,820,1024,1180,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const box=await center.locator('.record-single-form').boundingBox();assert(Math.abs(box.x+box.width/2-width/2)<20,'single content must be centered');}
 assert.deepEqual(errors,[]);
 console.log('Registration center UI PASS: unchanged single save/validation/race/duplicate/refresh, real XLSX/CSV worker, direct file UI, removed manual controls, 501-row preview, server-state resume after commit/timeout, error report, metadata-only persistence and centered 375–1440px layouts. Mock backend only.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
