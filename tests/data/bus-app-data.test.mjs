import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = path => JSON.parse(readFileSync(root + path, 'utf8'));

test('compact Mini App bus data is reproducible from the reviewed guide', () => {
  const result = spawnSync('python3', ['scripts/build_bus_app_data.py', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('compact data keeps every line variant, endpoint label and ordered stop name, and stays small', () => {
  const app = json('apps/miniapp/assets/bus-guide.json');
  const routes = json('data/bus/guide/routes.json').routes;
  assert.equal(app.meta.official_completeness_verified, false);
  assert.equal(app.meta.live_arrivals, false);
  assert.equal(app.meta.source_database_sha256, json('data/bus/guide/manifest.json').meta.source_database_sha256);
  assert.equal(app.l.length, 92);
  const variants = new Map(app.l.flatMap(line => line.v.map(v => [v.i, { ref: line.r, ...v }])));
  assert.equal(variants.size, 180);
  assert.equal([...variants.values()].reduce((sum, v) => sum + v.s.length, 0), 5275);
  for (const route of routes) {
    const v = variants.get(Number(route.id.split(':').pop()));
    assert.ok(v, route.id);
    assert.equal(v.ref, route.ref_raw);
    assert.equal(v.f, route.endpoint_display.from.name);
    assert.equal(v.t, route.endpoint_display.to.name);
    assert.deepEqual(v.s.map(i => app.n[i]), route.stops.map(s => s.name_raw), route.id);
    assert.equal(v.d, route.id === 'osm:relation:5815754' ? 1 : 0);
  }
  const raw = readFileSync(root + 'apps/miniapp/assets/bus-guide.json');
  assert.ok(raw.length < 400 * 1024);
  assert.doesNotMatch(raw.toString('utf8'), /"(lat|lon|geometry)"/);
});
