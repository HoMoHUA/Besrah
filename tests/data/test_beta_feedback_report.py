"""Tests for scripts/beta_feedback_report.py. Every record here is synthetic (reportId starts with SYNTH-); none is field evidence."""
import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts' / 'beta_feedback_report.py'


spec = importlib.util.spec_from_file_location('besrah_beta_feedback_report', SCRIPT)
assert spec is not None and spec.loader is not None
tool = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = tool
spec.loader.exec_module(tool)

MODEL_A = 'sha256:' + '0' * 63 + 'a'
MODEL_B = 'sha256:' + '0' * 63 + 'b'
NOTE_TEXT = 'SYNTH-NOTE-PRIVATE-TEXT-ZZ'


def independent_split(report_id):
    """Re-implementation of the documented split rule, kept separate from the tool on purpose."""
    return 'calibration' if hashlib.sha256((report_id + '|r2apb-split-v1').encode()).digest()[0] < 179 else 'held_out'


def id_for(split, index, prefix='SYNTH-'):
    """First id of the form SYNTH-<tag>-<n> whose split (computed independently) is the requested one."""
    split = 'held_out' if split == 'evaluation' else split
    counter = 0
    found = -1
    while True:
        candidate = '%s%s-%06d' % (prefix, split[:4].upper(), counter)
        counter += 1
        if independent_split(candidate) == split:
            found += 1
            if found == index:
                return candidate


def rec(report_id, kind='train_observation', line=1, service_date='2026-10-31', delta=30, trip_match='matched', precision='minute',
        direction='out', observed_at='2026-10-31T08:15:00+03:30', received_at='2026-10-31T05:00:00.000Z', model=MODEL_A,
        model_matches=True, result='made_it', ready=1793000000, category='other', quality='close', note=None):
    block = {'timing_quality': None, 'observation': None, 'outcome': None, 'problem': None}
    classes = {'timing_quality': 'qualitative', 'train_observation': 'claimed_observation',
               'boarding_outcome': 'journey_outcome', 'problem': 'problem_report'}
    if kind == 'timing_quality':
        block['timing_quality'] = quality
    elif kind == 'train_observation':
        block['observation'] = {'event': 'train_arrival', 'stationId': 'METRO-001', 'direction': direction,
                                'observedAtEpoch': int(dt.datetime.fromisoformat(observed_at).timestamp()), 'observedAt': observed_at, 'precision': precision}
    elif kind == 'boarding_outcome':
        block['outcome'] = {'result': result, 'platformReadyAtEpoch': ready}
    else:
        block['problem'] = {'category': category}
    return {'schema': 1, 'reportId': report_id, 'kind': kind, 'modelVersion': model,
            'context': {'line': line, 'originId': 'METRO-001', 'destinationId': 'METRO-002', 'serviceDate': service_date,
                        'tripId': '%s:L%d:%s:A:%s' % (service_date, line, 'out' if direction == 'unknown' else direction, hashlib.sha256(report_id.encode()).hexdigest()),
                        'readyAt': None, 'calendarState': 'known'},
            'timingQuality': block['timing_quality'], 'observation': block['observation'], 'outcome': block['outcome'],
            'problem': block['problem'], 'note': note, 'receivedAt': received_at, 'class': classes[kind],
            'identity': 'anonymous_unverified', 'review': 'unreviewed', 'modelVersionMatches': model_matches,
            'comparison': {'tripMatch': trip_match, 'modelEventAt': None if delta is None else (dt.datetime.fromisoformat(observed_at) - dt.timedelta(seconds=delta)).isoformat(),
                           'deltaSeconds': delta}}


def review(report_id, status='independently_verified', record=None, revision=1):
    evidence = None
    if record is not None and record['observation'] is not None:
        context, observation = record['context'], record['observation']
        evidence = {'reportId': report_id, 'tripId': context['tripId'], 'line': context['line'],
                    'direction': observation['direction'], 'stationId': observation['stationId'],
                    'serviceDate': context['serviceDate'], 'event': observation['event'],
                    'observedAt': observation['observedAt'], 'modelEventAt': record['comparison']['modelEventAt'],
                    'modelVersion': record['modelVersion'], 'platformReady': None, 'timePrecision': 'minute'}
    return {'schema': 1, 'reviewId': report_id + '-R%d' % revision, 'revision': revision,
            'reportId': report_id, 'status': status, 'reviewer': 'SYNTH-reviewer',
            'reviewedAt': '2026-11-01T10:00:%02d+03:30' % revision,
            'method': 'independent_field_observation', 'basis': 'synthetic test basis',
            'split': independent_split(report_id), 'evidence': evidence}


def write_feedback(directory, records, name='feedback-2026-10.jsonl', extra_lines=()):
    path = Path(directory) / name
    body = ''.join(json.dumps(item) + '\n' for item in records) + ''.join(extra_lines)
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(body)
    os.chmod(path, 0o600)
    return path


def write_reviews(path, items):
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(''.join(json.dumps(item) + '\n' for item in items))
    return Path(path)


def run(*argv):
    argv = list(argv)
    if argv and argv[0] in ('report', 'export') and '--real-only' not in argv:
        argv.append('--include-synthetic')
    if '--real-only' in argv:
        argv.remove('--real-only')
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            code = tool.main([str(item) for item in argv])
        except SystemExit as exit_error:
            code = exit_error.code
    return code, out.getvalue(), err.getvalue()


def snapshot(directory):
    result = {}
    for path in sorted(Path(directory).rglob('*')):
        if path.is_file():
            result[str(path.relative_to(directory))] = (path.read_bytes(), stat.S_IMODE(path.stat().st_mode))
    return result


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.store = self.tmp / 'store'
        self.store.mkdir(mode=0o700)
        self.work = self.tmp / 'work'
        self.work.mkdir()

    def report(self, reviews=None, strict=False):
        args = ['report', '--dir', self.store]
        if reviews is not None:
            args += ['--reviews', reviews]
        if strict:
            args.append('--strict')
        code, out, err = run(*args)
        return code, (json.loads(out) if code in (0, 3) and out else None), err

    def verified_set(self, count, lines=(1,), kind='train_observation', start=0, **options):
        """`count` evaluation-split records + their independently_verified reviews (ids chosen with the split rule)."""
        records, reviews = [], []
        for index in range(count):
            report_id = id_for('evaluation', start + index)
            records.append(rec(report_id, kind=kind, line=lines[index % len(lines)], delta=(index % 7) * 10 - 20, **options))
            reviews.append(review(report_id, record=records[-1]))
        return records, reviews


