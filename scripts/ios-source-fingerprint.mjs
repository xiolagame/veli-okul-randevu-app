import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { contentHash } from './ios-artifact-policy.mjs';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const walk=root=>fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(root,e.name)):[path.join(root,e.name)]);
export function iosSourceFingerprint() {
  const paths=[...walk('src'),...walk('public'),'package.json','package-lock.json','index.html','vite.config.ts','capacitor.config.ts','scripts/build-ios-client.mjs','scripts/ios-source-fingerprint.mjs','scripts/ios-artifact-policy.mjs'].map(p=>p.replaceAll('\\','/')).sort();
  const files=paths.map(p=>({path:p,sha256:contentHash(p,fs.readFileSync(p))}));
  return {sha256:hash(JSON.stringify(files)),files};
}
