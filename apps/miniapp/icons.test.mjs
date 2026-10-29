import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
const root = new URL('./', import.meta.url);
test('every static interface icon exists in the vendored font map', () => {
  const css = readFileSync(new URL('vendor/hm7/components/bundle.css', root), 'utf8');
  const missing = [];
  for (const dir of ['', 'views/', 'ui/']) {
    for (const file of readdirSync(new URL(dir || './', root)).filter(f => f.endsWith('.js'))) {
      const source = readFileSync(new URL(dir + file, root), 'utf8');
      for (const call of source.split('icon(').slice(1)) {
        const literal = call.trimStart().match(/^['"]([^'"]+)['"]/);
        if (literal && !css.includes('.hms-' + literal[1] + '::before')) missing.push(dir + file + ':' + literal[1]);
      }
    }
  }
  assert.deepEqual(missing, []);
});
