import fs from 'node:fs';
import type {ReviewDependencies} from './review-access';
export function createReviewAudit(file:string):ReviewDependencies['audit']{
 if(!file)throw Error('Persistent review audit path required');
 // File must be pre-created on a mounted volume; refuse symlinks and unsafe file types.
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW);
 if(!fs.fstatSync(fd).isFile())throw Error('Review audit must be a regular file');
 return async event=>{
  const line=JSON.stringify({time:new Date().toISOString(),channel:'review-access',action:String(event.action).slice(0,80),identity:String(event.identity).slice(0,80),result:String(event.result).slice(0,100)})+'\n';
  fs.writeSync(fd,line);fs.fsyncSync(fd);
 };
}
