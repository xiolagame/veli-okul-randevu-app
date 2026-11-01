import assert from 'node:assert/strict';import fs from 'node:fs';
import {renderBrandedEmail,verificationEmailSubject} from '../server/email-template';
import {schoolAdminEmail,deliverSchoolAdminCode,deliverUnifiedAdminActivationEmail,deliverPlatformLoginEmail,deliverPlatformPhoneBindingEmail,deliverPlatformInitialEmailVerification} from '../server/school-admin-email';
if(process.env.NODE_ENV==='production'||process.env.DATABASE_URL)throw Error('Local fixture test only');
const original=globalThis.fetch;const messages:any[]=[];
const code='246835'; // Synthetic presentation fixture only. Never output code values.
process.env.RESEND_API_KEY='fixture-only';process.env.EMAIL_FROM='fixture@example.test';
globalThis.fetch=async(input,init)=>{
 assert(String(input)==='https://api.resend.com/emails','Unexpected network destination');
 const payload=JSON.parse(String(init?.body));assert(payload.to.every((to:string)=>to.endsWith('@example.test')),'Non-fixture recipient');messages.push(payload);return new Response('{}',{status:200});
};
fs.mkdirSync('audit/header-mail',{recursive:true});
try{
 const school='Sentetik Öğretmenler Okulu '+('ÇĞİÖŞÜ '.repeat(20)),name='SENTETİK İNCELEME KULLANICISI';
 const fixtures:any[]=[schoolAdminEmail(school,'TEST',name,code),schoolAdminEmail(school,'TEST',name,'24683',true)];
 assert(await deliverSchoolAdminCode('fixture@example.test',school,'TEST',name,code));
 assert(await deliverUnifiedAdminActivationEmail('fixture@example.test',school,'TEST',name,code,'LICENSE'));
 assert(await deliverPlatformLoginEmail('fixture@example.test',name,code));
 assert(await deliverPlatformPhoneBindingEmail('fixture@example.test',name,code));
 assert(await deliverPlatformInitialEmailVerification('fixture@example.test',name,code));
 fixtures.push(...messages);
 for(const [index,item] of fixtures.entries()){
  const expected=index===1?'24683':code;
  assert(item.subject===verificationEmailSubject(expected),'Code must lead subject');
  assert(item.html.includes('data-email-code'),'Visible code card missing');
  assert(item.html.indexOf('data-email-code')<item.html.indexOf('Merhaba'),'Code must be above greeting');
  assert(item.html.indexOf('data-email-preheader')<item.html.indexOf('<table'),'Preheader must precede body tables');
  assert(item.html.includes('display:none!important')&&item.html.includes('mso-hide:all'),'Preheader must be hidden');
  assert(item.html.includes('&#8204;&nbsp;'),'Inbox preview padding missing');
  assert(item.text.indexOf(expected)<item.text.indexOf('Merhaba'),'Plain text code must be above greeting');
  assert(item.html.includes('tek kullanımlı')||item.html.includes('bir kez'),'Single-use notice missing');
  assert(item.html.includes('dakika')||item.html.includes('24 saat'),'Expiry notice missing');
  if(index<2)assert(item.html.indexOf(index===1?'15 dakika':'24 saat')<item.html.indexOf('OKUL KODU'),'Expiry must precede secondary school details');
  fs.writeFileSync(`audit/header-mail/code-${index}.html`,item.html);
 }
 const unsafe=renderBrandedEmail({subtitle:'Test <unsafe>',greeting:'<script>bad</script>',intro:['A&B'],preheader:'<img src=x onerror=bad>',verificationCode:{label:'Kod',value:code,tone:'accent'}});
 assert(!unsafe.html.includes('<script>bad</script>'),'Unsafe greeting not escaped');assert(unsafe.html.includes('&lt;img src=x onerror=bad&gt;'),'Unsafe preview not escaped');
 assert(!verificationEmailSubject('246835\r\nBcc: test').includes('\n'),'Subject permits header control characters');
 assert(!fs.readFileSync('server/api.ts','utf8').includes("console.error('[POST /auth/reset-password-with-code Error]:', err)"),'Reset errors must not dump raw request/provider details');
 console.log('Email presentation PASS: 7 code templates, subject/hidden preheader, code before greeting in HTML/text, expiry/single use, escaping and fixture-only dispatch. No real email or code values logged.');
}finally{globalThis.fetch=original;}
