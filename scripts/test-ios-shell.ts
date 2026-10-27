import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
};
const capacitorConfig = fs.readFileSync('capacitor.config.ts', 'utf8');
const generatedCapacitorConfig = fs.readFileSync('ios/App/App/capacitor.config.json', 'utf8');
const viteConfig = fs.readFileSync('vite.config.ts', 'utf8');
const infoPlist = fs.readFileSync('ios/App/App/Info.plist', 'utf8');
const privacyManifest = fs.readFileSync('ios/App/App/PrivacyInfo.xcprivacy', 'utf8');
const xcodeProject = fs.readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
const swiftPackage = fs.readFileSync('ios/App/CapApp-SPM/Package.swift', 'utf8');
const cameraSource = fs.readFileSync('src/components/SecurityView.tsx', 'utf8');
const cameraAdapter = fs.readFileSync('src/platform/android-camera-permission.ts', 'utf8');
const notificationAdapter = fs.readFileSync('src/platform/android-notification-settings.ts', 'utf8');
const pushSource = fs.readFileSync('src/platform/android-push.ts', 'utf8');
const iosPushSource = fs.readFileSync('src/platform/ios-push.ts', 'utf8');
const nativeFcmSource = fs.readFileSync('node_modules/@capacitor-community/fcm/ios/Plugin/Plugin.swift', 'utf8');
const appDelegate = fs.readFileSync('ios/App/App/AppDelegate.swift', 'utf8');
const entitlements = fs.readFileSync('ios/App/App/App.entitlements', 'utf8');
const codemagic = fs.readFileSync('codemagic.yaml', 'utf8');
const tokenSelection = fs.readFileSync('src/platform/auth-token-store-selection.ts', 'utf8');

