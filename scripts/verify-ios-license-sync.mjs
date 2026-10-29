import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {contentHash} from './ios-artifact-policy.mjs';
const base='651e46c40a359b0d645b4b22a42bcc5860820af5';
const git=(...a)=>execFileSync('git',a);
for(const p of ['src/App.tsx','src/platform/otp-resend-clock.ts','src/platform/auth-session.ts','src/platform/ios-push.ts','capacitor.config.ts','package-lock.json']) {
  assert.equal(contentHash(p,fs.readFileSync(p)),contentHash(p,git('show',base+':'+p)),p);
}
const before=JSON.parse(git('show',base+':package.json')),after=JSON.parse(fs.readFileSync('package.json'));
const {scripts:oldScripts,...oldPackage}=before,{scripts:newScripts,...newPackage}=after;
assert.deepEqual(newPackage,oldPackage,'Package identity/dependencies changed');
assert.deepEqual(newScripts,{...oldScripts,'android:sync:review':'node scripts/prepare-store-review.mjs android','ios:sync:review':'node scripts/prepare-store-review.mjs ios'},'Only explicit review preparation commands may be added');
const serverChanges=git('diff','--name-only',base,'--','server/','netlify/functions/','android/').toString().trim().split('\n').filter(Boolean);
const reviewOnly=new Set(['server/review-access.ts','server/review-service.ts','server/review-fixtures.ts','server/review-operations.ts','server/review-audit.ts','server/review-outbound.ts','server/review-settings.ts','server/review-maintenance.ts','android/app/build.gradle']);
assert(serverChanges.every(p=>reviewOnly.has(p)),'Unexpected backend/Android change');
const main=fs.readFileSync('src/main.tsx','utf8');
assert(main.includes('subscribeToNativeNavigationIntents')&&main.includes('getRuntimePlatform')&&main.includes("import './theme.css'"));
const auth=fs.readFileSync('src/components/AuthView.tsx','utf8');
const phone=fs.readFileSync('src/components/PhoneCentricLoginPanel.tsx','utf8');
assert(auth.includes('resolveLoginEntry')&&auth.includes('allowLegacyPhoneFallback'));
assert(phone.includes('remainingResendSeconds')&&phone.includes('appLifecycle.subscribe'));
assert(!/Telefon Numaranızla Giriş Yapın/.test(auth+phone));
for(const p of ['src/App.tsx','src/components/AuthView.tsx'])assert(!/<video\b/.test(fs.readFileSync(p,'utf8')));
const overlay=JSON.parse(fs.readFileSync('audit/license-reminder-overlay.json'));
for(const f of overlay.files)assert.equal(contentHash(f.path,fs.readFileSync(f.path)),f.iosCanonicalSha256);
console.log('Final sync PASS: protected iOS core/config and license overlay; production backend unchanged, review service and Android version metadata explicitly reviewed; native OTP lifecycle preserved.');
