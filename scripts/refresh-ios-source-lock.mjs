// Stage reviewed changes first. Hash Git index blobs, never local checkout bytes.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {contentHash} from './ios-artifact-policy.mjs';
execFileSync('git',['diff','--exit-code'],{stdio:'pipe'});
const lock=JSON.parse(fs.readFileSync('audit/ios-source-lock.json'));
const paths=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(p=>p&&p!=='audit/ios-source-lock.json').sort();
const data=execFileSync('git',['cat-file','--batch'],{input:paths.map(p=>':'+p).join('\n')+'\n',maxBuffer:100*1024*1024});
let offset=0;
lock.files=paths.map(p=>{
 const end=data.indexOf(10,offset),header=data.subarray(offset,end).toString();
 if(header.endsWith(' missing'))throw Error('Missing index blob: '+p);
 const size=Number(header.split(' ').at(-1));offset=end+1;
 const bytes=data.subarray(offset,offset+size);offset+=size+1;
 return {path:p,sha256:contentHash(p,bytes)};
});
fs.writeFileSync('audit/ios-source-lock.json',JSON.stringify(lock,null,2)+'\n');
console.log('Source lock generated from '+paths.length+' reviewed Git index blobs.');
