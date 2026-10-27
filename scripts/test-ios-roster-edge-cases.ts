import assert from 'node:assert/strict';
import {readRosterBlob,readRosterFile} from '../src/utils/roster-files';
import {ROSTER_HEADERS,validateRosterRow} from '../src/utils/roster-import';
import {normalizeClassName} from '../src/utils/class-name';
async function run(){
 const rows=[['ÇAĞRI ÖZTÜRK','0001','5/a','ŞÜKRÜ İNCE','05551234567'],['İPEK GÜNEŞ','0002','6 B','ÖZGE ŞEN',''],['ŞULE ÇELİK','0003','7-C','GÖKHAN GÜL','02121234567'],['ÖMER ŞAHİN','0004','8-Ş','ÇAĞLA ÖZ','+905551234567']];
 const csv=ROSTER_HEADERS.join(';')+'\r\n'+rows.map(r=>r.join(';')).join('\r\n');
 const imported=await readRosterBlob(new Blob([csv]),'turkce.csv');assert.equal(imported.length,4);
 const previews=imported.map(validateRosterRow);assert.deepEqual(previews.map(r=>r.status),['valid','invalid','invalid','valid']);
 assert.equal(previews[0].record.studentNumber,'0001');assert.equal(previews[0].record.studentName.toLocaleUpperCase('tr-TR'),'ÇAĞRI ÖZTÜRK');assert.equal(previews[0].record.className,'5-A');assert.equal(previews[3].record.className,'8-Ş');
 assert(previews[1].errors.some(e=>e.includes('Telefon')));assert(previews[2].errors.some(e=>e.includes('Telefon')));
 for(const value of ['5-A','6/b','7 C','8-Ş','11-AA','ÖZEL SINIF'])assert(normalizeClassName(value));
 for(const name of ['wrong.pdf','wrong.xls','wrong.zip']) await assert.rejects(()=>readRosterBlob(new Blob([csv]),name),/desteklenir/);
 await assert.rejects(()=>readRosterFile(new Uint8Array([1,2,3]).buffer,'broken.xlsx'),/Geçerli bir XLSX/);
 await assert.rejects(()=>readRosterBlob(new Blob(['Yanlış;Başlık\nA;B']),'bad.csv'),/Sütunlar/);
 const large=ROSTER_HEADERS.join(',')+'\n'+Array.from({length:501},(_,i)=>['ÖRNEK ÖĞRENCİ',String(i).padStart(5,'0'),`${5+i%4}-${String.fromCharCode(65+i%5)}`,'ÖRNEK VELİ',i%5?'05551234567':''].join(',')).join('\n');
 const mixed=(await readRosterBlob(new Blob([large]),'mixed.csv')).map(validateRosterRow);assert.equal(mixed.length,501);assert.equal(mixed.filter(r=>r.status==='invalid').length,101);assert.equal(mixed.filter(r=>r.status==='valid').length,400);
 console.log('Roster edge cases PASS: Turkish/leading zeros/class variants, missing/fixed-line phone, PDF/XLS/ZIP rejection, corrupt XLSX, bad headers, 501 mixed rows (400 valid,101 invalid). Duplicate persistence covered by DB job suite.');
}
run().catch(e=>{console.error(e instanceof Error?e.message:'Roster edge failure');process.exitCode=1;});
