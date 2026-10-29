#!/usr/bin/env python3
"""Build an offline, provenance-aware Mashhad bus catalogue from OSM JSON.

This module is not connected to the live app or timing engine.
"""
import json
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import tempfile


SCHEMA = '''
CREATE TABLE metadata (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE reference_sources (id TEXT PRIMARY KEY, url TEXT NOT NULL);
CREATE TABLE reference_route_records (
    source_id TEXT REFERENCES reference_sources(id), ordinal INTEGER,
    ref_raw TEXT NOT NULL, origin_raw TEXT, destination_raw TEXT, corridor_raw TEXT,
    row_json TEXT NOT NULL,
    quality TEXT NOT NULL DEFAULT 'research_only_not_current_verified' CHECK(quality='research_only_not_current_verified'),
    PRIMARY KEY(source_id, ordinal)
);
CREATE TABLE reference_pdf_mentions (
    source_id TEXT REFERENCES reference_sources(id), ordinal INTEGER,
    ref_raw TEXT NOT NULL, page INTEGER, bbox_json TEXT, row_json TEXT NOT NULL,
    quality TEXT NOT NULL DEFAULT 'research_only_not_current_verified' CHECK(quality='research_only_not_current_verified'),
    PRIMARY KEY(source_id, ordinal)
);
CREATE TABLE excluded_routes (id TEXT PRIMARY KEY, reason TEXT NOT NULL, tags_json TEXT NOT NULL);
CREATE TABLE issues (id INTEGER PRIMARY KEY, entity_id TEXT, code TEXT NOT NULL, detail_json TEXT NOT NULL);
CREATE TABLE lines (
    id TEXT PRIMARY KEY, ref_raw TEXT NOT NULL UNIQUE,
    quality TEXT NOT NULL DEFAULT 'osm_unverified'
);
CREATE TABLE route_masters (id TEXT PRIMARY KEY, ref_raw TEXT, name TEXT, tags_json TEXT NOT NULL);
CREATE TABLE route_master_members (
    master_id TEXT REFERENCES route_masters(id), member_index INTEGER,
    element_id TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(master_id, member_index)
);
CREATE TABLE routes (
    id TEXT PRIMARY KEY, ref_raw TEXT, name TEXT,
    line_id TEXT REFERENCES lines(id),
    operator TEXT, scope_quality TEXT NOT NULL DEFAULT 'operator_unverified',
    from_name TEXT, to_name TEXT, tags_json TEXT NOT NULL,
    headway_min REAL CHECK(headway_min IS NULL),
    timing_quality TEXT NOT NULL DEFAULT 'unknown' CHECK(timing_quality = 'unknown')
);
CREATE TABLE arrival_observations (
    provider TEXT NOT NULL, provider_stop_id TEXT NOT NULL,
    observed_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    route_ref_raw TEXT, arrival_at TEXT, minutes REAL,
    source_url TEXT NOT NULL, raw_response_sha256 TEXT NOT NULL,
    quality TEXT NOT NULL CHECK(quality IN ('live','provider_estimate','stale'))
);
CREATE TABLE stops (
    id TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, tags_json TEXT NOT NULL, ref_raw TEXT
);
CREATE TABLE platforms (
    id TEXT PRIMARY KEY, name TEXT, geometry_json TEXT, tags_json TEXT NOT NULL,
    evidence TEXT NOT NULL
);
CREATE TABLE observed_route_refs (
    platform_id TEXT REFERENCES platforms(id), ordinal INTEGER, ref_raw TEXT NOT NULL, ref_lookup TEXT NOT NULL,
    quality TEXT NOT NULL DEFAULT 'osm_route_ref_not_operating_proof',
    PRIMARY KEY(platform_id, ordinal)
);
CREATE TABLE route_platforms (
    route_id TEXT REFERENCES routes(id), member_index INTEGER,
    platform_id TEXT REFERENCES platforms(id), role TEXT NOT NULL,
    PRIMARY KEY(route_id, member_index)
);
CREATE TABLE facilities (
    id TEXT PRIMARY KEY, name TEXT, operator TEXT, scope_quality TEXT NOT NULL,
    geometry_json TEXT, tags_json TEXT NOT NULL
);
CREATE TABLE stop_refs (
    stop_id TEXT REFERENCES stops(id), ordinal INTEGER,
    ref_raw TEXT NOT NULL, ref_lookup TEXT NOT NULL, quality TEXT NOT NULL DEFAULT 'osm_tag_not_provider_verified',
    PRIMARY KEY(stop_id, ordinal)
);
CREATE TABLE external_stop_mappings (
    provider TEXT NOT NULL, provider_stop_id TEXT NOT NULL,
    stop_id TEXT NOT NULL REFERENCES stops(id),
    verified_at TEXT NOT NULL, evidence_url TEXT NOT NULL,
    PRIMARY KEY(provider, provider_stop_id)
);
CREATE TABLE route_members (
    route_id TEXT REFERENCES routes(id), member_index INTEGER,
    element_id TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(route_id, member_index)
);
CREATE TABLE route_geometry (
    route_id TEXT REFERENCES routes(id), member_index INTEGER,
    way_id TEXT NOT NULL, role TEXT NOT NULL, geometry_json TEXT NOT NULL,
    PRIMARY KEY(route_id, member_index)
);
CREATE TABLE route_stops (
    route_id TEXT REFERENCES routes(id), sequence INTEGER,
    stop_id TEXT REFERENCES stops(id), member_index INTEGER,
    PRIMARY KEY(route_id, sequence)
);
CREATE INDEX route_stops_stop ON route_stops(stop_id);
CREATE INDEX stop_refs_lookup ON stop_refs(ref_lookup);
CREATE INDEX observed_refs_lookup ON observed_route_refs(ref_lookup);
CREATE VIEW route_endpoints AS
    SELECT id AS route_id,'from' AS endpoint,from_name AS name_raw FROM routes
    UNION ALL SELECT id,'to',to_name FROM routes;
CREATE VIEW terminal_route_candidates AS
    SELECT r.route_id,r.endpoint,r.name_raw,f.id AS facility_id,
           'exact_name_candidate_not_verified' AS quality
    FROM route_endpoints r JOIN facilities f ON f.name = r.name_raw;
CREATE VIEW line_inventory AS
    SELECT l.id,l.ref_raw,count(r.id) AS variant_count,
           group_concat(DISTINCT r.from_name) AS origins_raw,
           group_concat(DISTINCT r.to_name) AS destinations_raw,
           'osm_unverified_not_current_operator_census' AS quality
    FROM lines l JOIN routes r ON r.line_id=l.id GROUP BY l.id;
CREATE VIEW route_inventory AS
    SELECT r.id,r.ref_raw,r.name,r.from_name,r.to_name,r.operator,r.scope_quality,
           (SELECT count(*) FROM route_stops s WHERE s.route_id=r.id) AS stop_count,
           (SELECT count(*) FROM route_platforms p WHERE p.route_id=r.id) AS platform_count,
           (SELECT count(*) FROM route_geometry g WHERE g.route_id=r.id) AS geometry_segment_count,
           r.headway_min,r.timing_quality
    FROM routes r;
CREATE VIEW stop_inventory AS
    SELECT s.id,s.name,s.lat,s.lon,
           s.ref_raw AS refs_raw,
           (SELECT group_concat(ref_lookup,'; ') FROM stop_refs x WHERE x.stop_id=s.id) AS refs_lookup,
           (SELECT count(DISTINCT route_id) FROM route_stops x WHERE x.stop_id=s.id) AS variant_count,
           'osm_element_not_guaranteed_distinct_physical_stop' AS quality
    FROM stops s;
CREATE VIEW municipal_terminal_candidates AS
    SELECT id,name,operator,scope_quality,geometry_json FROM facilities
    WHERE scope_quality='municipal_operator_tag';
CREATE VIEW route_ref_hints_without_geometry AS
    SELECT ref_lookup,group_concat(DISTINCT ref_raw) AS raw_token_variants,count(DISTINCT platform_id) AS observed_platform_count,
           'hint_only_not_operating_proof_may_include_malformed_refs' AS quality
    FROM observed_route_refs WHERE ref_lookup NOT IN (SELECT ref_raw FROM lines) GROUP BY ref_lookup;
'''


