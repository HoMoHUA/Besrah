#!/usr/bin/env python3
"""Offline, bounded intake for C1 field observations (schema 2).

Validates a collaborator submission against the D1-derived mission registry,
then optionally ingests its exact bytes into a new evidence layer. It never
creates routing edges, ETAs, network changes or public output. Unknown stays
unknown, a statement is not documentation, and documentation is not
independent verification. The Gate stays BLOCKED until every required leg of
a direction is independently verified with continuous exact boundary IDs.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/r2bd1'))
from validate import gate_status, rollup, valid_point  # noqa: E402  (reuse D1 contracts)

PACKAGE = ROOT / 'data/geospatial/r2bd2-c1-field-intake-v1'
MISSIONS = PACKAGE / 'missions.json'
D1_GATE = ROOT / 'data/geospatial/r2bd1-c1-v1/derived/gate-evaluation.json'
MAX_BYTES = 256 * 1024
MAX_ELAPSED_SECONDS = 1800
SUM_TOLERANCE_SECONDS = 5
TS = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:30$')
OBS_ID = re.compile(r'^obs:[A-Za-z0-9][A-Za-z0-9._-]{2,63}$')
CODE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$')
FILE_NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$')
TRI = ('yes', 'no', 'unknown')
WAITS = ('crossingWait', 'ticketQueue', 'ticketControl', 'elevatorWait', 'researcherPause')
MOTION = ('walking', 'steps')
EVENT_KEYS = ('startAt', 'entranceThresholdAt', 'ticketQueueStartAt', 'ticketControlCompleteAt',
              'platformReadyAt', 'alightedAt', 'exitThresholdAt', 'trainArrivedAt', 'endAt')
TRANSITIONS = ('none', 'stairs', 'escalator', 'elevator', 'ramp', 'mixed', 'unknown')
EVIDENCE_KINDS = ('photo_sign', 'photo_entrance', 'photo_branch', 'sketch', 'operator_document')
LEVELS = ('self_reported', 'documented')
VERIFY_METHODS = ('second_observer_walk', 'operator_document', 'operator_confirmation')
COORD_ANSWERS = ('station_entrance', 'station_structure', 'no_station_feature', 'unknown')
V1_KEYS = ('schemaVersion', 'isTemplateNotObservation', 'observationId', 'observedAt', 'timezone', 'stationId',
           'entranceId', 'platformId', 'directionDestinationText', 'fromPointId', 'toPointId', 'publicAreaOnly',
           'sourceEvidenceFiles', 'pathNodes', 'segments', 'entranceRules', 'surface', 'barriers', 'levels',
           'transition', 'events', 'durationsSeconds', 'pathLengthMeters', 'lengthMethod', 'coordinateCapture',
           'contradictions', 'unknowns', 'notes')
V2_KEYS = V1_KEYS + ('synthetic', 'missionId', 'sourceId', 'observerCode', 'consent', 'entranceMatchesCandidate',
                     'pathExists', 'platformReached', 'platformDirectionMatchesMission', 'arrivedFromStationText',
                     'boundaryStandable', 'evidenceLevel', 'verification', 'coordinateCheck')


def tehran(value):
    if not isinstance(value, str) or not TS.match(value):
        return None
    try:
        return dt.datetime.fromisoformat(value)
    except ValueError:
        return None


def load_missions(path=MISSIONS):
    registry = json.loads(Path(path).read_text())
    return registry, {m['missionId']: m for m in registry['missions']}


def _text(value, limit=200):
    return isinstance(value, str) and 0 < len(value.strip()) <= limit


def _number(value):
    return type(value) in (int, float) and value == value and abs(value) != float('inf')


def validate_observation(obs, missions, now=None, allow_synthetic=False):
    """Return a structured verdict; inputs are never mutated or repaired."""
    errors, gaps, review = [], [], []
    now = now or dt.datetime.now(dt.timezone.utc)
    if not isinstance(obs, dict):
        return {'status': 'rejected', 'errors': ['observation must be a JSON object'], 'gaps': [], 'review': []}
    extra = sorted(set(obs) - set(V2_KEYS))
    missing = sorted(set(V2_KEYS) - set(obs))
    if extra:
        errors.append(f'unknown fields (rename or remove): {extra}')
    if missing:
        errors.append(f'missing fields (write null for unknown): {missing}')
    if obs.get('schemaVersion') != 2 or obs.get('isTemplateNotObservation') is not False:
        errors.append('schemaVersion must be 2 and isTemplateNotObservation must be false')
    synthetic = obs.get('synthetic')
    if synthetic not in (True, False):
        errors.append('synthetic must be true or false')
    elif synthetic and not allow_synthetic:
        errors.append('synthetic data is never accepted as field evidence')
    oid = obs.get('observationId')
    if not isinstance(oid, str) or not OBS_ID.match(oid):
        errors.append('observationId must look like obs:<code>, letters/digits/._- only')
    elif obs.get('sourceId') != 'field:' + oid:
        errors.append('sourceId must be exactly field:<observationId>')
    if not isinstance(obs.get('observerCode'), str) or not CODE.match(obs['observerCode']):
        errors.append('observerCode must be a short pseudonymous code, not a name or phone number')
    consent = obs.get('consent')
    if not isinstance(consent, dict) or any(consent.get(k) is not True for k in
                                            ('recordingConsent', 'publicAreaOnly', 'noPeopleOrTicketsInMedia')):
        errors.append('consent: recordingConsent, publicAreaOnly and noPeopleOrTicketsInMedia must all be true')
    if obs.get('publicAreaOnly') is not True:
        errors.append('publicAreaOnly must be true')
    if obs.get('timezone') != '+03:30':
        errors.append('timezone must be +03:30')
    mission = missions.get(obs.get('missionId'))
    if mission is None:
        errors.append('missionId is not one of the eight C1 missions')
        return {'status': 'rejected', 'errors': errors, 'gaps': gaps, 'review': review, 'derived': {},
                'blocking': [], 'missionId': None, 'observationId': oid}
    kind = mission['kind']
    if obs.get('stationId') != mission['stationId']:
        errors.append(f"stationId must be {mission['stationId']} for {mission['missionId']}")
    if obs.get('fromPointId') != mission['start']['id'] or obs.get('toPointId') != mission['end']['id']:
        errors.append(f"fromPointId/toPointId must be {mission['start']['id']} -> {mission['end']['id']}")
    match = obs.get('entranceMatchesCandidate')
    expected_entrance = mission['entrance']['entranceId']
    if match not in TRI:
        errors.append('entranceMatchesCandidate must be yes, no or unknown')
    elif match == 'yes' and obs.get('entranceId') != expected_entrance:
        errors.append(f'entranceMatchesCandidate=yes requires entranceId {expected_entrance}')
    elif match == 'no':
        if not (isinstance(obs.get('entranceId'), str) and obs['entranceId'].startswith('new:')):
            errors.append('a different entrance needs entranceId new:<short-label> and a note')
        review.append('observed entrance differs from mapped candidate; needs mission revision before use')
    elif match == 'unknown':
        gaps.append('entrance identity unknown')
    for key in ('pathExists', 'boundaryStandable', 'platformReached', 'platformDirectionMatchesMission'):
        if obs.get(key) not in TRI + (None,):
            errors.append(f'{key} must be yes, no, unknown or null')
    blocking = []
    if obs.get('pathExists') == 'no':
        review.append('collaborator found no usable path for this mission')
        blocking.append('path_not_usable')
    elif obs.get('pathExists') != 'yes':
        gaps.append('path existence not confirmed')
    rules = obs.get('entranceRules')
    if not isinstance(rules, dict) or set(rules) != {'entryAllowed', 'exitAllowed', 'openingHours', 'sourceId'}:
        errors.append('entranceRules must have entryAllowed, exitAllowed, openingHours, sourceId')
        rules = {}
    needed = 'entryAllowed' if kind == 'internal_access' or mission['end']['type'] == 'entrance_threshold' else 'exitAllowed'
    if rules.get(needed) not in TRI + (None,):
        errors.append(f'{needed} must be yes, no or unknown')
    elif rules.get(needed) == 'no':
        review.append(f'{needed}=no: this entrance cannot serve this mission')
        blocking.append(needed + '_no')
    elif rules.get(needed) != 'yes':
        gaps.append(f'{needed} unknown')
    if kind == 'internal_access':
        if not _text(obs.get('directionDestinationText')):
            gaps.append('destination sign text not recorded')
        if obs.get('platformDirectionMatchesMission') == 'no':
            errors.append('wrong platform direction for this mission; record it under the correct mission')
        elif obs.get('platformDirectionMatchesMission') != 'yes':
            gaps.append('platform direction not confirmed')
        if obs.get('platformReached') != 'yes':
            gaps.append('platform not reached')
    if kind == 'internal_egress':
        if not _text(obs.get('arrivedFromStationText')):
            gaps.append('arriving-from station not recorded')
    if kind == 'outdoor' and obs.get('boundaryStandable') != 'yes':
        gaps.append('public point standing space not confirmed')
    if obs.get('transition') not in TRANSITIONS + (None,):
        errors.append(f'transition must be one of {TRANSITIONS}')
    elif kind != 'outdoor' and obs.get('transition') in (None, 'unknown'):
        gaps.append('level transition unknown')
    levels = obs.get('levels')
    if levels is not None and (not isinstance(levels, list) or len(levels) != 2
                               or any(v is not None and not _text(v, 40) for v in levels)):
        errors.append('levels must be null or [startLabel, endLabel] with text or null')
    events = obs.get('events')
    if not isinstance(events, dict) or set(events) - set(EVENT_KEYS):
        errors.append(f'events may only contain {EVENT_KEYS}')
        events = {}
    times = {}
    for key, value in events.items():
        if value is None:
            continue
        parsed = tehran(value)
        if parsed is None:
            errors.append(f'events.{key} must be YYYY-MM-DDTHH:MM:SS+03:30')
        else:
            times[key] = parsed
    derived = {}
    start, end = times.get('startAt'), times.get('endAt')
    if start is None or end is None:
        gaps.append('startAt and endAt are both required to time the leg')
    else:
        elapsed = (end - start).total_seconds()
        if elapsed <= 0 or elapsed > MAX_ELAPSED_SECONDS:
            errors.append(f'endAt must be after startAt and within {MAX_ELAPSED_SECONDS} seconds')
        if end.astimezone(dt.timezone.utc) > now + dt.timedelta(minutes=10):
            errors.append('observation times lie in the future relative to validation time')
        if tehran(obs.get('observedAt')) != start:
            errors.append('observedAt must equal events.startAt')
        ordered = [k for k in EVENT_KEYS if k in times and k != 'trainArrivedAt']
        stamps = [times[k] for k in ordered]
        if stamps != sorted(stamps):
            errors.append(f'event order contradicts their timestamps: {ordered}')
        if any(t < start or t > end for k, t in times.items() if k != 'trainArrivedAt'):
            errors.append('every boundary event must lie within startAt..endAt')
        if kind == 'internal_access':
            if 'platformReadyAt' not in times or times['platformReadyAt'] != end:
                errors.append('access must end at platformReadyAt (train wait is not access time)')
            if 'trainArrivedAt' in times and times['trainArrivedAt'] < end:
                errors.append('trainArrivedAt before platformReadyAt: train wait leaked into access timing')
        elif 'trainArrivedAt' in times:
            errors.append('trainArrivedAt is only allowed on internal_access missions, and is excluded')
        if kind == 'internal_egress' and times.get('alightedAt') != start:
            errors.append('egress must start at alightedAt')
        if kind == 'outdoor' and ('ticketQueueStartAt' in times or 'ticketControlCompleteAt' in times):
            errors.append('outdoor missions cannot contain ticket-control events')
        derived['elapsedSeconds'] = elapsed
    durations = obs.get('durationsSeconds')
    if not isinstance(durations, dict) or set(durations) != set(WAITS + MOTION):
        errors.append(f'durationsSeconds must contain exactly {WAITS + MOTION}; train wait is never a key')
        durations = {}
    for key, value in durations.items():
        if value is not None and (not _number(value) or value < 0 or value > MAX_ELAPSED_SECONDS):
            errors.append(f'durationsSeconds.{key} must be null or 0..{MAX_ELAPSED_SECONDS}')
    unknown_waits = [k for k in WAITS if durations.get(k) is None]
    if kind == 'outdoor':
        unknown_waits = [k for k in unknown_waits if k not in ('ticketQueue', 'ticketControl')]
        if any(durations.get(k) not in (None, 0) for k in ('ticketQueue', 'ticketControl')):
            errors.append('outdoor missions cannot contain ticket durations')
    if unknown_waits:
        gaps.append(f'unknown durations (write 0 only if it truly did not happen): {unknown_waits}')
    if 'elapsedSeconds' in derived and durations:
        known = sum(v for v in durations.values() if _number(v))
        if known > derived['elapsedSeconds'] + SUM_TOLERANCE_SECONDS:
            errors.append('component durations exceed elapsed time: double counting')
        if all(durations.get(k) is not None for k in MOTION) and not unknown_waits:
            if abs(known - derived['elapsedSeconds']) > SUM_TOLERANCE_SECONDS:
                errors.append('all components known but they do not add up to elapsed time')
        if 'ticketQueueStartAt' in times and 'ticketControlCompleteAt' in times \
                and durations.get('ticketQueue') is not None and durations.get('ticketControl') is not None:
            window = (times['ticketControlCompleteAt'] - times['ticketQueueStartAt']).total_seconds()
            if abs(window - durations['ticketQueue'] - durations['ticketControl']) > SUM_TOLERANCE_SECONDS:
                errors.append('ticket durations contradict ticket event timestamps')
        if not unknown_waits and durations.get('researcherPause') is not None:
            derived['movementAndUnclassifiedSeconds'] = derived['elapsedSeconds'] - sum(
                durations.get(k) or 0 for k in WAITS)
            derived['accessSecondsExcludingResearcherPause'] = derived['elapsedSeconds'] - durations['researcherPause']
            derived['method'] = 'timestamp difference minus explicitly recorded waits; single observation, not a distribution'
    length = obs.get('pathLengthMeters')
    if length is not None and (not _number(length) or length <= 0 or length > 3000 or not _text(obs.get('lengthMethod'))):
        errors.append('pathLengthMeters needs a positive value and a lengthMethod (step counts are not meters)')
    capture = obs.get('coordinateCapture')
    if not isinstance(capture, dict) or set(capture) - {'crs', 'method', 'accuracyMeters', 'lat', 'lon'}:
        errors.append('coordinateCapture has unexpected fields')
    elif capture.get('lat') is not None or capture.get('lon') is not None:
        if kind != 'outdoor':
            errors.append('do not record GPS coordinates inside a station')
        elif not valid_point(capture):
            errors.append('outdoor coordinates need numeric lat/lon and crs EPSG:4326')
    files = obs.get('sourceEvidenceFiles')
    if not isinstance(files, list) or len(files) > 20:
        errors.append('sourceEvidenceFiles must be a list of at most 20 entries')
        files = []
    names = set()
    for item in files:
        if not isinstance(item, dict) or set(item) != {'fileName', 'sha256', 'kind', 'containsPeopleOrTickets', 'rights'}:
            errors.append('each evidence file needs fileName, sha256, kind, containsPeopleOrTickets, rights')
            continue
        if not isinstance(item['fileName'], str) or not FILE_NAME.match(item['fileName']) or item['fileName'] in names:
            errors.append('evidence fileName must be a unique simple name')
        names.add(item.get('fileName'))
        if item['kind'] not in EVIDENCE_KINDS:
            errors.append(f'evidence kind must be one of {EVIDENCE_KINDS}')
        if item['containsPeopleOrTickets'] is not False:
            errors.append(f"{item['fileName']}: media with people, tickets or cards must be removed")
        if item['sha256'] is not None and not (isinstance(item['sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', item['sha256'])):
            errors.append(f"{item['fileName']}: sha256 must be 64 lowercase hex or null")
        if not _text(item['rights'], 120):
            errors.append(f"{item['fileName']}: rights statement required")
    level = obs.get('evidenceLevel')
    hashed = [f for f in files if isinstance(f, dict) and isinstance(f.get('sha256'), str)]
    if level not in LEVELS:
        errors.append(f'evidenceLevel must be one of {LEVELS}')
    elif level == 'documented' and not hashed:
        errors.append(f'{level} requires at least one hashed evidence file')
    if kind == 'internal_access' and obs.get('platformReached') == 'yes' and not any(
            f.get('kind') in ('photo_sign', 'sketch', 'operator_document') for f in hashed):
        review.append('platform claim has no sign photo, sketch or operator document; stays self-reported')
    if level == 'independently_verified':
        errors.append('independent verification is a separate record by another person; submit self_reported or documented')
    if obs.get('verification') is not None:
        errors.append('verification must be null; it is recorded separately and never edits this submission')
    coordinate = obs.get('coordinateCheck')
    if coordinate is not None:
        if mission['stationId'] != 'METRO-108' or not isinstance(coordinate, dict) \
                or set(coordinate) != {'registryPoint', 'osmStationPoint', 'note'} \
                or coordinate['registryPoint'] not in COORD_ANSWERS or coordinate['osmStationPoint'] not in COORD_ANSWERS:
            errors.append(f'coordinateCheck applies to METRO-108 only, answers {COORD_ANSWERS}')
    for key in ('contradictions', 'unknowns'):
        if not isinstance(obs.get(key), list) or any(not _text(v, 300) for v in obs[key]):
            errors.append(f'{key} must be a list of short texts')
    if isinstance(obs.get('contradictions'), list) and obs['contradictions']:
        review.append('collaborator recorded contradictions with the map')
    if obs.get('notes') is not None and not _text(obs['notes'], 1000):
        errors.append('notes must be null or text up to 1000 characters')
    for key in ('platformId', 'pathNodes', 'segments', 'surface', 'barriers'):
        value = obs.get(key)
        if key in ('pathNodes', 'segments'):
            if not isinstance(value, list) or len(value) > 40 or any(not _text(v, 120) for v in value):
                errors.append(f'{key} must be a list of at most 40 short texts')
        elif value is not None and not _text(value, 200):
            errors.append(f'{key} must be null or short text')
    if errors:
        status = 'rejected'
    elif review:
        status = 'requires_review'
    elif gaps:
        status = 'incomplete'
    else:
        status = 'technically_complete_unverified'
    return {'status': status, 'errors': errors, 'gaps': gaps, 'review': review, 'derived': derived,
            'blocking': blocking, 'entranceId': obs.get('entranceId'),
            'missionId': mission['missionId'], 'observationId': oid, 'evidenceLevel': level,
            'synthetic': synthetic is True}


VER_ID = re.compile(r'^ver:[A-Za-z0-9][A-Za-z0-9._-]{2,63}$')
VER_KEYS = {'schemaVersion', 'recordType', 'verificationId', 'observationId', 'submissionSha256', 'verifierCode',
            'method', 'verifiedAt', 'sourceId', 'secondObservationId', 'evidenceFileSha256', 'synthetic', 'notes'}


def validate_verification(record, observations, verdicts, allow_synthetic=False):
    """Check an independent verification record against an immutable submission.

    observations maps observationId -> (parsed observation, submission sha256).
    A verifier must be a different person; a second walk must itself be a
    technically complete observation of the same mission by the verifier.
    """
    errors = []
    if not isinstance(record, dict) or set(record) != VER_KEYS:
        return ['verification record must contain exactly ' + str(sorted(VER_KEYS))]
    if record['schemaVersion'] != 1 or record['recordType'] != 'verification':
        errors.append('schemaVersion 1 and recordType verification required')
    if record['synthetic'] is not False and not allow_synthetic:
        errors.append('synthetic verification is never accepted')
    if not isinstance(record['verificationId'], str) or not VER_ID.match(record['verificationId']):
        errors.append('verificationId must look like ver:<code>')
    elif record['sourceId'] != 'field:' + record['verificationId']:
        errors.append('sourceId must be field:<verificationId>')
    target = observations.get(record['observationId'])
    if target is None:
        return errors + ['verification references an unknown observation']
    obs, digest = target
    if record['submissionSha256'] != digest:
        errors.append('verification does not match the exact submitted bytes')
    if not isinstance(record['verifierCode'], str) or not CODE.match(record['verifierCode']) \
            or record['verifierCode'] == obs.get('observerCode'):
        errors.append('verifierCode must be a different pseudonymous person')
    verified_at, observed_end = tehran(record['verifiedAt']), tehran((obs.get('events') or {}).get('endAt'))
    if verified_at is None or (observed_end and verified_at < observed_end):
        errors.append('verifiedAt must be +03:30 and not precede the observation')
    method = record['method']
    if method not in VERIFY_METHODS:
        errors.append(f'method must be one of {VERIFY_METHODS}')
    elif method == 'second_observer_walk':
        second = observations.get(record['secondObservationId'])
        second_verdict = verdicts.get(record['secondObservationId'])
        if second is None or second_verdict is None or second[0].get('missionId') != obs.get('missionId') \
                or second[0].get('observerCode') != record['verifierCode'] \
                or second_verdict['status'] != 'technically_complete_unverified' \
                or second[0].get('entranceId') != obs.get('entranceId'):
            errors.append('second walk must be a complete observation of the same mission and entrance by the verifier')
    elif method == 'operator_document':
        hashes = {f.get('sha256') for f in obs.get('sourceEvidenceFiles', []) if isinstance(f, dict)}
        if record['evidenceFileSha256'] not in hashes - {None} or not any(
                f.get('kind') == 'operator_document' and f.get('sha256') == record['evidenceFileSha256']
                for f in obs.get('sourceEvidenceFiles', []) if isinstance(f, dict)):
            errors.append('operator_document verification must cite a hashed operator_document of the observation')
    elif method == 'operator_confirmation' and not (isinstance(record['notes'], str) and record['notes'].strip()):
        errors.append('operator_confirmation must state who confirmed what, without personal contact details')
    return errors


def leg_status(verdicts, verified_ids):
    """A leg passes only when a technically complete submission has an accepted independent record."""
    if any(v['status'] == 'technically_complete_unverified' and v['observationId'] in verified_ids for v in verdicts):
        return 'pass'
    if any(v['status'] != 'rejected' and v.get('blocking') for v in verdicts):
        return 'fail'
    return 'undetermined'


def gate(observations, missions, registry, d1_gate_path=D1_GATE, now=None, allow_synthetic=False, verifications=()):
    """observations: iterable of (parsed observation, exact submission sha256)."""
    verdicts, by_id, duplicate = {}, {}, []
    by_obs = {}
    for obs, digest in observations:
        oid = obs.get('observationId') if isinstance(obs, dict) else None
        if oid in by_id:
            duplicate.append(oid)
            continue
        verdict = validate_observation(obs, missions, now, allow_synthetic)
        by_id[oid] = (obs, digest)
        by_obs[oid] = verdict
        verdicts.setdefault(verdict.get('missionId'), []).append(verdict)
    verification_results, verified_ids, seen_ver = [], set(), set()
    for record in verifications:
        rid = record.get('verificationId') if isinstance(record, dict) else None
        problems = ['duplicate verificationId'] if rid in seen_ver else validate_verification(
            record, by_id, by_obs, allow_synthetic)
        seen_ver.add(rid)
        verification_results.append({'verificationId': rid, 'observationId': (record or {}).get('observationId'),
                                     'accepted': not problems, 'errors': problems})
        if not problems and by_obs.get(record['observationId'], {}).get('status') == 'technically_complete_unverified':
            verified_ids.add(record['observationId'])
    d1 = json.loads(Path(d1_gate_path).read_text())
    metro = {d['originStationId'] + '->' + d['destinationStationId']: next(l for l in d['legs'] if l['role'] == 'metro')
             for d in d1['directions']}
    directions = {}
    for name, roles in registry['directions'].items():
        legs = []
        origin, destination = ('METRO-107', 'METRO-108') if name == '107->108' else ('METRO-108', 'METRO-107')
        for role in roles:
            if role == 'metro':
                legs.append({'role': role, 'status': metro[origin + '->' + destination]['status'],
                             'basis': 'D1 historical platform-only R2a replay'})
                continue
            if role.endswith('public_point'):
                mission = next(m for m in missions.values() if m['role'].get(name) == role.replace('public_point', 'outdoor'))
                ok = any(v['observationId'] in verified_ids for v in verdicts.get(mission['missionId'], []))
                legs.append({'role': role, 'status': 'pass' if ok else 'undetermined',
                             'basis': f"verified boundaryStandable in {mission['missionId']}"})
                continue
            mission = next(m for m in missions.values() if m['role'].get(name) == role)
            mine = verdicts.get(mission['missionId'], [])
            legs.append({'role': role, 'missionId': mission['missionId'], 'status': leg_status(mine, verified_ids),
                         'observations': [{'observationId': v['observationId'], 'status': v['status'],
                                           'independentlyVerified': v['observationId'] in verified_ids} for v in mine]})
        # Continuity is exact ID equality of verified boundaries at each station, never proximity.
        stations = {}
        for leg in legs:
            if leg.get('missionId'):
                stations.setdefault(missions[leg['missionId']]['stationId'], set()).update(
                    v['entranceId'] for v in verdicts.get(leg['missionId'], []) if v['observationId'] in verified_ids)
        continuity = 'pass' if stations and all(len(ids) == 1 for ids in stations.values()) else 'undetermined'
        directions[name] = {'legs': legs, 'boundaryContinuity': continuity,
                            'gate': gate_status(legs) if continuity == 'pass' else 'BLOCKED'}
    technically = all(any(v['status'] == 'technically_complete_unverified' for v in verdicts.get(m, [])) for m in missions)
    overall = 'READY_FOR_INTERNAL_MODELED_PILOT' if all(d['gate'] != 'BLOCKED' for d in directions.values()) else 'BLOCKED'
    return {'schemaVersion': 1, 'gate': overall,
            'dataTechnicallyCompletePendingIndependentVerification': technically and overall == 'BLOCKED',
            'directions': directions, 'duplicates': duplicate, 'verifications': verification_results,
            'verdicts': {k: v for k, v in verdicts.items() if k is not None},
            'rejectedWithoutMission': verdicts.get(None, []),
            'openChecks': ['DA-COORD-CHECK: registry versus OSM station point (~200 m) is unresolved and never auto-corrected'],
            'note': 'READY would only permit an owner decision about R2b-B design; never a planner, ETA or release.'}


def ingest(submission, evidence_dir, package, private_archive, now=None, allow_synthetic=False):
    submission, package = Path(submission), Path(package)
    raw = submission.read_bytes()
    if len(raw) > MAX_BYTES:
        raise ValueError('submission exceeds 256 KiB')
    obs = json.loads(raw)
    real = package.resolve() == PACKAGE.resolve()
    if obs.get('synthetic') is not False and (real or not allow_synthetic):
        raise ValueError('synthetic submissions can never enter the real evidence package')
    _, missions = load_missions(package / 'missions.json')
    verdict = validate_observation(obs, missions, now, allow_synthetic=allow_synthetic and not real)
    if verdict['status'] == 'rejected':
        raise ValueError('rejected: ' + '; '.join(verdict['errors']))
    target = package / 'observations' / obs['observationId'].replace(':', '_')
    if target.exists():
        raise FileExistsError('observation already ingested; use a new observationId for a correction')
    hashes = {}
    for item in obs['sourceEvidenceFiles']:
        path = Path(evidence_dir) / item['fileName'] if evidence_dir else None
        if path is None or not path.is_file():
            if item['sha256'] is not None:
                raise ValueError(f"declared evidence file missing: {item['fileName']}")
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if item['sha256'] is not None and digest != item['sha256']:
            raise ValueError(f"evidence hash mismatch: {item['fileName']}")
        hashes[item['fileName']] = digest
    archive = Path(private_archive) / obs['observationId'].replace(':', '_')
    if hashes and archive.exists():
        raise FileExistsError('private evidence archive already exists for this observationId')
    target.mkdir(parents=True)
    (target / 'observation.json').write_bytes(raw)
    if hashes:
        archive.mkdir(parents=True, exist_ok=False, mode=0o700)
        for name in hashes:
            shutil.copy2(Path(evidence_dir) / name, archive / name)
    record = {'observationId': obs['observationId'], 'submissionSha256': hashlib.sha256(raw).hexdigest(),
              'verdict': verdict, 'evidenceFilesVerified': hashes,
              'privateEvidenceArchive': str(archive) if hashes else None,
              'mediaInRepository': False}
    (target / 'validation.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
    return record


def ingest_verification(record_path, package, now=None, allow_synthetic=False):
    """Store an exact verification record beside, never inside, the verified submission."""
    package = Path(package)
    raw = Path(record_path).read_bytes()
    if len(raw) > MAX_BYTES:
        raise ValueError('verification exceeds 256 KiB')
    record = json.loads(raw)
    real = package.resolve() == PACKAGE.resolve()
    _, missions = load_missions(package / 'missions.json')
    pairs = read_observations(package)
    observations = {o.get('observationId'): (o, d) for o, d in pairs}
    verdicts = {o.get('observationId'): validate_observation(o, missions, now, allow_synthetic and not real) for o, _ in pairs}
    problems = validate_verification(record, observations, verdicts, allow_synthetic and not real)
    if problems:
        raise ValueError('rejected: ' + '; '.join(problems))
    target = package / 'verifications' / (record['verificationId'].replace(':', '_') + '.json')
    if target.exists():
        raise FileExistsError('verification already ingested')
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(raw)
    return {'verificationId': record['verificationId'], 'observationId': record['observationId'],
            'recordSha256': hashlib.sha256(raw).hexdigest(), 'accepted': True}


def read_observations(package):
    found = []
    for path in sorted((Path(package) / 'observations').glob('*/observation.json')):
        raw = path.read_bytes()
        found.append((json.loads(raw), hashlib.sha256(raw).hexdigest()))
    return found


def read_verifications(package):
    return [json.loads(p.read_bytes()) for p in sorted((Path(package) / 'verifications').glob('*.json'))]


def main(argv=None):
    parser = argparse.ArgumentParser(description='Offline C1 field-observation intake')
    sub = parser.add_subparsers(dest='command', required=True)
    v = sub.add_parser('validate', help='check submissions without storing anything')
    v.add_argument('files', nargs='+')
    v.add_argument('--allow-synthetic', action='store_true', help='fixtures only')
    i = sub.add_parser('ingest', help='store exact submission bytes after validation')
    i.add_argument('submission')
    i.add_argument('--evidence-dir')
    i.add_argument('--package', default=str(PACKAGE))
    i.add_argument('--private-archive', default='/var/backups/besrah/field-evidence')
    r = sub.add_parser('verify', help='store an independent verification record')
    r.add_argument('record')
    r.add_argument('--package', default=str(PACKAGE))
    g = sub.add_parser('gate', help='recompute the Gate from stored records')
    g.add_argument('--package', default=str(PACKAGE))
    g.add_argument('--write', action='store_true')
    args = parser.parse_args(argv)
    if args.command == 'validate':
        _, missions = load_missions()
        results = []
        for name in args.files:
            raw = Path(name).read_bytes()
            try:
                obs = json.loads(raw) if len(raw) <= MAX_BYTES else None
            except ValueError:
                obs = None
            results.append({'file': name, **validate_observation(obs, missions, allow_synthetic=args.allow_synthetic)})
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return 1 if any(r['status'] == 'rejected' for r in results) else 0
    if args.command == 'ingest':
        print(json.dumps(ingest(args.submission, args.evidence_dir, args.package, args.private_archive),
                         ensure_ascii=False, indent=2))
        return 0
    if args.command == 'verify':
        print(json.dumps(ingest_verification(args.record, args.package), ensure_ascii=False, indent=2))
        return 0
    registry, missions = load_missions(Path(args.package) / 'missions.json')
    result = gate(read_observations(args.package), missions, registry, verifications=read_verifications(args.package))
    text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.write:
        (Path(args.package) / 'derived').mkdir(exist_ok=True)
        (Path(args.package) / 'derived/gate-status.json').write_text(text)
    print(json.dumps({'gate': result['gate'], 'technicallyCompletePendingVerification':
                      result['dataTechnicallyCompletePendingIndependentVerification'],
                      'directions': {k: d['gate'] for k, d in result['directions'].items()}}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
