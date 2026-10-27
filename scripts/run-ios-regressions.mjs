import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const root=process.cwd();
fs.mkdirSync(path.join(root,'audit','phase3a'),{recursive:true});
if(!fs.existsSync(path.join(root,'audit/production-source-manifest.json'))) throw new Error('Production manifest required');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SystemRoot|WINDIR|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|COMSPEC|CI)$/i.test(k)));
env.NODE_ENV='test';env.JWT_SECRET='isolated-ios-test-secret-not-a-production-key-20261027';
const pure=['test-ios-roster-edge-cases.ts','test-security-camera-lifecycle.ts','test-production-auth-guards.ts','test-ios-qr-boundaries.ts','test-ios-login-policy.ts','test-ios-session-expiry.ts','test-whatsapp-login-ui.ts','test-mobile-platform-foundation.ts','test-native-secure-storage.ts','test-ios-push.ts','test-ios-shell.ts','test-class-card-colors.ts','test-roster-qr-availability-security.ts','test-roster-excel-template.ts'];
const database=['test-ios-role-api-matrix.ts','test-push-notifications.ts','test-appointment-slot-visibility.ts','test-school-roster-ui.ts','test-security-and-tenant-audit.ts','test-identity-auth-attempts.ts','test-account-deletion.ts','test-roster-import-jobs.ts','test-teacher-appointment-ownership.ts'];
const selected=process.argv.includes('--only')?[process.argv[process.argv.indexOf('--only')+1]]:[...pure,...database,'test-ios-release-safety.mjs'];
const results=[];
for(const name of selected) {
  if(![...pure,...database,'test-ios-release-safety.mjs'].includes(name)) throw new Error('Unknown test');
  let cwd=root;
  if(database.includes(name)) {
    const base=path.join(root,'.cache','ios-tests');fs.mkdirSync(base,{recursive:true});
    cwd=fs.mkdtempSync(path.join(base,name.replace(/\.ts$/,'')+'-'));
    // Fixture copies only; no production data or environment. Each process gets a new PGlite directory.
    const data=path.join(root,'server','data');
    for(const dir of ['src','scripts','server','public']) fs.cpSync(path.join(root,dir),path.join(cwd,dir),{recursive:true,filter:p=>p!==data && !p.startsWith(data+path.sep)});
    for(const file of ['capacitor.config.ts','codemagic.yaml','package.json']) fs.copyFileSync(path.join(root,file),path.join(cwd,file));
  }
  const started=Date.now();
  const result=spawnSync(process.execPath,['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(root,'scripts',name)],{cwd,env,encoding:'utf8',timeout:240000});
  if(fs.existsSync(path.join(cwd,'role-api-results.json')))fs.copyFileSync(path.join(cwd,'role-api-results.json'),path.join(root,'audit/phase3a/role-api-results.json'));
  process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
  results.push({test:name,status:result.status===0?'PASS':'FAIL',exitCode:result.status,error:result.error?.code,durationMs:Date.now()-started});
  fs.writeFileSync(path.join(root,'audit/test-results.json'),JSON.stringify(results,null,2)+'\n');
}
fs.mkdirSync(path.join(root,'audit'),{recursive:true});
fs.writeFileSync(path.join(root,'audit/test-results.json'),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results));
if(results.some(r=>r.status!=='PASS')) process.exitCode=1;
