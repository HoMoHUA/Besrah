import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = path => JSON.parse(readFileSync(root + path, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const semanticHash = app => sha256(JSON.stringify({ n: app.n, l: app.l }));
const preservedUiSemanticHash = '9b7512e1d2c085814b6398d7ce2b5e345154ee2fbfd4440a39e20d70958ffe99';
const manifestHash = 'e6f7114eb2f76c1d137bac42e4ec0af35bf40bca608bd4697ebce9187b1d8c2c';
const overlayPath = 'data/bus/corrections/ui-v1.json';
const build = () => spawnSync('python3', ['-c', 'from scripts.build_bus_app_data import build; print(build(), end="")'], { cwd: root, encoding: 'utf8' });

test('metadata computes complete output counts and binds separate guide and overlay lineage', () => {
  const result = build();
  assert.equal(result.status, 0, result.stderr);
  const app = JSON.parse(result.stdout);
  const variants = app.l.flatMap(line => line.v);
  const used = new Set(variants.flatMap(v => v.s));
  assert.deepEqual(app.meta.counts, { lines: 95, variants: 188, stop_occurrences: 5381, stop_names: 1725, used_stop_names: 1719, unused_stop_names: 6 });
  assert.equal(app.meta.counts.lines, app.l.length);
  assert.equal(app.meta.counts.variants, variants.length);
  assert.equal(app.meta.counts.stop_occurrences, variants.reduce((sum, v) => sum + v.s.length, 0));
  assert.equal(app.meta.counts.stop_names, app.n.length);
  assert.equal(app.meta.counts.used_stop_names, used.size);
  assert.equal(app.meta.counts.unused_stop_names, app.n.length - used.size);
  assert.deepEqual(app.meta.guide_counts, { lines: 92, variants: 180, stop_occurrences: 5275, stop_names: 1689 });
  assert.deepEqual(app.meta.overlay_counts, { added_lines: 4, added_variants: 8, added_stop_occurrences: 106, appended_stop_names: 36, ref_corrections: 2 });
  assert.equal(app.meta.guide_manifest_sha256, manifestHash);
  assert.equal(app.meta.corrections_overlay_sha256, sha256(readFileSync(root + overlayPath)));
  assert.equal(app.meta.corrections_overlay_id, 'bus-ui-corrections-v1');
  assert.equal(app.meta.ui_semantics_sha256, preservedUiSemanticHash);
  assert.equal(app.meta.preserved_ui_sha256, 'e5dd1801130297925262d48770a03e43a6aa927895e48ddac61a80185fc06eea');
  assert.deepEqual(app.meta.ref_aliases, { '38.1': '38/1', '800': '801' });
});

test('all eight added variants retain exact sequences with honest owner versus assistant provenance', () => {
  const result = build();
  assert.equal(result.status, 0, result.stderr);
  const app = JSON.parse(result.stdout);
  const overlay = json(overlayPath);
  const expectedIds = [129001, 129002, 830001, 830002, 832001, 832002, 833001, 833002];
  const additions = app.l.filter(line => ['129', '830', '832', '833'].includes(line.r));
  assert.deepEqual(additions.flatMap(line => line.v.map(v => v.i)), expectedIds);
  assert.deepEqual(additions, overlay.added_lines.map(({ r, v }) => ({ r, v })));
  const lineage = app.meta.overlay_provenance;
  assert.equal(lineage.length, 4);
  for (const item of lineage) {
    assert.deepEqual(item.variant_ids, additions.find(l => l.r === item.ref).v.map(v => v.i));
    assert.equal(item.route_existence, 'owner_specified');
    assert.equal(item.endpoints_status, 'assistant_entered_unverified');
    assert.equal(item.stop_sequence_status, 'assistant_entered_unverified');
    assert.equal(item.official_verification, false);
    assert.equal(item.source, 'preserved_existing_ui_not_official_source');
  }
  const line129 = lineage.find(p => p.ref === '129');
  assert.equal(line129.areas_status, 'owner_specified');
  assert.deepEqual(line129.areas, ['پایانه شهید جوان', 'ارغوان', 'بهارستان', 'آبادگران', 'چشمه پونه']);
  assert.deepEqual(line129.headway_announcement, { minutes: 10, kind: 'owner_reported_announcement', time_specific_schedule: false, operationally_verified: false });
  for (const item of lineage.filter(p => p.ref !== '129')) {
    assert.equal(item.areas_status, 'not_independently_verified');
    assert.deepEqual(item.areas, []);
    assert.equal(item.headway_announcement, undefined);
  }
  assert.deepEqual(app.l.find(l => l.r === '38/1').v.map(v => v.i), [5698799, 12916882]);
  assert.deepEqual(app.l.find(l => l.r === '801').v.map(v => v.i), [5658288, 13090062]);
  assert.ok(!app.l.some(l => ['38.1', '800'].includes(l.r)));
  assert.deepEqual(app.l.slice(0, 3).map(l => l.r), ['EXP-2', 'EXP-3', 'EXP-4']);
  assert.equal(app.meta.official_completeness_verified, false);
  assert.equal(app.meta.live_arrivals, false);
});

const invalidOverlayMutations = {
  wrong_schema: o => { o.schema_version = 2; },
  boolean_schema: o => { o.schema_version = true; },
  unknown_field: o => { o.schedule = []; },
  wrong_base: o => { o.base_guide_manifest_sha256 = '0'.repeat(64); },
  malformed_hash: o => { o.preserved_ui_sha256 = 'not-a-hash'; },
  wrong_semantics_hash: o => { o.preserved_ui_semantics_sha256 = '0'.repeat(64); },
  missing_lineage: o => { delete o.added_lines[0].provenance; },
  official_claim: o => { o.added_lines[0].provenance.official_verification = true; },
  official_stops: o => { o.added_lines[0].provenance.stop_sequence_status = 'official'; },
  owner_stops: o => { o.added_lines[0].provenance.stop_sequence_status = 'owner_specified'; },
  official_endpoints: o => { o.added_lines[0].provenance.endpoints_status = 'official'; },
  invented_areas: o => { o.added_lines[1].provenance.areas_status = 'official'; },
  hidden_schedule: o => { o.added_lines[0].provenance.headway_announcement.time_specific_schedule = true; },
  wrong_headway_type: o => { o.added_lines[0].provenance.headway_announcement.minutes = true; },
  missing_headway_announcement: o => { delete o.added_lines[0].provenance.headway_announcement; },
  extra_schedule_field: o => { o.added_lines[0].provenance.headway_announcement.departures = ['08:00']; },
  duplicate_ref: o => { o.added_lines.push(structuredClone(o.added_lines[0])); },
  existing_ref: o => { o.added_lines[0].r = '10'; },
  malformed_ref: o => { o.added_lines[0].r = ' 129'; },
  duplicate_variant: o => { o.added_lines[0].v[1].i = o.added_lines[0].v[0].i; },
  source_id_collision: o => { o.added_lines[0].v[0].i = 5698799; },
  boolean_variant: o => { o.added_lines[0].v[0].i = true; },
  unknown_variant_field: o => { o.added_lines[0].v[0].official = true; },
  invalid_stop_index: o => { o.added_lines[0].v[0].s[0] = 999999; },
  negative_stop_index: o => { o.added_lines[0].v[0].s[0] = -1; },
  boolean_stop_index: o => { o.added_lines[0].v[0].s[0] = true; },
  empty_sequence: o => { o.added_lines[0].v[0].s = []; },
  changed_sequence: o => { o.added_lines[0].v[0].s.reverse(); },
  empty_endpoint: o => { o.added_lines[0].v[0].f = ''; },
  invalid_derived_flag: o => { o.added_lines[0].v[0].d = true; },
  duplicate_name: o => { o.appended_names.push(o.appended_names[0]); },
  existing_name: o => { o.appended_names.push('ایستگاه میدان فردوسی'); },
  empty_name: o => { o.appended_names[0] = ' '; },
  unknown_correction_source: o => { o.ref_corrections[0].from = '38.1 '; },
  duplicate_correction: o => { o.ref_corrections.push(structuredClone(o.ref_corrections[0])); },
  correction_cycle: o => { o.ref_corrections[0].to = '38.1'; },
  correction_chain: o => { o.ref_corrections[0].to = '800'; },
  lost_source_variant: o => { o.ref_corrections[1].variant_ids.pop(); },
  false_correction_evidence: o => { o.ref_corrections[0].evidence.official_verification = true; },
};
const validateOverlay = overlay => spawnSync('python3', ['-c', `
import json, os, sys, tempfile
from pathlib import Path
from scripts.build_bus_app_data import build
with tempfile.TemporaryDirectory(prefix='bus-overlay-test-', dir=os.environ.get('TMPDIR', '/root/.hermes/cache/scratch')) as directory:
    path = Path(directory) / 'overlay.json'
    path.write_text(sys.stdin.read(), encoding='utf-8')
    try:
        build(overlay_path=path)
    except ValueError as error:
        print('Rejected overlay:', error)
        sys.exit(2)
`], { cwd: root, encoding: 'utf8', input: typeof overlay === 'string' ? overlay : JSON.stringify(overlay) });

test('builder rejects ambiguous duplicate JSON object keys', () => {
  const raw = '{"schema_version":99,' + JSON.stringify(json(overlayPath)).slice(1);
  const result = validateOverlay(raw);
  assert.equal(result.status, 2, result.stderr + result.stdout);
  assert.match(result.stdout, /duplicate JSON key/);
});

test('overlay validator accepts the unchanged versioned source', () => {
  const result = validateOverlay(json(overlayPath));
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, mutate] of Object.entries(invalidOverlayMutations)) {
  test(`builder rejects invalid overlay: ${name}`, () => {
    const overlay = json(overlayPath);
    mutate(overlay);
    const result = validateOverlay(overlay);
    assert.equal(result.status, 2, result.stderr + result.stdout);
    assert.match(result.stdout, /Rejected overlay:/);
  });
}

test('two independent builds are byte identical with deterministic hashes', () => {
  const first = build(), second = build();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.equal(sha256(first.stdout), sha256(second.stdout));
});

test('builder preserves the entire existing UI dictionary, refs, endpoints and all 188 ordered variants', () => {
  const result = build();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(semanticHash(JSON.parse(result.stdout)), preservedUiSemanticHash);
});

test('compact Mini App bus data is reproducible from the reviewed guide and corrections overlay', () => {
  const result = spawnSync('python3', ['scripts/build_bus_app_data.py', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('compact data keeps every original variant, endpoint and ordered stop name, and stays small', () => {
  const app = json('apps/miniapp/assets/bus-guide.json');
  const routes = json('data/bus/guide/routes.json').routes;
  assert.equal(app.meta.official_completeness_verified, false);
  assert.equal(app.meta.live_arrivals, false);
  assert.equal(app.meta.source_database_sha256, json('data/bus/guide/manifest.json').meta.source_database_sha256);
  assert.equal(sha256(readFileSync(root + 'data/bus/guide/manifest.json')), manifestHash);
  assert.equal(app.l.length, 95);
  const variants = new Map(app.l.flatMap(line => line.v.map(v => [v.i, { ref: line.r, ...v }])));
  assert.equal(app.l.flatMap(line => line.v).length, 188);
  assert.equal(variants.size, 188);
  assert.equal(routes.length, 180);
  const original = routes.map(route => variants.get(Number(route.id.split(':').pop())));
  assert.equal(original.reduce((sum, v) => sum + v.s.length, 0), 5275);
  assert.equal([...variants.values()].reduce((sum, v) => sum + v.s.length, 0), 5381);
  for (const route of routes) {
    const v = variants.get(Number(route.id.split(':').pop()));
    assert.ok(v, route.id);
    assert.equal(v.ref, ({ '38.1': '38/1', '800': '801' })[route.ref_raw] ?? route.ref_raw);
    assert.equal(v.f, route.endpoint_display.from.name);
    assert.equal(v.t, route.endpoint_display.to.name);
    assert.deepEqual(v.s.map(i => app.n[i]), route.stops.map(s => s.name_raw), route.id);
    assert.equal(v.d, route.id === 'osm:relation:5815754' ? 1 : 0);
  }
  assert.equal(semanticHash(app), preservedUiSemanticHash);
  const raw = readFileSync(root + 'apps/miniapp/assets/bus-guide.json');
  assert.ok(raw.length < 400 * 1024);
  assert.doesNotMatch(raw.toString('utf8'), /"(lat|lon|geometry)"/);
});
