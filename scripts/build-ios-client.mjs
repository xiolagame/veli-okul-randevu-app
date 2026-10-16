import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(process.cwd());
const iosApiOrigin = 'https://velirandevu.com';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [path.join(repositoryRoot, 'scripts', 'clean-build-artifacts.mjs')]);
run(
  process.execPath,
  [path.join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', 'ios'],
  { ...process.env, VITE_API_BASE_URL: iosApiOrigin },
);
run(process.execPath, [path.join(repositoryRoot, 'scripts', 'test-release-artifacts.mjs'), '--client-only']);

for (const legacyTemplateAsset of ['adaptive-icon.png', 'splash-image.png']) {
  fs.rmSync(path.join(repositoryRoot, 'dist', 'client', legacyTemplateAsset), { force: true });
}
