import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(p,'utf8');
const pkg=JSON.parse(read('package.json')),project=read('ios/App/App.xcodeproj/project.pbxproj'),spm=read('ios/App/CapApp-SPM/Package.swift'),scheme=read('ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme');
for(const name of ['@capacitor/core','@capacitor/ios'])assert.equal(pkg.dependencies[name],'8.5.2');
assert.equal(pkg.devDependencies['@capacitor/cli'],'8.5.2');
for(const text of ['PRODUCT_BUNDLE_IDENTIFIER = com.velirandevu.app;','IPHONEOS_DEPLOYMENT_TARGET = 15.0;','TARGETED_DEVICE_FAMILY = "1,2";','MARKETING_VERSION = 1.0.0;','CURRENT_PROJECT_VERSION = 1;','APS_ENVIRONMENT = production;','PrivacyInfo.xcprivacy in Resources'])assert(project.includes(text),text);
assert(scheme.includes('BlueprintIdentifier = "504EC3031FED79650016851F"'));assert(scheme.includes('<ArchiveAction\n      buildConfiguration = "Release"')||/<ArchiveAction\s+buildConfiguration = "Release"/.test(scheme));
for(const match of spm.matchAll(/path:\s*"(\.\.\/\.\.\/\.\.\/node_modules\/[^"]+)"/g))assert(fs.existsSync(path.resolve('ios/App/CapApp-SPM',match[1],'Package.swift')),'Missing local Swift package');
assert(spm.includes('exact: "8.5.2"'));assert(spm.includes('.iOS(.v15)'));
for(const file of ['AppDelegate.swift','SceneDelegate.swift','Info.plist','PrivacyInfo.xcprivacy','App.entitlements','Base.lproj/Main.storyboard','Base.lproj/LaunchScreen.storyboard'])assert(fs.existsSync('ios/App/App/'+file),file);
for(const [file,size] of [['Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',1024],['Assets.xcassets/Splash.imageset/splash-2732x2732.png',2732]]){const b=fs.readFileSync('ios/App/App/'+file);assert.equal(b.readUInt32BE(16),size);assert.equal(b.readUInt32BE(20),size);assert.equal(b[25],2,'Expected opaque RGB PNG');}
const manifests=['@aparajita/capacitor-secure-storage','@capacitor-community/fcm'].map(name=>({name,packageSwift:read('node_modules/'+name+'/Package.swift')}));
fs.mkdirSync('audit/phase3b',{recursive:true});
fs.writeFileSync('audit/phase3b/native-preflight.json',JSON.stringify({status:'PASS_STATIC_ONLY',capacitor:'8.5.2',bundleId:'com.velirandevu.app',deploymentTarget:'15.0',deviceFamily:'iPhone + iPad',version:'1.0.0',sourceBuildNumber:1,xcodeCompile:'BLOCKED: Windows',signedIpa:'NOT BUILT',firebasePlistPresent:fs.existsSync('ios/App/App/GoogleService-Info.plist'),spmResolvedPresent:fs.existsSync('ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved'),transitivePackages:manifests},null,2));
console.log('Native static preflight PASS: Capacitor/SPM local paths, project/scheme identity, iOS 15, iPhone+iPad, Release resources and opaque branded PNGs. Xcode/SPM native resolution BLOCKED on Windows.');
