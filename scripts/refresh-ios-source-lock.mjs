// Run deliberately after reviewing the source diff, then commit the updated lock.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {contentHash} from './ios-artifact-policy.mjs';
const lock=JSON.parse(fs.readFileSync('audit/ios-source-lock.json'));
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
lock.branch='feature/ios-codemagic-final-20261029';
lock.files=[...new Set(paths)].filter(p=>p!=='audit/ios-source-lock.json'&&!p.endsWith('.log')&&!p.startsWith('previews/')).sort().map(p=>({path:p,sha256:contentHash(p,fs.readFileSync(p))}));
fs.writeFileSync('audit/ios-source-lock.json',JSON.stringify(lock,null,2)+'\n');
console.log('Refreshed reviewed source lock: '+lock.files.length);
