"""R2b-D2 offline intake checks. Every fixture here is synthetic and never field evidence."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'tests/fixtures/r2bd2'
PACKAGE = ROOT / 'data/geospatial/r2bd2-c1-field-intake-v1'
NOW = dt.datetime(2000, 1, 3, tzinfo=dt.timezone.utc)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


intake = load('r2bd2_intake', ROOT / 'scripts/r2bd2/intake.py')
build_missions = load('r2bd2_missions', ROOT / 'scripts/r2bd2/build_missions.py')
build_form = load('r2bd2_form', ROOT / 'scripts/r2bd2/build_form.py')


def fixture(name):
    return json.loads((FIXTURES / name).read_text())


class RegistryAndTemplateTests(unittest.TestCase):
    def test_registry_is_regenerated_from_d1_sources_not_hand_copied(self):
        self.assertEqual(json.loads((PACKAGE / 'missions.json').read_text()), build_missions.build(ROOT))

    def test_registry_ids_match_immutable_d1_topology(self):
        topology = json.loads((ROOT / 'data/geospatial/r2bd1-c1-v1/derived/c1-source-topology.json').read_text())
        entrances = {e['id']: e for e in topology['entrances']}
        registry, missions = intake.load_missions(PACKAGE / 'missions.json')
        self.assertEqual(len(missions), 8)
        for mission in missions.values():
            source = entrances[mission['entrance']['entranceId']]
            self.assertEqual(source['stationId'], mission['stationId'])
            self.assertEqual((source['lat'], source['lon']), (mission['entrance']['lat'], mission['entrance']['lon']))
        self.assertEqual(missions['H7-IN-OUTBOUND']['entrance']['sourceName'], 'شمال شرقی')
        self.assertEqual(missions['DA-IN-INBOUND']['entrance']['sourceName'], 'شمالی')
        check = registry['checks'][0]
        self.assertFalse(check['gating'])
        self.assertGreater(check['separationMeters2D'], 199)

    def test_v2_template_is_a_superset_of_d1_template_and_never_an_observation(self):
        v1 = json.loads((ROOT / 'data/geospatial/r2bd1-c1-v1/templates/field-observation.json').read_text())
        v2 = json.loads((PACKAGE / 'templates/field-observation.v2.json').read_text())
        self.assertTrue(set(v1) <= set(v2))
        self.assertEqual(set(v2), set(intake.V2_KEYS))
        _, missions = intake.load_missions(PACKAGE / 'missions.json')
        self.assertEqual(intake.validate_observation(v2, missions, NOW)['status'], 'rejected')

    def test_all_fixtures_are_explicitly_synthetic(self):
        for path in FIXTURES.glob('*.json'):
            self.assertIs(json.loads(path.read_text())['synthetic'], True, path.name)


class ObservationTests(unittest.TestCase):
    def setUp(self):
        _, self.missions = intake.load_missions(PACKAGE / 'missions.json')
        self.access = fixture('complete-internal-access.json')
        self.outdoor = fixture('outdoor-self-reported.json')

    def check(self, obs, allow=True):
        return intake.validate_observation(obs, self.missions, NOW, allow_synthetic=allow)

    def test_complete_observation_is_only_technically_complete_never_verified(self):
        verdict = self.check(self.access)
        self.assertEqual(verdict['status'], 'technically_complete_unverified', verdict)
        self.assertEqual(verdict['derived']['elapsedSeconds'], 120)
        self.assertEqual(verdict['derived']['accessSecondsExcludingResearcherPause'], 110)

    def test_synthetic_is_rejected_as_real_evidence(self):
        self.assertIn('synthetic data is never accepted as field evidence', self.check(self.access, allow=False)['errors'])

    def test_unknown_waits_stay_unknown_and_block_completeness(self):
        self.access['durationsSeconds']['researcherPause'] = None
        verdict = self.check(self.access)
        self.assertEqual(verdict['status'], 'incomplete')
        self.assertNotIn('accessSecondsExcludingResearcherPause', verdict['derived'])

    def test_missing_end_time_is_incomplete_not_zero(self):
        self.outdoor['events']['endAt'] = None
        self.outdoor['events']['entranceThresholdAt'] = None
        verdict = self.check(self.outdoor)
        self.assertEqual(verdict['status'], 'incomplete')
        self.assertNotIn('elapsedSeconds', verdict['derived'])

    def test_wrong_platform_direction_is_rejected(self):
        self.access['platformDirectionMatchesMission'] = 'no'
        self.assertEqual(self.check(self.access)['status'], 'rejected')

    def test_platform_claim_without_documents_stays_under_review(self):
        self.access['sourceEvidenceFiles'] = []
        self.access['evidenceLevel'] = 'self_reported'
        verdict = self.check(self.access)
        self.assertEqual(verdict['status'], 'requires_review')
        self.assertIn('platform claim has no sign photo', ' '.join(verdict['review']))

    def test_documented_level_needs_a_hashed_file(self):
        self.access['sourceEvidenceFiles'][0]['sha256'] = None
        self.assertEqual(self.check(self.access)['status'], 'rejected')

    def test_collaborator_cannot_self_declare_independent_verification(self):
        self.access['evidenceLevel'] = 'independently_verified'
        verdict = self.check(self.access)
        self.assertEqual(verdict['status'], 'rejected')
        self.assertIn('separate record by another person', ' '.join(verdict['errors']))

    def test_train_wait_cannot_enter_access_time(self):
        self.access['events']['trainArrivedAt'] = '2000-01-01T10:01:30+03:30'
        self.assertIn('train wait leaked', ' '.join(self.check(self.access)['errors']))
        broken = copy.deepcopy(fixture('complete-internal-access.json'))
        broken['events']['endAt'] = '2000-01-01T10:05:00+03:30'
        self.assertEqual(self.check(broken)['status'], 'rejected')
        broken = copy.deepcopy(fixture('complete-internal-access.json'))
        broken['durationsSeconds']['trainWait'] = 120
        self.assertEqual(self.check(broken)['status'], 'rejected')

    def test_double_counted_or_contradictory_durations_are_rejected(self):
        self.access['durationsSeconds']['ticketQueue'] = 200
        self.assertIn('double counting', ' '.join(self.check(self.access)['errors']))
        broken = fixture('complete-internal-access.json')
        broken['durationsSeconds']['ticketQueue'] = 2
        self.assertIn('ticket durations contradict', ' '.join(self.check(broken)['errors']))
        broken = fixture('complete-internal-access.json')
        broken['durationsSeconds'].update(walking=10, steps=10)
        self.assertIn('do not add up', ' '.join(self.check(broken)['errors']))

    def test_timestamps_need_tehran_offset_and_order(self):
        self.access['events']['ticketQueueStartAt'] = '2000-01-01T06:30:40Z'
        self.assertEqual(self.check(self.access)['status'], 'rejected')
        broken = fixture('complete-internal-access.json')
        broken['events']['ticketControlCompleteAt'] = '2000-01-01T10:00:30+03:30'
        self.assertIn('event order', ' '.join(self.check(broken)['errors']))
        future = fixture('complete-internal-access.json')
        self.assertIn('future', ' '.join(intake.validate_observation(
            future, self.missions, dt.datetime(1999, 1, 1, tzinfo=dt.timezone.utc), True)['errors']))

    def test_missing_consent_rejects_before_storage(self):
        for key in ('recordingConsent', 'publicAreaOnly', 'noPeopleOrTicketsInMedia'):
            obs = fixture('complete-internal-access.json')
            obs['consent'][key] = False
            self.assertEqual(self.check(obs)['status'], 'rejected', key)
        obs = fixture('complete-internal-access.json')
        obs['sourceEvidenceFiles'][0]['containsPeopleOrTickets'] = True
        self.assertEqual(self.check(obs)['status'], 'rejected')

    def test_unknown_or_missing_fields_are_rejected_with_actionable_message(self):
        self.access['extraField'] = 1
        del self.access['notes']
        errors = ' '.join(self.check(self.access)['errors'])
        self.assertIn("unknown fields (rename or remove): ['extraField']", errors)
        self.assertIn("missing fields (write null for unknown): ['notes']", errors)

    def test_mission_boundary_and_entrance_identity_are_exact(self):
        self.access['toPointId'] = 'platform:METRO-107:toward:METRO-106'
        self.assertEqual(self.check(self.access)['status'], 'rejected')
        other = fixture('complete-internal-access.json')
        other['entranceId'] = 'osm:node:1030590103'
        self.assertEqual(self.check(other)['status'], 'rejected')
        new = fixture('complete-internal-access.json')
        new.update(entranceMatchesCandidate='no', entranceId='new:north-2')
        self.assertEqual(self.check(new)['status'], 'requires_review')

    def test_closed_path_is_valid_evidence_of_a_failing_leg(self):
        self.access['pathExists'] = 'no'
        verdict = self.check(self.access)
        self.assertEqual(verdict['status'], 'requires_review')
        self.assertEqual(intake.leg_status([verdict], set()), 'fail')

    def test_gps_inside_station_and_bad_outdoor_crs_are_rejected(self):
        self.access['coordinateCapture'].update(lat=36.0, lon=59.0, crs='EPSG:4326')
        self.assertEqual(self.check(self.access)['status'], 'rejected')
        self.outdoor['coordinateCapture'].update(lat=36.0, lon=59.0, crs='EPSG:3857')
        self.assertEqual(self.check(self.outdoor)['status'], 'rejected')

    def test_step_count_is_not_a_length(self):
        self.outdoor['pathLengthMeters'] = 30
        self.assertEqual(self.check(self.outdoor)['status'], 'rejected')

    def test_outdoor_point_needs_confirmed_standing_space(self):
        self.assertEqual(self.check(self.outdoor)['status'], 'technically_complete_unverified')
        self.outdoor['boundaryStandable'] = 'unknown'
        self.assertEqual(self.check(self.outdoor)['status'], 'incomplete')

    def test_coordinate_check_is_station_scoped_and_bounded(self):
        self.access['coordinateCheck'] = {'registryPoint': 'unknown', 'osmStationPoint': 'unknown', 'note': None}
        self.assertEqual(self.check(self.access)['status'], 'rejected')

    def test_validation_never_mutates_input(self):
        before = copy.deepcopy(self.access)
        self.check(self.access)
        self.assertEqual(self.access, before)


class GateAndIngestTests(unittest.TestCase):
    def setUp(self):
        self.registry, self.missions = intake.load_missions(PACKAGE / 'missions.json')
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR', '/root/.hermes/cache/scratch'))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.package = self.root / 'package'
        self.package.mkdir()
        shutil.copy(PACKAGE / 'missions.json', self.package / 'missions.json')

    def write(self, name, obj):
        path = self.root / name
        path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')
        return path

    def test_real_package_gate_is_blocked_without_field_observations(self):
        result = intake.gate(intake.read_observations(PACKAGE), self.missions, self.registry,
                             verifications=intake.read_verifications(PACKAGE))
        self.assertEqual(result['gate'], 'BLOCKED')
        self.assertFalse(result['dataTechnicallyCompletePendingIndependentVerification'])
        self.assertEqual(list((PACKAGE / 'observations').glob('*/observation.json')), [])

    def test_duplicates_are_reported_and_do_not_count_twice(self):
        obs = fixture('complete-internal-access.json')
        result = intake.gate([(obs, 'a'), (copy.deepcopy(obs), 'a')], self.missions, self.registry,
                             now=NOW, allow_synthetic=True)
        self.assertEqual(result['duplicates'], ['obs:SYN-H7-IN-001'])
        self.assertEqual(result['gate'], 'BLOCKED')

    def test_independent_verification_requires_another_person_and_exact_bytes(self):
        obs = fixture('complete-internal-access.json')
        raw = (FIXTURES / 'complete-internal-access.json').read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        second = copy.deepcopy(obs)
        second.update(observationId='obs:SYN-H7-IN-002', sourceId='field:obs:SYN-H7-IN-002', observerCode='SYN-VER-2')
        second['entranceRules']['sourceId'] = 'field:obs:SYN-H7-IN-002'
        record = fixture('verification-second-walk.json')
        pairs = {obs['observationId']: (obs, digest), second['observationId']: (second, 'b')}
        verdicts = {k: intake.validate_observation(v[0], self.missions, NOW, True) for k, v in pairs.items()}
        self.assertEqual(intake.validate_verification(record, pairs, verdicts, True), [])
        confirmation = dict(record, method='operator_confirmation', secondObservationId=None,
                            notes='SYNTHETIC operator desk confirmed the route')
        self.assertEqual(intake.validate_verification(confirmation, pairs, verdicts, True), [])
        same = dict(confirmation, verifierCode='SYN-OBS-1')
        self.assertEqual(intake.validate_verification(same, pairs, verdicts, True),
                         ['verifierCode must be a different pseudonymous person'])
        unverified = intake.gate([(obs, digest)], self.missions, self.registry, now=NOW, allow_synthetic=True)
        leg = next(l for l in unverified['directions']['107->108']['legs'] if l['role'] == 'origin_internal')
        self.assertEqual(leg['status'], 'undetermined', 'a complete but unverified claim must not pass')
        self.assertTrue(intake.validate_verification(dict(record, submissionSha256='0' * 64), pairs, verdicts, True))
        result = intake.gate([(obs, digest), (second, 'b')], self.missions, self.registry, now=NOW,
                             allow_synthetic=True, verifications=[record])
        leg = next(l for l in result['directions']['107->108']['legs'] if l['role'] == 'origin_internal')
        self.assertEqual(leg['status'], 'pass')
        self.assertEqual(result['gate'], 'BLOCKED', 'one verified leg can never open the Gate')

    def test_ingest_stores_exact_bytes_and_refuses_overwrite_and_real_synthetic(self):
        source = FIXTURES / 'outdoor-self-reported.json'
        with self.assertRaisesRegex(ValueError, 'synthetic'):
            intake.ingest(source, None, PACKAGE, self.root / 'private', NOW, allow_synthetic=True)
        record = intake.ingest(source, None, self.package, self.root / 'private', NOW, allow_synthetic=True)
        stored = self.package / 'observations/obs_SYN-A-H7-001/observation.json'
        self.assertEqual(stored.read_bytes(), source.read_bytes())
        self.assertEqual(record['verdict']['status'], 'technically_complete_unverified')
        self.assertFalse(record['mediaInRepository'])
        with self.assertRaises(FileExistsError):
            intake.ingest(source, None, self.package, self.root / 'private', NOW, allow_synthetic=True)

    def test_ingest_checks_media_hash_and_keeps_media_out_of_package(self):
        obs = fixture('complete-internal-access.json')
        media = self.root / 'media'
        media.mkdir()
        (media / 'syn-sign.jpg').write_bytes(b'synthetic bytes')
        obs['sourceEvidenceFiles'][0]['sha256'] = hashlib.sha256(b'synthetic bytes').hexdigest()
        source = self.write('obs.json', obs)
        record = intake.ingest(source, media, self.package, self.root / 'private', NOW, allow_synthetic=True)
        self.assertTrue((self.root / 'private/obs_SYN-H7-IN-001/syn-sign.jpg').is_file())
        self.assertEqual(list(self.package.rglob('*.jpg')), [])
        self.assertIn('syn-sign.jpg', record['evidenceFilesVerified'])
        obs['observationId'] = 'obs:SYN-H7-IN-003'
        obs['sourceId'] = 'field:obs:SYN-H7-IN-003'
        (media / 'syn-sign.jpg').write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            intake.ingest(self.write('obs3.json', obs), media, self.package, self.root / 'private', NOW, allow_synthetic=True)

    def test_rejected_submission_is_not_stored(self):
        obs = fixture('complete-internal-access.json')
        obs['consent']['recordingConsent'] = False
        with self.assertRaisesRegex(ValueError, 'rejected'):
            intake.ingest(self.write('bad.json', obs), None, self.package, self.root / 'private', NOW, allow_synthetic=True)
        self.assertFalse((self.package / 'observations').exists())

    def test_cli_gate_on_real_package_reports_blocked(self):
        out = subprocess.run(['python3', '-B', 'scripts/r2bd2/intake.py', 'gate'], cwd=ROOT,
                             capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(json.loads(out.stdout)['gate'], 'BLOCKED')


class OfflineFormTests(unittest.TestCase):
    def test_mission_guide_coordinates_come_from_registry(self):
        guide = (ROOT / 'docs/r2b/field/FIELD-MISSION-FA.md').read_text()
        registry = json.loads((PACKAGE / 'missions.json').read_text())
        known = set()
        for mission in registry['missions']:
            known.add((mission['entrance']['lat'], mission['entrance']['lon']))
            if 'publicPoint' in mission:
                known.add((mission['publicPoint']['lat'], mission['publicPoint']['lon']))
        check = registry['checks'][0]
        known |= {(check['registryPoint']['lat'], check['registryPoint']['lon']),
                  (check['osmStationPoint']['lat'], check['osmStationPoint']['lon'])}
        found = {(float(a), float(b)) for a, b in re.findall(r'geo:(-?\d+\.\d+),(-?\d+\.\d+)', guide)}
        self.assertEqual(len(found), 6)
        self.assertTrue(found <= known, found - known)
        for mission_id in ('H7-IN-OUTBOUND', 'DA-OUT-OUTBOUND', 'DA-IN-INBOUND', 'H7-OUT-INBOUND',
                           'A-TO-H7', 'H7-TO-A', 'B-TO-DA', 'DA-TO-B'):
            self.assertIn(mission_id, guide)

    def test_form_is_regenerated_offline_and_has_no_network_surface(self):
        html = (ROOT / 'docs/r2b/field/FIELD-FORM-C1.html').read_text()
        self.assertEqual(html, build_form.build())
        self.assertIn("connect-src 'none'", html)
        self.assertNotRegex(html, r'(?i)https?://|fetch\(|XMLHttpRequest|geolocation|localStorage|navigator\.sendBeacon|<link|src=')

    def test_form_builder_output_passes_the_intake_validator(self):
        html = (ROOT / 'docs/r2b/field/FIELD-FORM-C1.html').read_text()
        found = re.search(r'<script id="besrah-builder">(.*?)</script>', html, re.S)
        assert found is not None
        builder = found.group(1)
        registry = json.loads((PACKAGE / 'missions.json').read_text())
        mission = next(m for m in registry['missions'] if m['missionId'] == 'DA-IN-INBOUND')
        answers = {'synthetic': True, 'observer': 'SYN-OBS-9', 'consent': True, 'publicOnly': True, 'noPeople': True,
                   'entranceMatch': 'yes', 'pathExists': 'yes', 'entryAllowed': 'yes', 'exitAllowed': 'unknown',
                   'sign': 'SYNTHETIC', 'platformReached': 'yes', 'directionMatch': 'yes', 'transition': 'stairs',
                   'levelStart': 'street', 'levelEnd': 'platform', 'steps': 'threshold\nstairs\ngate\nplatform',
                   'events': {'startAt': '2000-01-01T11:00:00+03:30', 'ticketQueueStartAt': '2000-01-01T11:00:30+03:30',
                              'ticketControlCompleteAt': '2000-01-01T11:00:50+03:30',
                              'platformReadyAt': '2000-01-01T11:01:40+03:30'},
                   'durations': {'crossingWait': '0', 'ticketQueue': '15', 'ticketControl': '5', 'elevatorWait': '0',
                                 'researcherPause': '0', 'walking': '', 'steps': ''},
                   'files': [{'fileName': 'sign.jpg', 'sha256': 'a' * 64, 'kind': 'photo_sign'}],
                   'rights': 'synthetic', 'coordinate': {'registryPoint': 'unknown', 'osmStationPoint': 'station_entrance',
                                                         'note': 'synthetic'}}
        script = builder + '\nconst m=' + json.dumps(mission) + ';const a=' + json.dumps(answers) + \
            ';process.stdout.write(JSON.stringify(besrahBuildObservation(a,m,"obs:SYN-FORM-001")));' + \
            'process.stderr.write(besrahTehranStamp(Date.UTC(2000,0,1,6,30,0)));'
        out = subprocess.run(['node', '-e', script], capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stderr, '2000-01-01T10:00:00+03:30')
        obs = json.loads(out.stdout)
        _, missions = intake.load_missions(PACKAGE / 'missions.json')
        verdict = intake.validate_observation(obs, missions, NOW, allow_synthetic=True)
        self.assertEqual(verdict['status'], 'technically_complete_unverified', verdict)
        self.assertEqual(obs['entranceRules']['exitAllowed'], 'unknown')
        self.assertIsNone(obs['durationsSeconds']['walking'])


if __name__ == '__main__':
    unittest.main()
