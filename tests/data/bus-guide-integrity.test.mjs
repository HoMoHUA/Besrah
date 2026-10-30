import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

const verification = String.raw`
from pathlib import Path
from contextlib import closing
import hashlib, json, os, re, sqlite3
root=Path('.')
guide=root/'data/bus/guide'
manifest=json.loads((guide/'manifest.json').read_text())
meta=manifest['meta']
source=root/'data/bus/mashhad-bus.sqlite'
assert hashlib.sha256(source.read_bytes()).hexdigest()==meta['source_database_sha256']
assert meta['official_completeness_verified'] is False
assert meta['official_current_line_count'] is None
assert meta['current_operator_service_verified'] is False
assert meta['real_time_arrivals_connected'] is False
paths=[x['path'] for x in manifest['files']]
assert len(paths)==len(set(paths))==5
assert set(paths)=={'lines.json','routes.json','stops.json','facilities.json','endpoint-derivations.json'}
for item in manifest['files']:
    assert Path(item['path']).name==item['path']
    content=(guide/item['path']).read_bytes()
    assert len(content)==item['bytes']
    assert hashlib.sha256(content).hexdigest()==item['sha256']
def load(name,key):
    d=json.loads((guide/name).read_text())
    assert d['meta']==meta
    return d[key]
lines=load('lines.json','lines')
routes=load('routes.json','routes')
stops=load('stops.json','stops')
facilities=load('facilities.json','facilities')
derived=load('endpoint-derivations.json','derivations')
audit_paths=[x['path'] for x in meta['audit_evidence']]
assert len(audit_paths)==len(set(audit_paths))==2
assert set(audit_paths)=={'research/bus-static-completion/audit/route_metrics.json','research/bus-static-completion/audit/route_geometry_metrics.json'}
audits={}
for item in meta['audit_evidence']:
    content=(root/item['path']).read_bytes()
    assert hashlib.sha256(content).hexdigest()==item['sha256']
    records=json.loads(content)['routes']
    assert len(records)==len({x['route_id'] for x in records})
    audits[Path(item['path']).name]={x['route_id']:x for x in records}
# Memory-only semantic mutations model a self-consistent regenerated artifact,
# after byte-integrity checks. They never alter the dataset or SQLite on disk.
mutation=os.environ.get('BESRAH_GUIDE_TEST_MUTATION','')
if mutation=='line_current_status':lines[0]['current_operator_service_verified']=True
elif mutation=='duplicate_variant':lines[0]['variants'].append(json.loads(json.dumps(lines[0]['variants'][0])))
elif mutation=='unsupported_summary_endpoints':
    lines[0]['variants'][0]['from_raw']='UNSUPPORTED ENDPOINT'
    lines[0]['variants'][0]['to_raw']='UNSUPPORTED ENDPOINT'
elif mutation=='orientation_verified':routes[0]['quality']['geometry_audit']['independent_traversal_orientation_verified']=True
elif mutation=='wrong_component_count':lines[0]['variants'][0]['exact_vertex_component_count']=999
elif mutation=='raw_member_omission':routes[0]['members'].pop()
with closing(sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True)) as db:
    db.row_factory=sqlite3.Row
    def rows(q,args=()):return [dict(r) for r in db.execute(q,args)]
    original_routes={r['id']:r for r in rows('SELECT * FROM routes')}
    original_lines={r['id']:r for r in rows('SELECT * FROM lines')}
    assert {r['id'] for r in routes}==set(original_routes)
    assert {r['id'] for r in lines}==set(original_lines)
    assert len(routes)==len(original_routes) and len(lines)==len(original_lines)
    source_metadata=json.loads(db.execute("SELECT value_json FROM metadata WHERE key='source'").fetchone()[0])
    assert meta['source_snapshot']==source_metadata
    assert meta['license']==source_metadata['license']
    assert meta['attribution']==source_metadata['attribution']
    for records in audits.values():assert set(records)==set(original_routes)
    display_derivations=[]
    for r in routes:
        raw=original_routes[r['id']]
        for key in ['id','ref_raw','name','line_id','operator','scope_quality','from_name','to_name','headway_min','timing_quality']:
            assert r[key]==raw[key],(r['id'],key)
        assert r['tags']==json.loads(raw['tags_json'])
        assert r['headway_min'] is None and r['timing_quality']=='unknown'
        assert r['quality']['continuous_navigation_supported'] is False
        assert r['quality']['current_operator_service_verified'] is False
        assert r['quality']['source_audit']==audits['route_metrics.json'][r['id']]
        assert r['quality']['geometry_audit']==audits['route_geometry_metrics.json'][r['id']]
        assert r['quality']['geometry_audit']['independent_traversal_orientation_verified'] is False
        assert r['quality']['source_audit']['route_id']==r['id']
        assert r['quality']['geometry_audit']['route_id']==r['id']
        expected=rows('SELECT q.sequence,q.member_index,q.stop_id,s.name AS name_raw,s.lat,s.lon,s.ref_raw,m.role AS source_role FROM route_stops q JOIN stops s ON s.id=q.stop_id JOIN route_members m ON m.route_id=q.route_id AND m.member_index=q.member_index WHERE q.route_id=? ORDER BY q.sequence',(r['id'],))
        assert r['stops']==expected,r['id']
        expected=rows('SELECT q.member_index,q.platform_id,q.role,p.name AS name_raw,p.geometry_json FROM route_platforms q JOIN platforms p ON p.id=q.platform_id WHERE q.route_id=? ORDER BY q.member_index',(r['id'],))
        for p in expected:p['geometry']=json.loads(p.pop('geometry_json'))
        assert r['platforms']==expected,r['id']
        expected=rows('SELECT member_index,way_id,role,geometry_json FROM route_geometry WHERE route_id=? ORDER BY member_index',(r['id'],))
        for s in expected:s['geometry']=json.loads(s.pop('geometry_json'))
        assert r['road_segments']==expected,r['id']
        # Independently recompute shared-exact-vertex components from SQL geometry.
        parents={}
        def find(point):
            parents.setdefault(point,point)
            while parents[point]!=point:
                parents[point]=parents[parents[point]]
                point=parents[point]
            return point
        for segment in expected:
            points=[tuple(x) for x in segment['geometry']['coordinates']]
            for point in points:find(point)
            for a,b in zip(points,points[1:]):parents[find(a)]=find(b)
        component_count=len({find(point) for point in parents})
        assert r['quality']['geometry_audit']['components_sharing_any_exact_coordinate_vertex']==component_count
        expected=rows('SELECT member_index,element_id,role FROM route_members WHERE route_id=? ORDER BY member_index',(r['id'],))
        assert r.get('members',[])==expected,('full raw source members not preserved',r['id'])
        typed_indices={x['member_index'] for group in ['stops','platforms','road_segments'] for x in r[group]}
        unclassified=[x for x in expected if x['member_index'] not in typed_indices]
        assert r.get('unclassified_members',[])==unclassified,r['id']
        for endpoint in ['from','to']:
            value=r['endpoint_display'][endpoint]
            assert value['raw_tag_value']==raw[endpoint+'_name']
            assert value['operator_verified'] is False
            if raw[endpoint+'_name']:
                assert value['name']==raw[endpoint+'_name']
                assert value['method']=='explicit_source_tag'
            elif value['name'] is not None:
                assert value['method']=='exact_same_route_name_en_to_unique_facility_name_en'
                proof=value['evidence']
                assert proof['route_id']==r['id']
                title=r['tags']['name:en']
                assert proof['route_source_value']==title
                assert title.startswith('Line '+r['ref_raw']+' (') and title.endswith(')')
                pair=title.split(' (',1)[1][:-1].split(' → ')
                assert len(pair)==2
                label=pair[0 if endpoint=='from' else 1]
                assert label==value['language_alias_text']
                matches=[f for f in rows('SELECT * FROM facilities') if json.loads(f['tags_json']).get('name:en')==label]
                assert len(matches)==1 and matches[0]['scope_quality']=='municipal_operator_tag'
                f=matches[0]
                assert proof['facility_id']==f['id']
                assert proof['facility_source_value']==label
                assert value['name']==proof['facility_name_raw']==f['name']
                display_derivations.append({'route_id':r['id'],'endpoint':endpoint,'original_raw_value':None,'derived_display':value})
    assert derived==display_derivations
    for line in lines:
        assert line['ref_raw']==original_lines[line['id']]['ref_raw']
        assert line['quality']==original_lines[line['id']]['quality']
        assert line['current_operator_service_verified'] is False
        expected_ids={r['id'] for r in routes if r['line_id']==line['id']}
        actual_ids=[v['id'] for v in line['variants']]
        assert len(actual_ids)==len(set(actual_ids))==len(expected_ids)
        assert {v['id'] for v in line['variants']}=={r['id'] for r in routes if r['line_id']==line['id']}
        for v in line['variants']:
            r=next(r for r in routes if r['id']==v['id'])
            assert v['name_raw']==r['name']
            assert v['from_raw']==r['from_name']
            assert v['to_raw']==r['to_name']
            assert v['direction_status']==r['quality']['source_audit']['direction']['status']
            assert v['exact_vertex_component_count']==r['quality']['geometry_audit']['components_sharing_any_exact_coordinate_vertex']
            assert v['endpoint_display']==r['endpoint_display']
            assert v['stop_occurrences']==len(r['stops'])
            assert v['platform_occurrences']==len(r['platforms'])
            assert v['geometry_segments']==len(r['road_segments'])
    expected=rows('SELECT * FROM stops ORDER BY id')
    for s in expected:
        s['tags']=json.loads(s.pop('tags_json'))
        s['route_occurrences']=rows('SELECT route_id,sequence,member_index FROM route_stops WHERE stop_id=? ORDER BY route_id,sequence',(s['id'],))
        s['physical_stop_identity_verified']=False
    assert stops==expected
    expected=rows('SELECT * FROM facilities ORDER BY id')
    for f in expected:
        f['geometry']=json.loads(f.pop('geometry_json'))
        f['tags']=json.loads(f.pop('tags_json'))
        f['official_terminal_verified']=False
    assert facilities==expected
    counts=meta['counts']
    assert counts['exact_line_refs']==len(lines)
    assert counts['route_variants']==len(routes)
    assert counts['stop_elements']==len(stops)
    assert counts['facility_candidates']==len(facilities)
    assert counts['stop_occurrences']==db.execute('SELECT count(*) FROM route_stops').fetchone()[0]
    assert counts['platform_occurrences']==db.execute('SELECT count(*) FROM route_platforms').fetchone()[0]
    assert counts['road_segment_occurrences']==db.execute('SELECT count(*) FROM route_geometry').fetchone()[0]
    assert counts['raw_member_occurrences']==sum(len(r['members']) for r in routes)==db.execute('SELECT count(*) FROM route_members').fetchone()[0]
    assert counts['unclassified_member_occurrences']==sum(len(r['unclassified_members']) for r in routes)
    assert counts['derived_endpoint_display_labels']==len(derived)
    assert counts['missing_display_endpoint_labels']==sum(not r['endpoint_display'][key]['name'] for r in routes for key in ['from','to'])
    assert counts['raw_missing_endpoint_tags']==sum(raw[key] is None for raw in original_routes.values() for key in ['from_name','to_name'])
    assert db.execute('SELECT count(*) FROM arrival_observations').fetchone()[0]==0
    assert db.execute('SELECT count(*) FROM external_stop_mappings').fetchone()[0]==0
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
assert hashlib.sha256(source.read_bytes()).hexdigest()==meta['source_database_sha256']
print('Full-source projection, exact memberships/geometry, explicit provenance and unknown timing verified.')
`;

function verify(mutation = '') {
  return spawnSync('python3', ['-c', verification], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, BESRAH_GUIDE_TEST_MUTATION: mutation },
  });
}

test('materialized static guide conserves the full source and proves every derived display endpoint', () => {
  const result = verify();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Full-source projection/);
});

for (const mutation of ['line_current_status', 'duplicate_variant', 'unsupported_summary_endpoints', 'orientation_verified', 'wrong_component_count', 'raw_member_omission']) {
  test(`static guide rejects unsupported semantic mutation: ${mutation}`, () => {
    const result = verify(mutation);
    assert.notEqual(result.status, 0, `Incorrect guide was accepted: ${mutation}`);
    assert.match(result.stderr, /AssertionError/, result.stderr);
  });
}