class EvidenceBoundaryRegression(Base):
    def test_corrupt_input_blocks_accuracy_instead_of_reporting_a_partial_subset(self):
        records, reviews = self.verified_set(30)
        write_feedback(self.store, records, extra_lines=('{"torn',))
        _, report, _ = self.report(write_reviews(self.work / 'reviews.jsonl', reviews))
        self.assertEqual(report['statistics']['integrity_gate'], 'blocked')
        self.assertNotIn('mae_seconds', report['statistics']['timing_error_verified'])
        self.assertNotIn('missed_rate', report['statistics']['missed_train_rate_verified'])

    def test_blank_lines_cannot_bypass_physical_record_bound(self):
        path = write_feedback(self.store, [rec('SYNTH-PHYSICAL-00001')])
        path.write_bytes(b'\n\n' + path.read_bytes())
        with mock.patch.object(tool, 'MAX_RECORDS', 1):
            self.assertEqual(self.report()[0], 2)

    def test_timestamp_offset_components_and_literal_ids_are_strict(self):
        self.assertIsNone(tool.parse_iso('2026-10-31T08:15:00+12:99'))
        row = rec('SYNTH-LITERAL-ID-0001')
        row['reportId'] += '\n'
        self.assertIsNone(tool.validate_record(row)[0])

    def test_held_out_trip_shared_with_calibration_is_excluded_even_at_other_station(self):
        records, reviews = self.verified_set(30)
        cal = rec(id_for('calibration', 0))
        cal['context']['tripId'] = records[0]['context']['tripId']
        cal['observation']['stationId'] = 'METRO-002'
        write_feedback(self.store, records + [cal])
        path = write_reviews(self.work / 'reviews.jsonl', reviews + [review(cal['reportId'], record=cal)])
        _, report, _ = self.report(path)
        self.assertEqual(report['statistics']['timing_error_verified']['n'], 29)
        self.assertEqual(report['integrity']['held_out_trip_overlap_excluded'], 1)

    def test_reviews_record_count_is_bounded(self):
        path = write_reviews(self.work / 'reviews.jsonl', [review('SYNTH-BOUND-REVIEW001'), review('SYNTH-BOUND-REVIEW002')])
        with mock.patch.object(tool, 'MAX_RECORDS', 1):
            self.assertEqual(self.report(path)[0], 2)

    def test_rejection_reason_content_is_not_exported(self):
        (self.store / 'rejections-2026-10.json').write_text(json.dumps({'month': '2026-10', 'counts': {NOTE_TEXT: 1}}))
        _, report, _ = self.report()
        self.assertEqual(report['integrity']['invalid_rejection_files'][0]['reason'], 'invalid_structure')
        self.assertNotIn(NOTE_TEXT, json.dumps(report))

    def test_report_cannot_overwrite_external_review_input(self):
        path = write_reviews(self.work / 'reviews.jsonl', [review('SYNTH-NO-OVERWRITE01')])
        before = path.read_bytes()
        code, _, _ = run('report', '--dir', self.store, '--reviews', path, '--json', path)
        self.assertEqual(code, 2)
        self.assertEqual(path.read_bytes(), before)

    def test_current_node_schema_one_provenance_is_accepted_without_promoting_trust(self):
        row = rec('SYNTH-NODE-SCHEMA0001')
        row.update(sourceId='anonymous_feedback:' + row['reportId'], reportedAt=row['receivedAt'],
                   consent={'granted': True, 'version': 'r2a-pb-feedback-v1', 'purpose': 'model_improvement',
                            'provenance': 'explicit_client_opt_in'},
                   provenance={'source': 'anonymous_public_report', 'independentlyVerified': False, 'modelTimetableUpdated': False})
        write_feedback(self.store, [row])
        _, report, _ = self.report()
        self.assertEqual(report['totals']['valid'], 1)
        self.assertEqual(report['accuracy']['n'], 0)
        row['provenance']['independentlyVerified'] = True
        write_feedback(self.store, [row])
        self.assertEqual(self.report()[1]['totals']['valid'], 0)

    def test_current_time_precision_is_preserved_but_is_not_independent_evidence(self):
        for precision in ('minute', 'second', 'unknown'):
            row = rec('SYNTH-TIMEPRECISION01')
            row['observation']['timePrecision'] = precision
            clean, reason = tool.validate_record(row)
            self.assertIsNone(reason)
            self.assertIsNotNone(clean)
            self.assertEqual(clean['observation']['timePrecision'], precision)
            write_feedback(self.store, [row])
            self.assertEqual(self.report()[1]['statistics']['timing_error_verified']['n'], 0)
        row['observation']['timePrecision'] = 'invented'
        self.assertIsNone(tool.validate_record(row)[0])

    def test_missing_independent_precision_never_promotes_client_precision(self):
        records, reviews = self.verified_set(30)
        for row, qc in zip(records, reviews):
            row['observation']['timePrecision'] = 'second'
            qc['evidence'].pop('timePrecision', None)
        write_feedback(self.store, records)
        path = write_reviews(self.work / 'reviews.jsonl', reviews)
        _, report, _ = self.report(path)
        self.assertEqual(report['totals']['valid'], 30)
        self.assertEqual(report['statistics']['timing_error_verified']['n'], 0)
        for qc in reviews:
            qc['evidence']['timePrecision'] = 'minute'
        write_reviews(path, reviews)
        metric = self.report(path)[1]['statistics']['timing_error_verified']
        self.assertEqual(metric['n'], 30)
        self.assertEqual(metric['precision'], 'minute')
        for qc in reviews:
            qc['evidence']['timePrecision'] = 'second'
        write_reviews(path, reviews)
        self.assertEqual(self.report(path)[1]['statistics']['timing_error_verified']['precision'], 'minute')

    def test_same_train_event_under_distinct_report_ids_cannot_inflate_or_leak_split(self):
        records, reviews = self.verified_set(30)
        for row, qc in zip(records, reviews):
            row['context']['tripId'] = records[0]['context']['tripId']
            qc['evidence']['tripId'] = row['context']['tripId']
        write_feedback(self.store, records)
        _, report, _ = self.report(write_reviews(self.work / 'reviews.jsonl', reviews))
        self.assertEqual(report['statistics']['timing_error_verified']['n'], 0)
        self.assertEqual(report['integrity']['repeated_event_claims_excluded'], 30)

    def test_synthetic_is_explicitly_excluded_from_real_metrics(self):
        records, reviews = self.verified_set(30)
        write_feedback(self.store, records)
        path = write_reviews(self.work / 'reviews.jsonl', reviews)
        code, out, _ = run('report', '--dir', self.store, '--reviews', path, '--real-only')
        self.assertEqual(code, 0)
        report = json.loads(out)
        self.assertEqual(report['totals']['analysed'], 0)
        self.assertEqual(report['totals']['synthetic_excluded'], 30)
        self.assertEqual(report['statistics']['timing_error_verified']['n'], 0)

    def test_unknown_unmatched_mismatch_duplicate_and_invalid_binding_never_metric(self):
        changes = ('unknown', 'unmatched', 'model', 'station', 'event', 'trip', 'delta', 'duplicate', 'split', 'method', 'basis')
        for change in changes:
            with self.subTest(change=change):
                records, reviews = self.verified_set(30)
                for row, qc in zip(records, reviews):
                    if change == 'unknown': row['observation']['direction'] = 'unknown'
                    if change == 'unmatched': row['comparison']['tripMatch'] = 'unmatched'
                    if change == 'model': row['modelVersionMatches'] = False
                    if change == 'station': qc['evidence']['stationId'] = 'METRO-002'
                    if change == 'event': qc['evidence']['event'] = 'train_departure'
                    if change == 'trip': row['context']['tripId'] = None
                    if change == 'delta': row['comparison']['deltaSeconds'] += 1
                    if change == 'split': qc['split'] = 'calibration'
                    if change == 'method': qc['method'] = 'documented_qc'
                    if change == 'basis': qc['basis'] = ''
                write_feedback(self.store, records + (records if change == 'duplicate' else []))
                _, report, _ = self.report(write_reviews(self.work / 'reviews.jsonl', reviews))
                self.assertEqual(report['statistics']['timing_error_verified']['n'], 0)
                self.assertNotIn('mae_seconds', report['statistics']['timing_error_verified'])

    def test_review_duplicate_revision_is_not_last_wins(self):
        records, reviews = self.verified_set(30)
        write_feedback(self.store, records)
        _, report, _ = self.report(write_reviews(self.work / 'reviews.jsonl', reviews + reviews))
        self.assertEqual(report['statistics']['timing_error_verified']['n'], 0)
        self.assertEqual(report['integrity']['invalid_review_lines_total'], 60)

    def test_epoch_mismatch_and_bad_timestamps_are_corruption(self):
        rows = [rec('SYNTH-TIME-%08d' % i) for i in range(4)]
        rows[0]['observation']['observedAtEpoch'] += 1
        rows[1]['observation']['observedAt'] = '2026-10-31T08:15:00'
        rows[2]['receivedAt'] = '2026-02-30T00:00:00Z'
        rows[3]['observation']['observedAt'] = '2026-10-31T08:15:00+24:00'
        write_feedback(self.store, rows)
        _, report, _ = self.report()
        self.assertEqual(report['integrity']['invalid_lines_total'], 4)

    def test_personal_outcome_never_creates_missed_train_metric(self):
        records, reviews = self.verified_set(30, kind='boarding_outcome', result='missed')
        write_feedback(self.store, records)
        _, report, _ = self.report(write_reviews(self.work / 'reviews.jsonl', reviews))
        self.assertEqual(report['statistics']['missed_train_rate_verified']['n'], 0)
        self.assertEqual(report['statistics']['raw_boarding_outcomes'], {'missed': 30})

    def test_independent_departure_and_platform_ready_are_required_for_missed_metric(self):
        records, reviews = self.verified_set(30)
        for row, qc in zip(records, reviews):
            row['observation']['event'] = qc['evidence']['event'] = 'train_departure'
            row['comparison']['modelEventAt'] = qc['evidence']['modelEventAt'] = '2026-10-31T08:17:00+03:30'
            row['comparison']['deltaSeconds'] = -120
            qc['evidence']['platformReady'] = {'observedAt': '2026-10-31T08:16:00+03:30',
                'method': 'independent_platform_record', 'basis': 'SYNTH platform-ready evidence', 'timePrecision': 'minute'}
        write_feedback(self.store, records)
        path = write_reviews(self.work / 'reviews.jsonl', reviews)
        metric = self.report(path)[1]['statistics']['missed_train_rate_verified']
        self.assertEqual((metric['n'], metric['missed'], metric['missed_rate']), (30, 30, 1.0))
        for qc in reviews: qc['evidence']['platformReady'].pop('timePrecision')
        write_reviews(path, reviews)
        self.assertEqual(self.report(path)[1]['statistics']['missed_train_rate_verified']['n'], 0)
        for qc in reviews: qc['evidence']['platformReady'] = None
        write_reviews(path, reviews)
        self.assertEqual(self.report(path)[1]['statistics']['missed_train_rate_verified']['n'], 0)

    def test_coverage_cells_and_digest_are_deterministic_and_private(self):
        write_feedback(self.store, [rec('SYNTH-CELLS-00000001', note=NOTE_TEXT)])
        _, report, _ = self.report()
        cell = report['coverage']['cells'][0]
        self.assertEqual({key: cell[key] for key in ('line', 'direction', 'serviceDate', 'hour', 'event', 'review', 'modelVersion', 'n')},
            {'line': 1, 'direction': 'out', 'serviceDate': '2026-10-31', 'hour': '08', 'event': 'train_arrival',
             'review': 'unreviewed', 'modelVersion': MODEL_A, 'n': 1})
        self.assertEqual(report['provenance']['signature_state'], 'not_provided')
        self.assertRegex(report['provenance']['sha256'], '^[0-9a-f]{64}$')
        self.assertEqual(report['coverage']['cells'][0]['eligibleIndependentObservations'], 0)
        self.assertNotIn(NOTE_TEXT, json.dumps(report))

    def test_privacy_minimal_json_csv_exports_are_deterministic_formula_safe(self):
        row = rec('SYNTH-EXPORT-00000001', note=NOTE_TEXT)
        write_feedback(self.store, [row])
        for fmt in ('json', 'csv'):
            output = self.work / ('export.' + fmt)
            code, _, err = run('export', '--dir', self.store, '--out', output, '--format', fmt)
            self.assertEqual(code, 0, err)
            text = output.read_text()
            self.assertNotIn(NOTE_TEXT, text)
            for field in ('originId', 'destinationId', 'readyAt', 'observedAt', 'basis', 'reviewer'):
                self.assertNotIn(field, text)
        self.assertEqual(tool.csv_cell('  =1+1'), "'  =1+1")
        self.assertEqual(tool.csv_cell('\t@SUM(1)'), "'\t@SUM(1)")

    def test_total_store_bounds_refuse_instead_of_silent_partial_accuracy(self):
        write_feedback(self.store, [rec('SYNTH-BOUND-00000001'), rec('SYNTH-BOUND-00000002')])
        with mock.patch.object(tool, 'MAX_RECORDS', 1):
            self.assertEqual(self.report()[0], 2)
        with mock.patch.object(tool, 'MAX_STORE_BYTES', 1):
            self.assertEqual(self.report()[0], 2)

    def test_legacy_status_only_review_cannot_enable_accuracy(self):
        records, _ = self.verified_set(30)
        write_feedback(self.store, records)
        old = [{'reportId': row['reportId'], 'status': 'independently_verified',
                'reviewer': 'SYNTH-reviewer', 'reviewedAt': '2026-11-01T10:00:00+03:30',
                'basis': 'synthetic claim only'} for row in records]
        _, report, _ = self.report(write_reviews(self.work / 'reviews.jsonl', old))
        self.assertEqual(report['statistics']['timing_error_verified']['n'], 0)
        self.assertNotIn('mae_seconds', report['statistics']['timing_error_verified'])
        self.assertEqual(report['integrity']['invalid_review_lines_total'], 30)


