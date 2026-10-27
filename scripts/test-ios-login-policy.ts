import assert from 'node:assert/strict';
import { allowLegacyPhoneFallback, resolveLoginEntry } from '../src/platform/login-capability-policy';
for (const platform of ['IOS','WEB'] as const) {
  for(const passwordSelected of [false,true]) {
    for(const enabled of [false,true]) {
      assert.equal(resolveLoginEntry(platform,'loading',enabled,passwordSelected),'loading');
      assert.equal(resolveLoginEntry(platform,'error',enabled,passwordSelected),'error');
    }
    assert.equal(resolveLoginEntry(platform,'ready',false,passwordSelected),'unavailable');
    assert.equal(resolveLoginEntry(platform,'ready',true,passwordSelected),'phone');
  }
  assert.equal(allowLegacyPhoneFallback(platform),false);
}
assert.equal(allowLegacyPhoneFallback('ANDROID'),true);
assert.equal(resolveLoginEntry('ANDROID','ready',true,false),'phone');
assert.equal(resolveLoginEntry('ANDROID','ready',true,true),'legacy');
assert.equal(resolveLoginEntry('ANDROID','loading',false,false),'legacy');
console.log('iOS/web fail-closed capability states, no password downgrade, Android rollout policy PASS.');
