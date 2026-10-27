import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { iosSourceFingerprint } from './ios-source-fingerprint.mjs';
import { forbiddenPackagePath } from './ios-artifact-policy.mjs';
const built=JSON.parse(fs.readFileSync('audit/ios-build-source-manifest.json','utf8'));
assert.equal(built.sha256,iosSourceFingerprint().sha256,'Sources changed after the iOS build; rebuild before syncing or signing');
const appIndex=process.argv.indexOf('--app-root');
const app=path.resolve(appIndex<0?'ios/App/App':process.argv[appIndex+1]);
const list=(root)=>fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(path.join(root,e.name)):[path.join(root,e.name)]);
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const client=path.resolve('dist/client'), native=path.join(app,'public');
const expected=list(client).map(p=>path.relative(client,p).replaceAll('\\','/')).sort();
const actual=list(native).map(p=>path.relative(native,p).replaceAll('\\','/')).filter(p=>!['cordova.js','cordova_plugins.js'].includes(p)).sort();
assert.deepEqual(actual,expected,'Native package contains missing or stale web assets');
for(const p of expected) assert.equal(sha(path.join(native,p)),sha(path.join(client,p)),`Native web mismatch: ${p}`);
const config=JSON.parse(fs.readFileSync(path.join(app,'capacitor.config.json'),'utf8'));
assert.equal(config.appId,'com.velirandevu.app');
assert.equal(config.loggingBehavior,'none');
assert(!config.server,'Remote navigation override is forbidden');
for(const file of list(app)) {
  const rel=path.relative(app,file).replaceAll('\\','/');
  assert(!forbiddenPackagePath(rel,appIndex>=0),`Forbidden packaged path: ${rel}`);
  if(!/\.(js|json|html|css|xml|plist|txt)$/i.test(file)) continue;
  const content=fs.readFileSync(file,'utf8');
  for(const marker of ['-----BEGIN PRIVATE KEY-----','-----BEGIN RSA PRIVATE KEY-----','SUPABASE_SERVICE_ROLE_KEY','JWT_SECRET','DATABASE_URL','FCM_FIREBASE_PRIVATE_KEY','"private_key"']) assert(!content.includes(marker),`Server secret marker in ${rel}`);
  for(const token of content.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]) {
    let payload;try{payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch{continue;}
    assert(payload.role!=='service_role',`Privileged JWT in ${rel}`);
  }
}
console.log(`iOS package parity PASS: ${expected.length} exact web files, local origin, logging disabled, server-secret scan. ${appIndex<0?'Source package only; no IPA built.':'Extracted IPA checked.'}`);
fs.writeFileSync('audit/ios-package-verification.json',JSON.stringify({status:'PASS',kind:appIndex<0?'source-package':'extracted-ipa',sourceSha256:built.sha256,files:expected.map(p=>({path:p,sha256:sha(path.join(native,p))}))},null,2)+'\n');
