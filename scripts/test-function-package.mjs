import fs from'node:fs';import path from'node:path';import os from'node:os';import cp from'node:child_process';import assert from'node:assert/strict';import crypto from'node:crypto';
const root=process.cwd(),manifest=JSON.parse(fs.readFileSync('release/functions/manifest.json','utf8'));
const names=['api','appointment-reminders','license-reminders-background','license-reminders'];
assert.deepEqual(manifest.functions.map(f=>f.name).sort(),[...names].sort());
assert.equal(manifest.functions.find(f=>f.name==='appointment-reminders').schedule,'*/5 * * * *');assert.equal(manifest.functions.find(f=>f.name==='license-reminders').schedule,'0 6 * * *');
assert.equal(manifest.functions.find(f=>f.name==='license-reminders-background').invocationMode,'background');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'veli-function-artifacts-')),verified=[];
const extract=String.raw`import sys,zipfile,pathlib
archive,out=sys.argv[1:];root=pathlib.Path(out).resolve()
with zipfile.ZipFile(archive) as z:
 for name in z.namelist():
  p=(root/name).resolve()
  assert p.is_relative_to(root),'ZIP_PATH_TRAVERSAL'
  low=name.lower();assert not any(x in low.split('/') for x in ['.env','google-services.json','googleservice-info.plist']),'PRIVATE_FILE_IN_ARCHIVE'
  assert not low.startswith(('server/data/','audit/','.cache/','scripts/')),'TEST_DATA_OR_AUDIT_IN_ARCHIVE'
 z.extractall(out)
`;
// Each ZIP is checked in a separate directory, with no source node_modules
// in its ancestor chain. The source tree can no longer mask missing packages.
for(const entry of manifest.functions){
 const target=path.join(temp,entry.name);fs.mkdirSync(target);
 const unzip=cp.spawnSync('python',['-c',extract,entry.path,target],{encoding:'utf8'});assert.equal(unzip.status,0,unzip.stderr);
 const schemaDir=path.join(target,'server/database');fs.mkdirSync(schemaDir,{recursive:true});fs.copyFileSync('server/database/supabase_schema.sql',path.join(schemaDir,'supabase_schema.sql'));fs.cpSync('server/database/migrations',path.join(schemaDir,'migrations'),{recursive:true});
 const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,NODE_ENV:'test',JWT_SECRET:'synthetic-package-jwt-at-least-32-characters',AUTH_CODE_SECRET:'synthetic-package-code-at-least-32-characters',WHATSAPP_AUTH_ENABLED:'true',WHATSAPP_UNIFIED_LOGIN_ENABLED:'true',PHONE_CENTRIC_AUTH_ENABLED:'true',WHATSAPP_PILOT_ENABLED:'true',WHATSAPP_LICENSE_REMINDERS_ENABLED:'false',WHATSAPP_LICENSE_REMINDERS_MANUAL_ENABLED:'false',WHATSAPP_LICENSE_REMINDERS_AUTO_ENABLED:'false'};
 // Import-only checks for non-API archives; never invoke scheduled jobs.
 const check=entry.name==='api'?cp.spawnSync(process.execPath,[path.join(root,'scripts/test-function-runtime.mjs'),target,JSON.stringify(['api'])],{cwd:target,env,encoding:'utf8',timeout:60000}):cp.spawnSync(process.execPath,['--input-type=module','-e',`const m=await import(${JSON.stringify(new URL('file:///'+path.join(target,'netlify/functions',entry.name+'.mjs').replaceAll('\\','/')).href)});if(typeof m.default!=='function')process.exit(2);console.log('IMPORT_PASS');`],{cwd:target,env,encoding:'utf8',timeout:60000});
 fs.mkdirSync('release/checks',{recursive:true});fs.writeFileSync('release/checks/'+entry.name+'.log',(check.stdout||'')+(check.stderr||''));
 assert.equal(check.status,0,entry.name+' archive runtime failed; inspect release/checks log');verified.push({name:entry.name,extracted:target,sha256:crypto.createHash('sha256').update(fs.readFileSync(entry.path)).digest('hex')});console.log(entry.name+' extracted ZIP runtime PASS');
}
fs.writeFileSync('release/checks/package-verification.json',JSON.stringify({verified},null,2));
console.log('Function package PASS: all four archives independently load without source node_modules; API routes execute on isolated PGlite.');
