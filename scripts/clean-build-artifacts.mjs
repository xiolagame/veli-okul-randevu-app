import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(process.cwd());
const distRoot = path.resolve(repositoryRoot, 'dist');

if (distRoot !== path.join(repositoryRoot, 'dist') || !distRoot.startsWith(`${repositoryRoot}${path.sep}`)) {
  throw new Error('Refusing to clean an unexpected build directory.');
}

fs.rmSync(distRoot, { recursive: true, force: true });
