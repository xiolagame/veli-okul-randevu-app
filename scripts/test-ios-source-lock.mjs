import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {contentHash,isTextSource} from './ios-artifact-policy.mjs';
const lock=JSON.parse(fs.readFileSync('audit/ios-source-lock.json'));
assert.throws(()=>contentHash('invalid.gradle',Buffer.from([255])),/Invalid UTF-8/);
for(const f of lock.files){
 const b=fs.readFileSync(f.path);
 if(isTextSource(f.path)){
  assert(Buffer.from(b.toString('utf8')).equals(b),'Invalid UTF8 text '+f.path);
  const lf=b.toString().replaceAll('\r\n','\n');
  assert.equal(contentHash(f.path,Buffer.from(lf)),f.sha256,f.path);
  assert.equal(contentHash(f.path,Buffer.from(lf.replaceAll('\n','\r\n'))),f.sha256,f.path);
 }else assert.equal(contentHash(f.path,b),f.sha256,f.path);
}
const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'veli-lock-negative-'));
fs.mkdirSync(path.join(cwd,'audit'));
fs.writeFileSync(path.join(cwd,'a.gradle'),'same\r\n');
fs.writeFileSync(path.join(cwd,'b.png'),Buffer.from([137,80,13,10,0,255]));
const fixture={files:['a.gradle','b.png'].map(p=>({path:p,sha256:contentHash(p,fs.readFileSync(path.join(cwd,p)))}))};
fs.writeFileSync(path.join(cwd,'audit/ios-source-lock.json'),JSON.stringify(fixture));
const verify=()=>spawnSync(process.execPath,[path.resolve('scripts/verify-ios-source-lock.mjs')],{cwd,encoding:'utf8'});
assert.equal(verify().status,0);
fs.appendFileSync(path.join(cwd,'a.gradle'),'functional change');
fs.appendFileSync(path.join(cwd,'b.png'),Buffer.from([1]));
const failed=verify();assert.equal(failed.status,1);
const errors=JSON.parse(fs.readFileSync(path.join(cwd,'audit/frozen-source-verification.json'))).errors;
assert.equal(errors.length,2,'Report every mutation, not just first');
console.log('Source lock policy PASS: all text LF/CRLF and exact binaries; real text/binary mutations fail together.');
