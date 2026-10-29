// Web build + Capacitor sync only. Native binaries and cloud jobs are user actions.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const platform=process.argv[2];
if(!['android','ios'].includes(platform))throw Error('Specify android or ios');
const config=JSON.parse(fs.readFileSync(path.join(root,'config/store-review.json')));
if(config.reviewApiOrigin!=='https://veli-review-demo.duckdns.org'||config.productionApiOrigin!=='https://velirandevu.com')throw Error('Unexpected store review origin configuration');
if(process.env.VITE_REVIEW_API_ORIGIN&&process.env.VITE_REVIEW_API_ORIGIN!==config.reviewApiOrigin)throw Error('Review origin override differs from approved profile');
const env={...process.env,VITE_REVIEW_API_ORIGIN:config.reviewApiOrigin};
function run(script,args=[]){const result=spawnSync(process.execPath,[path.join(root,script),...args],{cwd:root,env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);}
if(platform==='ios')run('scripts/sanitize-fcm-ios-logs.mjs');
run(`scripts/build-${platform}-client.mjs`);
run('node_modules/@capacitor/cli/bin/capacitor',['sync',platform]);
run('scripts/verify-store-review-package.mjs',[platform]);
