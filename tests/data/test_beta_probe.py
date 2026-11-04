import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("beta_probe", Path(__file__).resolve().parents[2] / "scripts" / "beta_probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class VerdictTests(unittest.TestCase):
    def v(self, **s):
        return probe.verdict({"unit_result": "success", **s})[0]

    def test_healthy_sample_is_ok(self):
        self.assertEqual(self.v(journey_p95_ms=12.0, old_api_p95_ms=6.0, memory_mib=60.0, feedback_dir_mib=0.1, disk_free_mib=6000, server_errors=0), "OK")

    def test_thresholds_are_inclusive_and_ordered(self):
        self.assertEqual(self.v(journey_p95_ms=79.9), "OK")
        self.assertEqual(self.v(journey_p95_ms=80.0), "WARN")
        self.assertEqual(self.v(journey_p95_ms=250.0), "KILL")
        self.assertEqual(self.v(old_api_p95_ms=50.0), "WARN")
        self.assertEqual(self.v(old_api_p95_ms=150.0), "KILL")
        self.assertEqual(self.v(memory_mib=149.9), "OK")
        self.assertEqual(self.v(memory_mib=150.0), "WARN")
        self.assertEqual(self.v(memory_mib=175.0), "KILL")
        self.assertEqual(self.v(feedback_dir_mib=6.0), "WARN")
        self.assertEqual(self.v(feedback_dir_mib=7.5), "KILL")

    def test_disk_is_worse_when_lower(self):
        self.assertEqual(self.v(disk_free_mib=1025), "OK")
        self.assertEqual(self.v(disk_free_mib=1024), "WARN")
        self.assertEqual(self.v(disk_free_mib=256), "KILL")

    def test_server_errors_restarts_oom_and_failed_unit_kill(self):
        self.assertEqual(self.v(server_errors=1), "WARN")
        self.assertEqual(self.v(server_errors=2), "KILL")
        self.assertEqual(self.v(restarts_since_baseline=1), "KILL")
        self.assertEqual(self.v(oom_kill=1), "KILL")
        self.assertEqual(probe.verdict({"unit_result": "exit-code"})[0], "KILL")

    def test_stale_lock_warns_with_the_operator_consequence(self):
        level, why = probe.verdict({"unit_result": "success", "stale_lock": True})
        self.assertEqual(level, "WARN")
        self.assertIn("fail closed", why[0])
        self.assertEqual(self.v(stale_lock=False), "OK")

    def test_missing_measurements_never_raise_the_alarm_or_hide_one(self):
        self.assertEqual(self.v(journey_p95_ms=None, old_api_p95_ms=None, memory_mib=None), "OK")
        self.assertEqual(self.v(journey_p95_ms=None, memory_mib=180.0), "KILL")

    def test_a_probe_that_got_no_journey_answer_is_inconclusive_not_ok(self):
        level, why = probe.verdict({"unit_result": "success", "journey_ok": 0, "rate_limited": 6})
        self.assertEqual(level, "WARN")
        self.assertIn("inconclusive", why[0])
        self.assertEqual(self.v(journey_ok=3), "OK")

    def test_p95_uses_nearest_rank(self):
        self.assertIsNone(probe.p95([]))
        self.assertEqual(probe.p95([1.0]), 1.0)
        self.assertEqual(probe.p95([float(i) for i in range(1, 21)]), 19.0)

    def test_thresholds_match_the_frozen_budget_document(self):
        doc = (Path(__file__).resolve().parents[2] / "docs" / "r2a-pb" / "PERFORMANCE-BUDGET.md").read_text()
        for needle in ("p95 <= 80 ms", "<= 250 ms", "p95 <= 50 ms", "184 MiB"):
            self.assertIn(needle.replace(" ", ""), doc.replace(" ", ""), needle)
        self.assertEqual(probe.THRESHOLDS["journey_p95_ms"], (80.0, 250.0))
        self.assertEqual(probe.THRESHOLDS["old_api_p95_ms"][0], 50.0)


if __name__ == "__main__":
    unittest.main()