const readPngDimensions = (path: string): { width: number; height: number } => {
  const png = fs.readFileSync(path);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', `${path} must be a PNG`);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

assert.equal(packageJson.dependencies['@capacitor/ios'], '8.5.2');
assert.equal(packageJson.dependencies['@capacitor-community/fcm'], '8.2.2');
assert.equal(packageJson.dependencies['@capacitor/app-launcher'], '8.0.0');
assert.equal(packageJson.scripts['ios:sync'], 'node scripts/sanitize-fcm-ios-logs.mjs && npm run build:ios && cap sync ios');
assert.equal(packageJson.scripts['test:ios-push'], 'tsx scripts/test-ios-push.ts');
assert.match(capacitorConfig, /appId:\s*'com\.velirandevu\.app'/);
assert.match(capacitorConfig, /appName:\s*'Veli Randevu'/);
assert.match(capacitorConfig, /webDir:\s*'dist\/client'/);
assert.doesNotMatch(capacitorConfig, /server\s*:/);
assert.match(capacitorConfig, /StatusBar:\s*\{[\s\S]*style:\s*'LIGHT'/);
assert.match(capacitorConfig, /PushNotifications:\s*\{[\s\S]*presentationOptions:\s*\['banner', 'list', 'sound'\]/);
assert.match(generatedCapacitorConfig, /"StatusBar"[\s\S]*"style":\s*"LIGHT"/);
assert.match(generatedCapacitorConfig, /"PushNotifications"[\s\S]*"presentationOptions":\s*\[[\s\S]*"banner"[\s\S]*"list"[\s\S]*"sound"/);
assert.match(viteConfig, /\['android', 'ios'\]\.includes\(mode\)/);
assert.match(viteConfig, /https:\/\/velirandevu\.com/);

assert.match(infoPlist, /<key>NSCameraUsageDescription<\/key>\s*<string>Veli Randevu, okul girişindeki randevu QR kodunu doğrulamak için kamerayı kullanır\.<\/string>/);
assert.doesNotMatch(infoPlist, /NSMicrophoneUsageDescription/);
assert.doesNotMatch(infoPlist, /NSAllowsArbitraryLoads/);
assert.match(infoPlist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
assert.match(infoPlist, /<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*<true\/>/);
assert.match(xcodeProject, /PRODUCT_BUNDLE_IDENTIFIER = com\.velirandevu\.app;/g);
assert.match(xcodeProject, /MARKETING_VERSION = 1\.0\.0;/g);
assert.match(xcodeProject, /CURRENT_PROJECT_VERSION = 1;/g);
assert.match(xcodeProject, /IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/g);
assert.match(xcodeProject, /com\.apple\.Push = \{\s*enabled = 1;/);
assert.match(xcodeProject, /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g);
assert.match(xcodeProject, /Embed Firebase iOS configuration when available/);
assert.match(entitlements, /<key>aps-environment<\/key>\s*<string>\$\(APS_ENVIRONMENT\)<\/string>/);
assert.match(xcodeProject, /APS_ENVIRONMENT = development;/);
assert.match(xcodeProject, /APS_ENVIRONMENT = production;/);
assert.match(swiftPackage, /platforms:\s*\[\.iOS\(\.v15\)\]/);
assert.match(swiftPackage, /CapacitorCommunityFcm/);
assert.match(swiftPackage, /CapacitorAppLauncher/);
assert.match(appDelegate, /didRegisterForRemoteNotificationsWithDeviceToken/);
assert.match(appDelegate, /didFailToRegisterForRemoteNotificationsWithError/);
assert.match(infoPlist, /<key>FirebaseMessagingAutoInitEnabled<\/key>\s*<false\/>/);

assert.match(privacyManifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
assert.match(privacyManifest, /NSPrivacyCollectedDataTypeName/);
assert.match(privacyManifest, /NSPrivacyCollectedDataTypePhoneNumber/);
assert.match(privacyManifest, /NSPrivacyCollectedDataTypeUserID/);
assert.match(privacyManifest, /NSPrivacyCollectedDataTypeDeviceID/);
assert.match(privacyManifest, /NSPrivacyCollectedDataTypeCustomerSupport/);
assert.match(xcodeProject, /PrivacyInfo\.xcprivacy in Resources/);

assert.match(cameraSource, /Ayarlar > Veli Randevu > Kamera/);
assert.match(cameraAdapter, /runtimePlatform\(\) === 'ANDROID'/);
assert.match(pushSource, /runtimePlatform\(\) !== 'ANDROID'/);
assert.match(pushSource, /platform:\s*'ANDROID'/);
assert.match(iosPushSource, /platform:\s*'IOS', provider:\s*'FCM'/);
assert.match(iosPushSource, /FCM_TOKEN_PATTERN/);
assert.doesNotMatch(iosPushSource, /providerTarget:\s*value/);
assert.match(iosPushSource, /getToken\(\)/);
assert.match(iosPushSource, /tokenReceived/);
assert.doesNotMatch(nativeFcmSource, /print\([^\n]*(?:token|error)/i);
assert.match(nativeFcmSource, /messaging\(_ messaging: Messaging, didReceiveRegistrationToken/);
assert.match(nativeFcmSource, /notifyListeners\("tokenReceived"/);
assert.match(codemagic, /Require Firebase iOS config for signed IPA/);
assert.match(codemagic, /FCM_GOOGLE_SERVICE_INFO_PLIST/);
assert.doesNotMatch(notificationAdapter, /getRuntimePlatform|IOS/);
assert.match(tokenSelection, /platform === 'WEB'[\s\S]*createNativeSecureAuthTokenStore/);

assert.deepEqual(
  readPngDimensions('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'),
  { width: 1024, height: 1024 },
);
for (const splashName of [
  'splash-2732x2732.png',
  'splash-2732x2732-1.png',
  'splash-2732x2732-2.png',
]) {
  assert.deepEqual(
    readPngDimensions(`ios/App/App/Assets.xcassets/Splash.imageset/${splashName}`),
    { width: 2732, height: 2732 },
  );
}

console.log('iOS shell, branded assets, permissions, privacy manifest, secure storage and Android isolation static tests PASS. Xcode build not tested.');