def element_id(element):
    return f"osm:{element['type']}:{element['id']}"


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


MUNICIPAL_OPERATORS = {'سازمان اتوبوسرانی مشهد', 'سازمان اتوبوسرانی شهرداری مشهد'}


def valid_point(lat, lon):
    # Bounds also reject NaN/infinity; booleans are not numeric coordinates.
    return (isinstance(lat, (int, float)) and not isinstance(lat, bool)
            and isinstance(lon, (int, float)) and not isinstance(lon, bool)
            and -90 <= lat <= 90 and -180 <= lon <= 180)


def geometry(element):
    """Return literal source geometry; never bridge disconnected pieces."""
    if element['type'] == 'node':
        if valid_point(element.get('lat'), element.get('lon')):
            return {'type': 'Point', 'coordinates': [element['lon'], element['lat']]}
        return None
    if any(not isinstance(p, dict) or not valid_point(p.get('lat'), p.get('lon'))
           for p in element.get('geometry', [])):
        return None
    points = [[p['lon'], p['lat']] for p in element.get('geometry', [])
              if p is not None and 'lat' in p and 'lon' in p]
    if len(points) >= 2:
        if len(points) >= 4 and points[0] == points[-1] and element.get('tags', {}).get('amenity') == 'bus_station':
            return {'type': 'Polygon', 'coordinates': [points]}
        return {'type': 'LineString', 'coordinates': points}
    geometries = []
    for member in element.get('members', []):
        member_geometry = geometry({'id': member['ref'], 'type': member['type'], **member})
        if member_geometry:
            geometries.append(member_geometry)
    return {'type': 'GeometryCollection', 'geometries': geometries} if geometries else None


