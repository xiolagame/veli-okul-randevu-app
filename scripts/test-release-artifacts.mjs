import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(process.cwd());
const clientRoot = path.join(repositoryRoot, 'dist', 'client');
const serverRoot = path.join(repositoryRoot, 'dist', 'server');
const publicRoot = path.join(repositoryRoot, 'public');
const clientOnly = process.argv.includes('--client-only');

function listFiles(root) {
  if (!fs.existsSync(root)) return [];

  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

function relativeFiles(root) {
  return listFiles(root).map((file) => path.relative(root, file).replaceAll(path.sep, '/'));
}

assert(fs.existsSync(clientRoot), 'Client artifact directory is missing.');
if (!clientOnly) assert(fs.existsSync(serverRoot), 'Server artifact directory is missing.');

const clientFiles = relativeFiles(clientRoot);
const publicFiles = relativeFiles(publicRoot);
const clientFilesLower = clientFiles.map((file) => file.toLowerCase());

assert(clientFiles.includes('index.html'), 'Client artifact must contain index.html.');
assert(clientFiles.some((file) => file.startsWith('assets/') && file.endsWith('.js')), 'Client artifact must contain JavaScript assets.');
assert(clientFiles.some((file) => file.startsWith('assets/') && file.endsWith('.css')), 'Client artifact must contain CSS assets.');

for (const publicFile of publicFiles) {
  assert(clientFiles.includes(publicFile), `Public asset is missing from client artifact: ${publicFile}`);
}

const forbiddenPathPatterns = [
  /(^|\/)server\.cjs(?:\.map)?$/i,
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:server|scripts|migrations|netlify\/functions)(?:\/|$)/i,
  /(^|\/)(?:service[-_.]?account|credentials?)(?:[-_.].*)?\.json$/i,
  /\.(?:pem|key|p12|pfx)$/i,
  /\.map$/i,
];

for (const clientFile of clientFiles) {
  assert(
    !forbiddenPathPatterns.some((pattern) => pattern.test(clientFile)),
    `Forbidden backend or sensitive artifact found in client output: ${clientFile}`,
  );
}

const forbiddenContentMarkers = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'JWT_SECRET',
  'AUTH_CODE_SECRET',
  'FCM_FIREBASE_PROJECT_ID',
  'FCM_FIREBASE_CLIENT_EMAIL',
  'FCM_FIREBASE_PRIVATE_KEY',
  'firebase-admin',
  '-----BEGIN PRIVATE KEY-----',
  'server.cjs',
  'sourcesContent',
];
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.txt', '.webmanifest', '.xml']);

for (const clientFile of clientFiles) {
  if (!textExtensions.has(path.extname(clientFile).toLowerCase())) continue;
  const content = fs.readFileSync(path.join(clientRoot, clientFile), 'utf8');
  for (const marker of forbiddenContentMarkers) {
    assert(!content.includes(marker), `Forbidden server-only content marker found in client output: ${marker}`);
  }
}

assert(!clientFilesLower.includes('server.cjs'), 'server.cjs must not be published with the client artifact.');
assert(!clientFilesLower.includes('server.cjs.map'), 'server.cjs.map must not be published with the client artifact.');
if (!clientOnly) {
  assert(fs.existsSync(path.join(serverRoot, 'server.cjs')), 'Server bundle is missing from the server artifact.');
  assert(fs.existsSync(path.join(serverRoot, 'server.cjs.map')), 'Server sourcemap is missing from the server artifact.');
}

console.log(`Release artifact safety test PASS (${clientFiles.length} client files, ${clientOnly ? 0 : relativeFiles(serverRoot).length} server files).`);
