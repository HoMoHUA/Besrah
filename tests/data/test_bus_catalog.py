"""Tests use explicitly synthetic OSM format fixtures, never city facts."""
import importlib.util
import json
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts' / 'bus_catalog.py'


def sample():
    return {'osm3s': {'timestamp_osm_base': '2026-10-29T00:00:00Z'}, 'elements': [
        {'type': 'node', 'id': 11, 'lat': 36.3, 'lon': 59.6,
         'tags': {'name': 'Synthetic stop A', 'public_transport': 'stop_position', 'bus': 'yes', 'ref': '00123; 123'}},
        {'type': 'node', 'id': 12, 'lat': 36.31, 'lon': 59.61,
         'tags': {'name': 'Synthetic stop B', 'highway': 'bus_stop', 'ref': 'B-2'}},
        {'type': 'node', 'id': 21, 'lat': 36.30002, 'lon': 59.60001,
         'tags': {'name': 'Synthetic stop A', 'public_transport': 'platform', 'route_ref': 'T1; T2'}},
        {'type': 'way', 'id': 100, 'tags': {'highway': 'residential'},
         'geometry': [{'lat': 36.3, 'lon': 59.6}, {'lat': 36.31, 'lon': 59.61}]},
        {'type': 'relation', 'id': 501, 'tags': {'type': 'route', 'route': 'bus', 'ref': 'T1',
         'name': 'Synthetic loop', 'from': 'Synthetic stop A', 'to': 'Synthetic stop A'},
         'members': [{'type': 'node', 'ref': 11, 'role': 'stop'},
                     {'type': 'node', 'ref': 21, 'role': 'platform'},
                     {'type': 'way', 'ref': 100, 'role': ''},
                     {'type': 'node', 'ref': 12, 'role': 'stop'},
                     {'type': 'node', 'ref': 11, 'role': 'stop'}]},
    ]}