def insert_stop(db, item):
    tags = item.get('tags', {})
    point = geometry(item)
    coords = point['coordinates'] if point and point['type'] == 'Point' else [None, None]
    sid = element_id(item)
    db.execute('INSERT OR IGNORE INTO stops VALUES (?,?,?,?,?,?)',
               (sid, tags.get('name'), coords[1], coords[0], encoded(tags), tags.get('ref')))
    for ordinal, raw_ref in enumerate(tags.get('ref', '').split(';')):
        if raw_ref.strip():
            db.execute('INSERT OR IGNORE INTO stop_refs (stop_id,ordinal,ref_raw,ref_lookup) VALUES (?,?,?,?)',
                       (sid, ordinal, raw_ref, raw_ref.strip()))


def audit_catalog(db, elements):
    def issue(entity, code, detail):
        db.execute('INSERT INTO issues (entity_id,code,detail_json) VALUES (?,?,?)',
                   (entity, code, encoded(detail)))
    for rid, in db.execute('SELECT id FROM routes').fetchall():
        stops = db.execute('SELECT count(*) FROM route_stops WHERE route_id=?', (rid,)).fetchone()[0]
        segments = db.execute('SELECT count(*) FROM route_geometry WHERE route_id=?', (rid,)).fetchone()[0]
        if stops < 2:
            issue(rid, 'fewer_than_two_stops', {'stop_members': stops})
        if not segments:
            issue(rid, 'no_road_geometry', {})
    for sid, in db.execute('SELECT id FROM stops WHERE lat IS NULL OR lon IS NULL').fetchall():
        issue(sid, 'missing_coordinates', {})
    for ref, in db.execute('SELECT ref_lookup FROM stop_refs GROUP BY ref_lookup HAVING count(DISTINCT stop_id)>1').fetchall():
        ids = [r[0] for r in db.execute('SELECT DISTINCT stop_id FROM stop_refs WHERE ref_lookup=? ORDER BY stop_id', (ref,))]
        issue(None, 'ambiguous_stop_ref_not_provider_id', {'ref_lookup': ref, 'stop_ids': ids})
    fingerprints = {}
    for rid, ref in db.execute('SELECT id,ref_raw FROM routes ORDER BY id').fetchall():
        members = db.execute('SELECT element_id,role FROM route_members WHERE route_id=? ORDER BY member_index', (rid,)).fetchall()
        signature = encoded([ref, members])
        if signature in fingerprints:
            issue(rid, 'identical_variant_preserved', {'other_route_id': fingerprints[signature]})
        else:
            fingerprints[signature] = rid
        for element, role in members:
            if element.startswith('osm:relation:'):
                item = elements.get(('relation', int(element.rsplit(':', 1)[1])))
                if item and item.get('tags', {}).get('route') != 'bus':
                    issue(rid, 'non_bus_relation_member', {'element_id': element, 'role': role})


