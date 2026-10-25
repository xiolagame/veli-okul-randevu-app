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
export const api={importRoster:async(school,records,preview)=>{const t=window.recordTest;t.calls.push({school,records,preview});if(t.hold)await new Promise(resolve=>t.release=resolve);if(t.fail)throw Error('Kayıt işlemi şu anda tamamlanamıyor.');const rows=records.map(validateRosterRow);if(records.length>500)throw Error('En fazla 500 kayıt yükleyin.');if(records.some(row=>row.studentNumber==='DUP'))rows[0]={...rows[0],status:'duplicate',errors:['Bu kayıt zaten mevcut.']};return{rows,addedCount:preview?0:rows.filter(row=>row.status==='valid').length,skippedCount:0};}};`;
const bundle = await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',logLevel:'silent',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'isolated-registration-test',setup(b){
 b.onResolve({filter:/services\/api$/},()=>({path:'api',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:apiFixture,loader:'ts',resolveDir:root}));
 b.onLoad({filter:/BulkRosterImport\.tsx$/},args=>({contents:fs.readFileSync(args.path,'utf8').replace("new URL('../utils/roster-worker.ts', import.meta.url)","new URL('/roster-worker.js', location.origin)"),loader:'tsx',resolveDir:path.dirname(args.path)}));
}}]});
const worker = await build({entryPoints:['src/utils/roster-worker.ts'],bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'});
const css=fs.readdirSync('dist/client/assets').filter(name=>name.endsWith('.css')).map(name=>fs.readFileSync('dist/client/assets/'+name,'utf8')).join('\n');
const server=http.createServer((req,res)=>{
 if(decodeURIComponent(req.url||'')==='/ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx'){res.setHeader('content-type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return res.end(fs.readFileSync('public/ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx'));}
 const body=req.url==='/bundle.js'?bundle.outputFiles[0].text:req.url==='/roster-worker.js'?worker.outputFiles[0].text:req.url==='/style.css'?css:'<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script></html>';
 res.setHeader('content-type',req.url?.endsWith('.js')?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1366,height:768}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
 await page.goto('http://127.0.0.1:'+server.address().port);
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
 await open();await center.getByRole('tab',{name:'Toplu kayıt',exact:true}).click();assert.equal(await center.getByRole('button',{name:'Dosyadan aktar',exact:true}).getAttribute('aria-pressed'),'true');
 const [download]=await Promise.all([page.waitForEvent('download'),center.getByRole('button',{name:'Excel Şablonunu İndir',exact:true}).click()]);assert.equal(download.suggestedFilename(),'ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx');assert.deepEqual(fs.readFileSync(await download.path()),fs.readFileSync('public/ÖĞRENCİ_VELİ_BİLGİ_FORMU.xlsx'));
 await center.getByLabel('XLSX veya CSV dosyası yükle').setInputFiles({name:'legacy.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:syntheticWorkbook});await center.getByText('legacy.xlsx',{exact:true}).waitFor();assert(await center.locator('tbody tr').count()>0,'real XLSX worker parses existing template');
 // Replacing an unsaved workbook requires explicit consent; failed parse preserves its draft.
 await center.getByLabel('XLSX veya CSV dosyası yükle').setInputFiles({name:'broken.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('invalid')});
 await page.getByRole('button',{name:'Devam et',exact:true}).click();await center.getByRole('alert').waitFor();assert(await center.locator('tbody tr').count()>0);
 const csv='Öğrenci Ad Soyad,Öğrenci No,Sınıf/Şube,Veli Ad Soyad,Veli Telefonu\nÖRNEK ÖĞRENCİ,0007,6/A,ÖRNEK VELİ,05551234567';
 await center.getByLabel('XLSX veya CSV dosyası yükle').setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.getByRole('button',{name:'Devam et',exact:true}).click();await center.getByText('synthetic.csv',{exact:true}).waitFor();assert.equal(await center.getByLabel('Öğrenci No — satır 1',{exact:true}).inputValue(),'0007');
 await center.getByRole('button',{name:'Elle giriş / Yapıştır',exact:true}).click();assert.equal(await center.getByLabel('Öğrenci No — satır 1',{exact:true}).inputValue(),'0007');
 const paste=async(text)=>center.getByLabel('Öğrenci Ad Soyad — satır 1',{exact:true}).evaluate((input,value)=>{const data=new DataTransfer();data.setData('text',value);input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},text);
 await paste(Array.from({length:501},(_,i)=>`ÖĞRENCİ ${i}\t${i}\t5-A\tVELİ ÖRNEK\t05551234567`).join('\n'));await center.getByRole('alert').filter({hasText:/500 kayıt/}).waitFor();assert.equal(await center.getByLabel('Öğrenci No — satır 1',{exact:true}).inputValue(),'0007');
 await paste('ÖRNEK ÖĞRENCİ\t0008\t5-A\tÖRNEK VELİ\tbad');await center.getByRole('button',{name:'Önizle',exact:true}).click();await center.getByText('Telefon numarası geçersiz.',{exact:true}).waitFor();assert(await center.getByRole('button',{name:'İçe Aktar',exact:true}).isDisabled());
 await center.getByRole('button',{name:'Geri',exact:true}).click();
 await paste(Array.from({length:500},(_,i)=>`ÖĞRENCİ ${i}\t${String(i).padStart(4,'0')}\t5-A\tVELİ ÖRNEK\t05551234567`).join('\n'));assert.equal(await center.locator('tbody tr').count(),25);await center.getByRole('button',{name:'Önizle',exact:true}).click();await center.getByText('500 kayıt · 500 yeni · 0 hatalı · 0 zaten mevcut',{exact:true}).waitFor();
 for(const [width,height]of[[1366,768],[1440,900],[1920,1080],[375,667],[390,844],[430,932],[768,1024]]){
  await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const rect=await center.boundingBox();assert.equal(Math.round(rect.width),width);assert.equal(Math.round(rect.height),height);
  const footer=await center.locator('footer').boundingBox();assert(footer.y+footer.height<=height+1);assert(footer.y>=0);assert(await center.locator('.record-table-scroll').evaluate(e=>e.scrollHeight>e.clientHeight));
 }
 await page.setViewportSize({width:1366,height:768});await page.screenshot({path:path.join(os.tmpdir(),'veli-record-center-bulk.png')});
 await center.getByRole('button',{name:'İçe Aktar',exact:true}).click();await center.getByText('500 kayıt eklendi; 0 mevcut kayıt atlandı.',{exact:true}).waitFor();await center.getByRole('button',{name:'Kapat',exact:true}).click();
 await open();await fill('003');for(const [width,height]of[[1366,768],[1440,900],[1920,1080],[375,667],[390,844],[430,932]]){await page.setViewportSize({width,height});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(width>1000)assert(await center.locator('.record-center-content').evaluate(e=>e.scrollHeight<=e.clientHeight));const save=await center.getByRole('button',{name:'Kaydet',exact:true}).boundingBox();assert(save.y+save.height<=height+1);}
 await page.screenshot({path:path.join(os.tmpdir(),'veli-record-center-mobile.png')});await page.setViewportSize({width:1366,height:768});await page.screenshot({path:path.join(os.tmpdir(),'veli-record-center-single.png')});
 await center.getByRole('button',{name:'Pencereyi kapat',exact:true}).click();await page.getByRole('button',{name:'Devam et',exact:true}).click();await center.waitFor({state:'detached'});assert.deepEqual(errors,[]);
 console.log('Registration center UI PASS: single validation/save/new/duplicate/failure/race, dirty close/tabs, real XLSX+CSV worker/template bytes, paste/500 limit/invalid block, preview pagination, refresh, full-screen desktop/mobile and fixed actions. Isolated synthetic API only.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
