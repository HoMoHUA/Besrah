#!/usr/bin/env python3
"""Offline aggregate report and maintenance CLI for the Besrah journey-planner BETA feedback store.

Reads the files written by packages/core/src/journey-beta/feedback.ts (see docs/r2a-pb/API-CONTRACT.md,
section "Stored record"). Standard library only, no network.

Product rules enforced here (owner decisions):
  * feedback never changes the timetable model; this tool only reads, counts and (on request) deletes/exports;
  * anonymous reports are `anonymous_unverified` and never independent evidence without an independent review;
  * the planner is a model-only estimate; this tool never claims accuracy;
  * free-text notes are never printed (only a count of reports that carry a note).

Subcommands: report | purge | delete-report | export.
Exit codes: 0 ok, 2 usage / not found / refused, 3 integrity problems (report --strict only).
"""
import argparse
from contextlib import contextmanager
import csv
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import statistics
import stat
import sys
import tempfile
import uuid

TOOL_SCHEMA_VERSION = 2
POLICY_VERSION = 3
STORE_SCHEMA = 1
SPLIT_SALT = '|r2apb-split-v1'
SPLIT_CALIBRATION_BELOW = 179  # first digest byte < 179  =>  calibration (~70 %)
MIN_SAMPLE = 30
MIN_RETENTION_DAYS = 30
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_LINE_BYTES = 8 * 1024
MAX_METADATA_BYTES = 16 * 1024
MAX_SAFE_INTEGER = 2**53 - 1
MAX_STORE_BYTES = 64 * 1024 * 1024
MAX_RECORDS = 50000
MAX_FILES = 120
MAX_QUEUE = 50
MAX_LISTED = 200
LARGE_DELTA_SECONDS = 600
TEHRAN = dt.timezone(dt.timedelta(hours=3, minutes=30))
PURGE_LOG = 'purge-log.jsonl'

KINDS = ('timing_quality', 'train_observation', 'boarding_outcome', 'problem')
KIND_CLASS = {'timing_quality': 'qualitative', 'train_observation': 'claimed_observation',
              'boarding_outcome': 'journey_outcome', 'problem': 'problem_report'}
KIND_BLOCK = {'timing_quality': 'timingQuality', 'train_observation': 'observation',
              'boarding_outcome': 'outcome', 'problem': 'problem'}
CLASSES = tuple(KIND_CLASS.values())
TRIP_MATCH = ('matched', 'unmatched', 'not_provided', 'model_version_mismatch')
REVIEW_STATUSES = ('independently_verified', 'rejected', 'needs_followup')
PROBLEM_CATEGORIES = ('cancelled', 'different_schedule', 'wrong_station', 'wrong_direction', 'other', 'unknown')
QUEUE_PROBLEMS = ('cancelled', 'different_schedule', 'wrong_station', 'wrong_direction')
REJECTION_CODES = frozenset(('malformed_request', 'forbidden_origin', 'rate_limited', 'invalid_payload',
                            'storage_full', 'storage_unavailable', 'busy', 'model_unavailable', 'feedback_timeout', 'disabled', 'other'))

TOP_KEYS = frozenset(('schema', 'reportId', 'kind', 'modelVersion', 'context', 'timingQuality', 'observation', 'outcome',
                      'problem', 'note', 'receivedAt', 'class', 'identity', 'review', 'modelVersionMatches', 'comparison'))
CONTEXT_KEYS = frozenset(('line', 'originId', 'destinationId', 'serviceDate', 'tripId', 'readyAt', 'calendarState'))
OPTIONAL_TOP_KEYS = frozenset(('sourceId', 'reportedAt', 'consent', 'provenance', 'synthetic'))
OBSERVATION_KEYS = frozenset(('event', 'stationId', 'direction', 'observedAtEpoch', 'observedAt', 'precision'))
OUTCOME_KEYS = frozenset(('result', 'platformReadyAtEpoch'))
COMPARISON_KEYS = frozenset(('tripMatch', 'modelEventAt', 'deltaSeconds'))
REVIEW_KEYS = frozenset(('schema', 'reviewId', 'revision', 'reportId', 'status', 'reviewer', 'reviewedAt',
                         'method', 'basis', 'split', 'evidence'))
REVIEW_METHODS = ('independent_field_observation', 'independent_platform_record', 'documented_qc')
EVIDENCE_KEYS = frozenset(('reportId', 'tripId', 'line', 'direction', 'stationId', 'serviceDate', 'event',
                           'observedAt', 'modelEventAt', 'modelVersion', 'platformReady'))
TRIP_ID = re.compile(r'^\d{4}-\d{2}-\d{2}:L[12]:(out|back):(A|B|-):[0-9a-f]{64}$')
STATION_ID = re.compile(r'^METRO-\d{3}$')
TOKEN = re.compile(r'^[A-Za-z0-9_.:-]{1,128}$')

REPORT_ID = re.compile(r'^[A-Za-z0-9-]{16,64}$')
MODEL_VERSION = re.compile(r'^sha256:[0-9a-f]{64}$')
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
RECEIVED_AT = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$')
CANONICAL_UTC = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
ISO_OFFSET = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$')
FEEDBACK_NAME = re.compile(r'^feedback-(\d{4})-(0[1-9]|1[0-2])\.jsonl$')
REJECTION_NAME = re.compile(r'^rejections-(\d{4})-(0[1-9]|1[0-2])\.json$')
MONTH = re.compile(r'^\d{4}-(0[1-9]|1[0-2])$')


class UsageError(Exception):
    """Bad usage, missing input or a refused operation: exit code 2."""


# ----------------------------------------------------------------------------------------------- low level helpers

def parse_iso(text, need_offset=False):
    """Parse an ISO timestamp into an aware datetime, or None."""
    if not isinstance(text, str) or not ISO_OFFSET.fullmatch(text):
        return None
    if not text.endswith('Z') and (int(text[-5:-3]) > 23 or int(text[-2:]) > 59):
        return None
    try:
        value = dt.datetime.fromisoformat(text[:-1] + '+00:00' if text.endswith('Z') else text)
    except ValueError:
        return None
    if value.tzinfo is None:
        return None
    return value


def parse_date(text):
    if not isinstance(text, str) or not DATE.fullmatch(text):
        return None
    try:
        return dt.date.fromisoformat(text)
    except ValueError:
        return None


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def split_of(report_id):
    """Deterministic pre-analysis split, not proof of field independence."""
    first = hashlib.sha256((report_id + SPLIT_SALT).encode('utf-8')).digest()[0]
    return 'calibration' if first < SPLIT_CALIBRATION_BELOW else 'held_out'


def day_type(service_date):
    """Gregorian weekday -> Sat-Wed normal, Thu thursday, Fri friday."""
    weekday = service_date.weekday()  # Monday=0
    if weekday == 3:
        return 'thursday'
    if weekday == 4:
        return 'friday'
    return 'normal'


def median_value(values):
    if not values:
        return None
    middle = statistics.median(values)
    return int(middle) if float(middle).is_integer() else float(middle)


