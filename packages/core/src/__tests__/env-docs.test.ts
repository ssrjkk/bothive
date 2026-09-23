import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

/**
 * Guards `.env.example` against drifting away from the code.
 *
 * A variable that the app reads but that nobody documented is invisible to
 * whoever deploys it: they cannot set what they do not know exists. This test
 * fails when source reads a `process.env.X` that `.env.example` never mentions,
 * so the two are forced to move together.
 *
 * Only `process.env.X` and `process.env['X']` (string literal) are detected. A
 * computed lookup such as `process.env[SOME_CONST]` cannot be resolved
 * statically and is therefore not covered — keep env access literal.
 */

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.cjs']);
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'coverage', '.vitest']);

/**
 * Vars injected by the runtime rather than configured by an operator. `npm_*`
 * is populated by npm itself when a script launches the process, so there is
 * nothing for a deployer to set.
 */
const RUNTIME_PROVIDED = /^npm_/;

function findRepoRoot(start: string): string {
  let current = start;
  for (;;) {
    try {
      statSync(join(current, 'package.json'));
      statSync(join(current, '.env.example'));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new Error('Could not locate repo root from ' + start);
      current = parent;
    }
  }
}

function collectSourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      collectSourceFiles(join(directory, entry.name), found);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
    // Tests may poke at env vars the app itself never reads; they are not part
    // of the deploy contract, so they do not create a documentation obligation.
    if (/\.test\.[cm]?tsx?$/.test(entry.name)) continue;
    found.push(join(directory, entry.name));
  }
  return found;
}

/** Every env var name read by non-test source, via `process.env.X` or `process.env['X']`. */
function envNamesReadBySource(root: string): Set<string> {
  const names = new Set<string>();
  const dotAccess = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
  const bracketAccess = /process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/g;

  for (const file of collectSourceFiles(join(root, 'packages'))) {
    const contents = readFileSync(file, 'utf8');
    for (const pattern of [dotAccess, bracketAccess]) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(contents)) !== null) {
        if (!RUNTIME_PROVIDED.test(match[1])) names.add(match[1]);
      }
    }
  }
  return names;
}

/** Every name `.env.example` declares, whether active or commented out. */
function envNamesDocumented(root: string): Set<string> {
  const contents = readFileSync(join(root, '.env.example'), 'utf8');
  const names = new Set<string>();
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

describe('.env.example', () => {
  const root = findRepoRoot(process.cwd());

  it('documents every env var the source reads', () => {
    const read = envNamesReadBySource(root);
    const documented = envNamesDocumented(root);

    // Sanity-check the scan itself: a silently empty result would make this
    // test pass no matter what the code does.
    expect(read.size).toBeGreaterThan(20);

    const undocumented = [...read].filter((name) => !documented.has(name)).sort();

    expect(
      undocumented,
      `These env vars are read by the code but missing from .env.example: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });
});
