import fs from 'node:fs';import assert from 'node:assert/strict';import YAML from 'yaml';
const pkg=JSON.parse(fs.readFileSync('package.json'));const c=YAML.parse(fs.readFileSync('codemagic.yaml','utf8'));
const scriptNames=['build','clean:build','build:client','build:server','test:release-artifacts','ios:sync','ios:sync:review','android:sync:review','build:ios','lint'];
const helpers=['scripts/clean-build-artifacts.mjs','scripts/build-ios-client.mjs','scripts/sanitize-fcm-ios-logs.mjs','scripts/test-release-artifacts.mjs','scripts/run-ios-regressions.mjs','scripts/verify-ios-provenance.mjs','scripts/verify-ios-web-package.mjs','scripts/verify-ios-ipa.sh','scripts/ios-source-fingerprint.mjs','scripts/ios-artifact-policy.mjs','scripts/verify-ios-source-lock.mjs','scripts/verify-apple-toolchain.sh','scripts/prepare-store-review.mjs','scripts/verify-store-review-package.mjs'];
const forbidden=/netlify\s+(?:deploy|env)|git\s+(?:push|commit)|app-store-connect\s+(?:publish|submit)|fastlane\s+(?:pilot|deliver)|altool\s+--upload|curl[^\n]+(?:--upload|-T\s)/i;
for(const name of scriptNames) assert(!forbidden.test(pkg.scripts[name]),name);
for(const file of helpers) assert(!forbidden.test(fs.readFileSync(file,'utf8')),file);
for(const hook of ['preinstall','install','postinstall','prepare','prebuild','postbuild','preios:sync','postios:sync']) assert(!pkg.scripts[hook],`Unexpected root lifecycle hook: ${hook}`);
const commands={};for(const [id,w] of Object.entries(c.workflows)) {
 assert(!w.triggering && !w.publishing);const text=w.scripts.map(s=>s.script).join('\n');
 if(id!=='ios-testflight')assert(!forbidden.test(text),id);
 commands[id]=w.scripts.map(s=>s.name);
}
fs.writeFileSync('audit/phase3a/command-chain.json',JSON.stringify({status:'PASS',npmScripts:Object.fromEntries(scriptNames.map(n=>[n,pkg.scripts[n]])),reviewedHelpers:helpers,commands,notes:'TestFlight has one explicit guarded publish step. First two workflows and reachable local helpers contain no publishing command. Third-party installed tool implementation and cloud UI hooks are outside this static audit.'},null,2));
console.log('Direct workflows, reachable npm script chain, helper programs and root lifecycle hooks PASS: no indirect publishing in the first two workflows.');