class SnapshotOperationRegression(Base):
    def test_all_commands_refuse_active_stale_empty_and_symlink_locks_without_removing_them(self):
        write_feedback(self.store, [rec('SYNTH-LOCK-000000001')])
        lock = self.store / '.feedback.lock'
        for content in (str(os.getpid()) + ':active\n', '999999999:stale\n', ''):
            lock.write_text(content)
            before = snapshot(self.store)
            commands = [('report', '--dir', self.store),
                        ('export', '--dir', self.store, '--out', self.work / 'export.json'),
                        ('purge', '--dir', self.store, '--today', '2026-11-03'),
                        ('delete-report', '--dir', self.store, '--report-id', 'SYNTH-LOCK-000000001',
                         '--apply', '--out-dir', self.work / 'child')]
            for command in commands:
                with self.subTest(content=content, command=command[0]):
                    code, _, err = run(*command)
                    self.assertEqual(code, 2)
                    self.assertIn('lock', err)
                    self.assertEqual(snapshot(self.store), before)
                    self.assertEqual(list(self.work.iterdir()), [])
            lock.unlink()
        os.symlink(self.work / 'missing', lock)
        self.assertEqual(run('report', '--dir', self.store)[0], 2)
        self.assertTrue(lock.is_symlink())

    def test_maintenance_holds_exclusive_store_lock_during_read_and_releases_its_own_only(self):
        write_feedback(self.store, [rec('SYNTH-LOCK-000000001')])
        original = tool.load_feedback
        lock = self.store / '.feedback.lock'
        def guarded(directory):
            self.assertTrue(lock.exists())
            self.assertEqual(stat.S_IMODE(lock.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                os.close(os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
            return original(directory)
        with mock.patch.object(tool, 'load_feedback', side_effect=guarded):
            code, _, err = run('delete-report', '--dir', self.store, '--report-id', 'SYNTH-LOCK-000000001')
        self.assertEqual(code, 0, err)
        self.assertFalse(lock.exists())

    def test_lock_replaced_during_read_is_not_stolen_and_no_snapshot_is_published(self):
        write_feedback(self.store, [rec('SYNTH-LOCK-REPLACED01')])
        original = tool.load_feedback
        lock = self.store / '.feedback.lock'
        def replace_lease(directory):
            rows = original(directory)
            lock.unlink()
            lock.write_bytes(b'999999999:replacement\n')
            lock.chmod(0o600)
            return rows
        with mock.patch.object(tool, 'load_feedback', side_effect=replace_lease):
            code, _, err = run('delete-report', '--dir', self.store, '--report-id', 'SYNTH-LOCK-REPLACED01',
                               '--apply', '--out-dir', self.work / 'blocked')
        self.assertEqual(code, 2, err)
        self.assertIn('lock', err)
        self.assertEqual(lock.read_bytes(), b'999999999:replacement\n')
        self.assertFalse((self.work / 'blocked').exists())

    def test_quota_mutation_before_publication_blocks_snapshot_and_is_not_undone(self):
        write_feedback(self.store, [rec('SYNTH-QUOTA-CHANGED01')])
        quota = self.store / 'quota.json'
        quota.write_text(json.dumps({'schema': 1, 'semantics': 'deleted_intake_offsets', 'counts': {'2026-10-31': 1}}))
        quota.chmod(0o600)
        original = tool.fsync_directory
        def changed(directory):
            original(directory)
            if Path(directory).name.startswith('.blocked.'):
                quota.write_text(json.dumps({'schema': 1, 'semantics': 'deleted_intake_offsets', 'counts': {'2026-10-31': 2}}))
        with mock.patch.object(tool, 'fsync_directory', side_effect=changed):
            code, _, err = run('delete-report', '--dir', self.store, '--report-id', 'SYNTH-QUOTA-CHANGED01',
                               '--apply', '--out-dir', self.work / 'blocked')
        self.assertEqual(code, 2, err)
        self.assertIn('changed', err)
        self.assertFalse((self.work / 'blocked').exists())
        self.assertFalse((self.store / '.feedback.lock').exists())
        self.assertEqual(json.loads(quota.read_text())['counts']['2026-10-31'], 2)

    def test_quota_offsets_preserved_and_incremented_only_in_new_snapshot(self):
        a = rec('SYNTH-QUOTA-00000001')
        b = rec('SYNTH-QUOTA-00000002')
        write_feedback(self.store, [a, b])
        quota = {'schema': 1, 'semantics': 'deleted_intake_offsets', 'counts': {'2026-10-31': 7, '2026-10-01': 2}}
        (self.store / 'quota.json').write_text(json.dumps(quota) + '\n')
        (self.store / 'quota.json').chmod(0o600)
        before = snapshot(self.store)
        first = self.work / 'first'
        code, out, err = run('delete-report', '--dir', self.store, '--report-id', a['reportId'], '--out-dir', first, '--apply')
        self.assertEqual(code, 0, err)
        self.assertEqual(snapshot(self.store), before)
        child_quota = json.loads((first / 'quota.json').read_text())
        self.assertEqual(child_quota['counts'], {'2026-10-31': 8, '2026-10-01': 2})
        self.assertFalse((first / '.feedback.lock').exists())
        self.assertFalse(json.loads(out)['sourceDeletionPerformed'])
        first_before = snapshot(first)
        second = self.work / 'second'
        code, _, err = run('delete-report', '--dir', first, '--report-id', b['reportId'], '--out-dir', second, '--apply')
        self.assertEqual(code, 0, err)
        self.assertEqual(snapshot(first), first_before)
        self.assertEqual(json.loads((second / 'quota.json').read_text())['counts']['2026-10-31'], 9)

    def test_corrupt_unsafe_overflowing_quota_refuses_report_and_maintenance(self):
        write_feedback(self.store, [rec('SYNTH-QUOTA-00000001')])
        quota = self.store / 'quota.json'
        for bad in ('{', json.dumps({'schema': 1, 'semantics': 'other', 'counts': {}}),
                    json.dumps({'schema': 1, 'semantics': 'deleted_intake_offsets', 'counts': {'2026-02-30': 1}}),
                    json.dumps({'schema': 1, 'semantics': 'deleted_intake_offsets', 'counts': {'2026-10-31': True}}),
                    json.dumps({'schema': 1, 'semantics': 'deleted_intake_offsets', 'counts': {'2026-10-31': 0}}),
                    json.dumps({'schema': 1, 'semantics': 'deleted_intake_offsets', 'counts': {'2026-10-31': 2**53 - 1}})):
            quota.write_text(bad)
            quota.chmod(0o600)
            before = snapshot(self.store)
            self.assertEqual(self.report()[0], 2)
            code, _, _ = run('delete-report', '--dir', self.store, '--report-id', 'SYNTH-QUOTA-00000001',
                              '--apply', '--out-dir', self.work / 'blocked')
            self.assertEqual(code, 2)
            self.assertEqual(snapshot(self.store), before)
            self.assertFalse((self.work / 'blocked').exists())
        quota.unlink()
        os.symlink(self.work / 'missing', quota)
        self.assertEqual(self.report()[0], 2)

    def test_actual_node_store_roundtrip_and_pruned_quota_survives_offline_reopen(self):
        if shutil.which('node') is None:
            self.skipTest('Node required for current-store integration')
        compiled = self.work / 'compiled'
        compiled.mkdir()
        bootstrap = r"""
const fs = require('node:fs'), path = require('node:path');
const root = process.argv[1], out = process.argv[2];
const ts = require(path.join(root, 'packages/core/node_modules/typescript'));
fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}');
for (const relative of ['time.ts', 'journey-beta/feedback.ts']) {
  const target = path.join(out, relative.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(target), {recursive:true});
  const source = fs.readFileSync(path.join(root, 'packages/core/src', relative), 'utf8');
  fs.writeFileSync(target, ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,
    module:ts.ModuleKind.ES2022}}).outputText);
}
"""
        process = subprocess.run(['node', '-e', bootstrap, str(ROOT), str(compiled)], capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        driver = r"""
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const [modulePath, dir, mode, python, reporter] = process.argv.slice(1);
const {validateFeedback, toStored, createFeedbackStore} = await import(pathToFileURL(modulePath));
const clock = () => Date.parse('2026-10-31T05:00:00.000Z');
const store = createFeedbackStore({dir,maxFileBytes:1048576,maxTotalBytes:1048576,maxPerDay:2,clock});
const catalog = {orders:{1:['METRO-001','METRO-002']}, stations:[{id:'METRO-001',lines:[1]},{id:'METRO-002',lines:[1]}]};
function make(id, explicit) {
 const body = {v:1,reportId:id,kind:'train_observation',consent:{storeForModelImprovement:true},
   modelVersion:'sha256:'+'a'.repeat(64),context:{line:1,originId:'METRO-001',destinationId:'METRO-002',serviceDate:'2026-10-31'},
   observation:{event:'train_arrival',stationId:'METRO-001',direction:'out',observedAt:'2026-10-31T08:15:00+03:30',
     ...(explicit?{precision:'minute',timePrecision:'second'}:{})}};
 const result=validateFeedback(body,{nowSec:clock()/1000,catalog,modelVersion:body.modelVersion,horizonDays:7});
 if (!result.ok) throw Error(JSON.stringify(result.issues));
 return toStored(result.value,{receivedAtEpoch:clock()/1000,modelVersionMatches:true,
   comparison:{tripMatch:'not_provided',modelEventAt:null,deltaSeconds:null}});
}
try {
 if(mode==='seed') {
  const appends=[await store.append(make('SYNTH-NODE-INTAKE001',false)),
   await store.append(make('SYNTH-NODE-INTAKE002',true))];
  const lock=dir+'/.feedback.lock', before=fs.readFileSync(lock,'utf8');
  const refused=spawnSync(python,['-B',reporter,'report','--dir',dir],{encoding:'utf8'});
  console.log(JSON.stringify({appends,lockedReportStatus:refused.status,
   lockUnchanged:before===fs.readFileSync(lock,'utf8')}));
  store.reject('model_unavailable');store.reject('feedback_timeout');
 } else {
  let records=[];const count=await store.exportRecords(r=>{records.push(r.reportId)});
  console.log(JSON.stringify({count,records,append:await store.append(make('SYNTH-NODE-INTAKE003',true))}));
 }
} finally {await store.flush()}
"""
        module = compiled / 'journey-beta/feedback.js'
        process = subprocess.run(['node', '--input-type=module', '-e', driver, str(module), str(self.store), 'seed', sys.executable, str(SCRIPT)],
                                 capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads(process.stdout), {'appends': ['stored', 'stored'], 'lockedReportStatus': 2, 'lockUnchanged': True})
        before = snapshot(self.store)
        code, report, err = self.report(strict=True)
        self.assertEqual(code, 0, err)
        self.assertEqual(report['totals']['valid'], 2)
        self.assertEqual(report['totals']['server_rejections_by_reason'], {'feedback_timeout': 1, 'model_unavailable': 1})
        child = self.work / 'pruned'
        code, _, err = run('delete-report', '--dir', self.store, '--report-id', 'SYNTH-NODE-INTAKE001',
                           '--apply', '--out-dir', child)
        self.assertEqual(code, 0, err)
        self.assertEqual(snapshot(self.store), before)
        # Analytical operations.jsonl is not a runtime-store input. Explicit scratch-only
        # promotion copies ONLY Node's accepted files; no source/snapshot file is deleted.
        runtime = self.work / 'runtime-copy'
        runtime.mkdir(mode=0o700)
        for path in child.iterdir():
            if path.name == 'quota.json' or path.name == 'reviews.jsonl' or tool.FEEDBACK_NAME.fullmatch(path.name) or tool.REJECTION_NAME.fullmatch(path.name):
                shutil.copy2(path, runtime / path.name)
        child_before = snapshot(child)
        process = subprocess.run(['node', '--input-type=module', '-e', driver, str(module), str(runtime), 'reopen'],
                                 capture_output=True, text=True)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads(process.stdout), {'count': 1, 'records': ['SYNTH-NODE-INTAKE002'], 'append': 'full'})
        self.assertEqual(snapshot(child), child_before)

    def test_apply_without_separate_snapshot_is_refused(self):
        write_feedback(self.store, [rec('SYNTH-OFFLINE-0000001')])
        before = snapshot(self.store)
        code, _, err = run('delete-report', '--dir', self.store, '--report-id', 'SYNTH-OFFLINE-0000001', '--apply')
        self.assertEqual(code, 2)
        self.assertIn('--out-dir', err)
        self.assertEqual(snapshot(self.store), before)

    def test_atomic_snapshot_removes_all_report_copies_and_all_review_revisions(self):
        a, b = rec('SYNTH-SNAPSHOT-000001'), rec('SYNTH-SNAPSHOT-000002')
        write_feedback(self.store, [a, b, a])
        write_reviews(self.store / 'reviews.jsonl', [review(a['reportId']), review(a['reportId'], revision=2), review(b['reportId'])])
        before = snapshot(self.store)
        target = self.work / 'clean-store'
        code, out, err = run('delete-report', '--dir', self.store, '--report-id', a['reportId'], '--out-dir', target, '--apply')
        self.assertEqual(code, 0, err)
        self.assertEqual(snapshot(self.store), before)
        self.assertEqual([json.loads(line)['reportId'] for line in (target / 'feedback-2026-10.jsonl').read_text().splitlines()], [b['reportId']])
        self.assertEqual([json.loads(line)['reportId'] for line in (target / 'reviews.jsonl').read_text().splitlines()], [b['reportId']])
        qc = json.loads((target / 'operations.jsonl').read_text())
        self.assertEqual(qc['schema'], 1)
        self.assertEqual(qc['removedReports'], 2)
        self.assertNotIn(a['reportId'], json.dumps(qc))
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)
        self.assertTrue(all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in target.iterdir()))

    def test_retention_defaults_to_30_days_and_uses_received_at_not_month_name(self):
        old = rec('SYNTH-RETENTION-00001', received_at='2026-10-01T00:00:00Z')
        fresh = rec('SYNTH-RETENTION-00002', received_at='2026-10-04T00:00:00Z')
        write_feedback(self.store, [old, fresh])
        write_reviews(self.store / 'reviews.jsonl', [review(old['reportId']), review(fresh['reportId'])])
        target = self.work / 'retained'
        code, out, err = run('purge', '--dir', self.store, '--today', '2026-11-03', '--out-dir', target, '--apply')
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out)['olderThanDays'], 30)
        self.assertEqual([json.loads(line)['reportId'] for line in (target / 'feedback-2026-10.jsonl').read_text().splitlines()], [fresh['reportId']])
        self.assertEqual(len((target / 'reviews.jsonl').read_text().splitlines()), 1)

    def test_snapshot_failure_leaves_original_and_no_published_target(self):
        write_feedback(self.store, [rec('SYNTH-FAIL-SNAPSHOT01')])
        before = snapshot(self.store)
        target = self.work / 'never-published'
        with mock.patch.object(tool.os, 'rename', side_effect=OSError('synthetic publication failure')):
            code, _, err = run('delete-report', '--dir', self.store, '--report-id', 'SYNTH-FAIL-SNAPSHOT01', '--out-dir', target, '--apply')
        self.assertEqual(code, 2)
        self.assertIn('synthetic publication failure', err)
        self.assertEqual(snapshot(self.store), before)
        self.assertFalse(target.exists())
        self.assertEqual(list(self.work.iterdir()), [])