def nearest_rank(sorted_values, percent):
    count = len(sorted_values)
    rank = max(1, -(-count * percent // 100))
    return sorted_values[rank - 1]


def share(part, whole):
    return round(part / whole, 4) if whole else None


def counted(items):
    result = {}
    for item in items:
        result[item] = result.get(item, 0) + 1
    return dict(sorted(result.items()))


def reject_constant(name):
    raise ValueError('non-finite number ' + name)


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate key')
        result[key] = value
    return result


def loads_strict(raw):
    return json.loads(raw, parse_constant=reject_constant, object_pairs_hook=no_duplicate_keys)


def read_file_bytes(path):
    """Read a regular file bounded by MAX_FILE_BYTES. Returns (bytes|None, reason|None)."""
    try:
        if os.path.islink(path) or not os.path.isfile(path):
            return None, 'not_a_regular_file'
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
        with os.fdopen(fd, 'rb') as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode):
                return None, 'not_a_regular_file'
            if info.st_size > MAX_FILE_BYTES:
                return None, 'file_too_large'
            data = handle.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            return None, 'file_too_large'
        return data, None
    except OSError:
        return None, 'unreadable'


def split_lines(data, include_empty=False):
    """Yield bounded physical lines; raw-store validation explicitly includes empty lines."""
    for number, raw in enumerate(io.BytesIO(data), 1):
        if number > MAX_RECORDS:
            raise UsageError('physical record count exceeds bound')
        has_newline = raw.endswith(b'\n')
        piece = raw[:-1] if has_newline else raw
        if piece == b'' and not include_empty:
            continue
        yield number, piece, has_newline


def list_store_files(directory, pattern):
    names = []
    for name in sorted(os.listdir(directory)):
        if pattern.match(name):
            names.append(name)
    return names


def require_dir(value):
    path = Path(value)
    if not path.is_dir():
        raise UsageError('not a directory: ' + str(value))
    return path


def refuse_store_lock(directory):
    if os.path.lexists(Path(directory) / '.feedback.lock'):
        raise UsageError('feedback lock exists (active or stale); offline inspection required; never steal/remove it automatically')


@contextmanager
def offline_store_lock(directory):
    """Cooperate with Node O_EXCL locking; unlink only the exact lease we created."""
    absolute = Path(os.path.abspath(directory))
    if absolute.is_symlink():
        raise UsageError('unsafe feedback directory symlink')
    for path in (absolute, *absolute.parents):
        info = path.lstat()
        if path.is_symlink():
            if info.st_uid != 0:
                raise UsageError('unsafe feedback path alias')
            for target in (path.resolve(), *path.resolve().parents):
                checked = target.lstat()
                if not stat.S_ISDIR(checked.st_mode) or checked.st_mode & 0o022 or checked.st_uid not in (0, os.getuid()):
                    raise UsageError('unsafe feedback path ancestor')
            info = path.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o022 or info.st_uid not in (0, os.getuid()):
            raise UsageError('unsafe feedback path ancestor')
    info = absolute.stat()
    if stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != os.getuid():
        raise UsageError('feedback snapshot must be owned by current user with mode 0700')
    identity = (info.st_dev, info.st_ino)
    dfd = os.open(absolute, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    lease = None
    try:
        try:
            fd = os.open('.feedback.lock', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dfd)
        except FileExistsError:
            raise UsageError('feedback lock exists (active or stale); explicit offline inspection required') from None
        with os.fdopen(fd, 'wb') as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(('%d:%s\n' % (os.getpid(), uuid.uuid4())).encode())
            handle.flush()
            os.fsync(handle.fileno())
            lease = os.fstat(handle.fileno())
        os.fsync(dfd)

        def check():
            current = os.stat('.feedback.lock', dir_fd=dfd, follow_symlinks=False)
            location = absolute.lstat()
            if ((location.st_dev, location.st_ino) != identity or not stat.S_ISDIR(location.st_mode)
                    or (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns, current.st_ctime_ns)
                    != (lease.st_dev, lease.st_ino, lease.st_size, lease.st_mtime_ns, lease.st_ctime_ns)
                    or not stat.S_ISREG(current.st_mode) or current.st_nlink != 1
                    or stat.S_IMODE(current.st_mode) != 0o600 or current.st_uid != os.getuid()):
                raise UsageError('feedback lock or directory changed; refusing publication/removal')
        try:
            yield check
        finally:
            check()
            os.unlink('.feedback.lock', dir_fd=dfd)
            os.fsync(dfd)
    finally:
        os.close(dfd)


def store_fingerprint(directory, reviews_path=None):
    """Bound the complete input before parsing and detect concurrent changes."""
    all_names = os.listdir(directory)
    if len(all_names) > MAX_FILES:
        raise UsageError('store directory entry count exceeds bound')
    names = list_store_files(directory, FEEDBACK_NAME) + list_store_files(directory, REJECTION_NAME)
    names += [name for name in ('quota.json', 'operations.jsonl', 'purge-log.jsonl') if name in all_names]
    paths = [(name, Path(directory) / name) for name in names]
    if reviews_path is not None:
        paths.append(('reviews', Path(reviews_path)))
    if len(paths) > MAX_FILES:
        raise UsageError('store file count exceeds bound')
    total, hashes = 0, [['entries', sorted(name for name in all_names if name != '.feedback.lock')]]
    for name, path in sorted(paths):
        data, problem = read_file_bytes(path)
        if data is None:
            hashes.append([name, 'unreadable:' + str(problem)])
            continue
        total += len(data)
        if total > MAX_STORE_BYTES:
            raise UsageError('store total bytes exceeds bound')
        hashes.append([name, hashlib.sha256(data).hexdigest()])
    return hashlib.sha256(json.dumps(hashes, separators=(',', ':')).encode()).hexdigest()


def synthetic_record(record):
    return record.get('synthetic') is True or record['reportId'].startswith('SYNTH-')


def path_inside(child, parent):
    try:
        Path(os.path.realpath(child)).relative_to(os.path.realpath(parent))
        return True
    except ValueError:
        return False


def write_text_atomic(out, text):
    """Write text to OUT (mode 0600) through a temp file + os.replace. Never inside the store directory."""
    out = Path(out)
    directory = out.parent if str(out.parent) else Path('.')
    if not directory.is_dir():
        raise UsageError('output directory does not exist: ' + str(directory))
    fd, temp = tempfile.mkstemp(prefix='.' + out.name + '.', suffix='.tmp', dir=str(directory))
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(text.encode('utf-8'))
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, 0o600)
        os.replace(temp, out)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


def append_log(directory, entry):
    flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(os.path.join(directory, PURGE_LOG), flags, 0o600)
    with os.fdopen(fd, 'ab') as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write((json.dumps(entry, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8'))
        handle.flush()
        os.fsync(handle.fileno())


def utc_now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


# ---------------------------------------------------------------------------------------------------- validation

def validate_record(obj):
    """Strictly validate one stored feedback record. Returns (clean_record, None) or (None, reason)."""
    if not isinstance(obj, dict):
        return None, 'not_an_object'
    if not TOP_KEYS <= set(obj) or set(obj) - TOP_KEYS - OPTIONAL_TOP_KEYS:
        return None, 'unexpected_or_missing_fields'
    provenance_keys = {'sourceId', 'reportedAt', 'consent', 'provenance'}
    if set(obj) & provenance_keys and not provenance_keys <= set(obj):
        return None, 'incomplete_provenance'
    if 'sourceId' in obj and obj['sourceId'] != 'anonymous_feedback:' + str(obj.get('reportId')):
        return None, 'sourceId'
    if 'reportedAt' in obj and (parse_iso(obj['reportedAt']) is None or obj['reportedAt'] != obj['receivedAt']):
        return None, 'reportedAt'
    if 'consent' in obj:
        consent = obj['consent']
        if not isinstance(consent, dict) or consent.get('granted') is not True:
            return None, 'consent'
        if consent != {'granted': True, 'version': 'r2a-pb-feedback-v1', 'purpose': 'model_improvement', 'provenance': 'explicit_client_opt_in'}:
            return None, 'consent'
        provenance = obj['provenance']
        if (not isinstance(provenance, dict) or provenance.get('independentlyVerified') is not False
                or provenance.get('modelTimetableUpdated') is not False
                or provenance != {'source': 'anonymous_public_report', 'independentlyVerified': False, 'modelTimetableUpdated': False}):
            return None, 'provenance'
    if 'synthetic' in obj and obj['synthetic'] is not True:
        return None, 'synthetic'
    if obj['schema'] != STORE_SCHEMA or not is_int(obj['schema']):
        return None, 'schema'
    report_id = obj['reportId']
    if not isinstance(report_id, str) or not REPORT_ID.fullmatch(report_id):
        return None, 'reportId'
    kind = obj['kind']
    if kind not in KINDS:
        return None, 'kind'
    if obj['class'] != KIND_CLASS[kind]:
        return None, 'class'
    if obj['identity'] != 'anonymous_unverified':
        return None, 'identity'
    if obj['review'] != 'unreviewed':
        return None, 'review'
    if not isinstance(obj['modelVersion'], str) or not MODEL_VERSION.fullmatch(obj['modelVersion']):
        return None, 'modelVersion'
    if not isinstance(obj['modelVersionMatches'], bool):
        return None, 'modelVersionMatches'
    received = obj['receivedAt']
    if not isinstance(received, str) or not RECEIVED_AT.fullmatch(received) or parse_iso(received) is None:
        return None, 'receivedAt'
    note = obj['note']
    if note is not None and (not isinstance(note, str) or len(note) > 200):
        return None, 'note'

    context = obj['context']
    if not isinstance(context, dict) or set(context) != CONTEXT_KEYS:
        return None, 'context'
    if not is_int(context['line']) or context['line'] not in (1, 2):
        return None, 'context.line'
    for key in ('originId', 'destinationId'):
        if not isinstance(context[key], str) or not STATION_ID.fullmatch(context[key]):
            return None, 'context.' + key
    if parse_date(context['serviceDate']) is None:
        return None, 'context.serviceDate'
    if context['tripId'] is not None:
        if not isinstance(context['tripId'], str) or not TRIP_ID.fullmatch(context['tripId']):
            return None, 'context.tripId'
        if not context['tripId'].startswith('%s:L%d:' % (context['serviceDate'], context['line'])):
            return None, 'context.tripId_context_mismatch'
    if context['readyAt'] is not None and parse_iso(context['readyAt']) is None:
        return None, 'context.readyAt'
    if context['calendarState'] not in (None, 'known', 'estimated', 'unknown'):
        return None, 'context.calendarState'

    comparison = obj['comparison']
    if not isinstance(comparison, dict) or set(comparison) != COMPARISON_KEYS:
        return None, 'comparison'
    if comparison['tripMatch'] not in TRIP_MATCH:
        return None, 'comparison.tripMatch'
    if comparison['modelEventAt'] is not None and parse_iso(comparison['modelEventAt']) is None:
        return None, 'comparison.modelEventAt'
    if comparison['deltaSeconds'] is not None and not is_int(comparison['deltaSeconds']):
        return None, 'comparison.deltaSeconds'

    for other_kind, block in KIND_BLOCK.items():
        if other_kind != kind and obj[block] is not None:
            return None, block + ':not_allowed_for_kind'
    wanted = obj[KIND_BLOCK[kind]]
    if wanted is None:
        return None, KIND_BLOCK[kind] + ':required_for_kind'
    if kind == 'timing_quality':
        if wanted not in ('close', 'earlier', 'later', 'unknown'):
            return None, 'timingQuality'
    elif kind == 'train_observation':
        if not isinstance(wanted, dict) or not OBSERVATION_KEYS <= set(wanted) or set(wanted) - OBSERVATION_KEYS - {'timePrecision'}:
            return None, 'observation'
        if wanted['event'] not in ('train_arrival', 'train_departure'):
            return None, 'observation.event'
        if not isinstance(wanted['stationId'], str) or not STATION_ID.fullmatch(wanted['stationId']):
            return None, 'observation.stationId'
        if wanted['direction'] not in ('out', 'back', 'unknown'):
            return None, 'observation.direction'
        if not is_int(wanted['observedAtEpoch']):
            return None, 'observation.observedAtEpoch'
        observed = parse_iso(wanted['observedAt'])
        if observed is None:
            return None, 'observation.observedAt'
        if int(observed.timestamp()) != wanted['observedAtEpoch']:
            return None, 'observation.epoch_mismatch'
        if wanted['precision'] not in ('minute', 'approximate'):
            return None, 'observation.precision'
        if 'timePrecision' in wanted and wanted['timePrecision'] not in ('minute', 'second', 'unknown'):
            return None, 'observation.timePrecision'
    elif kind == 'boarding_outcome':
        if not isinstance(wanted, dict) or set(wanted) != OUTCOME_KEYS:
            return None, 'outcome'
        if wanted['result'] not in ('made_it', 'missed', 'unknown'):
            return None, 'outcome.result'
        if wanted['platformReadyAtEpoch'] is not None and not is_int(wanted['platformReadyAtEpoch']):
            return None, 'outcome.platformReadyAtEpoch'
    else:
        if not isinstance(wanted, dict) or set(wanted) != {'category'} or wanted['category'] not in PROBLEM_CATEGORIES:
            return None, 'problem'
    return clean_record(obj), None


def clean_record(obj):
    """Rebuild a record from the known stored fields only, in contract order."""
    context, comparison = obj['context'], obj['comparison']
    observation, outcome, problem = obj['observation'], obj['outcome'], obj['problem']
    clean = {
        'schema': STORE_SCHEMA, 'reportId': obj['reportId'], 'kind': obj['kind'], 'modelVersion': obj['modelVersion'],
        'context': {key: context[key] for key in ('line', 'originId', 'destinationId', 'serviceDate', 'tripId', 'readyAt', 'calendarState')},
        'timingQuality': obj['timingQuality'],
        'observation': None if observation is None else {key: observation[key] for key in ('event', 'stationId', 'direction', 'observedAtEpoch', 'observedAt', 'precision')},
        'outcome': None if outcome is None else {key: outcome[key] for key in ('result', 'platformReadyAtEpoch')},
        'problem': None if problem is None else {'category': problem['category']},
        'note': obj['note'], 'receivedAt': obj['receivedAt'], 'class': obj['class'], 'identity': obj['identity'],
        'review': obj['review'], 'modelVersionMatches': obj['modelVersionMatches'],
        'comparison': {key: comparison[key] for key in ('tripMatch', 'modelEventAt', 'deltaSeconds')},
    }
    clean.update({key: obj[key] for key in sorted(OPTIONAL_TOP_KEYS) if key in obj})
    if observation is not None and 'timePrecision' in observation:
        clean['observation']['timePrecision'] = observation['timePrecision']
    return clean


def validate_review(obj):
    """Versioned QC assertions are separate from immutable anonymous claims."""
    if not isinstance(obj, dict) or set(obj) != REVIEW_KEYS:
        return None
    if not is_int(obj['schema']) or obj['schema'] != 1:
        return None
    for key in ('reportId', 'reviewId'):
        if not isinstance(obj[key], str) or not REPORT_ID.fullmatch(obj[key]):
            return None
    if not is_int(obj['revision']) or not 1 <= obj['revision'] <= 1000:
        return None
    if obj['status'] not in REVIEW_STATUSES or obj['method'] not in REVIEW_METHODS:
        return None
    if not isinstance(obj['reviewer'], str) or not TOKEN.fullmatch(obj['reviewer']):
        return None
    if not isinstance(obj['basis'], str) or not 1 <= len(obj['basis'].strip()) <= 200:
        return None
    if parse_iso(obj['reviewedAt']) is None or obj['split'] != split_of(obj['reportId']):
        return None
    evidence = obj['evidence']
    if evidence is not None:
        if (not isinstance(evidence, dict) or not EVIDENCE_KEYS <= set(evidence)
                or set(evidence) - EVIDENCE_KEYS - {'timePrecision'}):
            return None
        if 'timePrecision' in evidence and evidence['timePrecision'] not in ('minute', 'second', 'unknown'):
            return None
        if evidence['reportId'] != obj['reportId']:
            return None
        for key, pattern in (('tripId', TRIP_ID), ('stationId', STATION_ID), ('modelVersion', MODEL_VERSION)):
            if not isinstance(evidence[key], str) or not pattern.fullmatch(evidence[key]):
                return None
        if not is_int(evidence['line']) or evidence['line'] not in (1, 2):
            return None
        if evidence['direction'] not in ('out', 'back') or parse_date(evidence['serviceDate']) is None:
            return None
        if not evidence['tripId'].startswith('%s:L%d:%s:' % (evidence['serviceDate'], evidence['line'], evidence['direction'])):
            return None
        if evidence['event'] not in ('train_arrival', 'train_departure'):
            return None
        observed, model = parse_iso(evidence['observedAt']), parse_iso(evidence['modelEventAt'])
        reviewed = parse_iso(obj['reviewedAt'])
        service_date = parse_date(evidence['serviceDate'])
        if observed is None or model is None or reviewed is None or service_date is None or reviewed < observed:
            return None
        if abs((observed.astimezone(TEHRAN).date() - service_date).days) > 1:
            return None
        platform = evidence['platformReady']
        if platform is not None:
            if (not isinstance(platform, dict) or not {'observedAt', 'method', 'basis'} <= set(platform)
                    or set(platform) - {'observedAt', 'method', 'basis', 'timePrecision'}):
                return None
            if 'timePrecision' in platform and platform['timePrecision'] not in ('minute', 'second', 'unknown'):
                return None
            if platform['method'] not in REVIEW_METHODS[:2] or parse_iso(platform['observedAt']) is None:
                return None
            if not isinstance(platform['basis'], str) or not 1 <= len(platform['basis'].strip()) <= 200:
                return None
    return dict(obj)


def matched_independent_evidence(row):
    """Return independently observed error, never the anonymous stored delta alone."""
    record, review = row['record'], row.get('review_record')
    if review is None or review['status'] != 'independently_verified' or review['method'] not in REVIEW_METHODS[:2]:
        return None
    evidence, observation, context = review['evidence'], record['observation'], record['context']
    if evidence is None or observation is None or row.get('duplicate', False):
        return None
    # Client precision is only a claim; old status-only precision must never be inferred.
    if evidence.get('timePrecision', 'unknown') not in ('minute', 'second'):
        return None
    if (not record['modelVersionMatches'] or record['comparison']['tripMatch'] != 'matched'
            or observation['direction'] == 'unknown' or observation['precision'] != 'minute'):
        return None
    bindings = {'reportId': record['reportId'], 'modelVersion': record['modelVersion'],
                'tripId': context['tripId'], 'line': context['line'], 'serviceDate': context['serviceDate'],
                'event': observation['event'], 'direction': observation['direction'], 'stationId': observation['stationId']}
    if any(evidence[key] != value for key, value in bindings.items()):
        return None
    observed, model = parse_iso(evidence['observedAt']), parse_iso(evidence['modelEventAt'])
    raw_model = parse_iso(record['comparison']['modelEventAt'])
    raw_observed = parse_iso(observation['observedAt'])
    if model is None or observed is None or model != raw_model or observed != raw_observed:
        return None
    delta = int((observed - model).total_seconds())
    if record['comparison']['deltaSeconds'] != delta or not is_int(record['comparison']['deltaSeconds']):
        return None
    return delta


# ------------------------------------------------------------------------------------------------------ loading

def load_feedback(directory):
    """Return (records, integrity_parts). records: list of dicts {file,line,record} for every valid line (duplicates kept)."""
    records, invalid, skipped = [], [], []
    for name in list_store_files(directory, FEEDBACK_NAME):
        data, problem = read_file_bytes(os.path.join(directory, name))
        if data is None:
            skipped.append({'file': name, 'reason': problem})
            continue
        for number, raw, has_newline in split_lines(data, include_empty=True):
            if len(records) + len(invalid) >= MAX_RECORDS:
                raise UsageError('store record count exceeds bound')
            if not raw or not has_newline:
                invalid.append({'file': name, 'line': number, 'reason': 'empty_line' if not raw else 'torn_final_line'})
                continue
            if len(raw) > MAX_LINE_BYTES:
                invalid.append({'file': name, 'line': number, 'reason': 'line_too_long'})
                continue
            try:
                parsed = loads_strict(raw.decode('utf-8'))
            except (ValueError, UnicodeDecodeError, RecursionError):
                invalid.append({'file': name, 'line': number, 'reason': 'invalid_json' if has_newline else 'torn_final_line'})
                continue
            record, reason = validate_record(parsed)
            if record is None:
                invalid.append({'file': name, 'line': number, 'reason': 'invalid_record:' + str(reason)})
                continue
            if record['receivedAt'][:7] != name[len('feedback-'):-len('.jsonl')]:
                invalid.append({'file': name, 'line': number, 'reason': 'received_month_mismatch'})
                continue
            records.append({'file': name, 'line': number, 'record': record, 'raw': raw + (b'\n' if has_newline else b'')})
    return records, invalid, skipped


def load_rejections(directory):
    counts, bad = {}, []
    for name in list_store_files(directory, REJECTION_NAME):
        data, problem = read_file_bytes(os.path.join(directory, name))
        if data is None:
            bad.append({'file': name, 'reason': problem})
            continue
        try:
            parsed = loads_strict(data.decode('utf-8'))
        except (ValueError, UnicodeDecodeError, RecursionError):
            bad.append({'file': name, 'reason': 'invalid_json'})
            continue
        month = REJECTION_NAME.match(name)
        expected = month.group(1) + '-' + month.group(2)
        ok = (isinstance(parsed, dict) and set(parsed) == {'month', 'counts', 'updatedAt'}
              and parsed.get('month') == expected and isinstance(parsed.get('counts'), dict)
              and isinstance(parsed['updatedAt'], str) and CANONICAL_UTC.fullmatch(parsed['updatedAt']) is not None
              and parse_iso(parsed['updatedAt']) is not None
              and len(parsed['counts']) <= len(REJECTION_CODES)
              and all(k in REJECTION_CODES and is_int(v) and 0 < v <= 2**53 - 1 for k, v in parsed['counts'].items()))
        if not ok:
            bad.append({'file': name, 'reason': 'invalid_structure'})
            continue
        for reason, number in parsed['counts'].items():
            counts[reason] = counts.get(reason, 0) + number
    return dict(sorted(counts.items())), bad


def load_quota(directory, entries):
    """Daily intake = retained raw rows + persisted deleted-intake offsets, never a reset."""
    path = Path(directory) / 'quota.json'
    counts = {}
    if os.path.lexists(path):
        info = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > MAX_METADATA_BYTES):
            raise UsageError('unsafe or oversized quota.json')
        data, problem = read_file_bytes(path)
        if data is None:
            raise UsageError('unreadable quota.json: ' + str(problem))
        try:
            ledger = loads_strict(data.decode('utf-8'))
        except (ValueError, UnicodeDecodeError, RecursionError):
            raise UsageError('corrupt quota.json') from None
        if (not isinstance(ledger, dict) or set(ledger) != {'schema', 'semantics', 'counts'}
                or not is_int(ledger['schema']) or ledger['schema'] != 1
                or ledger['semantics'] != 'deleted_intake_offsets' or not isinstance(ledger['counts'], dict)
                or len(ledger['counts']) > 366):
            raise UsageError('invalid quota.json structure')
        for day, number in ledger['counts'].items():
            if (parse_date(day) is None or day[:4] < '2000' or not is_int(number)
                    or not 0 < number <= MAX_SAFE_INTEGER):
                raise UsageError('invalid quota.json counter')
        counts = dict(ledger['counts'])
    totals = dict(counts)
    for entry in entries:
        day = entry['record']['receivedAt'][:10]
        totals[day] = totals.get(day, 0) + 1
        if totals[day] > MAX_SAFE_INTEGER:
            raise UsageError('quota.json retained intake counter overflow')
    return counts


def load_reviews(path):
    """Return (effective {reportId: status}, invalid_line_count, invalid_lines[], total_valid)."""
    if path is None:
        return {}, [], 0
    data, problem = read_file_bytes(path)
    if data is None:
        raise UsageError('cannot read reviews file (' + str(problem) + '): ' + str(path))
    effective, invalid, valid = {}, [], 0
    histories, tainted, review_ids = {}, set(), {}
    for number, raw, _ in split_lines(data):
        if number > MAX_RECORDS:
            raise UsageError('review record count exceeds bound')
        parsed, review = None, None
        if len(raw) <= MAX_LINE_BYTES:
            try:
                parsed = loads_strict(raw.decode('utf-8'))
                review = validate_review(parsed)
            except (ValueError, UnicodeDecodeError, RecursionError, TypeError):
                review = None
        if review is None:
            invalid.append({'file': 'reviews', 'line': number, 'reason': 'invalid_review'})
            if isinstance(parsed, dict) and isinstance(parsed.get('reportId'), str):
                tainted.add(parsed['reportId'])
            continue
        rid, qid = review['reportId'], review['reviewId']
        if qid in review_ids:
            tainted.update((rid, review_ids[qid]))
        review_ids[qid] = rid
        histories.setdefault(rid, []).append((number, review))
        valid += 1
    for rid, history in sorted(histories.items()):
        ordered = sorted(history, key=lambda item: item[1]['revision'])
        revisions = [item[1]['revision'] for item in ordered]
        times = [value for item in ordered if (value := parse_iso(item[1]['reviewedAt'])) is not None]
        if (rid in tainted or revisions != list(range(1, len(ordered) + 1))
                or times != sorted(times) or len(set(times)) != len(times)):
            for number, _ in ordered:
                invalid.append({'file': 'reviews', 'line': number, 'reason': 'duplicate_or_invalid_revision_chain'})
            continue
        effective[rid] = ordered[-1][1]
    return effective, sorted(invalid, key=lambda item: item['line']), valid


# ------------------------------------------------------------------------------------------------------ report

def tehran_hour(entry):
    record = entry['record']
    source = record['observation']['observedAt'] if record['observation'] else record['receivedAt']
    return '%02d' % parse_iso(source).astimezone(TEHRAN).hour


def build_report(directory, reviews_path=None, generated_at=None, include_synthetic=False):
    refuse_store_lock(directory)
    if reviews_path is None and os.path.lexists(Path(directory) / 'reviews.jsonl'):
        reviews_path = Path(directory) / 'reviews.jsonl'
    before = store_fingerprint(directory, reviews_path)
    records, invalid_lines, skipped_files = load_feedback(directory)
    load_quota(directory, records)
    rejection_counts, bad_rejection_files = load_rejections(directory)
    effective_reviews, invalid_reviews, valid_review_lines = load_reviews(reviews_path)
    refuse_store_lock(directory)
    if store_fingerprint(directory, reviews_path) != before:
        raise UsageError('input changed during read; use a quiescent offline snapshot')
    synthetic_excluded = sum(1 for entry in records if synthetic_record(entry['record']) and not include_synthetic)
    records = [entry for entry in records if include_synthetic or not synthetic_record(entry['record'])]

    seen, unique, duplicate_counts = set(), [], {}
    for entry in records:
        report_id = entry['record']['reportId']
        if report_id in seen:
            duplicate_counts[report_id] = duplicate_counts.get(report_id, 1) + 1
            continue
        seen.add(report_id)
        unique.append(entry)
    duplicates = [{'reportId': key, 'count': value} for key, value in sorted(duplicate_counts.items())]

    unknown_review_ids = sorted(rid for rid in effective_reviews if rid not in seen and not (not include_synthetic and rid.startswith('SYNTH-')))
    rows = []  # analysed reports
    rejected_by_review = 0
    for entry in unique:
        record = entry['record']
        review_record = effective_reviews.get(record['reportId'])
        status = review_record['status'] if review_record else 'unreviewed'
        if status == 'rejected':
            rejected_by_review += 1
            continue
        rows.append({'record': record, 'review': status, 'review_record': review_record,
                     'duplicate': record['reportId'] in duplicate_counts, 'split': split_of(record['reportId']),
                     'dayType': day_type(parse_date(record['context']['serviceDate'])), 'hour': tehran_hour(entry)})

    records_only = [row['record'] for row in rows]
    analysed = len(rows)
    verified = [row for row in rows if row['review'] == 'independently_verified']
    server_rejections = sum(rejection_counts.values())
    stored_invalid = len(invalid_lines)

    split_counts = {'calibration': sum(1 for r in rows if r['split'] == 'calibration'),
                    'held_out': sum(1 for r in rows if r['split'] == 'held_out')}

    # Repeated reports about the same modeled station event are not independent samples.
    event_groups = {}
    for row in rows:
        record, observation = row['record'], row['record']['observation']
        if observation is not None and record['context']['tripId'] is not None:
            key = (record['modelVersion'], record['context']['tripId'], record['context']['line'],
                   record['context']['serviceDate'], observation['stationId'], observation['event'])
            event_groups.setdefault(key, []).append(row)
    repeated_events = [row for group in event_groups.values() if len(group) > 1 for row in group]
    for row in repeated_events:
        row['duplicate'] = True
    calibration_trips = {(row['record']['modelVersion'], row['record']['context']['tripId'])
                         for row in rows if row['split'] == 'calibration' and row['record']['context']['tripId'] is not None}
    trip_overlap = [row for row in rows if row['split'] == 'held_out'
                    and (row['record']['modelVersion'], row['record']['context']['tripId']) in calibration_trips]
    for row in trip_overlap:
        row['duplicate'] = True

    # --- statistics (held-out split only)
    evaluation = [row for row in rows if row['split'] == 'held_out']

    def claimed_matched(row):
        record = row['record']
        return (record['class'] == 'claimed_observation' and record['comparison']['tripMatch'] == 'matched'
                and is_int(record['comparison']['deltaSeconds']))

    descriptive = [row['record']['comparison']['deltaSeconds'] for row in evaluation
                   if claimed_matched(row) and row['review'] != 'independently_verified']
    integrity_blocked = bool(invalid_lines or skipped_files or bad_rejection_files or invalid_reviews)
    verified_errors = [] if integrity_blocked else [row for row in evaluation if matched_independent_evidence(row) is not None]
    if len(verified_errors) >= MIN_SAMPLE:
        absolute = sorted(abs(value) for row in verified_errors if (value := matched_independent_evidence(row)) is not None)
        timing_error = {'status': 'ok', 'n': len(absolute), 'split': 'held_out', 'basis': 'independently_verified',
                        'precision': 'minute', 'mae_seconds': round(sum(absolute) / len(absolute), 3),
                        'p90_abs_seconds': nearest_rank(absolute, 90), 'percentile_method': 'nearest_rank',
                        'lines': sorted({row['record']['context']['line'] for row in verified_errors})}
    else:
        timing_error = {'status': 'insufficient_sample', 'n': len(verified_errors), 'required': MIN_SAMPLE}
    boarding = []
    for row in verified_errors:
        evidence = row['review_record']['evidence']
        platform = evidence['platformReady']
        if (evidence['event'] != 'train_departure' or platform is None
                or platform.get('timePrecision', 'unknown') not in ('minute', 'second')):
            continue
        ready = parse_iso(platform['observedAt'])
        model, observed = parse_iso(evidence['modelEventAt']), parse_iso(evidence['observedAt'])
        if (ready is not None and model is not None and observed is not None and ready <= model
                and abs((observed - ready).total_seconds()) <= 3600):
            boarding.append(observed < ready)
    if len(boarding) >= MIN_SAMPLE:
        missed = sum(boarding)
        missed_rate = {'status': 'ok', 'n': len(boarding), 'missed': missed, 'missed_rate': round(missed / len(boarding), 4),
                       'split': 'held_out', 'basis': 'independent_platform_ready_and_matched_departure',
                       'definition': 'modeled_catchable_departure_left_before_independent_platform_ready'}
    else:
        missed_rate = {'status': 'insufficient_sample', 'n': len(boarding), 'required': MIN_SAMPLE}

    # --- calibration status
    lines_covered = sorted({row['record']['context']['line'] for row in verified_errors})
    limitations = ['no_accuracy_claim', 'planner_is_model_only_estimate', 'anonymous_reports_are_not_independent_evidence']
    if not verified:
        status = 'not_started'
    elif not verified_errors:
        status = 'collecting'
    elif len(verified_errors) < MIN_SAMPLE:
        status = 'insufficient_sample'
    else:
        status = 'ready_for_experimental_analysis'
        if len(lines_covered) < 2:
            limitations.append('single_line_only')
    calibration = {'status': status, 'claims_accuracy': False, 'independent_verified_reports': len(verified),
                   'verified_evaluation_observations': len(verified_errors), 'required': MIN_SAMPLE,
                   'lines_covered': lines_covered, 'limitations': sorted(limitations)}

    # --- review queue
    queue, reasons = {}, []
    for row in rows:
        if row['review'] == 'independently_verified':
            continue
        record = row['record']
        why = []
        if not record['modelVersionMatches'] or record['comparison']['tripMatch'] == 'model_version_mismatch':
            why.append('model_version_mismatch')
        delta = record['comparison']['deltaSeconds']
        if record['class'] == 'claimed_observation' and is_int(delta) and abs(delta) > LARGE_DELTA_SECONDS:
            why.append('large_delta')
        if record['comparison']['tripMatch'] == 'unmatched':
            why.append('trip_unmatched')
        if record['class'] == 'problem_report' and record['problem']['category'] in QUEUE_PROBLEMS:
            why.append('problem_category')
        if why:
            queue[record['reportId']] = why
            reasons.extend(why)
    queue_ids = sorted(queue)

    matched_count = sum(1 for r in records_only if r['comparison']['tripMatch'] == 'matched')
    mismatch_count = sum(1 for r in records_only if not r['modelVersionMatches'])
    per_day = counted(r['context']['serviceDate'] for r in records_only)
    claimed_all_matched = sum(1 for row in rows if claimed_matched(row))

    class_counts = counted(r['class'] for r in records_only)
    sample_quality = {
        'per_class': {c: {'n': class_counts.get(c, 0),
                          'n_reviewed': sum(1 for row in rows if row['record']['class'] == c and row['review'] != 'unreviewed'),
                          'n_independently_verified': sum(1 for row in verified if row['record']['class'] == c)} for c in CLASSES},
        'n_total': analysed,
        'n_reviewed': sum(1 for row in rows if row['review'] != 'unreviewed'),
        'n_independently_verified': len(verified),
        'n_anonymous_unverified': len(rows),
        'n_eligible_independent_observations': sum(matched_independent_evidence(row) is not None for row in rows),
        'by_review_status': counted(row['review'] for row in rows),
    }

    integrity_issues = (len(invalid_lines) + len(duplicates) + len(repeated_events) + len(trip_overlap) + len(skipped_files) + len(bad_rejection_files)
                        + len(invalid_reviews) + len(unknown_review_ids))
    report = {
        'tool': {'name': 'beta_feedback_report', 'schemaVersion': TOOL_SCHEMA_VERSION, 'policyVersion': POLICY_VERSION},
        'generatedAt': generated_at,
        'policy': {
            'anonymous_reports_independent_evidence': False, 'feedback_changes_timetable_model': False,
            'planner_is_model_only_estimate': True, 'notes_text_included': False,
            'split_rule': 'sha256(reportId + "' + SPLIT_SALT + '") first byte < %d => calibration, else held_out' % SPLIT_CALIBRATION_BELOW,
            'timing_error_statistics_split': 'held_out_only', 'minimum_sample': MIN_SAMPLE,
            'synthetic_included': include_synthetic,
            'identity_remains_anonymous_unverified_after_review': True,
            'hour_bucket_timezone': '+03:30', 'hour_bucket_source': 'observation.observedAt when present, else receivedAt',
            'day_type_rule': 'serviceDate Gregorian weekday: Sat-Wed normal, Thu thursday, Fri friday',
            'duplicates_rule': 'first occurrence in sorted file order is analysed, later copies are integrity issues',
        },
        'totals': {'valid': len(unique), 'analysed': analysed, 'excluded_rejected_by_review': rejected_by_review,
                   'synthetic_excluded': synthetic_excluded,
                   'invalid': server_rejections + stored_invalid, 'server_rejections': server_rejections,
                   'unparsable_or_invalid_stored_lines': stored_invalid, 'duplicate_copies_ignored': sum(d['count'] - 1 for d in duplicates),
                   'server_rejections_by_reason': rejection_counts},
        'integrity': {
            'issue_count': integrity_issues,
            'invalid_lines_total': len(invalid_lines), 'invalid_lines': invalid_lines[:MAX_LISTED],
            'duplicate_report_ids': duplicates[:MAX_LISTED], 'duplicate_report_ids_total': len(duplicates),
            'repeated_event_claims_excluded': len(repeated_events),
            'held_out_trip_overlap_excluded': len(trip_overlap),
            'skipped_files': skipped_files, 'invalid_rejection_files': bad_rejection_files,
            'invalid_review_lines_total': len(invalid_reviews), 'invalid_review_lines': invalid_reviews[:MAX_LISTED],
            'reviews_for_unknown_reports': len(unknown_review_ids),
        },
        'by_kind': counted(r['kind'] for r in records_only),
        'by_class': class_counts,
        'by_line': counted(str(r['context']['line']) for r in records_only),
        'by_direction': counted(r['observation']['direction'] for r in records_only if r['observation']),
        'by_day_type': counted(row['dayType'] for row in rows),
        'by_hour_tehran': {'%02d' % h: sum(1 for row in rows if row['hour'] == '%02d' % h) for h in range(24)},
        'model_version': {'mix': counted(r['modelVersion'] for r in records_only), 'mismatch_count': mismatch_count,
                          'mismatch_share': share(mismatch_count, analysed)},
        'trip_match': {'matched': matched_count, 'matched_share': share(matched_count, analysed),
                       'by_value': counted(r['comparison']['tripMatch'] for r in records_only)},
        'coverage': {'reports_per_service_date': per_day, 'days_with_reports': len(per_day),
                     'first_service_date': min(per_day) if per_day else None, 'last_service_date': max(per_day) if per_day else None,
                     'mean_reports_per_day_with_reports': round(analysed / len(per_day), 3) if per_day else None},
        'sample_quality': sample_quality,
        'split': {'calibration': split_counts['calibration'], 'held_out': split_counts['held_out'],
                  'calibration_share': share(split_counts['calibration'], analysed)},
        'statistics': {
            'scope': 'held_out_split_only',
            'integrity_gate': 'blocked' if integrity_blocked else 'clear',
            'raw_boarding_outcomes': counted(r['outcome']['result'] for r in records_only if r['outcome']),
            'boarding_outcome_excluded_from_model_error': True,
            'boarding_outcome_reports': sum(1 for r in records_only if r['kind'] == 'boarding_outcome'),
            'claimed_observations_descriptive': {'label': 'not_accuracy: unreviewed_claims', 'n': len(descriptive),
                                                 'median_delta_seconds': median_value(descriptive),
                                                 'median_abs_delta_seconds': median_value([abs(v) for v in descriptive]),
                                                 'matched_claims_all_splits': claimed_all_matched},
            'timing_error_verified': timing_error,
            'missed_train_rate_verified': missed_rate,
        },
        'calibration': calibration,
        'review_queue': queue_ids[:MAX_QUEUE], 'review_queue_total': len(queue_ids), 'review_queue_truncated': len(queue_ids) > MAX_QUEUE,
        'review_queue_reasons': counted(reasons),
        'reviews': {'valid_lines': valid_review_lines, 'distinct_reports': len(effective_reviews),
                    'unknown_report_reviews': len(unknown_review_ids), 'rejected_reports_excluded': rejected_by_review,
                    'by_effective_status': counted(item['status'] for item in effective_reviews.values())},
        'notes': {'reports_with_note': sum(1 for r in records_only if r['note'] is not None), 'text_included': False},
    }
    report['accuracy'] = {'status': 'unavailable' if not verified_errors else 'experimental_only',
                          'n': len(verified_errors), 'claims_accuracy': False}
    report['provenance'] = {'sha256': before, 'signature_state': 'not_provided',
                            'meaning': 'input_content_fingerprint_not_authenticity_verification'}
    cells = {}
    metric_row_ids = {id(row) for row in verified_errors}
    for row in rows:
        record, observation = row['record'], row['record']['observation']
        key = (record['context']['line'], observation['direction'] if observation else 'unknown',
               record['context']['serviceDate'], row['hour'], observation['event'] if observation else 'not_applicable',
               row['review'], record['modelVersion'], row['split'])
        cells.setdefault(key, []).append(row)
    report['coverage']['cells'] = []
    report['statistics']['timing_error_verified_by_cell'] = []
    for key, members in sorted(cells.items()):
        dimensions: dict[str, object] = dict(zip(('line', 'direction', 'serviceDate', 'hour', 'event', 'review', 'modelVersion', 'split'), key))
        eligible = sum(matched_independent_evidence(row) is not None for row in members)
        report['coverage']['cells'].append({**dimensions, 'n': len(members), 'eligibleIndependentObservations': eligible})
        errors = sorted(abs(value) for row in members if id(row) in metric_row_ids
                        and (value := matched_independent_evidence(row)) is not None)
        if not errors:
            continue
        metric: dict[str, object] = {**dimensions, 'n': len(errors), 'required': MIN_SAMPLE, 'status': 'insufficient_sample'}
        if len(errors) >= MIN_SAMPLE:
            metric.update(status='ok', mae_seconds=round(sum(errors) / len(errors), 3),
                          p90_abs_seconds=nearest_rank(errors, 90), percentile_method='nearest_rank')
        report['statistics']['timing_error_verified_by_cell'].append(metric)
    return report


def dumps_report(report):
    return json.dumps(report, sort_keys=True, indent=2, ensure_ascii=True, allow_nan=False) + '\n'


# ---------------------------------------------------------------------------------------------------- markdown

def bullets(mapping):
    if not mapping:
        return ['- بدون داده']
    return ['- `%s`: %s' % (key, value) for key, value in mapping.items()]


def render_markdown(report):
    calibration = report['calibration']
    stats = report['statistics']
    totals, integrity, quality = report['totals'], report['integrity'], report['sample_quality']
    ready = calibration['status'] == 'ready_for_experimental_analysis'
    out = []
    if ready:
        out.append('تحلیل آزمایشی ممکن شده است، اما این گزارش ادعای دقت ندارد و نتیجه ها فقط آزمایشی هستند.')
    else:
        out.append('دقت هنوز اندازه گیری نشده است.')
    out += ['', '# گزارش تجمیعی بازخورد بتای برنامه ریز سفر مترو', '']
    if report['generatedAt']:
        out += ['زمان تولید گزارش: `%s`' % report['generatedAt'], '']
    out += ['## قواعد محصول', '',
            '- برنامه ریز فقط یک تخمین مبتنی بر مدل است و زنده نیست.',
            '- بازخورد هرگز مدل زمان بندی را به صورت خودکار تغییر نمی دهد.',
            '- گزارش های ناشناس بدون بررسی مستقل هرگز شواهد مستقل به حساب نمی آیند.',
            '- گزارش های `boarding_outcome` هرگز وارد آمار خطای مدل نمی شوند.',
            '- متن یادداشت ها در این گزارش چاپ نمی شود؛ فقط تعداد گزارش های دارای یادداشت نشان داده می شود.', '']
    out += ['## وضعیت کالیبراسیون', '', '- وضعیت: `%s`' % calibration['status'],
            '- گزارش های بررسی شده مستقل: %d' % calibration['independent_verified_reports'],
            '- مشاهده های تایید شده در بخش ارزیابی: %d از حداقل %d' % (calibration['verified_evaluation_observations'], calibration['required']),
            '- محدودیت ها: ' + '، '.join('`%s`' % item for item in calibration['limitations']), '']
    out += ['## مجموع ها', '',
            '- گزارش های معتبر ذخیره شده: %d' % totals['valid'],
            '- گزارش های وارد شده در تحلیل: %d' % totals['analysed'],
            '- گزارش های ردشده با بررسی و خارج از آمار: %d' % totals['excluded_rejected_by_review'],
            '- موارد نامعتبر (سرور و خط های ذخیره شده): %d' % totals['invalid'],
            '  - ردشده در سرور: %d' % totals['server_rejections'],
            '  - خط های ذخیره شده نامعتبر یا ناقص: %d' % totals['unparsable_or_invalid_stored_lines'],
            '- نسخه های تکراری نادیده گرفته شده: %d' % totals['duplicate_copies_ignored'], '',
            '### دلیل رد شدن در سرور', ''] + bullets(totals['server_rejections_by_reason']) + ['']
    for title, key in (('نوع گزارش', 'by_kind'), ('رده گزارش', 'by_class'), ('خط مترو', 'by_line'),
                       ('جهت مشاهده', 'by_direction'), ('نوع روز سرویس', 'by_day_type')):
        out += ['## بر حسب ' + title, ''] + bullets(report[key]) + ['']
    out += ['## ساعت به وقت تهران (فقط ساعت های دارای گزارش)', '']
    out += bullets({hour: n for hour, n in report['by_hour_tehran'].items() if n})
    out += ['', '## نسخه مدل', ''] + bullets(report['model_version']['mix'])
    out += ['', '- گزارش های دارای نسخه ناهمخوان: %d' % report['model_version']['mismatch_count'],
            '- سهم نسخه ناهمخوان: %s' % report['model_version']['mismatch_share'], '']
    out += ['## تطبیق سفر', '', '- سهم گزارش های تطبیق یافته: %s' % report['trip_match']['matched_share']] + bullets(report['trip_match']['by_value']) + ['']
    coverage = report['coverage']
    out += ['## پوشش بازخورد', '', '- روزهای دارای گزارش: %d' % coverage['days_with_reports'],
            '- میانگین گزارش در هر روز دارای گزارش: %s' % coverage['mean_reports_per_day_with_reports'], '']
    out += bullets(coverage['reports_per_service_date']) + ['']
    out += ['## کیفیت نمونه', '', '- بررسی شده: %d از %d' % (quality['n_reviewed'], quality['n_total']),
            '- بررسی مستقل تایید شده: %d' % quality['n_independently_verified'], '']
    for name, item in quality['per_class'].items():
        out.append('- `%s`: تعداد %d، بررسی شده %d، تایید شده %d' % (name, item['n'], item['n_reviewed'], item['n_independently_verified']))
    out += ['', '## تقسیم داده', '',
            '- بخش کالیبراسیون: %d' % report['split']['calibration'],
            '- بخش ارزیابی: %d' % report['split']['held_out'],
            '- هر آمار خطای زمانی فقط روی بخش ارزیابی محاسبه می شود.', '']
    desc = stats['claimed_observations_descriptive']
    out += ['## آمار', '',
            '- گزارش های `boarding_outcome` از آمار خطای مدل کنار گذاشته شده اند (تعداد: %d).' % stats['boarding_outcome_reports'],
            '- ادعاهای تایید نشده (`%s`): تعداد %d، میانه اختلاف %s ثانیه، میانه قدر مطلق اختلاف %s ثانیه. این عدد دقت نیست.'
            % (desc['label'], desc['n'], desc['median_delta_seconds'], desc['median_abs_delta_seconds'])]
    error = stats['timing_error_verified']
    if error['status'] == 'ok':
        out.append('- خطای زمانی با بررسی مستقل (آزمایشی): تعداد %d، MAE برابر %s ثانیه، P90 برابر %s ثانیه.'
                   % (error['n'], error['mae_seconds'], error['p90_abs_seconds']))
    else:
        out.append('- خطای زمانی با بررسی مستقل: نمونه کافی نیست (`insufficient_sample`)، تعداد %d از %d.' % (error['n'], error['required']))
    rate = stats['missed_train_rate_verified']
    if rate['status'] == 'ok':
        out.append('- نرخ قطار از دست رفته با بررسی مستقل: %s (تعداد %d).' % (rate['missed_rate'], rate['n']))
    else:
        out.append('- نرخ قطار از دست رفته: نمونه کافی نیست (`insufficient_sample`)، تعداد %d از %d.' % (rate['n'], rate['required']))
    out += ['', '## صحت داده', '', '- تعداد مشکل ها: %d' % integrity['issue_count'],
            '- خط های نامعتبر: %d' % integrity['invalid_lines_total'],
            '- شناسه های تکراری: %d' % integrity['duplicate_report_ids_total'],
            '- فایل های ردشده یا ناخوانا: %d' % (len(integrity['skipped_files']) + len(integrity['invalid_rejection_files'])),
            '- خط های نامعتبر در فایل بازبینی ها: %d' % integrity['invalid_review_lines_total'],
            '- بازبینی برای گزارش ناشناخته: %d' % integrity['reviews_for_unknown_reports'], '']
    for item in integrity['invalid_lines'][:20]:
        out.append('- `%s` خط %d: `%s`' % (item['file'], item['line'], item['reason']))
    out += ['', '## صف بررسی انسانی', '', '- تعداد کل: %d' % report['review_queue_total']] + bullets(report['review_queue_reasons'])
    for report_id in report['review_queue']:
        out.append('  - `%s`' % report_id)
    out += ['', '## یادداشت ها', '',
            '- %d گزارش یادداشت دارد؛ متن یادداشت ها چاپ نمی شود.' % report['notes']['reports_with_note'], '']
    return '\n'.join(out)


# ---------------------------------------------------------------------------------------------------- commands

def command_report(args):
    directory = require_dir(args.dir)
    generated_at = None
    if args.generated_at is not None:
        if parse_iso(args.generated_at) is None:
            raise UsageError('--generated-at must be an ISO timestamp with offset')
        generated_at = args.generated_at
    for out in (args.json, args.md):
        if out is not None and path_inside(out, directory):
            raise UsageError('refusing to write inside the feedback directory: ' + str(out))
        if out is not None and args.reviews is not None and os.path.realpath(out) == os.path.realpath(args.reviews):
            raise UsageError('refusing to overwrite review input')
    if args.json is not None and args.md is not None and os.path.realpath(args.json) == os.path.realpath(args.md):
        raise UsageError('JSON and Markdown outputs must be different files')
    report = build_report(str(directory), args.reviews, generated_at, args.include_synthetic)
    text = dumps_report(report)
    if args.json is not None:
        write_text_atomic(args.json, text)
    if args.md is not None:
        write_text_atomic(args.md, render_markdown(report))
    if args.json is None and args.md is None:
        sys.stdout.write(text)
    if args.strict and report['integrity']['issue_count']:
        print('integrity problems: %d' % report['integrity']['issue_count'], file=sys.stderr)
        return 3
    return 0


def month_end(year, month):
    first_next = dt.date(year + 1, 1, 1) if month == 12 else dt.date(year, month + 1, 1)
    return first_next - dt.timedelta(days=1)


def maintenance_snapshot(args, report_id=None, cutoff=None):
    directory = require_dir(args.dir)
    with offline_store_lock(directory) as check_lock:
        return locked_maintenance_snapshot(args, directory, check_lock, report_id, cutoff)


def locked_maintenance_snapshot(args, directory, check_lock, report_id=None, cutoff=None):
    """Plan or publish a separate pruned store; never mutate an ingest directory."""
    if args.apply and args.out_dir is None:
        raise UsageError('--apply requires --out-dir NEW for atomic offline snapshot publication; in-place edits are refused')
    if report_id is None and cutoff is None:
        raise UsageError('maintenance requires a report id or retention cutoff')
    reviews_path = directory / 'reviews.jsonl'
    before = store_fingerprint(directory, reviews_path if reviews_path.exists() else None)
    entries, invalid, skipped = load_feedback(directory)
    quota_counts = load_quota(directory, entries)
    _, bad_rejections = load_rejections(directory)
    if skipped or invalid or bad_rejections:
        raise UsageError('maintenance refuses corrupt or unreadable input; preserve raw snapshot and resolve QC first')
    payloads, removed_ids, kept_ids, plans = {}, set(), set(), []
    grouped = {name: [] for name in list_store_files(directory, FEEDBACK_NAME)}
    for entry in entries:
        grouped[entry['file']].append(entry)
    for name, rows in grouped.items():
        kept, removed = [], 0
        for entry in rows:
            record = entry['record']
            received = parse_iso(record['receivedAt'])
            victim = record['reportId'] == report_id if report_id is not None else received is not None and cutoff is not None and received < cutoff
            if victim:
                removed += 1
                removed_ids.add(record['reportId'])
                day = record['receivedAt'][:10]
                quota_counts[day] = quota_counts.get(day, 0) + 1
            else:
                kept_ids.add(record['reportId'])
                kept.append(entry['raw'])
        payloads[name] = b''.join(kept)
        if removed:
            plans.append({'file': name, 'linesRemoved': removed})
    if report_id is not None and not removed_ids:
        raise UsageError('report not found: ' + report_id)
    if removed_ids or os.path.lexists(directory / 'quota.json'):
        if len(quota_counts) > 366:
            raise UsageError('quota.json day count exceeds store bound; no offsets were discarded')
        ledger = {'schema': 1, 'semantics': 'deleted_intake_offsets', 'counts': quota_counts}
        payloads['quota.json'] = (json.dumps(ledger, sort_keys=True, separators=(',', ':')) + '\n').encode()
        if len(payloads['quota.json']) > MAX_METADATA_BYTES:
            raise UsageError('updated quota.json exceeds store metadata bound')
    removed_ids -= kept_ids
    reviews_removed = 0
    if reviews_path.exists():
        data, problem = read_file_bytes(reviews_path)
        if data is None:
            raise UsageError('cannot preserve reviews: ' + str(problem))
        kept = []
        for _, raw, _ in split_lines(data):
            if len(raw) > MAX_LINE_BYTES:
                raise UsageError('cannot preserve oversized QC review')
            try:
                review = loads_strict(raw.decode())
            except (ValueError, UnicodeDecodeError, RecursionError):
                raise UsageError('cannot safely cascade corrupt QC review') from None
            if not isinstance(review, dict) or not isinstance(review.get('reportId'), str):
                raise UsageError('cannot safely cascade invalid QC review')
            if review['reportId'] in removed_ids:
                reviews_removed += 1
            else:
                kept.append(raw + b'\n')
        payloads['reviews.jsonl'] = b''.join(kept)
    for name in list_store_files(directory, REJECTION_NAME):
        data, _ = read_file_bytes(directory / name)
        match = REJECTION_NAME.fullmatch(name)
        if match is None:
            raise UsageError('invalid rejection filename')
        expired = cutoff is not None and month_end(int(match.group(1)), int(match.group(2))) < cutoff.date()
        if expired:
            plans.append({'file': name, 'aggregateCounterFileRemoved': True})
        else:
            payloads[name] = data
    for name in sorted(os.listdir(directory)):
        if name == '.feedback.lock':
            continue  # Our lease is never copied to a snapshot.
        if name in payloads or FEEDBACK_NAME.fullmatch(name) or REJECTION_NAME.fullmatch(name):
            continue
        if name not in ('operations.jsonl', 'purge-log.jsonl'):
            raise UsageError('unknown store entry cannot be safely preserved: ' + name)
        data, problem = read_file_bytes(directory / name)
        if data is None:
            raise UsageError('cannot preserve operations history: ' + str(problem))
        payloads[name] = data
    if store_fingerprint(directory, reviews_path if reviews_path.exists() else None) != before:
        raise UsageError('input changed during read; use a quiescent offline snapshot')
    check_lock()
    result = {'dryRun': not args.apply, 'sourceUnchanged': True, 'sourceDeletionPerformed': False, 'files': plans,
              'removedReports': sum(item.get('linesRemoved', 0) for item in plans),
              'removedReviewRevisions': reviews_removed, 'inputSha256': before}
    if cutoff is not None:
        result.update(olderThanDays=args.older_than_days, cutoff=cutoff.isoformat())
    if args.apply:
        target = Path(args.out_dir)
        if path_inside(target, directory) or path_inside(directory, target) or os.path.lexists(target):
            raise UsageError('--out-dir must be a new path outside the input store')
        if not target.parent.is_dir() or target.parent.stat().st_mode & 0o022:
            raise UsageError('--out-dir parent must exist and not be group/world writable')
        operation = {'schema': 1, 'policyVersion': POLICY_VERSION, 'action': args.command,
                     'sourceSha256': before, 'removedReports': result['removedReports'],
                     'removedReviewRevisions': reviews_removed, 'at': utc_now_iso()}
        if cutoff is not None:
            operation['cutoff'] = cutoff.isoformat()
        else:
            assert report_id is not None
            operation['reportIdSha256'] = hashlib.sha256(report_id.encode()).hexdigest()
        payloads['operations.jsonl'] = payloads.get('operations.jsonl', b'').rstrip(b'\n')
        if payloads['operations.jsonl']:
            payloads['operations.jsonl'] += b'\n'
        payloads['operations.jsonl'] += (json.dumps(operation, sort_keys=True, separators=(',', ':')) + '\n').encode()
        staging = Path(tempfile.mkdtemp(prefix='.' + target.name + '.', dir=target.parent))
        try:
            os.chmod(staging, 0o700)
            for name, data in sorted(payloads.items()):
                fd = os.open(staging / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'wb') as handle:
                    os.fchmod(handle.fileno(), 0o600)
                    handle.write(data)
                    handle.flush()
                    os.fsync(handle.fileno())
            fsync_directory(staging)
            check_lock()
            if store_fingerprint(directory, reviews_path if reviews_path.exists() else None) != before:
                raise UsageError('input changed before publication; preserve original offline snapshot')
            if os.path.lexists(target):
                raise UsageError('snapshot output appeared during operation')
            os.rename(staging, target)
            fsync_directory(target.parent)
            for name, data in payloads.items():
                actual, problem = read_file_bytes(target / name)
                if actual != data or problem:
                    raise UsageError('snapshot read-back verification failed')
        finally:
            if staging.exists():
                for path in staging.iterdir():
                    path.unlink()
                staging.rmdir()
        result['publishedSnapshot'] = str(target)
    print(json.dumps(result, sort_keys=True, indent=2))
    return 0


def command_purge(args):
    if not MIN_RETENTION_DAYS <= args.older_than_days <= 36500:
        raise UsageError('--older-than-days must be at least 30 and no more than 36500')
    today = dt.datetime.now(dt.timezone.utc).date() if args.today is None else parse_date(args.today)
    if today is None:
        raise UsageError('--today must be YYYY-MM-DD')
    cutoff = dt.datetime.combine(today, dt.time.min, tzinfo=dt.timezone.utc) - dt.timedelta(days=args.older_than_days)
    return maintenance_snapshot(args, cutoff=cutoff)


def command_delete(args):
    if not REPORT_ID.fullmatch(args.report_id):
        raise UsageError('--report-id must match [A-Za-z0-9-]{16,64}')
    return maintenance_snapshot(args, report_id=args.report_id)


def csv_cell(value):
    text = str(value)
    return "'" + text if text.lstrip().startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r', '\n')) else text


def publish_new_file(out, text):
    """Publish complete 0600 bytes without replacing even a concurrently created target."""
    out = Path(out)
    fd, temp = tempfile.mkstemp(prefix='.' + out.name + '.', suffix='.tmp', dir=out.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(text.encode('utf-8'))
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temp, out, follow_symlinks=False)
        fsync_directory(out.parent)
    finally:
        os.unlink(temp)


def fsync_directory(directory):
    fd = os.open(directory, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def command_export(args):
    directory = require_dir(args.dir)
    out = Path(args.out)
    if path_inside(out, directory):
        raise UsageError('refusing to write inside the feedback directory: ' + str(out))
    if os.path.lexists(out):
        raise UsageError('refusing to overwrite existing file: ' + str(out))
    if not out.parent.is_dir():
        raise UsageError('output directory does not exist: ' + str(out.parent))
    report = build_report(str(directory), args.reviews, include_synthetic=args.include_synthetic)
    cells = report['coverage']['cells']
    if args.format == 'json':
        text = dumps_report({'schema': 1, 'policyVersion': POLICY_VERSION, 'cells': cells,
                             'totals': report['totals'], 'accuracy': report['accuracy'],
                             'statistics': report['statistics'], 'provenance': report['provenance'],
                             'syntheticIncluded': args.include_synthetic})
    else:
        stream = io.StringIO(newline='')
        writer = csv.writer(stream, lineterminator='\n')
        keys = ('line', 'direction', 'serviceDate', 'hour', 'event', 'review', 'modelVersion', 'split', 'n', 'eligibleIndependentObservations')
        writer.writerow(keys + ('syntheticIncluded',))
        for cell in cells:
            writer.writerow([csv_cell(cell[key]) for key in keys] + [str(args.include_synthetic).lower()])
        text = stream.getvalue()
    publish_new_file(out, text)
    print(json.dumps({'exportedReports': report['totals']['analysed'], 'coverageCells': len(cells),
                      'sha256': hashlib.sha256(text.encode()).hexdigest(), 'signature_state': 'not_provided',
                      'integrityIssues': report['integrity']['issue_count'], 'notesIncluded': False}, sort_keys=True))
    return 0


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    report = sub.add_parser('report', help='aggregate report (read-only)')
    report.add_argument('--dir', required=True)
    report.add_argument('--reviews')
    report.add_argument('--json')
    report.add_argument('--md')
    report.add_argument('--generated-at')
    report.add_argument('--strict', action='store_true', help='exit 3 when integrity problems exist')
    report.add_argument('--include-synthetic', action='store_true', help='test-only: include explicitly labelled synthetic records')
    purge = sub.add_parser('purge', help='plan or publish a pruned offline snapshot; source never modified')
    purge.add_argument('--dir', required=True)
    purge.add_argument('--older-than-days', default=30, type=int)
    purge.add_argument('--today')
    purge.add_argument('--apply', action='store_true')
    purge.add_argument('--out-dir')
    delete = sub.add_parser('delete-report', help='remove one report by id (dry run by default)')
    delete.add_argument('--dir', required=True)
    delete.add_argument('--report-id', required=True)
    delete.add_argument('--apply', action='store_true')
    delete.add_argument('--out-dir')
    export = sub.add_parser('export', help='write validated records to a new 0600 file')
    export.add_argument('--dir', required=True)
    export.add_argument('--out', required=True)
    export.add_argument('--format', choices=('json', 'csv'), default='json')
    export.add_argument('--reviews')
    export.add_argument('--include-synthetic', action='store_true')
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    handler = {'report': command_report, 'purge': command_purge, 'delete-report': command_delete, 'export': command_export}[args.command]
    try:
        return handler(args)
    except UsageError as error:
        print('error: ' + str(error), file=sys.stderr)
        return 2
    except OSError as error:
        print('error: ' + error.__class__.__name__ + ': ' + str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
