import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import { contentHash } from './ios-artifact-policy.mjs';
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const manifest=JSON.parse(fs.readFileSync('audit/production-source-manifest.json','utf8'));
const allowed=new Set(['.gitignore','ios/App/App/Info.plist','scripts/test-ios-shell.ts','src/components/PhoneCentricLoginPanel.tsx','scripts/test-record-entry-center-ui.mjs','scripts/test-student-management-ui.mjs','capacitor.config.ts','codemagic.yaml','package.json','package-lock.json','src/components/AuthView.tsx','src/context/AppContext.tsx','src/index.css','src/main.tsx','scripts/test-whatsapp-login-ui.ts','scripts/test-push-notifications.ts','scripts/test-school-roster-ui.ts','scripts/test-appointment-slot-visibility.ts','scripts/test-account-deletion.ts','scripts/test-teacher-appointment-ownership.ts','scripts/test-roster-import-jobs.ts','scripts/test-admin-operations-ui.mjs','scripts/build-ios-client.mjs']);
const changes=[],unchanged=[],normalized=[];
for(const file of manifest.files) {
  // Local source access is optional on CI. The archived manifest remains mandatory.
  if(fs.existsSync(manifest.source)) assert.equal(sha(path.join(manifest.source,file.path)),file.sha256,`Production source changed: ${file.path}`);
  const current=sha(file.path);
  if(current===file.sha256) unchanged.push(file.path);
  else if(contentHash(file.path,fs.readFileSync(file.path))===file.canonicalSha256) {
    normalized.push(file.path);
  } else {
    assert(allowed.has(file.path),`Unreviewed production change: ${file.path}`);
    changes.push({path:file.path,productionSha256:file.sha256,iosSha256:current});
  }
}
const protectedFile=path.resolve('../protected-source-snapshot.json');
let protectedSources='not available on this host';
if(fs.existsSync(protectedFile)) {
  const snapshot=JSON.parse(fs.readFileSync(protectedFile,'utf8'));
  for(const [root,files] of [[snapshot.source,snapshot.sourceFiles],[snapshot.main,snapshot.mainFiles]]) for(const file of files) assert.equal(sha(path.join(root,file.path)),file.sha256,`Protected original changed: ${file.path}`);
  protectedSources='PASS: original main and production source hashes unchanged';
}
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const rel of tracked.filter(p=>/(^|\/)(\.env(?:\..*)?|GoogleService-Info\.plist)(\/|$)|\.(pem|key|p8|p12|mobileprovision)$/i.test(p))) assert(!fs.existsSync(rel),`Sensitive tracked file: ${rel}`);
assert(!fs.existsSync('server/data/store.json'),'Production/local store must not be carried into iOS checkout');
const report={deployId:manifest.deployId,baselineFiles:manifest.files.length,unchanged:unchanged.length,lineEndingOnly:normalized,changes,protectedSources,serverCode:'Unchanged from production source manifest; no server changes or migrations deployed',newFiles:execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).filter(p=>!p.startsWith('audit/'))};
fs.writeFileSync('audit/source-verification.json',JSON.stringify(report,null,2)+'\n');
console.log(`Production provenance PASS: ${unchanged.length} identical files, ${changes.length} reviewed iOS/tooling changes, ${normalized.length} line-ending normalization. ${protectedSources}.`);
