import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {spawnSync} from 'node:child_process';
const c=JSON.parse(fs.readFileSync('config/store-review.json'));
assert.equal(c.reviewApiOrigin,'https://veli-review-demo.duckdns.org');assert.equal(c.productionApiOrigin,'https://velirandevu.com');assert.equal(c.welcomeHeading,'Okulunuza Hoş Geldiniz');
const yaml=YAML.parse(fs.readFileSync('codemagic.yaml','utf8'));
for(const w of Object.values(yaml.workflows)){
 assert(!w.triggering&&!w.publishing);assert.equal(w.environment.vars.VITE_REVIEW_API_ORIGIN,c.reviewApiOrigin);
 assert(w.scripts.some(s=>s.script.includes('npm run ios:sync:review')));
}
const prepare=fs.readFileSync('scripts/prepare-store-review.mjs','utf8');assert(!/gradlew|assembleDebug|assembleRelease|bundleRelease|build-ipa|xcodebuild|publish|git push/.test(prepare));
const invalid=spawnSync(process.execPath,['scripts/prepare-store-review.mjs','ios'],{env:{...process.env,VITE_REVIEW_API_ORIGIN:'https://untrusted.invalid'},encoding:'utf8'});
assert.notEqual(invalid.status,0);assert(invalid.stderr.includes('differs from approved profile'));
const gradle=fs.readFileSync('android/app/build.gradle','utf8');
assert(gradle.includes('VELI_ANDROID_VERSION_CODE')&&gradle.includes('VELI_ANDROID_VERSION_NAME'));assert(gradle.includes('applicationId "com.velirandevu.app"'));
console.log('Store review configuration PASS: explicit sync-only profile, fixed review origin, normal API retained, manual workflows, Android public version metadata; no native build invoked.');
