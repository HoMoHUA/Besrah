#!/usr/bin/env python3
"""R0 local file identity, not a build, deployment, or provenance attestation."""
import argparse
from contextlib import closing
import csv
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import subprocess
import sys
import tempfile

SCHEMA_VERSION = 1
POLICY_VERSION = 2
REQUIRED = ('packages/core/package.json', 'packages/core/package-lock.json',
            'packages/core/dist/miniapp.js', 'packages/core/dist/index.js',
            'data/network.json', 'data/anchors.json')
SOURCE_REQUIRED = ('packages/core/src/miniapp.ts', 'packages/core/tsconfig.json',
                   'packages/core/tsconfig.build.json')


def canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def git(root, *args):
    return subprocess.check_output(['git', '--no-optional-locks', '-C', str(root), *args], stderr=subprocess.PIPE)


def git_state(root, files):
    if Path(git(root, 'rev-parse', '--show-toplevel').decode().strip()).resolve() != root.resolve():
        raise ValueError('source root must be the Git repository root')
    head = git(root, 'rev-parse', 'HEAD').decode().strip()
    objects = {}
    for record in git(root, 'ls-tree', '-rz', '--full-tree', head).split(b'\0'):
        if record:
            metadata, path = record.split(b'\t', 1)
            mode, kind, object_id = metadata.split(b' ')
            if kind == b'blob' and mode in (b'100644', b'100755'):
                objects[path.decode('utf-8')] = object_id.decode('ascii')
    differs = False
    for entry in files:
        if entry['category'] == 'artifact':
            continue  # Existing build outputs do not assert committed provenance.
        body = checked_read(root, entry['path'])
        if hashlib.sha256(body).hexdigest() != entry['sha256']:
            raise ValueError('file changed while checking Git identity: ' + entry['path'])
        hash_function = hashlib.sha256 if len(head) == 64 else hashlib.sha1
        object_id = hash_function(b'blob ' + str(len(body)).encode('ascii') + b'\0' + body).hexdigest()
        differs = differs or objects.get(entry['path']) != object_id
    status = git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=normal')
    entries = status.split(b'\0')
    states = []
    i = 0
    while i < len(entries):
        entry = entries[i]
        if entry:
            states.append(entry[:2])
            if b'R' in entry[:2] or b'C' in entry[:2]:
                i += 1
        i += 1
    if git(root, 'rev-parse', 'HEAD').decode().strip() != head:
        raise ValueError('Git HEAD changed during inventory')
    return {'head': head, 'dirty': bool(states) or differs,
            'inventory_differs_from_head': differs,
            'index_dirty': any(s[:1] not in (b' ', b'?') for s in states),
            'worktree_dirty': any(s[1:2] not in (b' ', b'?') for s in states),
            'untracked_entries': states.count(b'??')}


def asset_paths(root, deployed):
    path = 'packages/core/dist/miniapp.js' if deployed else 'packages/core/src/miniapp.ts'
    text = checked_read(root, path).decode('utf-8')
    match = re.search(r'export const MINIAPP_ASSETS[^=]*=\s*\[(.*?)\n\s*\];', text, re.S)
    if not match:
        raise ValueError('cannot parse MINIAPP_ASSETS in ' + path)
    paths = set()
    for line in match.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith('//'):
            continue
        entry = re.fullmatch(r"\[(['\"])(/app/[^'\"]*)\1,\s*(['\"])([^'\"]+)\3\],?", line)
        if not entry:
            raise ValueError('unsupported MINIAPP_ASSETS entry in ' + path)
        if not safe_relative(entry[4]) or not entry[4].endswith(('.html', '.js', '.css', '.svg', '.png', '.woff2', '.json', '.webmanifest')):
            raise ValueError('unsafe, private or unsupported MINIAPP_ASSETS path')
        paths.add('apps/miniapp/' + entry[4])
    if not paths:
        raise ValueError('empty MINIAPP_ASSETS')
    return paths


