#!/usr/bin/env python3
"""Deterministic source-only C1 extraction; creates no routes or connectors."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path

SOURCE_ID = 'overpass-de-c1-01'
STATIONS = {'METRO-107': (3156528, 5162609074), 'METRO-108': (3156522, 5162609068)}
# Owner-proposed public endpoints are existing shared OSM nodes, not interpolated positions.
POINTS = [('d1:point:A', 'METRO-107', 7033302509, 1030590026, 531913241),
          ('d1:point:B', 'METRO-108', 5162609067, 1030590123, 531913236)]
TAG_KEYS = ['highway', 'foot', 'foot:conditional', 'access', 'access:conditional', 'barrier',
            'sidewalk', 'crossing', 'crossing:signals', 'surface', 'smoothness', 'lit', 'wheelchair',
            'level', 'layer', 'bridge', 'tunnel', 'indoor', 'opening_hours', 'oneway:foot',
            'incline', 'ramp', 'width', 'step_count', 'railway', 'public_transport', 'name', 'ref']


def osm_id(kind, number):
    return f'osm:{kind}:{number}'


def meters(a, b):
    """Spherical two-dimensional polyline length; not surveyed precision or walk time."""
    p1, p2 = map(math.radians, [a['lat'], b['lat']])
    dp, dl = p2 - p1, math.radians(b['lon'] - a['lon'])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    h = min(1.0, max(0.0, h))
    return 6371008.8 * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def derive(package, network_path):
    package = Path(package)
    record = json.loads((package / f'raw/{SOURCE_ID}.request.json').read_text())
    raw = (package / record['bodyPath']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != record['sha256']:
        raise ValueError('Raw snapshot checksum mismatch')
    payload = json.loads(raw)
    if (not record['fetchSucceeded'] or record['httpStatus'] != 200
            or not record['useAsGeometryEvidence'] or payload.get('remark')):
        raise ValueError('Incomplete or failed source cannot establish an empty or valid network')
    elements = payload['elements']
    index = {(e['type'], e['id']): e for e in elements}
    if len(index) != len(elements):
        raise ValueError('Duplicate source object identity')
    nodes = {e['id']: e for e in elements if e['type'] == 'node'}
    ways = [e for e in elements if e['type'] == 'way']
    highways = [e for e in ways if 'highway' in e.get('tags', {})]
    highway_nodes = {nid for e in highways for nid in e['nodes']}
    network = json.loads(Path(network_path).read_text())
    registry = {s['id']: s for s in network['stations']}
    entrances_by_station, entrances, platforms, discrepancies = {}, [], [], []
    for station_id, (relation_id, station_node_id) in STATIONS.items():
        relation = index[('relation', relation_id)]
        entrances_by_station[station_id] = []
        station_node = nodes[station_node_id]
        discrepancies.append({'stationId': station_id, 'registryLat': registry[station_id]['lat'],
                              'registryLon': registry[station_id]['lon'], 'osmStationNodeId': osm_id('node', station_node_id),
                              'osmLat': station_node['lat'], 'osmLon': station_node['lon'],
                              'separationMeters2D': round(meters(registry[station_id], station_node), 3),
                              'interpretation': 'Different source positions/possibly roles; not proof either source is wrong. Baseline unchanged; not snapped.'})
        for member in relation['members']:
            obj = index[(member['type'], member['ref'])]
            tags = obj.get('tags', {})
            if member['type'] == 'node' and tags.get('railway') == 'subway_entrance':
                eid = osm_id('node', obj['id'])
                entrances_by_station[station_id].append(eid)
                entrances.append({'id': eid, 'entranceId': eid, 'stationId': station_id,
                                  'sourceId': SOURCE_ID, 'sourceVersion': obj['version'],
                                  'sourceLastEditedAt': obj['timestamp'], 'observedAt': None,
                                  'lat': obj['lat'], 'lon': obj['lon'], 'crs': 'EPSG:4326',
                                  'accuracyMeters': None, 'sourceTags': tags,
                                  'stopAreaId': osm_id('relation', relation_id),
                                  'memberRole': member['role'],
                                  'stationAssociation': 'Reviewed name correlation to registry plus explicit OSM stop_area membership; not operator validation',
                                  'assurance': 'public_source_claim', 'fieldVerification': 'unverified',
                                  'directionalPlatformId': None,
                                  'connectedHighwayWayIds': [osm_id('way', w['id']) for w in highways if obj['id'] in w['nodes']],
                                  'physicalAccessStatus': 'undetermined'})
            if member['type'] == 'way' and tags.get('railway') == 'platform':
                platforms.append({'id': osm_id('way', obj['id']), 'platformId': osm_id('way', obj['id']),
                                  'stationId': station_id, 'sourceId': SOURCE_ID,
                                  'sourceVersion': obj['version'], 'sourceLastEditedAt': obj['timestamp'],
                                  'direction': None, 'level': tags.get('level'), 'sourceTags': tags,
                                  'nodeIds': [osm_id('node', nid) for nid in obj['nodes']],
                                  'sharedHighwayNodeIds': [osm_id('node', nid) for nid in sorted(set(obj['nodes']) & highway_nodes)],
                                  'assurance': 'public_source_claim_not_physical_connection'})
    points, candidates = [], []
    for point_id, station_id, nid, entrance_nid, way_id in POINTS:
        node = nodes[nid]
        way = index[('way', way_id)]
        if way['nodes'][0] != nid or way['nodes'][-1] != entrance_nid:
            raise ValueError('Expected mapped outdoor path boundaries changed; do not repair by snapping')
        points.append({'id': point_id, 'stationId': station_id, 'sourceNodeId': osm_id('node', nid),
                       'sourceId': SOURCE_ID, 'sourceVersion': node['version'],
                       'sourceLastEditedAt': node['timestamp'], 'observedAt': None,
                       'lat': node['lat'], 'lon': node['lon'], 'crs': 'EPSG:4326',
                       'accuracyMeters': None, 'fieldVerification': 'unverified',
                       'assurance': 'public_source_geometry_not_field_survey',
                       'boundary': f'Exact mapped shared node of osm:way:752623414 (foot=yes) and osm:way:{way_id}; proposed standing start/end, not a station center or private address',
                       'standingSpaceVerified': False})
        candidates.append({'id': f'd1:outdoor:{station_id}', 'pointId': point_id,
                           'entranceId': osm_id('node', entrance_nid), 'sourceWayId': osm_id('way', way_id),
                           'sourceId': SOURCE_ID, 'stationId': station_id,
                           'nodeIds': [osm_id('node', number) for number in way['nodes']],
                           'sourceTags': way.get('tags', {}),
                           'lengthMeters2DFromSourceGeometry': round(sum(meters(nodes[a], nodes[b]) for a, b in zip(way['nodes'], way['nodes'][1:])), 3),
                           'lengthMethod': 'Spherical polyline from exact source node coordinates, mean radius6371008.8m; approximate geometry length, unknown source positional error. Not an air-distance walk proxy.',
                           'mappedTopology': 'pass', 'physicalPassability': 'undetermined',
                           'permittedDirections': 'unknown', 'barrier': 'unknown',
                           'surface': None, 'levels': [None, None],
                           'timing': {'seconds': None, 'method': None, 'sourceIds': []}})
    return {'schemaVersion': 1, 'packageVersion': 'r2bd1-c1-v1', 'sourceId': SOURCE_ID,
            'sourceSha256': record['sha256'], 'sourceSnapshotAt': record['snapshotAt'],
            'sourceRetrievedAt': record['retrievedAt'],
            'crs': 'EPSG:4326', 'coordinateAccuracyMeters': None,
            'counts': {'elements': len(elements), 'types': dict(sorted(Counter(e['type'] for e in elements).items())),
                       'highwayWays': len(highways), 'entrances': len(entrances), 'railwayPlatformWays': len(platforms)},
            'tagCounts': {key: dict(sorted(Counter(e.get('tags', {})[key] for e in elements if key in e.get('tags', {})).items())) for key in TAG_KEYS},
            'entrancesByStation': entrances_by_station, 'entrances': sorted(entrances, key=lambda e:e['id']),
            'platforms': sorted(platforms, key=lambda e:e['id']), 'publicPoints': points,
            'outdoorCandidates': candidates, 'registryDisagreements': discrepancies,
            'railPlatformDefinitionMissingFor': ['METRO-107'],
            'artificialConnectorsCreated': False, 'physicalPassabilityCertified': False,
            'importantDistinctions': ['OSM source last-edit timestamps are not field observation times.',
                                     'Stop-area membership groups objects, but does not assert a walkable connection or directional platform access.',
                                     'A station underpass may only cross a road; its existence is not evidence of a platform branch.',
                                     'No source coordinate is silently substituted into network.json.',
                                     'Fresh download does not make an old or unobserved feature physically verified.']}


def geometry(package, derivation):
    package = Path(package)
    payload = json.loads((package / f'raw/{SOURCE_ID}.body').read_bytes())
    index = {(e['type'], e['id']): e for e in payload['elements']}
    features = []
    for e in payload['elements']:
        tags = e.get('tags', {})
        if e['type'] == 'way' and ('highway' in tags or tags.get('railway') == 'platform'):
            coordinates = [[index[('node', n)]['lon'], index[('node', n)]['lat']] for n in e['nodes']]
            features.append({'type': 'Feature', 'id': osm_id('way', e['id']),
                             'properties': {'sourceId': SOURCE_ID, 'sourceVersion': e['version'],
                                            'tags': {k:v for k,v in tags.items() if k in TAG_KEYS},
                                            'nodeIds': [osm_id('node', n) for n in e['nodes']],
                                            'assurance': 'source_geometry_only_not_validated_route'},
                             'geometry': {'type': 'LineString', 'coordinates': coordinates}})
    for entrance in derivation['entrances']:
        features.append({'type': 'Feature', 'id': entrance['id'], 'properties': entrance,
                         'geometry': {'type': 'Point', 'coordinates': [entrance['lon'], entrance['lat']]}})
    return {'type': 'FeatureCollection', 'name': 'C1 acquired source geometry, not a routing graph', 'features': features}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('package')
    parser.add_argument('--network', default='data/network.json')
    args = parser.parse_args()
    package = Path(args.package)
    result = derive(package, Path(args.network))
    derived = package / 'derived'
    derived.mkdir(exist_ok=True)
    (derived / 'c1-source-topology.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    (derived / 'c1-source-geometry.geojson').write_text(json.dumps(geometry(package, result), ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result['counts'], indent=2))
