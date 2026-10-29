import fs from 'node:fs';
import {contentHash} from './ios-artifact-policy.mjs';
const lock=JSON.parse(fs.readFileSync('audit/ios-source-lock.json'));
const errors=[];
for(const f of lock.files){
 try{const actual=contentHash(f.path,fs.readFileSync(f.path));if(actual!==f.sha256)errors.push({path:f.path,expected:f.sha256,actual});}
 catch(error){errors.push({path:f.path,error:error.code||error.message});}
}
fs.mkdirSync('audit',{recursive:true});
fs.writeFileSync('audit/frozen-source-verification.json',JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,checked:lock.files.length,errors},null,2)+'\n');
if(errors.length){for(const e of errors)console.error('Frozen source changed: '+JSON.stringify(e));process.exitCode=1;}
else console.log('Frozen iOS source lock PASS: '+lock.files.length+' files, canonical LF text / exact binary.');