# Versioned, positive file policy. Changes require a policy version bump.
DATA_FILES = (
    'data/network.json', 'data/anchors.json', 'data/field/corrections.json',
    'data/field/2026-10-16_line1_vakilabad-ghadir-vakilabad.csv',
    'data/field/2026-10-16_line2_shariati-fakouri-tabarsi.csv',
    'data/field/2026-10-22_line1_thursday_kowsar-vakilabad-ghadir.csv',
    'data/official/airport_route_sheet_1405-07-22.json',
    'data/official/metro_mashhad_ir_schedule_1405-07-21.json',
    'data/official/timetable_photo_rotated_1405-07-22.jpg',
    'data/bus/mashhad-bus.sqlite', 'data/bus/corrections/ui-v1.json',
) + tuple('data/bus/guide/' + name + '.json' for name in (
    'endpoint-derivations', 'facilities', 'lines', 'manifest', 'routes', 'stops',
)) + tuple('data/bus/exports/' + name for name in (
    'arrival_observations.csv', 'catalog.json', 'excluded_routes.csv', 'external_stop_mappings.csv',
    'facilities.csv', 'facilities.geojson', 'issues.csv', 'line_inventory.csv', 'lines.csv',
    'metadata.csv', 'municipal_terminal_candidates.csv', 'observed_route_refs.csv', 'platforms.csv',
    'reference_pdf_mentions.csv', 'reference_route_records.csv', 'reference_sources.csv',
    'route_endpoints.csv', 'route_geometry.csv', 'route_inventory.csv', 'route_master_members.csv',
    'route_masters.csv', 'route_members.csv', 'route_platforms.csv', 'route_ref_hints_without_geometry.csv',
    'route_stops.csv', 'routes.csv', 'routes.geojson', 'stop_inventory.csv', 'stop_refs.csv',
    'stops.csv', 'stops.geojson', 'summary.json', 'terminal_route_candidates.csv',
))
TOOL_FILES = ('scripts/release_inventory.py', 'tests/release/test_release_inventory.py',
              'docs/release-inventory.md', 'scripts/build_bus_app_data.py')
DENIED_PARTS = {'research', 'raw', 'session', 'sessions', 'node_modules', 'contact', 'contacts',
                'secret', 'secrets', 'credential', 'credentials', 'env', '__pycache__'}


def safe_relative(path):
    if not isinstance(path, str) or not path or '\\' in path or '\x00' in path:
        return False
    parts = path.split('/')
    if PurePosixPath(path).is_absolute() or any(not p or p in ('.', '..') or p.startswith('.') for p in parts):
        return False
    return not any(set(re.split(r'[._-]', part.lower())) & DENIED_PARTS for part in parts)