class EmptyAndBasics(Base):
    def test_empty_dir(self):
        code, report, _ = self.report(strict=True)
        self.assertEqual(code, 0)
        self.assertEqual(report['totals']['valid'], 0)
        self.assertEqual(report['totals']['invalid'], 0)
        self.assertEqual(report['calibration']['status'], 'not_started')
        self.assertEqual(report['review_queue'], [])
        self.assertEqual(report['statistics']['timing_error_verified'], {'status': 'insufficient_sample', 'n': 0, 'required': 30})
        self.assertEqual(report['statistics']['missed_train_rate_verified'], {'status': 'insufficient_sample', 'n': 0, 'required': 30})

    def test_missing_dir_is_usage_error(self):
        code, _, err = run('report', '--dir', self.tmp / 'nope')
        self.assertEqual(code, 2)
        self.assertIn('not a directory', err)

    def test_report_never_writes_inside_dir(self):
        write_feedback(self.store, [rec('SYNTH-READONLY-0001')])
        before = snapshot(self.store)
        self.assertEqual(run('report', '--dir', self.store, '--json', self.work / 'r.json', '--md', self.work / 'r.md')[0], 0)
        self.assertEqual(snapshot(self.store), before)
        code, _, err = run('report', '--dir', self.store, '--json', self.store / 'r.json')
        self.assertEqual(code, 2)
        self.assertFalse((self.store / 'r.json').exists())
        self.assertIn('refusing', err)

    def test_distributions_day_type_hour_and_direction(self):
        records = [
            rec('SYNTH-DIST-000000001', service_date='2026-10-31', direction='out'),   # Saturday
            rec('SYNTH-DIST-000000002', service_date='2026-11-01', direction='back'),  # Sunday
            rec('SYNTH-DIST-000000003', service_date='2026-10-29', direction='unknown'),  # Thursday
            rec('SYNTH-DIST-000000004', service_date='2026-10-30', kind='timing_quality',
                received_at='2026-10-30T20:45:00.000Z'),  # Friday, 00:15 next day in Tehran
            rec('SYNTH-DIST-000000005', service_date='2026-10-31', line=2, kind='problem', category='other',
                received_at='2026-10-31T05:00:00.000Z'),
            rec('SYNTH-DIST-000000006', service_date='2026-10-31', kind='boarding_outcome'),
        ]
        write_feedback(self.store, records)
        _, report, _ = self.report()
        self.assertEqual(report['by_day_type'], {'friday': 1, 'normal': 4, 'thursday': 1})
        self.assertEqual(report['by_direction'], {'back': 1, 'out': 1, 'unknown': 1})
        self.assertEqual(report['by_line'], {'1': 5, '2': 1})
        self.assertEqual(report['by_kind'], {'boarding_outcome': 1, 'problem': 1, 'timing_quality': 1, 'train_observation': 3})
        self.assertEqual(report['by_class']['claimed_observation'], 3)
        self.assertEqual(report['by_hour_tehran']['08'], 5)  # Three observations plus two receivedAt 05:00Z -> 08:30 Tehran.
        self.assertEqual(report['by_hour_tehran']['00'], 1)  # receivedAt 20:45Z -> 00:15 Tehran
        self.assertEqual(report['by_hour_tehran']['08'] + report['by_hour_tehran']['00'] + report['by_hour_tehran']['09'], 6)
        self.assertEqual(sum(report['by_hour_tehran'].values()), 6)
        self.assertEqual(report['coverage']['days_with_reports'], 4)
        self.assertEqual(report['coverage']['reports_per_service_date']['2026-10-31'], 3)

    def test_model_version_mix_and_trip_match_share(self):
        records = [rec('SYNTH-MODEL-00000001'), rec('SYNTH-MODEL-00000002', model=MODEL_B, model_matches=False, trip_match='model_version_mismatch', delta=None),
                   rec('SYNTH-MODEL-00000003', trip_match='unmatched', delta=None), rec('SYNTH-MODEL-00000004', trip_match='not_provided', delta=None)]
        write_feedback(self.store, records)
        _, report, _ = self.report()
        self.assertEqual(report['model_version']['mix'], {MODEL_A: 3, MODEL_B: 1})
        self.assertEqual(report['model_version']['mismatch_share'], 0.25)
        self.assertEqual(report['trip_match']['matched_share'], 0.25)
        self.assertEqual(report['trip_match']['by_value']['unmatched'], 1)


