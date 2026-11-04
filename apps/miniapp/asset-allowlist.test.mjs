// Every module the Mini App imports must be served: the core only serves files named in MINIAPP_ASSETS, so a new file
// that is not registered there is a 404 and breaks the whole app (found the hard way while adding a geometry module).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const allow = readFileSync(new URL('../../packages/core/src/miniapp.ts', import.meta.url), 'utf8');
const served = new Set([...allow.matchAll(/\['\/app\/[^']*',\s*'([^']+)'\]/g)].map(m => m[1]));

function importsOf(file) {
  const source = readFileSync(join(root, file), 'utf8');
  return [...source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)]
    .map(m => normalize(join(dirname(file), m[1] ?? m[2] ?? m[3])));
}

test('the allowlist was parsed', () => assert.ok(served.size > 20 && served.has('app.js') && served.has('ui/tracker.js')));

test('every file reachable by relative imports from app.js is in the allowlist', () => {
  const seen = new Set(), queue = ['app.js'], missing = [];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!served.has(file)) { missing.push(file); continue; }
    if (file.endsWith('.js')) queue.push(...importsOf(file));
  }
  assert.deepEqual(missing, [], `not served by the core (404 in production): ${missing.join(', ')}`);
  assert.ok(seen.size > 15);
});