def checked_read(root, path):
    if not safe_relative(path):
        raise ValueError('unsafe or private path')
    current = root
    for part in path.split('/'):
        current = current / part
        if current.is_symlink():
            raise ValueError('symlink is not an inventory file: ' + path)
    if not current.is_file():
        raise ValueError('missing regular inventory file: ' + path)
    before = current.stat()
    body = current.read_bytes()
    after = current.stat()
    fingerprint = lambda stat: (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    if fingerprint(before) != fingerprint(after) or len(body) != after.st_size:
        raise ValueError('file changed while reading: ' + path)
    return body


def selected_paths(root, deployed):
    selected: set[str] = set(REQUIRED)
    if not deployed:
        selected.update(SOURCE_REQUIRED)
        selected.update(p.relative_to(root).as_posix() for p in (root / 'packages/core/src').rglob('*.ts') if p.is_file() and safe_relative(p.relative_to(root).as_posix()))
        selected.update(p for p in TOOL_FILES if (root / p).exists())
    for artifact in (root / 'packages/core/dist').rglob('*'):
        relative = artifact.relative_to(root).as_posix()
        if artifact.is_symlink():
            raise ValueError('symlink under runtime dist')
        if not safe_relative(relative):
            continue
        if artifact.is_dir():
            continue
        if not artifact.is_file() or not artifact.name.endswith(('.js', '.js.map', '.d.ts', '.d.ts.map')):
            raise ValueError('unexpected file under runtime dist; review and version the allowlist')
        selected.add(relative)
    selected.update(p for p in DATA_FILES if (root / p).exists() or (root / p).is_symlink())
    selected.update(asset_paths(root, deployed))
    return selected


def data_stats(root, path, body):
    if path.endswith(('.json', '.geojson')):
        value = json.loads(body)
        root_type = 'object' if isinstance(value, dict) else ('array' if isinstance(value, list) else 'scalar')
        return {'format': 'json', 'root_type': root_type,
                'records': len(value) if isinstance(value, (list, dict)) else 1,
                'collections': {k: len(v) for k, v in value.items() if isinstance(v, (list, dict))} if isinstance(value, dict) else {}}
    if path.endswith('.csv'):
        rows = csv.reader(io.StringIO(body.decode('utf-8-sig'), newline=''))
        header = next(rows, [])
        return {'format': 'csv', 'columns': len(header), 'records': sum(1 for row in rows if row)}
    if path.endswith('.sqlite'):
        database = root / path
        for suffix in ('-wal', '-shm', '-journal'):
            if Path(str(database) + suffix).exists():
                raise ValueError('SQLite sidecar present; use a closed, checkpointed snapshot: ' + path)
        # Immutable mode avoids creating journals or taking write locks in production.
        with closing(sqlite3.connect(database.resolve().as_uri() + '?mode=ro&immutable=1', uri=True)) as connection:
            connection.execute('PRAGMA query_only=ON')
            names = [row[0] for row in connection.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
            tables = {name: connection.execute('SELECT count(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0] for name in names}
        if database.read_bytes() != body:
            raise ValueError('file changed while measuring SQLite: ' + path)
        return {'format': 'sqlite', 'tables': tables}
    return {'format': 'binary'}


def file_entry(root, path):
    body = checked_read(root, path)
    category = 'artifact' if path.startswith('packages/core/dist/') else ('data' if path.startswith('data/') or path.endswith('.json') and path.startswith('apps/') else 'source')
    if path.startswith('apps/') and category != 'data':
        category = 'asset'
    entry = {'path': path, 'category': category, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
    if category == 'data':
        entry['stats'] = data_stats(root, path, body)
    return entry


def snapshot(root, deployed):
    files = [file_entry(root, p) for p in sorted(selected_paths(root, deployed))]
    package = json.loads((root / 'packages/core/package.json').read_text(encoding='utf-8'))
    if deployed:
        state = None
        kind = 'deployed_snapshot'
    else:
        state = git_state(root, files)
        kind = 'dirty_worktree_snapshot' if state['dirty'] else 'committed_source_snapshot'
    result = {'kind': kind, 'git': state,
              'package': {key: package[key] for key in ('name', 'version')}, 'files': files}
    result['id'] = 'sha256:' + digest(result)
    return result


def comparison(candidate, deployed):
    a = {f['path']: f['sha256'] for f in candidate['files'] if f['category'] != 'source'}
    b = {f['path']: f['sha256'] for f in deployed['files'] if f['category'] != 'source'}
    # Package/lock are runtime inputs even though their category is source.
    for snap, result in ((candidate, a), (deployed, b)):
        for f in snap['files']:
            if f['path'] in REQUIRED[:2]:
                result[f['path']] = f['sha256']
    common = a.keys() & b.keys()
    return {'candidate_only': sorted(a.keys() - b.keys()), 'deployed_only': sorted(b.keys() - a.keys()),
            'changed': sorted(p for p in common if a[p] != b[p]),
            'equal_count': sum(a[p] == b[p] for p in common)}


def create_manifest(source_root, production_root):
    source = Path(source_root).resolve(strict=True)
    production = Path(production_root).resolve(strict=True)
    if source == production:
        raise ValueError('source and production roots must be distinct')
    candidate = snapshot(source, False)
    deployed = snapshot(production, True)
    result = {'schema_version': SCHEMA_VERSION, 'policy_version': POLICY_VERSION,
              'kind': 'besrah-r0-release-inventory', 'candidate': candidate, 'deployed': deployed,
              'comparison': comparison(candidate, deployed)}
    result['manifest_sha256'] = digest(result)
    return result


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate JSON key: ' + key)
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError('non-finite JSON number: ' + value)

    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid_constant)


def load_manifest(path):
    return strict_json(Path(path).read_text(encoding='utf-8'))


def exact_keys(value, keys, label):
    if type(value) is not dict or set(value) != set(keys):
        raise ValueError(label + ': unexpected or missing fields')


def nonnegative(value, label):
    if type(value) is not int or value < 0:
        raise ValueError(label + ': expected nonnegative integer')


def hash_value(value, label, prefix=''):
    if type(value) is not str or not re.fullmatch(re.escape(prefix) + r'[0-9a-f]{64}', value):
        raise ValueError(label + ': expected SHA-256')


def path_list(values, label):
    if type(values) is not list or any(not safe_relative(p) for p in values) or values != sorted(set(values)):
        raise ValueError(label + ': paths must be safe, unique and sorted')


def validate_stats(stats):
    if type(stats) is not dict:
        raise ValueError('stats must be an object')
    fmt = stats.get('format')
    if fmt == 'json':
        exact_keys(stats, ('format', 'root_type', 'records', 'collections'), 'JSON stats')
        if stats['root_type'] not in ('object', 'array', 'scalar'):
            raise ValueError('invalid JSON root_type')
        nonnegative(stats['records'], 'JSON records')
        counts = stats['collections']
    elif fmt == 'csv':
        exact_keys(stats, ('format', 'columns', 'records'), 'CSV stats')
        nonnegative(stats['columns'], 'CSV columns')
        nonnegative(stats['records'], 'CSV records')
        return
    elif fmt == 'sqlite':
        exact_keys(stats, ('format', 'tables'), 'SQLite stats')
        counts = stats['tables']
    elif fmt == 'binary':
        exact_keys(stats, ('format',), 'binary stats')
        return
    else:
        raise ValueError('unknown stats format')
    if type(counts) is not dict or any(type(k) is not str for k in counts):
        raise ValueError('stats counts must be an object')
    for value in counts.values():
        nonnegative(value, 'stats count')


def validate_schema(manifest):
    exact_keys(manifest, ('schema_version', 'policy_version', 'kind', 'candidate', 'deployed',
                          'comparison', 'manifest_sha256'), 'manifest')
    for key, expected in (('schema_version', SCHEMA_VERSION), ('policy_version', POLICY_VERSION)):
        if type(manifest[key]) is not int or manifest[key] != expected:
            raise ValueError('unsupported ' + key)
    if manifest['kind'] != 'besrah-r0-release-inventory':
        raise ValueError('invalid manifest kind')
    for name in ('candidate', 'deployed'):
        snap = manifest[name]
        exact_keys(snap, ('kind', 'git', 'package', 'files', 'id'), name)
        if name == 'deployed':
            if snap['kind'] != 'deployed_snapshot' or snap['git'] is not None:
                raise ValueError('deployed snapshot cannot assert a Git commit')
        else:
            state = snap['git']
            exact_keys(state, ('head', 'dirty', 'index_dirty', 'worktree_dirty', 'untracked_entries', 'inventory_differs_from_head'), 'git')
            if type(state['head']) is not str or not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', state['head']):
                raise ValueError('invalid Git HEAD')
            for key in ('dirty', 'index_dirty', 'worktree_dirty', 'inventory_differs_from_head'):
                if type(state[key]) is not bool:
                    raise ValueError('Git flags must be booleans')
            nonnegative(state['untracked_entries'], 'untracked_entries')
            if state['dirty'] != bool(state['index_dirty'] or state['worktree_dirty'] or state['untracked_entries'] or state['inventory_differs_from_head']):
                raise ValueError('inconsistent Git dirty state')
            expected = 'dirty_worktree_snapshot' if state['dirty'] else 'committed_source_snapshot'
            if snap['kind'] != expected:
                raise ValueError('candidate kind contradicts Git state')
        exact_keys(snap['package'], ('name', 'version'), 'package')
        if any(type(v) is not str or not v for v in snap['package'].values()):
            raise ValueError('package name/version must be nonempty strings')
        if type(snap['files']) is not list or not snap['files']:
            raise ValueError('files must be a nonempty array')
        paths = []
        for entry in snap['files']:
            if type(entry) is not dict:
                raise ValueError('file entry must be an object')
            keys = ('path', 'category', 'bytes', 'sha256') + (('stats',) if entry.get('category') == 'data' else ())
            exact_keys(entry, keys, 'file')
            if not safe_relative(entry['path']):
                raise ValueError('unsafe or private inventory path')
            paths.append(entry['path'])
            if entry['category'] not in ('source', 'artifact', 'asset', 'data'):
                raise ValueError('invalid file category')
            nonnegative(entry['bytes'], 'file bytes')
            hash_value(entry['sha256'], 'file hash')
            if entry['category'] == 'data':
                validate_stats(entry['stats'])
        path_list(paths, name + ' files')
        hash_value(snap['id'], name + ' id', 'sha256:')
        if snap['id'] != 'sha256:' + digest({k: v for k, v in snap.items() if k != 'id'}):
            raise ValueError(name + ' snapshot checksum mismatch')
    delta = manifest['comparison']
    exact_keys(delta, ('candidate_only', 'deployed_only', 'changed', 'equal_count'), 'comparison')
    for key in ('candidate_only', 'deployed_only', 'changed'):
        path_list(delta[key], key)
    nonnegative(delta['equal_count'], 'equal_count')
    if delta != comparison(manifest['candidate'], manifest['deployed']):
        raise ValueError('comparison does not match snapshot inventories')
    hash_value(manifest['manifest_sha256'], 'manifest checksum')
    if manifest['manifest_sha256'] != digest({k: v for k, v in manifest.items() if k != 'manifest_sha256'}):
        raise ValueError('manifest checksum mismatch')


def validate_manifest(manifest, source_root, production_root):
    try:
        validate_schema(manifest)
        current = create_manifest(source_root, production_root)
        errors = []
        for name in ('candidate', 'deployed'):
            recorded = {f['path']: f for f in manifest[name]['files']}
            actual = {f['path']: f for f in current[name]['files']}
            for path in sorted(recorded.keys() - actual.keys()):
                errors.append(name + ': missing or no longer allowed file: ' + path)
            for path in sorted(actual.keys() - recorded.keys()):
                errors.append(name + ': unexpected allowed file: ' + path)
            for path in sorted(recorded.keys() & actual.keys()):
                if recorded[path] != actual[path]:
                    errors.append(name + ': hash/size/category/stats changed: ' + path)
            for key in ('kind', 'git', 'package'):
                if manifest[name][key] != current[name][key]:
                    errors.append(name + ': ' + key + ' metadata changed')
        return errors
    except (ValueError, OSError, sqlite3.Error, subprocess.CalledProcessError, KeyError, TypeError) as error:
        return [str(error)]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest='command', required=True)
    for name in ('create', 'validate'):
        command = subparsers.add_parser(name)
        command.add_argument('--source-root', type=Path, required=True)
        command.add_argument('--production-root', type=Path, required=True)
        command.add_argument('--output' if name == 'create' else '--manifest', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        source = args.source_root.resolve(strict=True)
        production = args.production_root.resolve(strict=True)
        if args.command == 'create':
            output = args.output.resolve()
            # Output is outside BOTH roots: no self hash, no self-induced Git dirt,
            # and no accidental overwrite of source or live deployment files.
            if output.is_relative_to(source) or output.is_relative_to(production):
                raise ValueError('manifest output must be outside source and production roots')
            manifest = create_manifest(source, production)
            errors = validate_manifest(manifest, source, production)
            if errors:
                raise ValueError('inputs changed during capture: ' + '; '.join(errors))
            output.parent.mkdir(parents=True, exist_ok=True)
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(prefix='besrah-manifest-', dir=os.environ.get('TMPDIR'), delete=False) as staged:
                    temporary = Path(staged.name)
                    staged.write(json.dumps(manifest, ensure_ascii=True, sort_keys=True, indent=2, allow_nan=False).encode('utf-8') + b'\n')
                    staged.flush()
                    os.fsync(staged.fileno())
                # A cross-filesystem output fails safely rather than partially writing.
                os.replace(temporary, output)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            print('created ' + str(output))
        else:
            errors = validate_manifest(load_manifest(args.manifest), source, production)
            if errors:
                raise ValueError('; '.join(errors))
            print('valid: candidate and deployed inventories match current allowed files')
        return 0
    except (ValueError, OSError, sqlite3.Error, subprocess.CalledProcessError, KeyError, TypeError) as error:
        print('release inventory: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