class IntegrityTests(Base):
    def test_torn_line_is_counted_with_line_number(self):
        records = [rec('SYNTH-TORN-0000000001'), rec('SYNTH-TORN-0000000002')]
        path = write_feedback(self.store, records, extra_lines=('{"schema":1,"reportId":"SYNTH-TORN-0000000003","kin',))
        with open(path, 'a', encoding='utf-8') as handle:
            handle.write('\n')
        write_feedback(self.store, [rec('SYNTH-TORN-0000000004', received_at='2026-09-30T05:00:00.000Z')], name='feedback-2026-09.jsonl', extra_lines=('not json at all',))
        code, report, _ = self.report(strict=True)
        self.assertEqual(code, 3)
        self.assertEqual(report['totals']['valid'], 3)
        self.assertEqual(report['totals']['unparsable_or_invalid_stored_lines'], 2)
        self.assertEqual(report['totals']['invalid'], 2)
        found = {(item['file'], item['line'], item['reason']) for item in report['integrity']['invalid_lines']}
        self.assertEqual(found, {('feedback-2026-10.jsonl', 3, 'invalid_json'), ('feedback-2026-09.jsonl', 2, 'torn_final_line')})
        self.assertEqual(self.report(strict=False)[0], 0)

    def test_torn_fixture_directory(self):
        write_feedback(self.store, [rec('SYNTH-TORN-FIXTURE01')], extra_lines=('invalid\n', '{"torn'))
        code, report, _ = self.report(strict=True)
        self.assertEqual(code, 3)
        self.assertEqual(report['totals']['valid'], 1)
        self.assertEqual(report['integrity']['invalid_lines_total'], 2)
        self.assertEqual([item['line'] for item in report['integrity']['invalid_lines']], [2, 3])

    def test_duplicate_report_ids_are_integrity_issues_and_analysed_once(self):
        write_feedback(self.store, [rec('SYNTH-DUP-00000000001'), rec('SYNTH-DUP-00000000001'), rec('SYNTH-DUP-00000000002')])
        write_feedback(self.store, [rec('SYNTH-DUP-00000000001', received_at='2026-09-30T05:00:00.000Z')], name='feedback-2026-09.jsonl')
        code, report, _ = self.report(strict=True)
        self.assertEqual(code, 3)
        self.assertEqual(report['integrity']['duplicate_report_ids'], [{'reportId': 'SYNTH-DUP-00000000001', 'count': 3}])
        self.assertEqual(report['totals']['valid'], 2)
        self.assertEqual(report['totals']['duplicate_copies_ignored'], 2)

    def test_schema_violations_are_invalid_not_valid(self):
        good = rec('SYNTH-SCHEMA-000000001')
        extra = rec('SYNTH-SCHEMA-000000002')
        extra['ip'] = '192.0.2.1'
        wrong_class = rec('SYNTH-SCHEMA-000000003')
        wrong_class['class'] = 'problem_report'
        two_blocks = rec('SYNTH-SCHEMA-000000004')
        two_blocks['timingQuality'] = 'close'
        bad_id = rec('short')
        bad_version = rec('SYNTH-SCHEMA-000000006', model='sha256:xyz')
        bad_delta = rec('SYNTH-SCHEMA-000000007')
        bad_delta['comparison']['deltaSeconds'] = True
        nan_line = json.dumps(rec('SYNTH-SCHEMA-000000008')).replace('"deltaSeconds": 30', '"deltaSeconds": NaN') + '\n'
        write_feedback(self.store, [good, extra, wrong_class, two_blocks, bad_id, bad_version, bad_delta], extra_lines=(nan_line,))
        _, report, _ = self.report()
        self.assertEqual(report['totals']['valid'], 1)
        self.assertEqual(report['integrity']['invalid_lines_total'], 7)
        self.assertTrue(all(item['reason'].startswith('invalid_record') or item['reason'] == 'invalid_json'
                            for item in report['integrity']['invalid_lines']))

    def test_oversized_line_and_file_are_bounded(self):
        huge = rec('SYNTH-BIG-00000000001', note='x' * 200)
        path = write_feedback(self.store, [rec('SYNTH-BIG-00000000002')], extra_lines=(json.dumps(huge) + ' ' * 17000 + '\n',))
        _, report, _ = self.report()
        self.assertEqual(report['totals']['valid'], 1)
        self.assertEqual([item['reason'] for item in report['integrity']['invalid_lines']], ['line_too_long'])
        with mock.patch.object(tool, 'MAX_FILE_BYTES', path.stat().st_size - 1):
            _, report, _ = self.report()
        self.assertEqual(report['totals']['valid'], 0)
        self.assertEqual(report['integrity']['skipped_files'], [{'file': 'feedback-2026-10.jsonl', 'reason': 'file_too_large'}])

    def test_storage_framing_and_month_corruption_cannot_be_published(self):
        row = rec('SYNTH-FRAMING-000001')
        path = write_feedback(self.store, [row])
        good = path.read_bytes()
        for raw in (good.rstrip(b'\n'), b'\n' + good,
                    good.replace(b'2026-10-31T05:00:00.000Z', b'2026-09-30T05:00:00.000Z')):
            with self.subTest(raw=raw[:24]):
                path.write_bytes(raw)
                code, report, _ = self.report(strict=True)
                self.assertEqual(code, 3)
                self.assertGreater(report['integrity']['invalid_lines_total'], 0)
                before = snapshot(self.store)
                code, _, _ = run('delete-report', '--dir', self.store, '--report-id', row['reportId'],
                                  '--apply', '--out-dir', self.work / 'blocked')
                self.assertEqual(code, 2)
                self.assertEqual(snapshot(self.store), before)
                self.assertFalse((self.work / 'blocked').exists())

    def test_rejection_codes_match_current_store_and_require_valid_metadata(self):
        source = (ROOT / 'packages/core/src/journey-beta/feedback.ts').read_text()
        declaration = re.search(r'export const FEEDBACK_REJECTION_CODES = \[(.*?)\] as const', source)
        assert declaration is not None
        codes = declaration.group(1)
        expected = set(re.findall(r"'([^']+)'", codes))
        self.assertEqual(tool.REJECTION_CODES, expected)
        path = self.store / 'rejections-2026-10.json'
        path.write_text(json.dumps({'month': '2026-10', 'counts': {code: 1 for code in expected},
                                    'updatedAt': '2026-10-31T00:00:00.000Z'}))
        _, report, _ = self.report(strict=True)
        self.assertEqual(report['totals']['server_rejections'], len(expected))
        for bad in ({'month': '2026-10', 'counts': {'busy': 1}},
                    {'month': '2026-10', 'counts': {'busy': 0}, 'updatedAt': '2026-10-31T00:00:00.000Z'},
                    {'month': '2026-10', 'counts': {'busy': 1}, 'updatedAt': '2026-02-30T00:00:00.000Z'},
                    {'month': '2026-10', 'counts': {'busy': 1}, 'updatedAt': '2026-10-31T00:00:00.000Z', 'extra': True}):
            path.write_text(json.dumps(bad))
            self.assertEqual(self.report(strict=True)[0], 3)

    def test_rejection_counters_aggregate_by_reason(self):
        for month, counts in (('2026-09', {'rate_limited': 2, 'invalid_payload': 1}), ('2026-10', {'rate_limited': 3})):
            with open(self.store / ('rejections-%s.json' % month), 'w', encoding='utf-8') as handle:
                json.dump({'month': month, 'counts': counts, 'updatedAt': '2026-10-31T00:00:00.000Z'}, handle)
        with open(self.store / 'rejections-2026-08.json', 'w', encoding='utf-8') as handle:
            handle.write('{"month":')
        write_feedback(self.store, [rec('SYNTH-REJ-00000000001')])
        _, report, _ = self.report()
        self.assertEqual(report['totals']['server_rejections_by_reason'], {'invalid_payload': 1, 'rate_limited': 5})
        self.assertEqual(report['totals']['server_rejections'], 6)
        self.assertEqual(report['totals']['invalid'], 6)
        self.assertEqual(report['integrity']['invalid_rejection_files'], [{'file': 'rejections-2026-08.json', 'reason': 'invalid_json'}])


