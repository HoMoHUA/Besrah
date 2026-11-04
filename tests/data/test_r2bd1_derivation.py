"""Offline regressions for targeted C1 snapshot derivation, not routing."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'scripts/r2bd1/derive.py'
PACKAGE = ROOT / 'data/geospatial/r2bd1-c1-v1'


class DerivationTests(unittest.TestCase):
    def test_real_snapshot_retains_entrance_memberships_without_platform_connectors(self):
        self.assertTrue(SCRIPT.exists(), 'The C1 evidence derivation is not implemented')
        spec = importlib.util.spec_from_file_location('r2bd1_derive', SCRIPT)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = module.derive(PACKAGE, ROOT / 'data/network.json')
        self.assertEqual(result['counts']['elements'], 951)
        self.assertEqual(result['counts']['entrances'], 6)
        self.assertEqual(result['counts']['highwayWays'], 198)
        self.assertEqual(len(result['entrancesByStation']['METRO-107']), 4)
        self.assertEqual(len(result['entrancesByStation']['METRO-108']), 2)
        self.assertTrue(all(p['sharedHighwayNodeIds'] == [] for p in result['platforms']))
        self.assertTrue(all(p['fieldVerification'] == 'unverified' for p in result['publicPoints']))
        self.assertTrue(all(p['accuracyMeters'] is None for p in result['publicPoints']))
        self.assertTrue(all(c['timing']['seconds'] is None for c in result['outdoorCandidates']))
        self.assertFalse(result['artificialConnectorsCreated'])
        self.assertFalse(result['physicalPassabilityCertified'])
    def test_real_gate_remains_blocked_in_both_directions_without_invented_internal_edges(self):
        script = ROOT / 'scripts/r2bd1/build_evidence.py'
        self.assertTrue(script.exists(), 'Evidence Gate builder is not implemented')
        import sys
        sys.path.insert(0, str(script.parent))
        spec = importlib.util.spec_from_file_location('r2bd1_build', script)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = module.build(ROOT)
        self.assertEqual(result['gate'], 'BLOCKED')
        self.assertEqual(result['eligibleDirectionCount'], 0)
        self.assertEqual(len(result['directions']), 2)
        for direction in result['directions']:
            self.assertEqual(direction['gate'], 'BLOCKED')
            for leg in direction['legs']:
                if leg['role'] in ['origin_internal', 'destination_internal']:
                    self.assertIsNone(leg['edgeId'])
                    self.assertIsNone(leg['timingSeconds'])
                    self.assertNotEqual(leg['status'], 'pass')
        self.assertFalse(result['plannerImplemented'])
        self.assertFalse(result['fullAtoBDurationComputed'])
        registered_sources = set(result['sources']) | set(result.get('internalSources', {}))
        for direction in result['directions']:
            for leg in direction['legs']:
                self.assertTrue(set(leg['sourceIds']).issubset(registered_sources), leg['role'])


if __name__ == '__main__':
    unittest.main()
