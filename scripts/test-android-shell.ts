import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import capacitorConfig from '../capacitor.config';
import viteConfig from '../vite.config';

const repositoryRoot = path.resolve(process.cwd());
const clientRoot = path.join(repositoryRoot, 'dist', 'client');
const androidRoot = path.join(repositoryRoot, 'android');
const generatedClientRoot = path.join(androidRoot, 'app', 'src', 'main', 'assets', 'public');
const productionOrigin = 'https://velirandevu.com';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

function relativeFiles(root: string): string[] {
  return listFiles(root).map((file) => path.relative(root, file).replaceAll(path.sep, '/'));
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function assertSafeClientTree(root: string, label: string): void {
  const files = relativeFiles(root);
  const forbiddenPaths = [
    /(^|\/)server\.cjs(?:\.map)?$/i,
    /(^|\/)\.env(?:\.|$)/i,
    /(^|\/)(?:server|scripts|migrations|netlify\/functions)(?:\/|$)/i,
    /(^|\/)(?:service[-_.]?account|credentials?)(?:[-_.].*)?\.json$/i,
    /\.(?:pem|key|p12|pfx)$/i,
    /\.map$/i,
  ];
  const forbiddenMarkers = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'DATABASE_URL',
    'JWT_SECRET',
    'AUTH_CODE_SECRET',
    'RESEND_API_KEY',
    '-----BEGIN PRIVATE KEY-----',
    'server.cjs',
    'sourcesContent',
  ];
  const textExtensions = new Set(['.css', '.html', '.js', '.json', '.txt', '.webmanifest', '.xml']);

  for (const file of files) {
    assert(!forbiddenPaths.some((pattern) => pattern.test(file)), `${label} contains forbidden path: ${file}`);
    if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    for (const marker of forbiddenMarkers) {
      assert(!content.includes(marker), `${label} contains forbidden marker: ${marker}`);
    }
  }
}

assert.equal(capacitorConfig.appId, 'com.velirandevu.app');
assert.equal(capacitorConfig.appName, 'Veli Randevu');
assert.equal(capacitorConfig.webDir, 'dist/client');
assert(!Object.prototype.hasOwnProperty.call(capacitorConfig, 'server'), 'Production Capacitor config must not use server.url.');

const packageJson = JSON.parse(read('package.json')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const capacitorPackages = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};
for (const packageName of [
  '@capacitor/core',
  '@capacitor/cli',
  '@capacitor/android',
  '@capacitor/app',
  '@capacitor/network',
  '@capacitor/status-bar',
  '@capacitor/keyboard',
  '@capacitor/splash-screen',
]) {
  assert.match(capacitorPackages[packageName] ?? '', /^[~^]?8\./, `${packageName} must remain on Capacitor 8.`);
}
assert.equal(packageJson.dependencies['@aparajita/capacitor-secure-storage'], '8.0.1');
for (const excludedPackage of [
  '@capacitor/ios',
  '@capacitor/camera',
  '@capacitor/filesystem',
  '@capacitor/push-notifications',
  '@capacitor/geolocation',
  '@capacitor-community/secure-storage',
]) {
  assert.equal(capacitorPackages[excludedPackage], undefined, `${excludedPackage} is outside Phase 3A scope.`);
}

const variablesGradle = read('android/variables.gradle');
assert.match(variablesGradle, /minSdkVersion\s*=\s*24/);
assert.match(variablesGradle, /compileSdkVersion\s*=\s*36/);
assert.match(variablesGradle, /targetSdkVersion\s*=\s*36/);

