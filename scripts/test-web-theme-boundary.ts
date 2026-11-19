import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import config from '../vite.config';
const script=fs.readFileSync('public/web-theme-init.js','utf8');
const run=(value:string|null,native=false,denied=false)=>{const root={dataset:{} as Record<string,string>,style:{colorScheme:''}};const storage={getItem(){if(denied)throw Error('blocked');return value;}};vm.runInNewContext(script,{window:{Capacitor:{isNativePlatform:()=>native}},localStorage:storage,document:{documentElement:root}});return root;};
assert.equal(run(null).dataset.theme,'light');assert.equal(run('dark').dataset.theme,'dark');assert.equal(run('invalid').dataset.theme,'light');assert.equal(run(null,false,true).dataset.theme,'light');assert.equal(run('dark',true).dataset.theme,undefined);
const html=fs.readFileSync('index.html','utf8');assert(html.indexOf('/web-theme-init.js')<html.indexOf('fonts.googleapis.com'),'theme set before styles and React');
process.env.VITE_API_BASE_URL='https://velirandevu.com';
for(const mode of ['android','ios','production']){const resolved=(config as Function)({mode,command:'build'});const plugin=resolved.plugins.find((p:any)=>p.name==='web-theme-build-boundary');const result=plugin.transformIndexHtml(html);assert.equal(result.includes('/web-theme-init.js'),mode==='production');}
const luminance=(hex:string)=>{const c=hex.match(/\w\w/g)!.map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
for(const[a,b]of [['142d26','ffffff'],['586d63','ffffff'],['ffffff','136b56'],['eff5f1','1d2a25'],['b7cac0','1d2a25'],['09291f','48b99a']]){const ls=[luminance(a),luminance(b)].sort((a,b)=>a-b);assert((ls[1]+.05)/(ls[0]+.05)>=4.5,`${a}/${b} AA`);}
console.log('Web theme boundary PASS: early dark/light initialization, storage failure, invalid preference, native runtime/build exclusion, AA base text/button pairs.');
