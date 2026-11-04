#!/usr/bin/env python3
"""Derive the C1 field-mission registry from D1 source facts; never hand-copied IDs.

Every station, entrance, public point and sign hint is read from the immutable
D1 topology and the unchanged network registry. The output is a collection
plan, not an observation, route edge or verified access claim.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
D1 = ROOT / 'data/geospatial/r2bd1-c1-v1'
OUT = ROOT / 'data/geospatial/r2bd2-c1-field-intake-v1/missions.json'
H7, DA = 'METRO-107', 'METRO-108'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(root=ROOT):
    root = Path(root)
    d1 = root / 'data/geospatial/r2bd1-c1-v1'
    topology_path = d1 / 'derived/c1-source-topology.json'
    network_path = root / 'data/network.json'
    topology = json.loads(topology_path.read_text())
    network = json.loads(network_path.read_text())
    stations = {s['id']: s for s in network['stations']}
    order = network['lines']['1']['order_vakilabad_to_airport']
    if order.index(stations[H7]['name']) + 1 != order.index(stations[DA]['name']):
        raise ValueError('C1 stations are no longer adjacent in line 1 order')
    outward_terminals = [name for name in order[-3:] if name in network['lines']['1']['terminals']]
    inward_terminal = order[0]
    points = {p['stationId']: p for p in topology['publicPoints']}
    outdoor = {c['stationId']: c for c in topology['outdoorCandidates']}
    entrances = {e['id']: e for e in topology['entrances']}

    def entrance(station_id):
        entrance_id = outdoor[station_id]['entranceId']
        item = entrances[entrance_id]
        if item['stationId'] != station_id:
            raise ValueError('Outdoor candidate entrance belongs to another station')
        return {'entranceId': entrance_id, 'sourceName': item['sourceTags'].get('name'),
                'sourceNameEn': item['sourceTags'].get('name:en'), 'lat': item['lat'], 'lon': item['lon'],
                'crs': 'EPSG:4326', 'sourceId': item['sourceId'], 'assurance': item['assurance'],
                'fieldVerification': 'unverified'}

    def point(station_id):
        item = points[station_id]
        return {'pointId': item['id'], 'sourceNodeId': item['sourceNodeId'], 'lat': item['lat'], 'lon': item['lon'],
                'crs': 'EPSG:4326', 'accuracyMeters': None, 'fieldVerification': 'unverified',
                'boundary': item['boundary']}

    h7, da = entrance(H7), entrance(DA)
    a, b = point(H7), point(DA)
    names = {H7: stations[H7]['name'], DA: stations[DA]['name']}
    missions = [
        {'missionId': 'H7-IN-OUTBOUND', 'kind': 'internal_access', 'stationId': H7, 'entrance': h7,
         'start': {'type': 'entrance_threshold', 'id': h7['entranceId']},
         'end': {'type': 'platform_ready', 'id': f'platform:{H7}:toward:{DA}'},
         'trainTowardStationId': DA, 'expectedSignCandidates': outward_terminals,
         'role': {'107->108': 'origin_internal'}},
        {'missionId': 'DA-OUT-OUTBOUND', 'kind': 'internal_egress', 'stationId': DA, 'entrance': da,
         'start': {'type': 'platform_alighting', 'id': f'platform:{DA}:arrival-from:{H7}'},
         'end': {'type': 'exit_threshold', 'id': da['entranceId']},
         'trainFromStationId': H7, 'role': {'107->108': 'destination_internal'}},
        {'missionId': 'DA-IN-INBOUND', 'kind': 'internal_access', 'stationId': DA, 'entrance': da,
         'start': {'type': 'entrance_threshold', 'id': da['entranceId']},
         'end': {'type': 'platform_ready', 'id': f'platform:{DA}:toward:{H7}'},
         'trainTowardStationId': H7, 'expectedSignCandidates': [inward_terminal],
         'role': {'108->107': 'origin_internal'}},
        {'missionId': 'H7-OUT-INBOUND', 'kind': 'internal_egress', 'stationId': H7, 'entrance': h7,
         'start': {'type': 'platform_alighting', 'id': f'platform:{H7}:arrival-from:{DA}'},
         'end': {'type': 'exit_threshold', 'id': h7['entranceId']},
         'trainFromStationId': DA, 'role': {'108->107': 'destination_internal'}},
        {'missionId': 'A-TO-H7', 'kind': 'outdoor', 'stationId': H7, 'entrance': h7, 'publicPoint': a,
         'start': {'type': 'public_point', 'id': a['pointId']},
         'end': {'type': 'entrance_threshold', 'id': h7['entranceId']},
         'sourceWayId': outdoor[H7]['sourceWayId'], 'role': {'107->108': 'origin_outdoor'}},
        {'missionId': 'H7-TO-A', 'kind': 'outdoor', 'stationId': H7, 'entrance': h7, 'publicPoint': a,
         'start': {'type': 'exit_threshold', 'id': h7['entranceId']},
         'end': {'type': 'public_point', 'id': a['pointId']},
         'sourceWayId': outdoor[H7]['sourceWayId'], 'role': {'108->107': 'destination_outdoor'}},
        {'missionId': 'B-TO-DA', 'kind': 'outdoor', 'stationId': DA, 'entrance': da, 'publicPoint': b,
         'start': {'type': 'public_point', 'id': b['pointId']},
         'end': {'type': 'entrance_threshold', 'id': da['entranceId']},
         'sourceWayId': outdoor[DA]['sourceWayId'], 'role': {'108->107': 'origin_outdoor'}},
        {'missionId': 'DA-TO-B', 'kind': 'outdoor', 'stationId': DA, 'entrance': da, 'publicPoint': b,
         'start': {'type': 'exit_threshold', 'id': da['entranceId']},
         'end': {'type': 'public_point', 'id': b['pointId']},
         'sourceWayId': outdoor[DA]['sourceWayId'], 'role': {'107->108': 'destination_outdoor'}},
    ]
    disagreement = next(x for x in topology['registryDisagreements'] if x['stationId'] == DA)
    checks = [{'checkId': 'DA-COORD-CHECK', 'kind': 'coordinate_check', 'stationId': DA,
               'registryPoint': {'lat': disagreement['registryLat'], 'lon': disagreement['registryLon'], 'crs': 'EPSG:4326',
                                 'source': 'data/network.json (unchanged baseline)'},
               'osmStationPoint': {'id': disagreement['osmStationNodeId'], 'lat': disagreement['osmLat'],
                                   'lon': disagreement['osmLon'], 'crs': 'EPSG:4326'},
               'separationMeters2D': disagreement['separationMeters2D'],
               'gating': False,
               'purpose': 'Record what physically exists at each point; never move or snap the baseline from this check.'}]
    for mission in missions:
        mission['stationName'] = names[mission['stationId']]
    return {'schemaVersion': 1, 'registryVersion': 'r2bd2-c1-missions-v1', 'corridor': 'C1',
            'line': 1, 'stations': [H7, DA], 'timezoneOffset': '+03:30',
            'derivedFrom': {'topology': str(topology_path.relative_to(root)), 'topologySha256': sha(topology_path),
                            'network': str(network_path.relative_to(root)), 'networkSha256': sha(network_path)},
            'isObservation': False, 'missions': missions, 'checks': checks,
            'directions': {'107->108': ['origin_public_point', 'origin_outdoor', 'origin_internal', 'metro',
                                        'destination_internal', 'destination_outdoor', 'destination_public_point'],
                           '108->107': ['origin_public_point', 'origin_outdoor', 'origin_internal', 'metro',
                                        'destination_internal', 'destination_outdoor', 'destination_public_point']}}


if __name__ == '__main__':
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build(), ensure_ascii=False, indent=2) + '\n')
    print(OUT)
