// generate-script-types.mjs — copies the script-author type declarations
// (packages/workers/src/script-api.ts) into docs/script-api.d.ts so script
// authors get editor autocomplete for the `api` and `ctx` sandbox globals.
//
// Run: npm run script:types
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = resolve(root, 'packages/workers/src/script-api.ts');
const outPath = resolve(root, 'docs/script-api.d.ts');

const source = readFileSync(srcPath, 'utf8');
const header = `// AUTO-GENERATED from packages/workers/src/script-api.ts — do not edit.
// Regenerate after changing the script API: npm run script:types

`;

writeFileSync(outPath, header + source);
console.log(`docs/script-api.d.ts updated (${source.split('\n').length} lines)`);