def import_reference_records(db, rows, pdf_mentions):
    """Quarantine published catalogue facts; never promote them into routes/lines."""
    for kind, records in [('table', rows), ('pdf', pdf_mentions)]:
        for ordinal, row in enumerate(records):
            sid, url = row['source_id'], row['source_url']
            existing = db.execute('SELECT url FROM reference_sources WHERE id=?', (sid,)).fetchone()
            if existing and existing[0] != url:
                raise ValueError('Reference source id has conflicting URLs: ' + str(sid))
            db.execute('INSERT OR IGNORE INTO reference_sources VALUES (?,?)', (sid, url))
            if kind == 'table':
                db.execute('''INSERT INTO reference_route_records
                    (source_id,ordinal,ref_raw,origin_raw,destination_raw,corridor_raw,row_json)
                    VALUES (?,?,?,?,?,?,?)''', (sid, ordinal, row['route_ref_raw'], row.get('origin'),
                    row.get('destination'), row.get('corridor_raw'), encoded(row)))
            else:
                db.execute('''INSERT INTO reference_pdf_mentions
                    (source_id,ordinal,ref_raw,page,bbox_json,row_json) VALUES (?,?,?,?,?,?)''',
                    (sid, ordinal, row['route_ref_raw'], row.get('page'), encoded(row.get('bbox')), encoded(row)))


