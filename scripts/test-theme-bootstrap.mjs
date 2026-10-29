import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(source?.includes('veli.theme'));
for(const saved of [null,'light','dark','invalid','storage-blocked'])for(const systemDark of [false,true]){
 const document={documentElement:{dataset:{},style:{}}};
 vm.runInNewContext(source,{document,localStorage:{getItem(){if(saved==='storage-blocked')throw Error('storage unavailable');return saved;}},matchMedia:()=>({matches:systemDark})});
 const expected=saved==='light'||saved==='dark'?saved:systemDark?'dark':'light';
 assert.equal(document.documentElement.dataset.theme,expected);assert.equal(document.documentElement.style.colorScheme,expected);
}
console.log('Theme bootstrap PASS: system default, manual preference precedence, invalid preference and blocked storage; pre-React initializer.');