def importer(test):
    test.assertTrue(SCRIPT.is_file(), 'Bus catalogue importer is not implemented')
    spec = importlib.util.spec_from_file_location('besrah_bus_catalog', SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class BusCatalogTests(unittest.TestCase):
    def test_preserves_repeated_stop_order_without_counting_platforms_twice(self):
        module = importer(self)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(sample(), {'retrieved_at': '2026-10-29T00:01:00Z'}, path)
            with closing(sqlite3.connect(path)) as db, db:
                stops = db.execute('SELECT stop_id FROM route_stops WHERE route_id = ? ORDER BY sequence',
                                   ('osm:relation:501',)).fetchall()
                self.assertEqual(stops, [('osm:node:11',), ('osm:node:12',), ('osm:node:11',)])
                self.assertEqual(db.execute('SELECT count(*) FROM route_members').fetchone()[0], 5)

    def test_never_creates_headways_or_arrivals_from_osm_schedule_tags(self):
        module = importer(self)
        osm = sample()
        osm['elements'][-1]['tags'].update(interval='00:15:00', duration='30')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(osm, {}, path)
            with closing(sqlite3.connect(path)) as db, db:
                columns = {r[1] for r in db.execute('PRAGMA table_info(routes)')}
                self.assertIn('headway_min', columns, 'Unknown timing must be explicit')
                self.assertEqual(db.execute('SELECT headway_min, timing_quality FROM routes').fetchone(),
                                 (None, 'unknown'))
                self.assertEqual(db.execute('SELECT count(*) FROM arrival_observations').fetchone()[0], 0)

    def test_identifiers_are_namespaced_and_raw_refs_are_not_repaired(self):
        module = importer(self)
        osm = sample()
        for number, ref in [(502, '13.1'), (503, '13/1')]:
            variant = json.loads(json.dumps(osm['elements'][-1]))
            variant['id'] = number
            variant['tags']['ref'] = ref
            osm['elements'].append(variant)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(osm, {}, path)
            with closing(sqlite3.connect(path)) as db, db:
                tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertIn('lines', tables)
                self.assertEqual(db.execute('SELECT ref_raw FROM lines ORDER BY ref_raw').fetchall(),
                                 [('13.1',), ('13/1',), ('T1',)])
                self.assertEqual(db.execute('SELECT ref_raw FROM stop_refs WHERE stop_id=? ORDER BY ordinal',
                                            ('osm:node:11',)).fetchall(), [('00123',), (' 123',)])
                self.assertEqual(db.execute('SELECT ref_lookup FROM stop_refs WHERE stop_id=? ORDER BY ordinal',
                                            ('osm:node:11',)).fetchall(), [('00123',), ('123',)])
                self.assertEqual(db.execute('SELECT refs_raw FROM stop_inventory WHERE id=?',
                                            ('osm:node:11',)).fetchone()[0], '00123; 123')
                self.assertEqual(db.execute('SELECT count(*) FROM external_stop_mappings').fetchone()[0], 0)


    def test_private_bus_is_excluded_and_source_completeness_is_not_invented(self):
        module = importer(self)
        osm = sample()
        private = json.loads(json.dumps(osm['elements'][-1]))
        private['id'] = 900
        private['tags']['operator'] = 'Ferdowsi University of Mashhad'
        osm['elements'].append(private)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(osm, {'retrieved_at': '2026-10-29T00:01:00Z', 'url': 'https://example.invalid/synthetic'}, path)
            with closing(sqlite3.connect(path)) as db, db:
                self.assertEqual(db.execute('SELECT count(*) FROM routes').fetchone()[0], 1)
                self.assertEqual(db.execute('SELECT id FROM excluded_routes').fetchall(), [('osm:relation:900',)])
                meta = {k: json.loads(v) for k, v in db.execute('SELECT key,value_json FROM metadata')}
                self.assertEqual(meta['official_completeness'], 'not_verified')
                self.assertEqual(meta['source']['retrieved_at'], '2026-10-29T00:01:00Z')
                self.assertEqual(db.execute('SELECT scope_quality FROM routes').fetchone()[0], 'operator_unverified')


    def test_partial_overpass_response_cannot_replace_a_valid_database(self):
        module = importer(self)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(sample(), {}, path)
            original = path.read_bytes()
            partial = sample()
            partial['remark'] = 'runtime error: query timed out'
            with self.assertRaisesRegex(ValueError, 'partial|remark|Overpass'):
                module.build_catalog(partial, {}, path)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(Path(tmp).glob('.bus-build-*')), [])


    def test_catalogue_keeps_unlinked_stops_and_does_not_call_every_facility_urban(self):
        module = importer(self)
        osm = sample()
        osm['elements'].extend([
            {'type': 'node', 'id': 301, 'lat': 36.32, 'lon': 59.62,
             'tags': {'highway': 'bus_stop', 'name': 'Synthetic unlinked stop', 'ref': 'UNLINKED'}},
            {'type': 'way', 'id': 302, 'tags': {'amenity': 'bus_station', 'name': 'Synthetic urban terminal',
             'operator': 'سازمان اتوبوسرانی مشهد'}, 'geometry': [
                 {'lat': 36.3, 'lon': 59.6}, {'lat': 36.3, 'lon': 59.61},
                 {'lat': 36.31, 'lon': 59.61}, {'lat': 36.3, 'lon': 59.6}]},
            {'type': 'node', 'id': 303, 'lat': 36.4, 'lon': 59.7,
             'tags': {'amenity': 'bus_station', 'name': 'Synthetic unknown facility'}},
        ])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(osm, {}, path)
            with closing(sqlite3.connect(path)) as db, db:
                self.assertEqual(db.execute('SELECT name FROM stops WHERE id=?', ('osm:node:301',)).fetchone(),
                                 ('Synthetic unlinked stop',))
                self.assertEqual(db.execute('SELECT scope_quality FROM facilities WHERE id=?',
                                            ('osm:node:303',)).fetchone(), ('unclassified_not_confirmed_urban',))
                row = db.execute('SELECT scope_quality,geometry_json FROM facilities WHERE id=?',
                                 ('osm:way:302',)).fetchone()
                self.assertEqual(row[0], 'municipal_operator_tag')
                self.assertEqual(json.loads(row[1])['type'], 'Polygon')


    def test_route_geometry_keeps_disconnected_source_segments_separate(self):
        module = importer(self)
        osm = sample()
        osm['elements'].insert(0, {'type': 'way', 'id': 101, 'tags': {'highway': 'residential'},
            'geometry': [{'lat': 36.4, 'lon': 59.7}, {'lat': 36.41, 'lon': 59.71}]})
        osm['elements'][-1]['members'].append({'type': 'way', 'ref': 101, 'role': ''})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(osm, {}, path)
            with closing(sqlite3.connect(path)) as db, db:
                tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertIn('route_geometry', tables)
                rows = db.execute('SELECT way_id,geometry_json FROM route_geometry ORDER BY member_index').fetchall()
                self.assertEqual([r[0] for r in rows], ['osm:way:100', 'osm:way:101'])
                self.assertEqual(json.loads(rows[1][1])['coordinates'], [[59.7, 36.4], [59.71, 36.41]])


    def test_platform_refs_are_evidence_not_invented_operating_lines(self):
        module = importer(self)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(sample(), {}, path)
            with closing(sqlite3.connect(path)) as db, db:
                tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertIn('platforms', tables)
                self.assertEqual(db.execute('SELECT ref_raw FROM observed_route_refs ORDER BY ordinal').fetchall(),
                                 [('T1',), (' T2',)])
                self.assertEqual(db.execute('SELECT ref_lookup FROM observed_route_refs ORDER BY ordinal').fetchall(),
                                 [('T1',), ('T2',)])
                self.assertEqual(db.execute('SELECT ref_raw FROM lines').fetchall(), [('T1',)])
                self.assertEqual(db.execute('SELECT platform_id FROM route_platforms').fetchall(), [('osm:node:21',)])


    def test_incomplete_routes_are_retained_with_auditable_issues(self):
        module = importer(self)
        osm = sample()
        osm['elements'][-1]['members'] = [
            {'type': 'node', 'ref': 11, 'role': 'stop'},
            {'type': 'node', 'ref': 404, 'role': 'stop'}]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(osm, {}, path)
            with closing(sqlite3.connect(path)) as db, db:
                tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertIn('issues', tables)
                self.assertEqual(db.execute('SELECT count(*) FROM routes').fetchone()[0], 1)
                codes = {r[0] for r in db.execute('SELECT code FROM issues')}
                self.assertTrue({'missing_member', 'fewer_than_two_stops', 'no_road_geometry'} <= codes)
                endpoints = db.execute('SELECT endpoint,name_raw FROM route_endpoints ORDER BY endpoint').fetchall()
                self.assertEqual(endpoints, [('from', 'Synthetic stop A'), ('to', 'Synthetic stop A')])


    def test_route_master_ref_conflict_is_preserved_not_used_to_rename_routes(self):
        module = importer(self)
        osm = sample()
        osm['elements'].append({'type': 'relation', 'id': 601,
            'tags': {'type': 'route_master', 'route_master': 'bus', 'ref': 'DIFFERENT'},
            'members': [{'type': 'relation', 'ref': 501, 'role': ''}]})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(osm, {}, path)
            with closing(sqlite3.connect(path)) as db, db:
                tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertIn('route_masters', tables)
                self.assertEqual(db.execute('SELECT ref_raw FROM routes').fetchall(), [('T1',)])
                self.assertEqual(db.execute('SELECT ref_raw FROM route_masters').fetchall(), [('DIFFERENT',)])
                self.assertIn('master_child_ref_conflict', {r[0] for r in db.execute('SELECT code FROM issues')})


    def test_cli_builds_a_real_database_and_counted_csv_json_geojson_exports(self):
        import gzip
        import hashlib
        import subprocess
        module = importer(self)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = json.dumps(sample()).encode()
            (root / 'input.json.gz').write_bytes(gzip.compress(raw, mtime=0))
            (root / 'source.json').write_text(json.dumps({'sha256': hashlib.sha256(raw).hexdigest(),
                'retrieved_at': '2026-10-29T00:01:00Z', 'url': 'https://example.invalid/synthetic'}))
            result = subprocess.run([sys.executable, str(SCRIPT), '--input', str(root / 'input.json.gz'),
                '--source', str(root / 'source.json'), '--db', str(root / 'bus.sqlite'), '--out', str(root / 'exports')],
                capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((root / 'bus.sqlite').is_file(), 'CLI must build the database, not just exit successfully')
            report = json.loads((root / 'exports' / 'summary.json').read_text())
            self.assertEqual(report['counts']['routes'], 1)
            self.assertIsNone(report['official_current_line_count'])
            self.assertFalse(report['official_completeness_verified'])
            self.assertEqual(len(json.loads((root / 'exports' / 'routes.geojson').read_text())['features']), 1)
            self.assertTrue((root / 'exports' / 'route_stops.csv').is_file())
            source = json.loads((root / 'source.json').read_text())
            source['sha256'] = '0' * 64
            (root / 'source.json').write_text(json.dumps(source))
            original = (root / 'bus.sqlite').read_bytes()
            bad = subprocess.run([sys.executable, str(SCRIPT), '--input', str(root / 'input.json.gz'),
                '--source', str(root / 'source.json'), '--db', str(root / 'bus.sqlite'), '--out', str(root / 'exports')],
                capture_output=True, text=True)
            self.assertNotEqual(bad.returncode, 0)
            self.assertIn('hash', bad.stderr.lower())
            self.assertEqual((root / 'bus.sqlite').read_bytes(), original)


    def test_human_readable_inventory_distinguishes_lines_variants_and_unverified_ref_hints(self):
        module = importer(self)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(sample(), {}, path)
            with closing(sqlite3.connect(path)) as db, db:
                views = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='view'")}
                self.assertIn('line_inventory', views)
                self.assertEqual(db.execute('SELECT ref_raw,variant_count FROM line_inventory').fetchall(), [('T1', 1)])
                self.assertEqual(db.execute('SELECT ref_lookup FROM route_ref_hints_without_geometry').fetchall(), [('T2',)])
                self.assertEqual(db.execute('SELECT stop_count FROM route_inventory').fetchone()[0], 3)


    def test_empty_city_query_cannot_destroy_a_populated_database(self):
        module = importer(self)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(sample(), {}, path)
            original = path.read_bytes()
            with self.assertRaisesRegex(ValueError, 'No eligible bus routes'):
                module.build_catalog({'elements': []}, {}, path)
            self.assertEqual(path.read_bytes(), original)


    def test_missing_nonstop_members_and_broken_way_geometry_are_not_silently_hidden(self):
        module = importer(self)
        osm = sample()
        osm['elements'][3]['geometry'].insert(1, None)
        osm['elements'][-1]['members'].extend([
            {'type': 'way', 'ref': 404, 'role': ''},
            {'type': 'node', 'ref': 405, 'role': 'platform'}])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(osm, {}, path)
            with closing(sqlite3.connect(path)) as db, db:
                self.assertEqual(db.execute("SELECT count(*) FROM issues WHERE code='missing_member'").fetchone()[0], 2)
                self.assertEqual(db.execute('SELECT count(*) FROM route_geometry').fetchone()[0], 0,
                                 'Missing geometry cannot be bridged with a fabricated line segment')
                self.assertIn('invalid_or_missing_way_geometry', {r[0] for r in db.execute('SELECT code FROM issues')})


    def test_historical_catalogues_remain_queryable_quarantine_without_promoting_operating_lines(self):
        import inspect
        module = importer(self)
        self.assertIn('reference_rows', inspect.signature(module.build_catalog).parameters)
        rows = [{'source_id': 'synthetic_catalogue', 'source_url': 'https://example.invalid/history',
                 'route_ref_raw': '01/2', 'origin': 'Synthetic old origin', 'destination': 'Synthetic old terminal',
                 'corridor_raw': 'Synthetic corridor', 'classification': 'current_verified'}]
        refs = [{'source_id': 'synthetic_pdf', 'source_url': 'https://example.invalid/history.pdf',
                 'route_ref_raw': '۳/۴', 'page': 3, 'bbox': {'xMin': '1', 'yMin': '2', 'xMax': '3', 'yMax': '4'}}]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(sample(), {}, path, reference_rows=rows, historical_refs=refs)
            with closing(sqlite3.connect(path)) as db, db:
                self.assertEqual(db.execute('SELECT ref_raw FROM lines').fetchall(), [('T1',)])
                self.assertEqual(db.execute('SELECT ref_raw,quality FROM reference_route_records').fetchone(),
                                 ('01/2', 'research_only_not_current_verified'))
                self.assertEqual(db.execute('SELECT ref_raw,page FROM reference_pdf_mentions').fetchone(), ('۳/۴', 3))
                self.assertEqual(db.execute('SELECT count(*) FROM arrival_observations').fetchone()[0], 0)


    def test_geometry_rejects_nonfinite_out_of_range_or_boolean_coordinates(self):
        module = importer(self)
        for lat, lon in [(float('nan'), 59.6), (36.3, float('inf')), (91, 59.6), (36.3, 181), (True, 59.6)]:
            with self.subTest(lat=lat, lon=lon):
                self.assertIsNone(module.geometry({'type': 'node', 'id': 1, 'lat': lat, 'lon': lon}))
                self.assertIsNone(module.geometry({'type': 'way', 'id': 2, 'geometry': [
                    {'lat': 36.3, 'lon': 59.6}, {'lat': lat, 'lon': lon}]}))


    def test_unresolved_route_master_members_are_preserved_and_flagged(self):
        module = importer(self)
        osm = sample()
        osm['elements'].append({'type': 'relation', 'id': 601,
            'tags': {'route_master': 'bus', 'ref': 'T1'},
            'members': [{'type': 'relation', 'ref': 404, 'role': ''}]})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bus.sqlite'
            module.build_catalog(osm, {}, path)
            with closing(sqlite3.connect(path)) as db, db:
                self.assertEqual(db.execute('SELECT element_id FROM route_master_members').fetchone()[0], 'osm:relation:404')
                self.assertIn('missing_master_member', {r[0] for r in db.execute('SELECT code FROM issues')})


if __name__ == '__main__':
    unittest.main()
