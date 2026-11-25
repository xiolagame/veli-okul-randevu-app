import assert from 'node:assert/strict';
import { resolveLoginEntry } from '../src/platform/login-capability-policy';
// Giriş yalnız telefon + WhatsApp kodudur: yetenekler bilinmeden form gösterilmez, parola/eski yol yoktur.
for (const enabled of [false, true]) {
  assert.equal(resolveLoginEntry('loading', enabled), 'loading');
  assert.equal(resolveLoginEntry('error', enabled), 'error');
}
assert.equal(resolveLoginEntry('ready', false), 'unavailable');
assert.equal(resolveLoginEntry('ready', true), 'phone');
console.log('Capability states fail closed; the only login entry is phone + WhatsApp code PASS.');
