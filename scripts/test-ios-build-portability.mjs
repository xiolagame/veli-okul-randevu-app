import fs from 'node:fs';import assert from 'node:assert/strict';
import {contentHash,isTextSource,forbiddenPackagePath} from './ios-artifact-policy.mjs';
const m=JSON.parse(fs.readFileSync('audit/production-source-manifest.json','utf8'));
let tested=0;
for(const f of m.files) {
 assert(f.canonicalSha256 && f.hashMode,'Canonical baseline required');
 if(!isTextSource(f.path)) continue;
 const raw=fs.readFileSync(m.source+'/'+f.path);
 assert.equal(contentHash(f.path,Buffer.from(raw.toString().replaceAll('\r\n','\n'))),f.canonicalSha256);
 assert.equal(contentHash(f.path,Buffer.from(raw.toString().replaceAll('\r\n','\n').replaceAll('\n','\r\n'))),f.canonicalSha256);
 tested++;
}
assert.notEqual(contentHash('example.ts',Buffer.from('safe\n')),contentHash('example.ts',Buffer.from('tampered\n')));
assert.notEqual(contentHash('example.png',Buffer.from('x\r\n')),contentHash('example.png',Buffer.from('x\n')));
assert.equal(forbiddenPackagePath('embedded.mobileprovision',true),false);
assert.equal(forbiddenPackagePath('embedded.mobileprovision',false),true);
for(const p of ['nested/embedded.mobileprovision','key.p8','.env','server/config.json','credentials.json','service-account/admin.json'])assert(forbiddenPackagePath(p,true),p);
console.log(`Build portability PASS: ${tested} production text files LF/CRLF-equivalent, binary/tamper rejection, signed-profile exception confined to IPA root.`);
