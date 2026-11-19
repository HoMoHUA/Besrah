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

test('the service worker precaches every module app.js reaches and every page resource, and only served files', () => {
  const sw = readFileSync(join(root, 'reminder-sw.js'), 'utf8');
  const list = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')));
  const shell = new Set([...list.matchAll(/'([^']+)'/g)].map(m => m[1]));
  const reachable = new Set(), queue = ['app.js'];
  while (queue.length) {
    const file = queue.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    if (file.endsWith('.js') && served.has(file)) queue.push(...importsOf(file));
  }
  const page = readFileSync(join(root, 'index.html'), 'utf8');
  for (const m of page.matchAll(/(?:href|src)="([^"#:]+)"/g)) reachable.add(normalize(m[1]));
  const notPrecached = [...reachable].filter(f => !shell.has(f));
  assert.deepEqual(notPrecached, [], `offline start would stop at the preloader: ${notPrecached.join(', ')}`);
  const unknown = [...shell].filter(f => f !== './' && !served.has(f));
  assert.deepEqual(unknown, [], `precached but not served: ${unknown.join(', ')}`);
  assert.ok(!shell.has('assets/food-catalog.json'), 'the 6 MB food catalogue is fetched on demand, not precached');
});