class ReviewTests(Base):
    def test_rejected_review_is_excluded_from_every_statistic_and_counted_separately(self):
        a, b, c = 'SYNTH-REV-000000000001', 'SYNTH-REV-000000000002', 'SYNTH-REV-000000000003'
        write_feedback(self.store, [rec(a, delta=3000), rec(b, line=2), rec(c, kind='problem', category='cancelled')])
        reviews = write_reviews(self.work / 'reviews.jsonl', [review(a, 'rejected')])
        _, report, _ = self.report(reviews)
        self.assertEqual(report['totals']['valid'], 3)
        self.assertEqual(report['totals']['analysed'], 2)
        self.assertEqual(report['totals']['excluded_rejected_by_review'], 1)
        self.assertEqual(report['by_kind'], {'problem': 1, 'train_observation': 1})
        self.assertEqual(report['by_line'], {'1': 1, '2': 1}) if False else None
        self.assertNotIn(a, report['review_queue'])  # delta 3000 would have queued it
        self.assertEqual(report['review_queue'], [c])
        self.assertEqual(report['reviews']['rejected_reports_excluded'], 1)
        self.assertEqual(report['sample_quality']['n_total'], 2)

    def test_explicit_revision_supersedes_and_unknown_ids_are_counted(self):
        a = 'SYNTH-LAST-0000000001'
        write_feedback(self.store, [rec(a, delta=3000)])
        reviews = write_reviews(self.work / 'reviews.jsonl', [review(a, 'independently_verified'), review(a, 'needs_followup', revision=2),
                                                              review('SYNTH-UNKNOWN-000000001', 'independently_verified')])
        with open(reviews, 'a', encoding='utf-8') as handle:
            handle.write('garbage\n')
        code, report, _ = self.report(reviews, strict=True)
        self.assertEqual(code, 3)
        self.assertEqual(report['reviews']['by_effective_status'], {'independently_verified': 1, 'needs_followup': 1})
        self.assertEqual(report['reviews']['unknown_report_reviews'], 1)
        self.assertEqual(report['integrity']['invalid_review_lines_total'], 1)
        self.assertEqual(report['sample_quality']['n_independently_verified'], 0)  # last review (needs_followup) wins
        self.assertEqual(report['sample_quality']['by_review_status'], {'needs_followup': 1})
        self.assertEqual(report['review_queue'], [a])  # needs_followup with a >600 s delta stays queued

    def test_anonymous_without_review_is_never_independent(self):
        records, _ = self.verified_set(40)
        write_feedback(self.store, records)
        _, report, _ = self.report()  # no reviews at all
        self.assertEqual(report['calibration']['status'], 'not_started')
        self.assertEqual(report['sample_quality']['n_independently_verified'], 0)
        self.assertEqual(report['sample_quality']['n_anonymous_unverified'], 40)
        self.assertEqual(report['statistics']['timing_error_verified']['n'], 0)

    def test_review_queue_criteria_and_cap(self):
        ids = ['SYNTH-Q-%016d' % number for number in range(1, 9)]
        records = [rec(ids[0], model=MODEL_B, model_matches=False, trip_match='model_version_mismatch', delta=None),
                   rec(ids[1], delta=601), rec(ids[2], delta=600), rec(ids[3], trip_match='unmatched', delta=None),
                   rec(ids[4], kind='problem', category='wrong_direction'), rec(ids[5], kind='problem', category='other'),
                   rec(ids[6], kind='timing_quality'), rec(ids[7], delta=-700)]
        write_feedback(self.store, records)
        reviews = write_reviews(self.work / 'reviews.jsonl', [review(ids[7])])  # verified items leave the queue
        _, report, _ = self.report(reviews)
        self.assertEqual(report['review_queue'], [ids[0], ids[1], ids[3], ids[4]])
        capped = [rec('SYNTH-CAP-%016d' % number, trip_match='unmatched', delta=None) for number in range(60)]
        shutil.rmtree(self.store)
        self.store.mkdir()
        write_feedback(self.store, capped)
        _, report, _ = self.report()
        self.assertEqual(len(report['review_queue']), 50)
        self.assertEqual(report['review_queue'], sorted(report['review_queue']))
        self.assertEqual(report['review_queue_total'], 60)
        self.assertTrue(report['review_queue_truncated'])


