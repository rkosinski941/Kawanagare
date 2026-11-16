/**
 * Test gate (spec v6 section 9, slices.md "Test gate"): `node --test m3/` on Node 24 runs only what
 * index.mjs imports, so index.mjs must import every *.test.mjs in this directory. This check fails
 * when a test file is missing from index.mjs. It is the only test file that reads the disk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

test('gate: index.mjs imports every *.test.mjs in m3/', () => {
  const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();
  assert.ok(files.includes('gate.test.mjs'));
  assert.ok(files.length >= 6, `expected at least 6 test files, found ${files.length}`);
  const index = readFileSync(join(here, 'index.mjs'), 'utf8');
  const imported = new Set([...index.matchAll(/^\s*import\s+['"]\.\/([^'"]+\.test\.mjs)['"]\s*;?\s*$/gm)].map((m) => m[1]));
  const missing = files.filter((f) => !imported.has(f));
  assert.deepEqual(missing, [], `index.mjs does not import: ${missing.join(', ')}`);
  const stale = [...imported].filter((f) => !files.includes(f));
  assert.deepEqual(stale, [], `index.mjs imports missing files: ${stale.join(', ')}`);
});
