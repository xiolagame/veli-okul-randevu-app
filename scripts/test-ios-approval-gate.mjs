import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
const w=YAML.parse(fs.readFileSync('codemagic.yaml','utf8')).workflows['ios-testflight'];
const bash=process.platform==='win32'?path.join(process.env.ProgramFiles||'C:/Program Files','Git/bin/bash.exe'):'bash';
for(const additions of [{},{IOS_TESTFLIGHT_APPROVAL:'UPLOAD_TO_TESTFLIGHT',IOS_APPROVED_COMMIT:'unapproved-commit'}]) {
  const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,HOME:process.env.HOME,...additions};
  const result=spawnSync(bash,['-c',w.scripts[0].script],{env,encoding:'utf8'});
  if(result.error) throw result.error;
  assert.equal(result.status,1,'Missing or mismatched approval must abort');
  assert.match(result.stdout,/TestFlight upload is locked/);
}
console.log('Executed TestFlight shell gate: missing approval and mismatched commit both BLOCK upload. No upload step executed.');
