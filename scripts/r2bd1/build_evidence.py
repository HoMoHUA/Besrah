#!/usr/bin/env python3
"""Offline Gate assembly from acquired facts plus explicitly unknown field claims.

This is an evidence validator, not an A-to-B planner. The leg order is the
owner's required audit checklist, never a computed or traversable itinerary.
"""
from collections import Counter
import hashlib
import json
from pathlib import Path
from derive import derive, SOURCE_ID
from validate import assess_edge, foot_permission, gate_status, rollup, valid_point, verify_source

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = Path('data/geospatial/r2bd1-c1-v1')


def load(path):
    return json.loads(path.read_text())


def point_leg(point, role):
    checks = {'idAndSourceGeometry': 'pass' if valid_point(point) else 'fail',
              'standingSpace': 'pass' if point['standingSpaceVerified'] else 'undetermined',
              'positionalAccuracy': 'undetermined' if point['accuracyMeters'] is None else 'pass',
              'fieldVerification': 'pass' if point['fieldVerification'] == 'verified' else 'undetermined'}
    return {'role': role, 'pointId': point['id'], 'sourceIds': [SOURCE_ID],
            'checks': checks, 'status': rollup(list(checks.values()))}


def outdoor_leg(candidate, role, reverse, nodes, sources, ways):
    ids = candidate['nodeIds'][::-1] if reverse else candidate['nodeIds']
    raw_way = ways[int(candidate['sourceWayId'].rsplit(':', 1)[1])]
    literal = [f'osm:node:{n}' for n in raw_way['nodes']]
    topology = ids == (literal[::-1] if reverse else literal)
    permission = foot_permission(candidate['sourceTags'])
    edge = {'id': candidate['id'], 'nodeIds': ids, 'sourceIds': [SOURCE_ID],
            'direction': 'reverse' if reverse else 'forward',
            'permittedDirections': candidate['permittedDirections'],
            'footAccess': {'pass': 'allowed', 'fail': 'prohibited'}.get(permission, 'unknown'),
            'barrier': candidate['barrier'], 'surface': candidate['surface'],
            'levels': candidate['levels'], 'transition': None, 'timing': candidate['timing']}
    result = assess_edge(edge, nodes, sources)
    result['checks']['orderedNodesExactlyMatchSourceWay'] = 'pass' if topology else 'fail'
    result['status'] = rollup(list(result['checks'].values()))
    return {'role': role, 'edgeId': edge['id'], 'sourceWayId': candidate['sourceWayId'],
            'pointId': candidate['pointId'], 'entranceId': candidate['entranceId'],
            'sourceIds': [SOURCE_ID], 'timingSeconds': None, **result,
            'meaning': 'Exact source-way node order confirmed, but missing passage/direction/surface/level/timing evidence is not filled.'}


def internal_leg(station_id, role, entrance_id, topology):
    platforms = [p for p in topology['platforms'] if p['stationId'] == station_id]
    connected = any(p['sharedHighwayNodeIds'] for p in platforms)
    checks = {'mappedEntranceAndStopAreaMembership': 'pass',
              'directionalPlatformAssociation': 'undetermined',
              'sourcePlatformHighwayNodeConnection': ('pass' if connected else 'fail') if platforms else 'undetermined',
              'physicalPlatformAccess': 'undetermined', 'direction': 'undetermined',
              'footAccess': 'undetermined', 'barrier': 'undetermined',
              'surfaceLevel': 'undetermined', 'timing': 'undetermined'}
    return {'role': role, 'stationId': station_id, 'entranceId': entrance_id,
            'platformCandidateIds': [p['id'] for p in platforms], 'platformId': None,
            'edgeId': None, 'timingSeconds': None, 'sourceIds': [SOURCE_ID],
            'checks': checks, 'status': rollup(list(checks.values())),
            'meaning': 'Fail denotes missing mapped connection in this snapshot, NOT proof the physical path is blocked. No invented internal edge.'}