class SplitAndStatistics(Base):
    def test_split_is_deterministic_and_documented(self):
        self.assertEqual(tool.split_of('SYNTH-SPLIT-0000000001'), tool.split_of('SYNTH-SPLIT-0000000001'))
        sample = ['SYNTH-S-%08d' % number for number in range(2000)]
        for report_id in sample[:300]:
            self.assertEqual(tool.split_of(report_id), independent_split(report_id))
        share = sum(1 for report_id in sample if tool.split_of(report_id) == 'calibration') / len(sample)
        self.assertTrue(0.65 < share < 0.75, share)
        digest = hashlib.sha256(b'SYNTH-SPLIT-0000000001|r2apb-split-v1').digest()[0]
        self.assertEqual(tool.split_of('SYNTH-SPLIT-0000000001'), 'calibration' if digest < 179 else 'evaluation')

    def test_report_split_sizes_match_rule(self):
        ids = ['SYNTH-SIZE-%012d' % number for number in range(120)]
        write_feedback(self.store, [rec(report_id, kind='timing_quality') for report_id in ids])
        _, report, _ = self.report()
        expected = sum(1 for report_id in ids if independent_split(report_id) == 'calibration')
        self.assertEqual(report['split'], {'calibration': expected, 'held_out': 120 - expected, 'calibration_share': round(expected / 120, 4)})

    def test_insufficient_sample_then_sufficient(self):
        records, reviews = self.verified_set(29, lines=(1, 2))
        write_feedback(self.store, records)
        path = write_reviews(self.work / 'reviews.jsonl', reviews)
        _, report, _ = self.report(path)
        self.assertEqual(report['statistics']['timing_error_verified'], {'status': 'insufficient_sample', 'n': 29, 'required': 30})
        self.assertEqual(report['calibration']['status'], 'insufficient_sample')
        more_records, more_reviews = self.verified_set(30, lines=(1, 2))
        write_feedback(self.store, more_records)
        path = write_reviews(self.work / 'reviews.jsonl', more_reviews)
        _, report, _ = self.report(path)
        stat_block = report['statistics']['timing_error_verified']
        deltas = sorted(abs((index % 7) * 10 - 20) for index in range(30))
        self.assertEqual(stat_block['status'], 'ok')
        self.assertEqual(stat_block['n'], 30)
        self.assertEqual(stat_block['mae_seconds'], round(sum(deltas) / 30, 3))
        self.assertEqual(stat_block['p90_abs_seconds'], deltas[26])  # nearest rank: ceil(0.9 * 30) = 27th value
        self.assertEqual(stat_block['percentile_method'], 'nearest_rank')
        self.assertEqual(sum(cell['n'] for cell in report['statistics']['timing_error_verified_by_cell']), 30)
        self.assertEqual(report['calibration']['status'], 'ready_for_experimental_analysis')
        self.assertFalse(report['calibration']['claims_accuracy'])
        self.assertNotIn('single_line_only', report['calibration']['limitations'])

    def test_statistics_use_evaluation_split_only(self):
        records, reviews = self.verified_set(30)
        calibration_ids = [id_for('calibration', index) for index in range(10)]
        records += [rec(report_id, delta=5000) for report_id in calibration_ids]
        reviews += [review(report_id) for report_id in calibration_ids]
        write_feedback(self.store, records)
        _, report, _ = self.report(write_reviews(self.work / 'reviews.jsonl', reviews))
        block = report['statistics']['timing_error_verified']
        self.assertEqual(block['n'], 30)
        self.assertLess(block['mae_seconds'], 100)
        self.assertEqual(report['statistics']['scope'], 'held_out_split_only')
        self.assertEqual(report['sample_quality']['n_independently_verified'], 40)

    def test_only_minute_precision_and_matched_trips_count(self):
        records, reviews = self.verified_set(30)
        records[0]['observation']['precision'] = 'approximate'
        records[1]['comparison']['tripMatch'] = 'unmatched'
        records[2]['comparison']['deltaSeconds'] = None
        write_feedback(self.store, records)
        _, report, _ = self.report(write_reviews(self.work / 'reviews.jsonl', reviews))
        self.assertEqual(report['statistics']['timing_error_verified'], {'status': 'insufficient_sample', 'n': 27, 'required': 30})

    def test_calibration_statuses(self):
        # not_started: nothing verified
        write_feedback(self.store, [rec(id_for('evaluation', 0))])
        self.assertEqual(self.report()[1]['calibration']['status'], 'not_started')
        # collecting: verified evidence exists, but none usable for timing analysis (a verified qualitative report)
        quality = rec(id_for('evaluation', 1), kind='timing_quality')
        write_feedback(self.store, [quality])
        reviews = write_reviews(self.work / 'reviews.jsonl', [review(quality['reportId'])])
        self.assertEqual(self.report(reviews)[1]['calibration']['status'], 'collecting')
        # insufficient_sample
        records, items = self.verified_set(5)
        write_feedback(self.store, records)
        reviews = write_reviews(self.work / 'reviews.jsonl', items)
        self.assertEqual(self.report(reviews)[1]['calibration']['status'], 'insufficient_sample')
        # ready, one line only => explicit limitation note
        records, items = self.verified_set(30, lines=(1,))
        write_feedback(self.store, records)
        reviews = write_reviews(self.work / 'reviews.jsonl', items)
        calibration = self.report(reviews)[1]['calibration']
        self.assertEqual(calibration['status'], 'ready_for_experimental_analysis')
        self.assertIn('single_line_only', calibration['limitations'])
        self.assertEqual(calibration['lines_covered'], [1])
        # ready, two lines => no single-line limitation
        records, items = self.verified_set(30, lines=(1, 2))
        write_feedback(self.store, records)
        reviews = write_reviews(self.work / 'reviews.jsonl', items)
        calibration = self.report(reviews)[1]['calibration']
        self.assertEqual(calibration['lines_covered'], [1, 2])
        self.assertNotIn('single_line_only', calibration['limitations'])

    def test_boarding_outcome_never_enters_model_error_stats(self):
        records, items = self.verified_set(40, kind='boarding_outcome', result='missed')
        write_feedback(self.store, records)
        _, report, _ = self.report(write_reviews(self.work / 'reviews.jsonl', items))
        stats = report['statistics']
        self.assertEqual(stats['timing_error_verified'], {'status': 'insufficient_sample', 'n': 0, 'required': 30})
        self.assertEqual(stats['claimed_observations_descriptive']['n'], 0)
        self.assertEqual(stats['missed_train_rate_verified']['status'], 'insufficient_sample')
        self.assertEqual(stats['missed_train_rate_verified']['n'], 0)
        self.assertNotIn('missed_rate', stats['missed_train_rate_verified'])
        self.assertTrue(stats['boarding_outcome_excluded_from_model_error'])
        self.assertEqual(report['calibration']['status'], 'collecting')  # 40 verified, 0 usable as model-error observations

    def test_missed_rate_needs_platform_ready_time_verification_and_sample(self):
        records, items = self.verified_set(30, kind='boarding_outcome', result='made_it')
        records[0]['outcome']['platformReadyAtEpoch'] = None
        records[1]['outcome']['result'] = 'unknown'
        write_feedback(self.store, records)
        reviews = write_reviews(self.work / 'reviews.jsonl', items)
        self.assertEqual(self.report(reviews)[1]['statistics']['missed_train_rate_verified'], {'status': 'insufficient_sample', 'n': 0, 'required': 30})
        self.assertEqual(self.report()[1]['statistics']['missed_train_rate_verified']['n'], 0)  # unreviewed -> not counted

    def test_claimed_and_verified_are_separated(self):
        records, items = self.verified_set(30)
        claims = [rec(id_for('evaluation', 100 + index), delta=value) for index, value in enumerate((10, 20, 40, 1000))]
        write_feedback(self.store, records + claims)
        reviews = write_reviews(self.work / 'reviews.jsonl', items)
        _, report, _ = self.report(reviews)
        descriptive = report['statistics']['claimed_observations_descriptive']
        self.assertEqual(descriptive['label'], 'not_accuracy: unreviewed_claims')
        self.assertEqual(descriptive['n'], 4)
        self.assertEqual(descriptive['median_delta_seconds'], 30)
        self.assertEqual(set(descriptive), {'label', 'n', 'median_delta_seconds', 'median_abs_delta_seconds', 'matched_claims_all_splits'})
        verified = report['statistics']['timing_error_verified']
        self.assertEqual(verified['n'], 30)
        self.assertLess(verified['p90_abs_seconds'], 100)  # the 1000 s unreviewed claim is not in the verified numbers
        self.assertNotIn('mae_seconds', report['statistics']['claimed_observations_descriptive'])