const appGradle = read('android/app/build.gradle');
assert.match(appGradle, /namespace\s*=\s*["']com\.velirandevu\.app["']/);
assert.match(appGradle, /applicationId\s+["']com\.velirandevu\.app["']/);
assert.match(appGradle, /versionCode\s+1\b/);
assert.match(appGradle, /versionName\s+["']1\.0\.0["']/);

assert.equal(typeof viteConfig, 'function', 'Vite configuration must expose a mode-aware build guard.');
const resolveViteConfig = viteConfig as (environment: { command: 'build'; mode: string; isSsrBuild: boolean; isPreview: boolean }) => unknown;
const previousApiBase = process.env.VITE_API_BASE_URL;
try {
  process.env.VITE_API_BASE_URL = 'https://invalid.example';
  assert.throws(
    () => resolveViteConfig({ command: 'build', mode: 'android', isSsrBuild: false, isPreview: false }),
    /Android build requires VITE_API_BASE_URL=https:\/\/velirandevu\.com/,
  );
  assert.doesNotThrow(() => resolveViteConfig({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false }));
  process.env.VITE_API_BASE_URL = productionOrigin;
  assert.doesNotThrow(() => resolveViteConfig({ command: 'build', mode: 'android', isSsrBuild: false, isPreview: false }));
} finally {
  if (previousApiBase === undefined) delete process.env.VITE_API_BASE_URL;
  else process.env.VITE_API_BASE_URL = previousApiBase;
}

assert(fs.existsSync(path.join(clientRoot, 'index.html')), 'Android client build is missing.');
assert(fs.existsSync(path.join(generatedClientRoot, 'index.html')), 'Capacitor generated web assets are missing; run android:sync.');
for (const legacyTemplateAsset of ['adaptive-icon.png', 'splash-image.png']) {
  assert(!fs.existsSync(path.join(clientRoot, legacyTemplateAsset)), `Android client must exclude legacy template asset: ${legacyTemplateAsset}`);
  assert(!fs.existsSync(path.join(generatedClientRoot, legacyTemplateAsset)), `Generated Android assets must exclude legacy template asset: ${legacyTemplateAsset}`);
}
assertSafeClientTree(clientRoot, 'dist/client');
assertSafeClientTree(generatedClientRoot, 'generated Android client assets');

const clientFiles = relativeFiles(clientRoot);
const generatedFiles = new Set(relativeFiles(generatedClientRoot));
for (const clientFile of clientFiles) {
  assert(generatedFiles.has(clientFile), `Capacitor assets are stale or incomplete: ${clientFile}`);
}

const clientJavaScript = clientFiles
  .filter((file) => file.endsWith('.js'))
  .map((file) => fs.readFileSync(path.join(clientRoot, file), 'utf8'))
  .join('\n');
assert(clientJavaScript.includes(productionOrigin), 'Android client bundle must contain the production API origin.');
for (const forbiddenOrigin of [
  'http://localhost',
  'https://localhost',
  '127.0.0.1',
  '10.0.2.2',
  'velirokulrandevu.netlify.app',
  '.ngrok',
  '.trycloudflare.com',
]) {
  assert(!clientJavaScript.includes(forbiddenOrigin), `Android client bundle contains forbidden origin: ${forbiddenOrigin}`);
}

const generatedConfig = JSON.parse(read('android/app/src/main/assets/capacitor.config.json')) as Record<string, unknown>;
assert.equal(generatedConfig.appId, 'com.velirandevu.app');
assert.equal(generatedConfig.appName, 'Veli Randevu');
assert.equal(generatedConfig.webDir, 'dist/client');
assert.equal(generatedConfig.server, undefined, 'Generated Capacitor config must not use server.url.');
const generatedPlugins = JSON.parse(read('android/app/src/main/assets/capacitor.plugins.json')) as Array<{ pkg: string; classpath: string }>;
assert(generatedPlugins.some((plugin) => plugin.pkg === '@aparajita/capacitor-secure-storage' && plugin.classpath === 'com.aparajita.capacitor.securestorage.SecureStorage'));
assert(read('android/capacitor.settings.gradle').includes("include ':aparajita-capacitor-secure-storage'"));
assert(read('android/app/capacitor.build.gradle').includes("implementation project(':aparajita-capacitor-secure-storage')"));

const manifest = read('android/app/src/main/AndroidManifest.xml');
assert(manifest.includes('android.permission.INTERNET'));
assert.match(manifest, /android:allowBackup="false"/);
assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
const backupRules = read('android/app/src/main/res/xml/data_extraction_rules.xml');
assert.match(backupRules, /<cloud-backup>[\s\S]*<exclude domain="root" path="\."\s*\/>[\s\S]*<\/cloud-backup>/);
assert.match(backupRules, /<device-transfer>[\s\S]*<exclude domain="root" path="\."\s*\/>[\s\S]*<\/device-transfer>/);
const nativeTheme = read('android/app/src/main/res/values/styles.xml');
assert.match(nativeTheme, /AppTheme\.NoActionBar" parent="Theme\.AppCompat\.Light\.NoActionBar"/);
assert.match(nativeTheme, /android:forceDarkAllowed">false</);
assert.match(read('src/main.tsx'), /getRuntimePlatform\(\) === 'ANDROID'.*dataset\.runtimePlatform = 'android'/);
const authStyles = read('src/index.css');
assert.match(authStyles, /html\[data-runtime-platform="android"\] \.auth-form-wrap \{[^}]*background: rgba\(255, 255, 255, \.94\)/);
assert.match(authStyles, /html\[data-runtime-platform="android"\] \.auth-form-side \{[^}]*safe-area-inset-bottom/);
assert(!read('src/context/AppContext.tsx').includes("'sch-kazan-01'"), 'Authenticated sessions must not use a hard-coded school fallback.');
for (const forbiddenPermission of [
  'android.permission.CAMERA',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.RECORD_AUDIO',
  'android.permission.READ_CONTACTS',
  'android.permission.READ_SMS',
  'android.permission.READ_CALL_LOG',
  'android.permission.MANAGE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
]) {
  assert(!manifest.includes(forbiddenPermission), `Unexpected Phase 3A permission: ${forbiddenPermission}`);
}
assert(!fs.existsSync(path.join(androidRoot, 'app', 'google-services.json')), 'Firebase configuration is outside Phase 3A scope.');

const brandSource = path.join(repositoryRoot, 'public', 'branding', 'veli-randevu-logo.png');
const androidBrand = path.join(androidRoot, 'app', 'src', 'main', 'res', 'drawable-nodpi', 'veli_randevu_logo.png');
assert.equal(sha256(androidBrand), sha256(brandSource), 'Android brand asset must be an exact copy of the approved logo.');
assert(read('android/app/src/main/res/values/styles.xml').includes('@drawable/launch_screen'));
assert(read('android/app/src/main/res/drawable/launch_screen.xml').includes('@drawable/veli_randevu_logo'));
assert(read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml').includes('@drawable/ic_launcher_brand_foreground'));
assert(read('android/app/src/main/res/drawable/ic_launcher_brand_foreground.xml').includes('@drawable/veli_randevu_logo'));

const androidGitignore = read('android/.gitignore');
assert.match(androidGitignore, /^local\.properties$/m);
assert.match(androidGitignore, /^\*\.jks$/m);
assert.match(androidGitignore, /^\*\.keystore$/m);
assert.match(androidGitignore, /^google-services\.json$/m);

console.log('Android shell config, API guard, branding, permissions and generated asset safety tests PASS.');
