import fs from 'node:fs';import assert from 'node:assert/strict';import {contentHash} from './ios-artifact-policy.mjs';
const lock=JSON.parse(fs.readFileSync('audit/ios-source-lock.json'));
for(const f of lock.files)assert.equal(contentHash(f.path,fs.readFileSync(f.path)),f.sha256,'Frozen source changed: '+f.path);
console.log(`Frozen iOS source lock PASS: ${lock.files.length} source/config files, text normalized to LF and binary exact.`);
