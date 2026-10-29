import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {contentHash,isTextSource} from './ios-artifact-policy.mjs';
const lock=JSON.parse(fs.readFileSync('audit/ios-source-lock.json'));
const ref=process.argv.includes('--index')?':':'HEAD:';
const data=execFileSync('git',['cat-file','--batch'],{input:lock.files.map(f=>ref+f.path).join('\n')+'\n',maxBuffer:100*1024*1024});
const attr=execFileSync('git',['-c','core.quotepath=false','check-attr','text','eol','--stdin'],{input:lock.files.map(f=>f.path).join('\n'),encoding:'utf8'});
let pos=0;const rows=[];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const f of lock.files){
  const end=data.indexOf(10,pos),header=data.subarray(pos,end).toString();pos=end+1;
  if(header.endsWith(' missing')){rows.push({path:f.path,error:'missing Git blob'});continue;}
  const size=Number(header.split(' ').at(-1)),blob=data.subarray(pos,pos+size);pos+=size+1;
  const text=isTextSource(f.path),working=fs.readFileSync(f.path);
  const utf8=!blob.includes(0)&&Buffer.from(blob.toString('utf8')).equals(blob);
  rows.push({path:f.path,type:text?'text':'binary',utf8,expected:f.sha256,gitRaw:sha(blob),workingRaw:sha(working),
    gitCanonical:contentHash(f.path,blob),workingCanonical:contentHash(f.path,working),
    eolOnly:working.toString().replaceAll('\r\n','\n')===blob.toString().replaceAll('\r\n','\n'),
    gitCRLF:blob.toString().includes('\r\n'),workingCRLF:working.toString().includes('\r\n'),
    attributes:attr.split('\n').filter(l=>l.startsWith(f.path+': '))});
}
const mismatches=rows.filter(r=>r.error||r.expected!==r.gitCanonical||r.expected!==r.workingCanonical);
fs.mkdirSync('audit',{recursive:true});
fs.writeFileSync('audit/lock-platform-audit.json',JSON.stringify({ref,rows,mismatches},null,2)+'\n');
console.log(JSON.stringify({files:rows.length,mismatches:mismatches.map(r=>({path:r.path,expected:r.expected,git:r.gitCanonical,working:r.workingCanonical,eolOnly:r.eolOnly})),text:rows.filter(r=>r.type==='text').length,binary:rows.filter(r=>r.type==='binary').length},null,2));
if(mismatches.length)process.exitCode=1;
