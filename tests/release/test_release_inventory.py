"""Isolated stdlib tests: never reads or writes the real runtime."""
import importlib.util
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
TOOL = REPO / 'scripts/release_inventory.py'


def load_tool():
    spec = importlib.util.spec_from_file_location('release_inventory', TOOL)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ReleaseInventoryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='besrah-release-test-', dir=os.environ['TMPDIR'])
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.source = self.base / 'source'
        self.deployed = self.base / 'deployed'
        self.source.mkdir()
        self.deployed.mkdir()
        self.write(self.source, 'packages/core/package.json', '{"name":"fixture-core","version":"0.1.0"}')
        self.write(self.source, 'packages/core/package-lock.json', '{"lockfileVersion":3}')
        for name in ['tsconfig.json', 'tsconfig.build.json']:
            self.write(self.source, 'packages/core/' + name, '{}')
        assets = "export const MINIAPP_ASSETS = [\n  ['/app/', 'index.html'],\n  ['/app/assets/catalog.json', 'assets/catalog.json'],\n];\n"
        self.write(self.source, 'packages/core/src/miniapp.ts', assets)
        self.write(self.source, 'packages/core/src/index.ts', 'export {};\n')
        self.write(self.source, 'packages/core/dist/miniapp.js', assets)
        self.write(self.source, 'packages/core/dist/index.js', 'export {};\n')
        self.write(self.source, 'apps/miniapp/index.html', '<!doctype html>fixture\n')
        self.write(self.source, 'apps/miniapp/assets/catalog.json', '{"vendors":[{"id":1}],"count":1}')
        self.write(self.source, 'data/network.json', '{"stations":[{"id":"one"}],"lines":{"1":{}}}')
        self.write(self.source, 'data/anchors.json', '{}')
        shutil.copytree(self.source, self.deployed, dirs_exist_ok=True)
        shutil.rmtree(self.deployed / 'packages/core/src')
        self.git('init', '-q')
        self.git('config', 'user.name', 'Release Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture baseline')

    @staticmethod
    def write(root, relative, text):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
        return path

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.source), *args], text=True).strip()

    def test_inventory_covers_full_runtime_and_explicit_safe_data_without_private_paths(self):
        tool = load_tool()
        for root in (self.source, self.deployed):
            self.write(root, 'packages/core/dist/bus/cli.js', 'export {};')
            self.write(root, 'packages/core/dist/index.js.map', '{}')
            self.write(root, 'packages/core/dist/index.d.ts', 'export {};')
            self.write(root, 'data/field/2026-10-16_line1_vakilabad-ghadir-vakilabad.csv', 'station,time\none,12:00\n')
            self.write(root, 'data/official/airport_route_sheet_1405-07-22.json', '{}')
            self.write(root, 'data/bus/guide/stops.json', '[{"id":1}]')
            for path in ['.env', 'research/contacts.json', 'session/login.json',
                         'data/bus/raw/observation.json', 'data/contacts.json',
                         'packages/core/node_modules/private.json', 'packages/core/src/secrets.ts',
                         'apps/miniapp/not-served.js']:
                self.write(root, path, 'PRIVATE_SENTINEL')
        manifest = tool.create_manifest(self.source, self.deployed)
        encoded = json.dumps(manifest)
        self.assertNotIn('PRIVATE_SENTINEL', encoded)
        for key in ('candidate', 'deployed'):
            paths = {f['path'] for f in manifest[key]['files']}
            self.assertIn('packages/core/dist/index.js.map', paths)
            self.assertIn('packages/core/dist/index.d.ts', paths)
            self.assertIn('packages/core/dist/bus/cli.js', paths)
            self.assertIn('data/official/airport_route_sheet_1405-07-22.json', paths)
            self.assertIn('data/field/2026-10-16_line1_vakilabad-ghadir-vakilabad.csv', paths)
            self.assertIn('data/bus/guide/stops.json', paths)
            self.assertFalse(any(part in paths for part in ['.env', 'data/contacts.json', 'packages/core/src/secrets.ts']))
            self.assertNotIn('apps/miniapp/not-served.js', paths)
        # Installed assets are derived from installed dist, never from candidate source.
        text = (self.deployed / 'packages/core/dist/miniapp.js').read_text()
        self.write(self.deployed, 'packages/core/dist/miniapp.js', text.replace("  ['/app/',", "  ['/app/installed.js', 'installed.js'],\n  ['/app/',"))
        self.write(self.deployed, 'apps/miniapp/installed.js', 'export {};')
        manifest = tool.create_manifest(self.source, self.deployed)
        self.assertIn('apps/miniapp/installed.js', manifest['comparison']['deployed_only'])

    def test_data_statistics_are_measured_and_stale_stats_or_hash_are_rejected(self):
        import copy
        import sqlite3
        tool = load_tool()
        db = self.source / 'data/bus/mashhad-bus.sqlite'
        db.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(db)) as connection:
            connection.execute('CREATE TABLE stops (id INTEGER)')
            connection.executemany('INSERT INTO stops VALUES (?)', [(1,), (2,)])
            connection.commit()
        self.write(self.source, 'data/field/2026-10-16_line1_vakilabad-ghadir-vakilabad.csv', 'station,time\none,12:00\ntwo,12:05\n')
        manifest = tool.create_manifest(self.source, self.deployed)
        entries = {f['path']: f for f in manifest['candidate']['files']}
        self.assertIn('stats', entries['data/network.json'])
        self.assertEqual(entries['data/network.json']['stats']['collections']['stations'], 1)
        self.assertEqual(entries['data/bus/mashhad-bus.sqlite']['stats']['tables'], {'stops': 2})
        self.assertEqual(entries['data/field/2026-10-16_line1_vakilabad-ghadir-vakilabad.csv']['stats']['records'], 2)
        tampered = copy.deepcopy(manifest)
        next(f for f in tampered['candidate']['files'] if f['path'] == 'data/network.json')['stats']['collections']['stations'] = 99
        # Even if a caller re-seals the hashes, stats must be checked against files.
        for snap in (tampered['candidate'], tampered['deployed']):
            snap['id'] = 'sha256:' + tool.digest({k: v for k, v in snap.items() if k != 'id'})
        tampered['manifest_sha256'] = tool.digest({k: v for k, v in tampered.items() if k != 'manifest_sha256'})
        self.assertTrue(tool.validate_manifest(tampered, self.source, self.deployed))
        self.write(self.source, 'data/network.json', '{"stations":[{"id":"two"}],"lines":{"1":{}}}')
        self.assertTrue(tool.validate_manifest(manifest, self.source, self.deployed))

    def test_strict_schema_rejects_bool_versions_unknown_fields_and_duplicate_json_keys(self):
        import copy
        tool = load_tool()
        original = tool.create_manifest(self.source, self.deployed)
        for version in [True, '1', 2, None]:
            with self.subTest(version=version):
                edited = copy.deepcopy(original)
                edited['schema_version'] = version
                self.assertTrue(tool.validate_manifest(edited, self.source, self.deployed))
        edited = copy.deepcopy(original)
        edited['unexpected'] = 'field'
        self.assertTrue(tool.validate_manifest(edited, self.source, self.deployed))
        edited = copy.deepcopy(original)
        edited['candidate']['kind'] = 'committed_release'
        self.assertTrue(tool.validate_manifest(edited, self.source, self.deployed))
        path = self.write(self.base, 'duplicate.json', '{"schema_version":1,"schema_version":1}')
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            tool.load_manifest(path)

    def test_private_or_traversing_asset_and_symlink_inputs_fail_closed(self):
        tool = load_tool()
        original = (self.source / 'packages/core/src/miniapp.ts').read_text()
        for target in ['../index.html', '../../../.env', 'assets/contacts.json', '/etc/passwd', 'assets/raw/test.json']:
            with self.subTest(target=target):
                self.write(self.source, 'packages/core/src/miniapp.ts', original.replace('index.html', target))
                with self.assertRaisesRegex(ValueError, 'unsafe|private|unsupported'):
                    tool.create_manifest(self.source, self.deployed)
        self.write(self.source, 'packages/core/src/miniapp.ts', original)
        outside = self.write(self.base, 'outside.html', 'NOT_PUBLIC')
        asset = self.source / 'apps/miniapp/index.html'
        asset.unlink()
        asset.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            tool.create_manifest(self.source, self.deployed)

    def cli(self, *args):
        return subprocess.run(['python3', str(TOOL), *args,
                               '--source-root', str(self.source), '--production-root', str(self.deployed)],
                              text=True, capture_output=True, check=False)

    def test_cli_roundtrip_manifest_self_exclusion_and_readonly_runtime(self):
        output = self.base / 'R0.manifest.json'
        original = {p.relative_to(self.deployed): p.read_bytes() for p in self.deployed.rglob('*') if p.is_file()}
        created = self.cli('create', '--output', str(output))
        self.assertEqual(created.returncode, 0, created.stderr)
        self.assertTrue(output.is_file(), 'CLI must create the manifest artifact')
        first = output.read_bytes()
        self.assertEqual(self.cli('validate', '--manifest', str(output)).returncode, 0)
        self.assertEqual(self.cli('create', '--output', str(output)).returncode, 0)
        self.assertEqual(first, output.read_bytes())
        actual = {p.relative_to(self.deployed): p.read_bytes() for p in self.deployed.rglob('*') if p.is_file()}
        self.assertEqual(original, actual)
        manifest = json.loads(first)
        self.assertFalse(any(f['path'].endswith('R0.manifest.json') for key in ('candidate', 'deployed') for f in manifest[key]['files']))
        self.write(self.deployed, 'packages/core/dist/added.js', 'export {};')
        result = self.cli('validate', '--manifest', str(output))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('unexpected allowed file', result.stderr)
        (self.deployed / 'packages/core/dist/added.js').unlink()
        (self.deployed / 'apps/miniapp/index.html').unlink()
        result = self.cli('validate', '--manifest', str(output))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('missing', result.stderr)
        for path in [self.source / 'candidate.json', self.deployed / 'output.json']:
            result = self.cli('create', '--output', str(path))
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(path.exists())

    def test_ignored_source_and_assume_unchanged_bytes_cannot_claim_committed_snapshot(self):
        tool = load_tool()
        self.write(self.source, '.gitignore', 'packages/core/src/local.ts\npackages/core/dist/\n')
        self.git('add', '.gitignore')
        self.git('commit', '-qm', 'fixture ignore rules')
        self.write(self.source, 'packages/core/src/local.ts', 'export const local = true;')
        self.assertEqual('', self.git('status', '--porcelain'))
        manifest = tool.create_manifest(self.source, self.deployed)
        self.assertTrue(manifest['candidate']['git']['dirty'])
        self.assertEqual(manifest['candidate']['kind'], 'dirty_worktree_snapshot')
        (self.source / 'packages/core/src/local.ts').unlink()
        self.git('update-index', '--assume-unchanged', 'apps/miniapp/index.html')
        self.write(self.source, 'apps/miniapp/index.html', 'changed despite assume-unchanged')
        self.assertEqual('', self.git('status', '--porcelain'))
        manifest = tool.create_manifest(self.source, self.deployed)
        self.assertEqual(manifest['candidate']['kind'], 'dirty_worktree_snapshot')
        self.git('update-index', '--no-assume-unchanged', 'apps/miniapp/index.html')
        self.git('add', 'apps/miniapp/index.html')
        manifest = tool.create_manifest(self.source, self.deployed)
        self.assertTrue(manifest['candidate']['git']['index_dirty'])

    def test_unrecognized_runtime_dist_file_fails_instead_of_silently_omitting_it(self):
        tool = load_tool()
        self.write(self.deployed, 'packages/core/dist/unexpected.txt', 'not a declared runtime artifact')
        with self.assertRaisesRegex(ValueError, 'unexpected.*dist|unsupported.*dist'):
            tool.create_manifest(self.source, self.deployed)

    def test_resealed_manifest_missing_extra_and_changed_entries_do_not_validate(self):
        import copy
        tool = load_tool()
        original = tool.create_manifest(self.source, self.deployed)

        def reseal(value):
            for key in ('candidate', 'deployed'):
                snap = value[key]
                snap['files'].sort(key=lambda f: f['path'])
                snap['id'] = 'sha256:' + tool.digest({k: v for k, v in snap.items() if k != 'id'})
            value['comparison'] = tool.comparison(value['candidate'], value['deployed'])
            value['manifest_sha256'] = tool.digest({k: v for k, v in value.items() if k != 'manifest_sha256'})

        for action in ('remove', 'extra', 'hash', 'package', 'private'):
            with self.subTest(action=action):
                value = copy.deepcopy(original)
                entries = value['deployed']['files']
                if action == 'remove':
                    entries.pop()
                elif action in ('extra', 'private'):
                    entry = copy.deepcopy(entries[0])
                    entry['path'] = 'apps/miniapp/extra.js' if action == 'extra' else 'research/contacts.json'
                    entries.append(entry)
                elif action == 'hash':
                    entries[0]['sha256'] = '0' * 64
                else:
                    value['deployed']['package']['version'] = '999.0.0'
                reseal(value)
                self.assertTrue(tool.validate_manifest(value, self.source, self.deployed))
        self.write(self.deployed, 'apps/miniapp/index.html', '<!doctype html>tampered')
        self.assertTrue(tool.validate_manifest(original, self.source, self.deployed))

    def test_sqlite_sidecar_is_rejected_without_creating_more_runtime_files(self):
        import sqlite3
        tool = load_tool()
        db = self.deployed / 'data/bus/mashhad-bus.sqlite'
        db.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(db)) as connection:
            connection.execute('CREATE TABLE stops (id INTEGER)')
            connection.commit()
        self.write(self.deployed, 'data/bus/mashhad-bus.sqlite-wal', '')
        before = sorted(str(p.relative_to(self.deployed)) for p in self.deployed.rglob('*'))
        with self.assertRaisesRegex(ValueError, 'sidecar'):
            tool.create_manifest(self.source, self.deployed)
        self.assertEqual(before, sorted(str(p.relative_to(self.deployed)) for p in self.deployed.rglob('*')))

    def test_identical_source_and_deployment_roots_are_rejected(self):
        tool = load_tool()
        with self.assertRaisesRegex(ValueError, 'distinct|different'):
            tool.create_manifest(self.source, self.source)

    def test_candidate_identity_includes_bus_correction_inputs_and_builder(self):
        tool = load_tool()
        overlay = 'data/bus/corrections/ui-v1.json'
        builder = 'scripts/build_bus_app_data.py'
        self.write(self.source, overlay, '{"schema_version":1,"overlay_id":"fixture-v1"}')
        self.write(self.source, builder, '# fixture bus builder\n')
        first = tool.create_manifest(self.source, self.deployed)
        entries = {entry['path']: entry for entry in first['candidate']['files']}
        self.assertIn(overlay, entries, 'correction input must be part of candidate identity')
        self.assertIn(builder, entries, 'data generator must be part of candidate identity')
        self.assertEqual(entries[overlay]['category'], 'data')
        self.assertEqual(entries[builder]['category'], 'source')
        self.write(self.source, overlay, '{"schema_version":1,"overlay_id":"changed-fixture"}')
        self.assertTrue(tool.validate_manifest(first, self.source, self.deployed))
        second = tool.create_manifest(self.source, self.deployed)
        self.assertNotEqual(first['candidate']['id'], second['candidate']['id'])
        self.assertEqual(first['deployed'], second['deployed'])
        self.write(self.source, builder, '# changed fixture bus builder\n')
        self.assertTrue(tool.validate_manifest(second, self.source, self.deployed))

    def test_deterministic_inventory_separates_head_worktree_and_deployed(self):
        self.assertTrue(TOOL.is_file(), 'R0 release inventory tool is not implemented')
        tool = load_tool()
        baseline = tool.create_manifest(self.source, self.deployed)
        self.assertEqual(baseline, tool.create_manifest(self.source, self.deployed))
        self.assertEqual(baseline['schema_version'], 1)
        self.assertEqual(baseline['candidate']['kind'], 'committed_source_snapshot')
        self.assertEqual(baseline['candidate']['git']['head'], self.git('rev-parse', 'HEAD'))
        self.assertEqual(baseline['deployed']['kind'], 'deployed_snapshot')
        self.write(self.source, 'apps/miniapp/index.html', '<!doctype html>candidate\n')
        dirty = tool.create_manifest(self.source, self.deployed)
        self.assertEqual(dirty['candidate']['kind'], 'dirty_worktree_snapshot')
        self.assertTrue(dirty['candidate']['git']['dirty'])
        self.assertEqual(dirty['candidate']['git']['head'], baseline['candidate']['git']['head'])
        self.assertNotEqual(dirty['candidate']['id'], baseline['candidate']['id'])
        self.assertEqual(dirty['deployed'], baseline['deployed'])
        self.assertIn('apps/miniapp/index.html', dirty['comparison']['changed'])
        self.assertIn('packages/core/dist/index.js', [f['path'] for f in dirty['deployed']['files']])
        self.assertEqual([], tool.validate_manifest(dirty, self.source, self.deployed))


if __name__ == '__main__':
    unittest.main()
