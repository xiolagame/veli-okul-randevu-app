import fs from 'node:fs';
import path from 'node:path';
const client=path.resolve('dist/client'),welcome=path.resolve(client,'welcome');
if(path.dirname(welcome)!==client||path.basename(welcome)!=='welcome')throw Error('Unexpected native prune target');
// Only the explicitly browser-only production welcome directory is excluded.
fs.rmSync(welcome,{recursive:true,force:true});
