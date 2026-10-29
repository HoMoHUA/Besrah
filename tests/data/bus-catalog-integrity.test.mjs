import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('persisted bus catalogue conserves the real source graph and quarantines supplementary records', () => {
  const code = String.raw`
from pathlib import Path
from contextlib import closing
import csv, datetime, gzip, hashlib, json, sqlite3

raw = gzip.decompress(Path('data/bus/raw/overpass-mashhad-expanded.json.gz').read_bytes())
osm = json.loads(raw)
source = json.loads(Path('data/bus/raw/overpass-mashhad-expanded.source.json').read_text())
assert hashlib.sha256(raw).hexdigest() == source['sha256']
assert not osm.get('remark')
index = {(e['type'], e['id']): e for e in osm['elements']}
assert len(index) == len(osm['elements']), 'Unexpected duplicate source element ids'
raw_routes = [e for e in osm['elements'] if e['type']=='relation' and e.get('tags', {}).get('route')=='bus']
municipal = {'سازمان اتوبوسرانی مشهد', 'سازمان اتوبوسرانی شهرداری مشهد'}
included = [e for e in raw_routes if not e.get('tags', {}).get('operator') or e['tags']['operator'] in municipal]
expected_ids = {f"osm:relation:{e['id']}" for e in included}
summary = json.loads(Path('data/bus/exports/summary.json').read_text())
assert summary['official_completeness_verified'] is False
assert summary['official_current_line_count'] is None
assert summary['real_time_arrivals_connected'] is False
assert summary['database_sha256'] == hashlib.sha256(Path('data/bus/mashhad-bus.sqlite').read_bytes()).hexdigest()

with closing(sqlite3.connect(Path('data/bus/mashhad-bus.sqlite').resolve().as_uri()+'?mode=ro', uri=True)) as db:
    assert {r[0] for r in db.execute('SELECT id FROM routes')} == expected_ids
    assert {r[0] for r in db.execute('SELECT id FROM excluded_routes')} == {
        f"osm:relation:{r['id']}" for r in raw_routes if f"osm:relation:{r['id']}" not in expected_ids}
    for route in included:
        rid = f"osm:relation:{route['id']}"
        members = route.get('members', [])
        expected_members = [(i, f"osm:{m['type']}:{m['ref']}", m.get('role','')) for i, m in enumerate(members)]
        actual_members = db.execute('SELECT member_index,element_id,role FROM route_members WHERE route_id=? ORDER BY member_index',(rid,)).fetchall()
        assert actual_members == expected_members, rid
        expected_stops = [f"osm:{m['type']}:{m['ref']}" for m in members
                          if m.get('role') in {'stop','stop_entry_only','stop_exit_only'} and (m['type'],m['ref']) in index]
        assert [r[0] for r in db.execute('SELECT stop_id FROM route_stops WHERE route_id=? ORDER BY sequence',(rid,))] == expected_stops, rid
        for member_index, way_id, shape in db.execute('SELECT member_index,way_id,geometry_json FROM route_geometry WHERE route_id=?',(rid,)):
            member = members[member_index]
            assert member['type'] == 'way'
            source_way = index[('way',member['ref'])]
            assert json.loads(shape)['coordinates'] == [[p['lon'],p['lat']] for p in source_way['geometry']]
    assert {r[0] for r in db.execute('SELECT ref_raw FROM lines')} == {
        r['tags']['ref'] for r in included if r.get('tags',{}).get('ref')}
    for sid, tags_json, ref_raw in db.execute('SELECT id,tags_json,ref_raw FROM stops'):
        tags = json.loads(tags_json)
        assert ref_raw == tags.get('ref')
        expected = [(i, token, token.strip()) for i, token in enumerate(tags.get('ref','').split(';')) if token.strip()]
        actual = db.execute('SELECT ordinal,ref_raw,ref_lookup FROM stop_refs WHERE stop_id=? ORDER BY ordinal',(sid,)).fetchall()
        assert actual == expected, sid
    for pid, tags_json in db.execute('SELECT id,tags_json FROM platforms'):
        tags = json.loads(tags_json)
        expected = [(i, token, token.strip()) for i, token in enumerate(tags.get('route_ref','').split(';')) if token.strip()]
        actual = db.execute('SELECT ordinal,ref_raw,ref_lookup FROM observed_route_refs WHERE platform_id=? ORDER BY ordinal',(pid,)).fetchall()
        assert actual == expected, pid
    assert db.execute('SELECT count(*) FROM routes WHERE headway_min IS NOT NULL').fetchone()[0] == 0
    assert db.execute('SELECT count(*) FROM arrival_observations').fetchone()[0] == 0
    assert db.execute('SELECT count(*) FROM external_stop_mappings').fetchone()[0] == 0
    for table, filename in [('reference_route_records','supplementary-route-tables.json'),
                            ('reference_pdf_mentions','historical-pdf-route-refs.json')]:
        rows = json.loads((Path('research/bus-static-additional')/filename).read_text())
        assert [json.loads(r[0]) for r in db.execute(f'SELECT row_json FROM {table} ORDER BY ordinal')] == rows
        assert db.execute(f"SELECT count(*) FROM {table} WHERE quality<>'research_only_not_current_verified'").fetchone()[0] == 0
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    for table, count in summary['counts'].items():
        assert db.execute(f'SELECT count(*) FROM {table}').fetchone()[0] == count, table
        with Path(f'data/bus/exports/{table}.csv').open(encoding='utf-8-sig',newline='') as file:
            assert len(list(csv.DictReader(file))) == count, table
    for kind,table in [('stops','stops'),('facilities','facilities'),('routes','routes')]:
        features = json.loads(Path(f'data/bus/exports/{kind}.geojson').read_text())['features']
        assert len(features) == summary['counts'][table], kind

print(json.dumps({'ok': True, 'source_relations': len(raw_routes),
                  'variants': len(included), 'line_refs': summary['counts']['lines'],
                  'stops': summary['counts']['stops'], 'reference_rows': summary['counts']['reference_route_records'],
                  'historical_mentions': summary['counts']['reference_pdf_mentions']}))
`;
  const result = spawnSync('python3', ['-W', 'error::ResourceWarning', '-c', code], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 1_000_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).ok, true);
});