def build(root=ROOT):
    root = Path(root)
    package = root / PACKAGE
    record = load(package / f'raw/{SOURCE_ID}.request.json')
    errors = verify_source(package, record)
    if errors:
        raise ValueError('Ineligible geometry source: ' + '; '.join(errors))
    topology = derive(package, root / 'data/network.json')
    raw = load(package / record['bodyPath'])
    nodes = {f"osm:node:{e['id']}": {'id': f"osm:node:{e['id']}", 'lat': e['lat'], 'lon': e['lon'], 'crs': 'EPSG:4326'}
             for e in raw['elements'] if e['type'] == 'node'}
    ways = {e['id']: e for e in raw['elements'] if e['type'] == 'way'}
    sources = {}
    for path in sorted((package / 'raw').glob('*.request.json')):
        source = load(path)
        body = package / source['bodyPath'] if source.get('bodyPath') else None
        integrity = bool(body and body.is_file() and hashlib.sha256(body.read_bytes()).hexdigest() == source['sha256'])
        if not integrity:
            raise ValueError('Source body missing or altered: ' + source['sourceId'])
        sources[source['sourceId']] = {**source, 'artifactIntegrityVerified': integrity,
                                       'verifiedArtifact': integrity and source['fetchSucceeded'],
                                       'assurance': 'artifact_and_source_claim_not_field_verification'}
    for source in load(package / 'external-sources.json'):
        path = Path(source['privateRawArchivePath'])
        integrity = path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == source['sha256']
        if not integrity:
            raise ValueError('Private archived source body missing or altered: ' + source['sourceId'])
        sources[source['sourceId']] = {**source, 'artifactIntegrityVerified': integrity,
                                       'verifiedArtifact': integrity and source['fetchSucceeded'],
                                       'assurance': 'historical_or_discovery_document_not_platform_path_proof'}
    replay = load(package / 'derived/r2a-c1-platform-only-replay.json')
    if hashlib.sha256((root / 'data/network.json').read_bytes()).hexdigest() != replay['networkSha256']:
        raise ValueError('R2a replay network fingerprint mismatch')
    points = {p['stationId']: p for p in topology['publicPoints']}
    candidates = {c['stationId']: c for c in topology['outdoorCandidates']}
    directions = []
    for experiment in replay['experiments']:
        request, result = experiment['request'], experiment['result']
        origin, destination = request['originId'], request['destinationId']
        if {origin, destination} != {'METRO-107', 'METRO-108'}:
            raise ValueError('Replay exceeds C1 scope')
        o, d = candidates[origin], candidates[destination]
        journeys = result['journeys']
        metro = {'role': 'metro', 'status': 'pass' if result['status'] == 'ok' and journeys else 'fail',
                 'checks': {'historicalModeledTripReplay': 'pass' if journeys else 'fail'},
                 'sourceIds': ['besrah:approved-r2a'], 'resultFile': str(PACKAGE / 'derived/r2a-c1-platform-only-replay.json'),
                 'calendar': request['calendar'], 'serviceDate': '2026-10-16',
                 'modeledJourneyCount': len(journeys), 'sourceVersion': replay['dataVersion'],
                 'physicalPlatformAssociationProved': False,
                 'meaning': 'Historical Friday platform-ready replay only. Not live, not a real A-start, not future service-calendar proof.'}
        legs = [point_leg(points[origin], 'origin_public_point'),
                outdoor_leg(o, 'origin_outdoor', False, nodes, sources, ways),
                internal_leg(origin, 'origin_internal', o['entranceId'], topology), metro,
                internal_leg(destination, 'destination_internal', d['entranceId'], topology),
                outdoor_leg(d, 'destination_outdoor', True, nodes, sources, ways),
                point_leg(points[destination], 'destination_public_point')]
        directions.append({'originStationId': origin, 'destinationStationId': destination,
                           'proposedOriginPointId': points[origin]['id'], 'proposedDestinationPointId': points[destination]['id'],
                           'gate': gate_status(legs), 'legs': legs})
    if len(directions) != 2 or len({(d['originStationId'], d['destinationStationId']) for d in directions}) != 2:
        raise ValueError('Both distinct C1 replay directions required')
    eligible = sum(d['gate'] == 'READY_FOR_INTERNAL_MODELED_PILOT' for d in directions)
    return {'schemaVersion': 1, 'phase': 'R2b-D1', 'packageVersion': 'r2bd1-c1-v1',
            'baseR2b': '9a1d300846aaa60be5e24acef6c35478197cbaf3', 'corridor': 'C1',
            'C2Examined': False, 'C2NotUsedReason': 'C1 yielded fresh entrances, explicit stop-area memberships and pedestrian topology; fallback condition was not met.',
            'C3Excluded': True, 'gate': 'READY_FOR_INTERNAL_MODELED_PILOT' if eligible == len(directions) else 'BLOCKED',
            'eligibleDirectionCount': eligible, 'directions': directions,
            'sourceIntegrity': 'pass', 'sources': sources,
            'internalSources': {'besrah:approved-r2a': {
                'sourceId': 'besrah:approved-r2a', 'kind': 'local_derived',
                'artifactPath': str(PACKAGE / 'derived/r2a-c1-platform-only-replay.json'),
                'sha256': hashlib.sha256((package / 'derived/r2a-c1-platform-only-replay.json').read_bytes()).hexdigest(),
                'baseCommit': replay['engineRevision'], 'modelVersion': replay['dataVersion'],
                'networkSha256': replay['networkSha256'], 'live': False,
                'method': 'Unchanged approved R2a planJourney/createModelSource; historical platform-only replay, no street connectors',
                'executionTree': replay['engineExecutionTree']}},
            'acquisitionRequestCount': len(sources),
            'httpStatusCounts': dict(Counter(str(s['httpStatus']) for s in sources.values())),
            'topology': topology,
            'timingModel': load(package / 'derived/walking-speed-evidence.json'),
            'historicalOfficialMarkers': load(package / 'derived/c1-official-historical-markers.json'),
            'fare': {'requiredForTimeGate': False, 'status': 'undetermined', 'value': None},
            'prospectiveServiceCalendar': {'status': 'undetermined', 'testDateSelected': False,
                                           'note': 'Historical R2a replay does not validate holidays or future service.'},
            'evidenceReview': {'physicalPassageNotAutomaticallyCertified': True,
                               'mappedMembershipNotInternalConnection': True,
                               'freshFetchNotFieldObservation': True},
            'plannerImplemented': False, 'fullAtoBDurationComputed': False,
            'fullAtoBDurationSeconds': None, 'fieldEtaAccuracyClaimed': False,
            'publicApiAdded': False, 'productionChanged': False,
            'remainingMinimum': ['Confirm A/B public standing boundaries and positional/source uncertainty.',
                                 'Confirm both short outdoor paths, directions, barriers, surfaces/levels and timing.',
                                 'Provide the four directional entrance-to-platform/platform-to-exit internal chains with observed or source-supported time accounting.',
                                 'Choose an explicit service-date/calendar policy for a future internal modeled test.'],
            'stop': 'Owner approval of a separate R2b-B design is required even if a later data Gate passes.'}


if __name__ == '__main__':
    result = build()
    content = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    (ROOT / PACKAGE / 'derived/gate-evaluation.json').write_text(content)
    (ROOT / 'docs/r2b/R2b-D1-EVIDENCE.json').write_text(content)
    print(json.dumps({'gate': result['gate'], 'eligibleDirectionCount': result['eligibleDirectionCount'],
                      'requestCount': result['acquisitionRequestCount'], 'httpStatusCounts': result['httpStatusCounts']}, indent=2))
