import fs from 'node:fs';
import assert from 'node:assert/strict';
import YAML from 'yaml';
const config=YAML.parse(fs.readFileSync('codemagic.yaml','utf8'));
function validate(config) {
  assert.deepEqual(Object.keys(config.workflows).sort(),['ios-ci-check','ios-signed-ipa','ios-testflight']);
  for(const [id,w] of Object.entries(config.workflows)) {
    assert(!w.triggering,`${id}: automatic triggers forbidden`);
    assert(!w.publishing,`${id}: implicit publishing forbidden`);
    const scripts=w.scripts.map(s=>s.script).join('\n');
    assert(!/fastlane|altool\s+--upload|notarytool|netlify\s+deploy|git\s+push/.test(scripts));
    if(id!=='ios-testflight') assert(!/app-store-connect\s+(?:publish|submit)|--testflight|--app-store\b/.test(scripts),`${id}: upload command forbidden`);
    else {
      for(const guard of [w.scripts[0], w.scripts.at(-2)]) {
        assert(guard.script.includes('IOS_TESTFLIGHT_APPROVAL'));
        assert(guard.script.includes('UPLOAD_TO_TESTFLIGHT'));
        assert(guard.script.includes('IOS_APPROVED_COMMIT'));
        assert(guard.script.includes('git rev-parse HEAD'));
        assert(guard.script.includes('exit 1'));
      }
      assert(!('IOS_TESTFLIGHT_APPROVAL' in (w.environment.vars||{})));
      assert.match(w.scripts.at(-1).script,/app-store-connect publish .* --testflight/);
      assert(!scripts.includes('--app-store'));
    }
  }
}
validate(config);
for(const id of ['ios-ci-check','ios-signed-ipa']) {
  const publishing=structuredClone(config);publishing.workflows[id].publishing={app_store_connect:{submit_to_testflight:false}};
  assert.throws(()=>validate(publishing));
  const upload=structuredClone(config);upload.workflows[id].scripts.push({script:'app-store-connect publish --path app.ipa'});
  assert.throws(()=>validate(upload));
  const trigger=structuredClone(config);trigger.workflows[id].triggering={events:['push']};
  assert.throws(()=>validate(trigger));
}
assert.match(fs.readFileSync('capacitor.config.ts','utf8'),/loggingBehavior: 'none'/);
const main=fs.readFileSync('src/main.tsx','utf8');
assert.match(main,/dataset.runtimePlatform = getRuntimePlatform\(\).toLowerCase/);
const auth=fs.readFileSync('src/components/AuthView.tsx','utf8');
assert.match(auth,/addEventListener\('focusin', onFocus\)/);
assert.match(auth,/contains\(focused\)/);
assert(!fs.readFileSync('src/context/AppContext.tsx','utf8').includes("console.error('Test isolation error:', err)"));
console.log('Codemagic parsed workflow safety and negative upload/trigger cases, Release logging and OTP focus wiring PASS. Cloud settings not inspected.');