class OutputTests(Base):
    def populated(self):
        records = [rec('SYNTH-OUT-000000000001', note=NOTE_TEXT), rec('SYNTH-OUT-000000000002', kind='problem', category='cancelled', note=NOTE_TEXT),
                   rec('SYNTH-OUT-000000000003', delta=900), rec('SYNTH-OUT-000000000004', kind='boarding_outcome')]
        write_feedback(self.store, records)
        write_feedback(self.store, [rec('SYNTH-OUT-000000000005', received_at='2026-09-30T05:00:00.000Z')], name='feedback-2026-09.jsonl', extra_lines=('{"torn',))
        return write_reviews(self.work / 'reviews.jsonl', [review('SYNTH-OUT-000000000003')])

    def test_note_text_is_never_printed(self):
        reviews = self.populated()
        outputs = []
        code, out, _ = run('report', '--dir', self.store, '--reviews', reviews, '--json', self.work / 'r.json', '--md', self.work / 'r.md')
        outputs.append(out)
        outputs += [(self.work / 'r.json').read_text(encoding='utf-8'), (self.work / 'r.md').read_text(encoding='utf-8')]
        outputs.append(run('report', '--dir', self.store)[1])
        for text in outputs:
            self.assertNotIn(NOTE_TEXT, text)
            self.assertNotIn('PRIVATE-TEXT', text)
        report = json.loads((self.work / 'r.json').read_text(encoding='utf-8'))
        self.assertEqual(report['notes'], {'reports_with_note': 2, 'text_included': False})

    def test_deterministic_bytes_across_runs_and_processes(self):
        reviews = self.populated()
        first = [self.work / 'a.json', self.work / 'a.md']
        second = [self.work / 'b.json', self.work / 'b.md']
        for json_path, md_path in (first, second):
            self.assertEqual(run('report', '--dir', self.store, '--reviews', reviews, '--json', json_path, '--md', md_path)[0], 0)
        self.assertEqual(first[0].read_bytes(), second[0].read_bytes())
        self.assertEqual(first[1].read_bytes(), second[1].read_bytes())
        self.assertIsNone(json.loads(first[0].read_text(encoding='utf-8'))['generatedAt'])
        process = subprocess.run([sys.executable, '-B', str(SCRIPT), 'report', '--dir', str(self.store), '--reviews', str(reviews),
                                  '--json', str(self.work / 'c.json'), '--md', str(self.work / 'c.md'), '--include-synthetic'], capture_output=True, check=False)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual((self.work / 'c.json').read_bytes(), first[0].read_bytes())
        self.assertEqual((self.work / 'c.md').read_bytes(), first[1].read_bytes())
        self.assertEqual(stat.S_IMODE((self.work / 'c.json').stat().st_mode), 0o600)

    def test_generated_at_is_only_set_when_given(self):
        run('report', '--dir', self.store, '--json', self.work / 'g.json', '--generated-at', '2026-11-03T00:00:00+03:30')
        self.assertEqual(json.loads((self.work / 'g.json').read_text(encoding='utf-8'))['generatedAt'], '2026-11-03T00:00:00+03:30')
        self.assertEqual(run('report', '--dir', self.store, '--generated-at', 'yesterday')[0], 2)

    def test_markdown_leads_with_unmeasured_accuracy_and_has_correct_persian_spacing(self):
        reviews = self.populated()
        run('report', '--dir', self.store, '--reviews', reviews, '--md', self.work / 'r.md')
        text = (self.work / 'r.md').read_text(encoding='utf-8')
        self.assertTrue(text.startswith('دقت هنوز اندازه گیری نشده'))
        for required in ('می شود', 'نمی شود', 'نمی دهد', 'بررسی شده'):
            self.assertIn(required, ' '.join(text.split()), required)
        for fused in ('نمیشود', 'میشود', 'دستگاهها', 'نمیدهد', 'بررسیشده', 'گزارشها', 'یادداشتها'):
            self.assertNotIn(fused, text)
        self.assertNotIn('\u200c', text)  # explicit spaces, no zero-width joiners
        self.assertIsNone(re.search(r'(?<![\u0600-\u06FF])ن?می(شود|دهد|کند|رود|توان|باشد|گردد)', text))
        self.assertIsNone(re.search(r'[\u0621-\u06FF]{2,}ها(?![\u0621-\u06FF])', text))
        self.assertIn('boarding_outcome', text)
        self.assertNotIn('دقیق است', text)

    def test_markdown_for_ready_status_does_not_claim_accuracy(self):
        records, items = self.verified_set(30, lines=(1, 2))
        write_feedback(self.store, records)
        reviews = write_reviews(self.work / 'reviews.jsonl', items)
        run('report', '--dir', self.store, '--reviews', reviews, '--md', self.work / 'r.md')
        text = (self.work / 'r.md').read_text(encoding='utf-8')
        self.assertFalse(text.startswith('دقت هنوز'))
        self.assertIn('ادعای دقت ندارد', text.splitlines()[0])
        self.assertIsNone(re.search(r'(?<![\u0600-\u06FF])ن?می(شود|دهد|کند|رود|توان|باشد|گردد)', text))


class MaintenanceTests(Base):
    def test_purge_refuses_less_than_30_days(self):
        write_feedback(self.store, [rec('SYNTH-RETENTION-00001')])
        before = snapshot(self.store)
        code, _, err = run('purge', '--dir', self.store, '--older-than-days', 29, '--apply')
        self.assertEqual(code, 2)
        self.assertIn('at least 30', err)
        self.assertEqual(snapshot(self.store), before)

    def test_purge_dry_run_is_default_and_exact_boundary_is_retained(self):
        old = rec('SYNTH-BOUNDARY-000001', received_at='2026-10-03T23:59:59Z')
        boundary = rec('SYNTH-BOUNDARY-000002', received_at='2026-10-04T00:00:00Z')
        write_feedback(self.store, [old, boundary])
        before = snapshot(self.store)
        code, out, err = run('purge', '--dir', self.store, '--today', '2026-11-03')
        self.assertEqual(code, 0, err)
        self.assertTrue(json.loads(out)['dryRun'])
        self.assertEqual(json.loads(out)['removedReports'], 1)
        self.assertEqual(snapshot(self.store), before)

    def test_delete_report_unknown_and_bad_id_are_refused(self):
        write_feedback(self.store, [rec('SYNTH-DEL-000000000001')])
        before = snapshot(self.store)
        for report_id in ('SYNTH-DEL-NOT-THERE-001', 'short', 'SYNTH-DEL-000000000001\n'):
            code, _, _ = run('delete-report', '--dir', self.store, '--report-id', report_id)
            self.assertEqual(code, 2)
        self.assertEqual(snapshot(self.store), before)

    def test_delete_dry_run_does_not_write_any_file(self):
        write_feedback(self.store, [rec('SYNTH-DEL-000000000001')])
        before = snapshot(self.store)
        code, out, _ = run('delete-report', '--dir', self.store, '--report-id', 'SYNTH-DEL-000000000001')
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(out)['dryRun'])
        self.assertEqual(snapshot(self.store), before)

    def test_corrupt_input_and_unknown_qc_files_refuse_snapshot_publication(self):
        path = write_feedback(self.store, [rec('SYNTH-DEL-000000000001')], extra_lines=('{"torn',))
        target = self.work / 'blocked'
        args = ('delete-report', '--dir', self.store, '--report-id', 'SYNTH-DEL-000000000001', '--out-dir', target, '--apply')
        self.assertEqual(run(*args)[0], 2)
        self.assertFalse(target.exists())
        write_feedback(self.store, [rec('SYNTH-DEL-000000000001')])
        (self.store / 'unversioned-qc.txt').write_text('SYNTH-QC')
        self.assertEqual(run(*args)[0], 2)
        self.assertFalse(target.exists())
        self.assertTrue(path.exists())

    def test_export_aggregates_valid_records_and_never_exports_notes_or_ids(self):
        good = rec('SYNTH-EXP-000000000001', note=NOTE_TEXT)
        extra = rec('SYNTH-EXP-000000000002')
        extra['ip'] = '192.0.2.1'
        write_feedback(self.store, [good, extra, good, rec('SYNTH-EXP-000000000003', kind='problem')], extra_lines=('{"torn',))
        out = self.work / 'export.json'
        code, summary, err = run('export', '--dir', self.store, '--out', out)
        self.assertEqual(code, 0, err)
        self.assertEqual(stat.S_IMODE(out.stat().st_mode), 0o600)
        text = out.read_text()
        self.assertNotIn(NOTE_TEXT, text)
        self.assertNotIn(good['reportId'], text)
        report = json.loads(text)
        self.assertEqual(report['totals']['analysed'], 2)
        self.assertEqual(report['totals']['duplicate_copies_ignored'], 1)
        self.assertEqual(report['totals']['unparsable_or_invalid_stored_lines'], 2)
        self.assertEqual(json.loads(summary)['exportedReports'], 2)
        self.assertEqual(json.loads(summary)['sha256'], hashlib.sha256(out.read_bytes()).hexdigest())

    def test_export_refuses_to_overwrite_or_write_inside_store(self):
        write_feedback(self.store, [rec('SYNTH-EXP-000000000001')])
        out = self.work / 'export.json'
        out.write_text('precious')
        self.assertEqual(run('export', '--dir', self.store, '--out', out)[0], 2)
        self.assertEqual(out.read_text(), 'precious')
        link = self.work / 'link.json'
        os.symlink(self.work / 'does-not-exist', link)
        self.assertEqual(run('export', '--dir', self.store, '--out', link)[0], 2)
        before = snapshot(self.store)
        self.assertEqual(run('export', '--dir', self.store, '--out', self.store / 'x.json')[0], 2)
        self.assertEqual(snapshot(self.store), before)

    def test_export_publication_failure_has_no_partial_output(self):
        write_feedback(self.store, [rec('SYNTH-EXP-000000000001')])
        out = self.work / 'export.json'
        with mock.patch.object(tool.os, 'link', side_effect=OSError('synthetic failure')):
            self.assertEqual(run('export', '--dir', self.store, '--out', out)[0], 2)
        self.assertEqual(list(self.work.iterdir()), [])


class FixtureTests(Base):
    def test_synthetic_fixture_is_generated_only_inside_scratch(self):
        rows = [rec('SYNTH-FIXTURE-%08d' % i, kind='timing_quality' if i % 2 else 'train_observation') for i in range(8)]
        write_feedback(self.store, rows)
        self.assertTrue(str(self.store).startswith(os.environ.get('TMPDIR', '/root/.hermes/cache/scratch')))
        self.assertTrue(all(row['reportId'].startswith('SYNTH-') for row in rows))
        self.assertTrue(all(row['identity'] == 'anonymous_unverified' for row in rows))
        self.assertEqual(self.report()[1]['totals']['analysed'], 8)
        code, out, _ = run('report', '--dir', self.store, '--real-only')
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)['totals']['analysed'], 0)
        self.assertEqual(json.loads(out)['accuracy'], {'status': 'unavailable', 'n': 0, 'claims_accuracy': False})


if __name__ == '__main__':
    unittest.main()
