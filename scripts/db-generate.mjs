import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const genDir = join(root, 'packages/api/prisma/generated/prisma');
const buildDir = join(root, 'packages/api/prisma/.generated-build');

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(p, out);
    else out.push(p);
  }
  return out;
}

rmSync(genDir, { recursive: true, force: true });
rmSync(buildDir, { recursive: true, force: true });
mkdirSync(genDir, { recursive: true });

execSync('npx prisma generate', { cwd: root, stdio: 'inherit' });

execSync('npx tsc -p packages/api/tsconfig.prisma.json', { cwd: root, stdio: 'inherit' });

for (const file of collectFiles(buildDir)) {
  const rel = relative(buildDir, file);
  const dest = join(genDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(file, dest);
}

for (const file of collectFiles(genDir)) {
  if (file.endsWith('.ts') && !file.endsWith('.d.ts')) rmSync(file);
}

rmSync(buildDir, { recursive: true, force: true });

if (!existsSync(join(genDir, 'client.js')) || !existsSync(join(genDir, 'client.d.ts'))) {
  throw new Error('Prisma client build failed: client.js / client.d.ts missing');
}

console.log('Prisma Client generated and compiled to packages/api/prisma/generated/prisma');
