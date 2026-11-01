import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(source?.includes('veli.theme'));
for(const platform of ['web','android','ios','ios-no-bridge'])for(const saved of [null,'light','dark','invalid','storage-blocked'])for(const systemDark of [false,true]){
 const document={documentElement:{dataset:{},style:{}}};
 vm.runInNewContext(source,{document,location:{protocol:platform==='ios-no-bridge'?'capacitor:':'https:'},window:{Capacitor:platform==='ios-no-bridge'?undefined:{getPlatform:()=>platform}},localStorage:{getItem(){if(saved==='storage-blocked')throw Error('storage unavailable');return saved;},setItem(){throw Error('Default must never overwrite manual preference');}},matchMedia:()=>({matches:systemDark})});
 const expected=saved==='light'||saved==='dark'?saved:platform.startsWith('ios')?'light':systemDark?'dark':'light';
 assert.equal(document.documentElement.dataset.theme,expected);assert.equal(document.documentElement.style.colorScheme,expected);
}
const html=fs.readFileSync('index.html','utf8');
assert(html.indexOf('<script>')<html.indexOf('type="module"'));
assert(html.indexOf('<script>')<html.indexOf('<body'));
assert.match(fs.readFileSync('ios/App/App/Info.plist','utf8'),/<key>UIUserInterfaceStyle<\/key>\s*<string>Light<\/string>/);
assert(!fs.readFileSync('ios/App/App/Base.lproj/LaunchScreen.storyboard','utf8').includes('key="backgroundColor" systemColor='));
console.log('Theme bootstrap PASS: 40 cases; iOS light without preference even on dark system, saved manual light/dark preserved, invalid/blocked storage, no-bridge capacitor scheme; Android/web system default unchanged; pre-React initializer and native light launch policy.');
