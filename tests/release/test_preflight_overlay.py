import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[2] / "scripts" / "preflight_overlay.py"


def run(*args):
    return subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True)


def write(root: Path, rel: str, text: str, mode=0o644):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
    os.chmod(p, mode)


class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.cand, self.prod, self.base = t / "cand", t / "prod", t / "base-dist"
        self.snap, self.plan = t / "snap", t / "plan.json"
        # Production runs old server.js and an unrelated food view; the candidate changes server.js, adds a module and a new asset.
        write(self.prod, "packages/core/dist/server.js", "old-server")
        write(self.prod, "packages/core/dist/time.js", "same-time")
        write(self.prod, "apps/miniapp/views/food.js", "prod-food")
        write(self.prod, "apps/miniapp/views/metro.js", "old-metro")
        write(self.cand, "packages/core/dist/server.js", "new-server")
        write(self.cand, "packages/core/dist/time.js", "same-time")
        write(self.cand, "packages/core/dist/journey/new.js", "brand-new")
        write(self.cand, "apps/miniapp/views/food.js", "candidate-food-drift")
        write(self.cand, "apps/miniapp/views/metro.js", "new-metro")
        write(self.cand, "apps/miniapp/ui/planner.js", "planner")
        write(self.cand, "apps/miniapp/planner.test.mjs", "test only")
        write(self.cand, "apps/miniapp/zz-sorts-after-views.js", "late")
        write(self.base, "server.js", "base-server")
        write(self.base, "time.js", "same-time")
        names = t / "assets.json"
        names.write_text(json.dumps(["apps/miniapp/views/metro.js", "apps/miniapp/ui/planner.js", "apps/miniapp/planner.test.mjs", "apps/miniapp/zz-sorts-after-views.js"]))
        self.names = names
        r = run("plan", "--candidate", str(self.cand), "--production", str(self.prod), "--base-dist", str(self.base),
                "--base-assets-json", str(names), "--out", str(self.plan))
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.data = json.loads(self.plan.read_text())

    def tearDown(self):
        self.tmp.cleanup()

    def apply(self, *extra):
        return run("apply", "--plan", str(self.plan), "--candidate", str(self.cand), "--target", str(self.prod), "--snapshot", str(self.snap), *extra)

    def test_plan_is_an_allowlist_against_production_and_names_excluded_drift(self):
        paths = [f["path"] for f in self.data["files"]]
        self.assertIn("packages/core/dist/server.js", paths)
        self.assertIn("packages/core/dist/journey/new.js", paths)
        self.assertNotIn("packages/core/dist/time.js", paths)  # already equal to Production
        self.assertNotIn("apps/miniapp/planner.test.mjs", paths)  # test files never ship
        self.assertNotIn("apps/miniapp/views/food.js", paths)  # unrelated drift is not swept in
        self.assertEqual([d["path"] for d in self.data["excludedDrift"]], ["apps/miniapp/views/food.js"])
        self.assertEqual(paths.index("apps/miniapp/views/metro.js"), len(paths) - 1, "entry import goes last")
        by = {f["path"]: f for f in self.data["files"]}
        self.assertIsNone(by["packages/core/dist/journey/new.js"]["preSha256"])
        self.assertFalse(by["packages/core/dist/server.js"]["productionEqualsApprovedBaseBuild"])

    def test_apply_then_rollback_restores_the_exact_tree(self):
        before = {str(p.relative_to(self.prod)): p.read_text() for p in self.prod.rglob("*") if p.is_file()}
        self.assertEqual(self.apply().returncode, 0)
        self.assertEqual((self.prod / "packages/core/dist/server.js").read_text(), "new-server")
        self.assertEqual((self.prod / "apps/miniapp/views/food.js").read_text(), "prod-food")
        self.assertEqual(run("verify", "--plan", str(self.plan), "--target", str(self.prod), "--state", "post").returncode, 0)
        r = run("rollback", "--plan", str(self.plan), "--target", str(self.prod), "--snapshot", str(self.snap))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        after = {str(p.relative_to(self.prod)): p.read_text() for p in self.prod.rglob("*") if p.is_file()}
        self.assertEqual(before, after)
        self.assertFalse((self.prod / "packages/core/dist/journey").exists(), "directories created by the overlay are removed")

    def test_apply_refuses_and_changes_nothing_when_target_drifted(self):
        write(self.prod, "packages/core/dist/server.js", "someone-else-edited-this")
        r = self.apply()
        self.assertEqual(r.returncode, 1)
        self.assertIn("pre-state", r.stdout)
        self.assertEqual((self.prod / "packages/core/dist/server.js").read_text(), "someone-else-edited-this")
        self.assertFalse((self.prod / "packages/core/dist/journey").exists())
        self.assertFalse(self.snap.exists())

    def test_second_apply_is_refused(self):
        self.assertEqual(self.apply().returncode, 0)
        self.assertEqual(self.apply().returncode, 1)

    def test_groups_are_applied_separately_so_a_restart_can_sit_between_them(self):
        self.assertEqual(self.apply("--group", "dist").returncode, 0)
        self.assertEqual((self.prod / "apps/miniapp/views/metro.js").read_text(), "old-metro")
        self.assertEqual(self.apply("--group", "assets").returncode, 0)
        self.assertEqual((self.prod / "apps/miniapp/views/metro.js").read_text(), "new-metro")

    def test_rollback_refuses_a_file_changed_after_the_overlay(self):
        self.assertEqual(self.apply().returncode, 0)
        write(self.prod, "packages/core/dist/server.js", "hot-fixed-later")
        r = run("rollback", "--plan", str(self.plan), "--target", str(self.prod), "--snapshot", str(self.snap))
        self.assertEqual(r.returncode, 1)
        self.assertEqual((self.prod / "packages/core/dist/server.js").read_text(), "hot-fixed-later")
        self.assertEqual((self.prod / "apps/miniapp/views/metro.js").read_text(), "new-metro", "nothing was partially rolled back")

    def test_dry_run_and_symlink_targets(self):
        r = self.apply("--dry-run")
        self.assertEqual(r.returncode, 0)
        self.assertEqual((self.prod / "packages/core/dist/server.js").read_text(), "old-server")
        os.remove(self.prod / "apps/miniapp/views/metro.js")
        os.symlink("/etc/hostname", self.prod / "apps/miniapp/views/metro.js")
        r = run("plan", "--candidate", str(self.cand), "--production", str(self.prod), "--base-dist", str(self.base),
                "--base-assets-json", str(self.names), "--out", str(self.plan.with_name("p2.json")))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("symlink", str(r.stderr) + str(r.stdout))

    def test_unsafe_plan_paths_are_rejected(self):
        bad = json.loads(self.plan.read_text())
        bad["files"][0]["path"] = "../../etc/passwd"
        p = self.plan.with_name("bad.json")
        p.write_text(json.dumps(bad))
        r = run("verify", "--plan", str(p), "--target", str(self.prod), "--state", "pre")
        self.assertNotEqual(r.returncode, 0)

