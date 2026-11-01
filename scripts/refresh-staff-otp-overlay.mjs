// Run only after reviewing/staging this phase's changes. Does not alter the archived manifest.
import fs from 'node:fs';import {execFileSync} from 'node:child_process';
import {contentHash} from './ios-artifact-policy.mjs';
const base='ecbedc4fac7d657fff147d647625736c7be29c05';
const git=(...args)=>execFileSync('git',args,{maxBuffer:30*1024*1024});
const archive=JSON.parse(fs.readFileSync('audit/production-source-manifest.json'));
const paths=git('diff','--cached','--name-only',base,'-z').toString().split('\0').filter(p=>p&&!p.startsWith('audit/')&&!p.startsWith('docs/'));
const files=paths.map(p=>{
 let baseline=null;try{baseline=contentHash(p,git('show',base+':'+p));}catch{}
 return {path:p,baselineCanonicalSha256:baseline,archivedProductionCanonicalSha256:archive.files.find(f=>f.path===p)?.canonicalSha256??null,currentCanonicalSha256:contentHash(p,git('show',':'+p))};
});
fs.writeFileSync('audit/staff-otp-overlay.json',JSON.stringify({baseCommit:base,scope:'Local staff WhatsApp OTP, notification preservation, reviewed iOS light-theme carryover unchanged web welcome restoration and original public help presentation recovery',files},null,2)+'\n');
console.log('Pinned staff overlay: '+files.length+' staged source/tooling files; archived production manifest retained.');
