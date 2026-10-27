import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {contentHash} from './ios-artifact-policy.mjs';
const git=(...a)=>execFileSync('git',a);
const files=git('diff','--cached','--name-only','--diff-filter=ACMR','-z').toString().split('\0').filter(Boolean);
const denied=/(^|\/)(\.env(?:\..*)?|node_modules|\.cache|\.netlify|build|dist|uploads)(\/|$)|^server\/data\/|^android\/|\.(p8|p12|pfx|pem|key|mobileprovision|ipa|log|zip)$/i;
const production=new Set(JSON.parse(fs.readFileSync('audit/production-source-manifest.json')).files.map(f=>f.path));
const extras=new Set(['.gitattributes','audit/production-source-manifest.json','audit/ios-source-lock.json']);
const findings=[];
for(const p of files){
 assert(!denied.test(p),'Forbidden staged path: '+p);
 assert(production.has(p)||extras.has(p)||/^scripts\/[a-z0-9-]+\.(mjs|ts|sh)$/.test(p)||['src/platform/login-capability-policy.ts','src/platform/otp-resend-clock.ts'].includes(p),'Unreviewed staged scope: '+p);
 const b=git('show',':'+p);
 if(/\.(png|xlsx)$/i.test(p)) {
  const baseline=JSON.parse(fs.readFileSync('audit/production-source-manifest.json')).files.find(f=>f.path===p);
  assert(baseline&&contentHash(p,b)===baseline.canonicalSha256,'Unverified binary asset: '+p);continue;
 }
 const s=b.toString();
 if(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{32,}-----END (?:RSA |EC )?PRIVATE KEY-----/.test(s))findings.push({path:p,rule:'private-key'});
 for(const token of s.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[])try{if(JSON.parse(Buffer.from(token.split('.')[1],'base64url')).role==='service_role')findings.push({path:p,rule:'privileged-jwt'});}catch{}
}
const deleted=git('diff','--cached','--name-only','--diff-filter=D','-z').toString().split('\0').filter(Boolean);
assert(deleted.every(p=>p==='server/data/store.json'),'Unexpected staged deletion');
assert.equal(findings.length,0,'Staged secret findings; values withheld');
console.log(`Staging safety PASS: ${files.length} added/modified paths, ${deleted.length} data-file deletion, no Android/build/log/environment/user-data addition.`);