class DataGroupTests(unittest.TestCase):
    """R3-C: runtime data files form their own `data` group (created before code starts) and one unit can be rolled back alone."""

    def test_data_group_creates_dirs_and_each_unit_rolls_back_alone(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            cand, prod, base, snap = t / "cand", t / "prod", t / "base", t / "snap"
            write(prod, "packages/core/dist/server.js", "old-server")
            write(prod, "apps/miniapp/views/metro.js", "old-metro")
            write(prod, "data/network.json", "net")
            write(cand, "packages/core/dist/server.js", "new-server")
            write(cand, "apps/miniapp/views/metro.js", "new-metro")
            write(cand, "data/timetable/overlay.json", "{}")
            write(cand, "data/network.json", "net-candidate-must-not-ship")
            write(cand, "apps/miniapp/test-support/dom.mjs", "fixture-must-not-ship")
            write(base, "server.js", "base-server")
            names, data = t / "assets.json", t / "data.json"
            names.write_text(json.dumps(["apps/miniapp/views/metro.js", "apps/miniapp/test-support/dom.mjs"]))
            data.write_text(json.dumps(["data/timetable/overlay.json"]))
            u1, u2 = t / "u1.json", t / "u2.json"
            (t / "none.json").write_text("[]")
            ok = lambda r: self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
            ok(run("plan", "--candidate", str(cand), "--production", str(prod), "--base-dist", str(base), "--out", str(u1),
                   "--data-json", str(data), "--base-assets-json", str(t / "none.json")))
            plan = json.loads(u1.read_text())
            self.assertEqual([f["group"] for f in plan["files"]][0], "data")
            self.assertNotIn("data/network.json", [f["path"] for f in plan["files"]])
            ok(run("apply", "--plan", str(u1), "--candidate", str(cand), "--target", str(prod), "--snapshot", str(snap / "u1")))
            # U2 is planned over the tree that already carries U1, so the two plans never overlap.
            ok(run("plan", "--candidate", str(cand), "--production", str(prod), "--base-dist", str(base), "--out", str(u2), "--base-assets-json", str(names)))
            self.assertEqual({f["group"] for f in json.loads(u2.read_text())["files"]}, {"assets"})
            self.assertEqual([f["path"] for f in json.loads(u2.read_text())["files"]], ["apps/miniapp/views/metro.js"])
            ok(run("apply", "--plan", str(u2), "--candidate", str(cand), "--target", str(prod), "--snapshot", str(snap / "u2")))
            self.assertTrue((prod / "data/timetable/overlay.json").is_file())
            self.assertEqual((prod / "data/network.json").read_text(), "net")
            # U2 alone goes back; U1 stays applied.
            ok(run("rollback", "--plan", str(u2), "--target", str(prod), "--snapshot", str(snap / "u2")))
            self.assertEqual((prod / "apps/miniapp/views/metro.js").read_text(), "old-metro")
            self.assertEqual((prod / "packages/core/dist/server.js").read_text(), "new-server")
            # Then U1: data file and the directory this overlay created disappear.
            ok(run("rollback", "--plan", str(u1), "--target", str(prod), "--snapshot", str(snap / "u1")))
            self.assertFalse((prod / "data/timetable").exists())
            self.assertEqual((prod / "packages/core/dist/server.js").read_text(), "old-server")
            self.assertEqual((prod / "data/network.json").read_text(), "net")



if __name__ == "__main__":
    unittest.main()