def build_catalog(osm, source, db_path, *, reference_rows=None, historical_refs=None):
    """Build atomically; preserve stop-member order including circular repeats."""
    if osm.get('remark'):
        raise ValueError('Partial Overpass response with remark: ' + str(osm['remark']))
    if not isinstance(osm.get('elements'), list):
        raise ValueError('Overpass response must contain an elements array')
    if not any(e.get('type') == 'relation' and e.get('tags', {}).get('route') == 'bus'
               and (not e.get('tags', {}).get('operator') or e['tags']['operator'] in MUNICIPAL_OPERATORS)
               for e in osm['elements']):
        raise ValueError('No eligible bus routes; refusing to replace the catalogue')
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    elements = {(e['type'], e['id']): e for e in osm['elements']}
    platform_members = {(m['type'], m['ref']) for e in elements.values()
                        if e['type'] == 'relation' and e.get('tags', {}).get('route') == 'bus'
                        for m in e.get('members', []) if m.get('role', '').startswith('platform')}
    fd, temporary = tempfile.mkstemp(prefix='.bus-build-', suffix='.sqlite', dir=db_path.parent)
    os.close(fd)
    try:
        with closing(sqlite3.connect(temporary)) as db, db:
            db.execute('PRAGMA foreign_keys=ON')
            db.executescript(SCHEMA)
            for key, value in {'source': source, 'osm_base': osm.get('osm3s', {}).get('timestamp_osm_base'),
                               'official_completeness': 'not_verified', 'real_time': 'unavailable',
                               'schema_version': 1}.items():
                db.execute('INSERT INTO metadata VALUES (?,?)', (key, encoded(value)))
            for item in sorted(elements.values(), key=lambda e: (e['type'], e['id'])):
                tags = item.get('tags', {})
                if tags.get('highway') == 'bus_stop' or (tags.get('public_transport') == 'stop_position' and tags.get('bus') == 'yes'):
                    insert_stop(db, item)
                is_member_platform = (item['type'], item['id']) in platform_members
                if is_member_platform or (tags.get('public_transport') == 'platform' and
                                          (tags.get('bus') == 'yes' or tags.get('route_ref'))):
                    evidence = 'bus_route_member' if is_member_platform else 'bus_or_route_ref_tag'
                    db.execute('INSERT INTO platforms VALUES (?,?,?,?,?)',
                               (element_id(item), tags.get('name'), encoded(geometry(item)), encoded(tags), evidence))
                    for ordinal, raw_ref in enumerate(tags.get('route_ref', '').split(';')):
                        if raw_ref.strip():
                            db.execute('INSERT INTO observed_route_refs (platform_id,ordinal,ref_raw,ref_lookup) VALUES (?,?,?,?)',
                                       (element_id(item), ordinal, raw_ref, raw_ref.strip()))
                if tags.get('amenity') == 'bus_station' or (tags.get('public_transport') == 'station' and tags.get('bus') == 'yes'):
                    scope = 'municipal_operator_tag' if tags.get('operator') in MUNICIPAL_OPERATORS else 'unclassified_not_confirmed_urban'
                    db.execute('INSERT INTO facilities VALUES (?,?,?,?,?,?)',
                               (element_id(item), tags.get('name'), tags.get('operator'), scope,
                                encoded(geometry(item)), encoded(tags)))
            for route in sorted(elements.values(), key=lambda e: (e['type'], e['id'])):
                tags = route.get('tags', {})
                if route['type'] != 'relation' or tags.get('route') != 'bus':
                    continue
                rid = element_id(route)
                operator = tags.get('operator')
                if operator and operator not in MUNICIPAL_OPERATORS:
                    db.execute('INSERT INTO excluded_routes VALUES (?,?,?)',
                               (rid, 'explicit_non_municipal_operator', encoded(tags)))
                    continue
                ref = tags.get('ref')
                line_id = f'osm:ref:{ref}' if ref else None
                if line_id:
                    db.execute('INSERT OR IGNORE INTO lines (id,ref_raw) VALUES (?,?)', (line_id, ref))
                db.execute('INSERT INTO routes (id,ref_raw,name,line_id,from_name,to_name,tags_json) VALUES (?,?,?,?,?,?,?)',
                           (rid, ref, tags.get('name'), line_id, tags.get('from'), tags.get('to'), encoded(tags)))
                db.execute('UPDATE routes SET operator=?,scope_quality=? WHERE id=?',
                           (operator, 'municipal_operator_tag' if operator else 'operator_unverified', rid))
                sequence = 0
                for index, member in enumerate(route.get('members', [])):
                    key = (member['type'], member['ref'])
                    mid = f'osm:{key[0]}:{key[1]}'
                    role = member.get('role', '')
                    db.execute('INSERT INTO route_members VALUES (?,?,?,?)', (rid, index, mid, role))
                    item = elements.get(key)
                    if not item:
                        db.execute('INSERT INTO issues (entity_id,code,detail_json) VALUES (?,?,?)',
                                   (rid, 'missing_member', encoded(member)))
                        continue
                    if role.startswith('platform'):
                        db.execute('INSERT INTO route_platforms VALUES (?,?,?,?)', (rid, index, mid, role))
                    if item and member['type'] == 'way' and item.get('tags', {}).get('highway'):
                        shape = geometry(item)
                        if shape:
                            db.execute('INSERT INTO route_geometry VALUES (?,?,?,?,?)',
                                       (rid, index, mid, role, encoded(shape)))
                        else:
                            db.execute('INSERT INTO issues (entity_id,code,detail_json) VALUES (?,?,?)',
                                       (rid, 'invalid_or_missing_way_geometry', encoded({'member_index': index, 'way_id': mid})))
                    if role not in {'stop', 'stop_entry_only', 'stop_exit_only'}:
                        continue
                    insert_stop(db, item)
                    db.execute('INSERT INTO route_stops VALUES (?,?,?,?)', (rid, sequence, mid, index))
                    sequence += 1
            for master in sorted(elements.values(), key=lambda e: (e['type'], e['id'])):
                tags = master.get('tags', {})
                if master['type'] != 'relation' or tags.get('route_master') != 'bus':
                    continue
                mid = element_id(master)
                db.execute('INSERT INTO route_masters VALUES (?,?,?,?)',
                           (mid, tags.get('ref'), tags.get('name'), encoded(tags)))
                for index, member in enumerate(master.get('members', [])):
                    eid = f"osm:{member['type']}:{member['ref']}"
                    db.execute('INSERT INTO route_master_members VALUES (?,?,?,?)',
                               (mid, index, eid, member.get('role', '')))
                    if (member['type'], member['ref']) not in elements:
                        db.execute('INSERT INTO issues (entity_id,code,detail_json) VALUES (?,?,?)',
                                   (mid, 'missing_master_member', encoded({'member_index': index, **member})))
                    child = db.execute('SELECT ref_raw FROM routes WHERE id=?', (eid,)).fetchone()
                    if child and child[0] != tags.get('ref'):
                        db.execute('INSERT INTO issues (entity_id,code,detail_json) VALUES (?,?,?)',
                                   (mid, 'master_child_ref_conflict', encoded({'child_id': eid,
                                    'master_ref_raw': tags.get('ref'), 'child_ref_raw': child[0]})))
            import_reference_records(db, reference_rows or [], historical_refs or [])
            audit_catalog(db, elements)
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('SQLite integrity check failed')
            if db.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('SQLite foreign key check failed')
        os.replace(temporary, db_path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return db_path


def summarize(db):
    tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    counts = {name: db.execute('SELECT count(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0]
              for name in tables}
    unknown_refs = [row[0] for row in db.execute('''
        SELECT DISTINCT ref_lookup FROM observed_route_refs
        WHERE ref_lookup NOT IN (SELECT ref_raw FROM lines) ORDER BY ref_lookup
    ''')]
    return {
        'schema_version': 1,
        'official_completeness_verified': False,
        'official_current_line_count': None,
        'current_service_status': 'not_verified_with_operator',
        'real_time_arrivals_connected': False,
        'attribution': '© OpenStreetMap contributors',
        'license': 'ODbL-1.0',
        'counts': counts,
        'routes_with_municipal_operator_tag': db.execute(
            "SELECT count(*) FROM routes WHERE scope_quality='municipal_operator_tag'").fetchone()[0],
        'municipal_operator_tagged_facilities': db.execute(
            "SELECT count(*) FROM facilities WHERE scope_quality='municipal_operator_tag'").fetchone()[0],
        'stops_in_imported_routes': db.execute('SELECT count(DISTINCT stop_id) FROM route_stops').fetchone()[0],
        'stops_not_in_imported_routes': db.execute(
            'SELECT count(*) FROM stops WHERE id NOT IN (SELECT stop_id FROM route_stops)').fetchone()[0],
        'route_ref_tags_without_route_relation': unknown_refs,
        'issues_by_code': dict(db.execute('SELECT code,count(*) FROM issues GROUP BY code ORDER BY code')),
        'source': json.loads(db.execute("SELECT value_json FROM metadata WHERE key='source'").fetchone()[0]),
        'geometry_semantics': 'Source OSM way segments; not stitched, not proven trip traversal orientation.',
        'stop_order_semantics': 'Raw stop-member order per relation, including repeats; not operator verified.',
        'identifier_semantics': 'ref_raw preserves exact source tokens; ref_lookup trims separator whitespace only. Neither is a verified Neshan/municipality API identifier.',
        'integrity_check': db.execute('PRAGMA integrity_check').fetchone()[0],
        'foreign_key_violations': db.execute('PRAGMA foreign_key_check').fetchall(),
    }


def export_catalog(db_path, output):
    import csv
    import hashlib
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    snapshot = {}
    with closing(sqlite3.connect(Path(db_path).resolve().as_uri() + '?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        names = [r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")]
        for name in names:
            cursor = db.execute('SELECT * FROM "' + name.replace('"', '""') + '" ORDER BY 1,2')
            fields = [col[0] for col in cursor.description]
            rows = [dict(r) for r in cursor]
            snapshot[name] = rows
            with (output / f'{name}.csv').open('w', encoding='utf-8-sig', newline='') as file:
                writer = csv.DictWriter(file, fields, quoting=csv.QUOTE_ALL, lineterminator='\n')
                writer.writeheader()
                writer.writerows(rows)
        report = summarize(db)
        source = report['source']
        for category, table in [('stops', 'stops'), ('facilities', 'facilities'), ('routes', 'routes')]:
            features = []
            for row in snapshot[table]:
                props = {k: v for k, v in row.items() if k not in {'geometry_json', 'tags_json'}}
                if category == 'stops':
                    shape = {'type': 'Point', 'coordinates': [row['lon'], row['lat']]} if row['lat'] is not None and row['lon'] is not None else None
                elif category == 'facilities':
                    shape = json.loads(row['geometry_json'])
                else:
                    parts = [json.loads(r['geometry_json']) for r in db.execute(
                        'SELECT geometry_json FROM route_geometry WHERE route_id=? ORDER BY member_index', (row['id'],))]
                    segments = [p['coordinates'] for p in parts if p['type'] == 'LineString']
                    shape = {'type': 'MultiLineString', 'coordinates': segments} if segments else None
                    props['geometry_quality'] = 'source_way_segments_not_stitched_or_direction_verified'
                features.append({'type': 'Feature', 'id': row['id'], 'properties': props, 'geometry': shape})
            collection = {'type': 'FeatureCollection', 'attribution': report['attribution'],
                          'license': report['license'], 'source': source, 'features': features}
            (output / f'{category}.geojson').write_text(encoded(collection) + '\n', encoding='utf-8')
        (output / 'catalog.json').write_text(encoded(snapshot) + '\n', encoding='utf-8')
    report['database_sha256'] = hashlib.sha256(Path(db_path).read_bytes()).hexdigest()
    (output / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


def main():
    import argparse
    import gzip
    import hashlib
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path, help='Saved Overpass JSON or JSON.gz')
    parser.add_argument('--source', required=True, type=Path, help='Fetch metadata with raw JSON SHA-256')
    parser.add_argument('--reference-rows', type=Path, help='Quarantined supplementary route table JSON')
    parser.add_argument('--historical-refs', type=Path, help='Quarantined historical PDF reference mentions JSON')
    parser.add_argument('--db', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    try:
        content = args.input.read_bytes()
        raw = gzip.decompress(content) if args.input.suffix == '.gz' else content
        source = json.loads(args.source.read_text(encoding='utf-8'))
        actual_hash = hashlib.sha256(raw).hexdigest()
        if source.get('sha256') and source['sha256'] != actual_hash:
            raise ValueError('Source hash mismatch; refusing to replace the database')
        source['sha256'] = actual_hash
        reference_inputs = []
        records = {}
        for key, path in [('reference_rows', args.reference_rows), ('historical_refs', args.historical_refs)]:
            if path:
                data = path.read_bytes()
                records[key] = json.loads(data)
                if not isinstance(records[key], list):
                    raise ValueError('Reference input must be a list: ' + str(path))
                reference_inputs.append({'path': str(path), 'sha256': hashlib.sha256(data).hexdigest(), 'rows': len(records[key])})
        source['quarantined_reference_inputs'] = reference_inputs
        build_catalog(json.loads(raw), source, args.db, **records)
        report = export_catalog(args.db, args.out)
        print(json.dumps(report, ensure_ascii=False, indent=2))
    except (ValueError, OSError, sqlite3.DatabaseError) as exc:
        parser.exit(2, f'Bus catalogue error: {exc}\n')


if __name__ == '__main__':
    main()
