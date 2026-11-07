"""Tests for append/update food index safety. Fixtures only; no private data required."""
import gzip
import importlib.util
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("merge_food_index", ROOT / "scripts" / "food" / "merge_food_index.py")
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


def vendor(code, category="رستوران", cap=1000, items=None, source="snappfood"):
    short = "s" if source == "snappfood" else "t"
    return {
        "id": short + ":" + code, "s": short, "c": code, "n": "فروشنده " + code, "b": "",
        "t": category, "la": 36.30, "lo": 59.58, "a": "مشهد",
        "m": None, "r": None, "cc": None, "o": None, "cap": cap,
        "lk": "https://example.test/" + code,
        "i": items if items is not None else [["چلو کباب", "", 180000, None, "غذا"]],
    }


def index(*vendors):
    return {"v": 1, "capturedFrom": 1000, "capturedTo": 1000, "vendors": list(vendors)}


class FoodMergeTest(unittest.TestCase):
    def test_existing_vendor_survives_and_new_verticals_are_appended(self):
        old = index(vendor("old", "رستوران"))
        new = index(
            vendor("old", "رستوران"),
            vendor("flower", "گل فروشی", items=[["رز", "دسته", 90000, None, "گل"]]),
            vendor("cafe", "کافه", items=[["لاته", "", 78000, None, "نوشیدنی"]]),
            vendor("sweet", "قنادی", items=[["کیک", "", 120000, None, "شیرینی"]], source="tapsifood"),
            vendor("grocery", "سوپرمارکت", items=[["شیر", "", 35000, None, "سوپرمارکت"]]),
        )
        merged, report, history = MOD.merge_indexes(old, new)
        self.assertEqual(report["baselineVendors"], 1)
        self.assertEqual(report["finalVendors"], 5)
        self.assertEqual(report["addedVendors"], 4)
        self.assertEqual(history, [])
        self.assertEqual(merged["vendors"][0]["t"], "کافه")  # sorted by provider/code
        self.assertEqual({v["t"] for v in merged["vendors"]},
                         {"رستوران", "گل فروشی", "کافه", "قنادی", "سوپرمارکت"})
        self.assertEqual(old["vendors"][0]["i"][0][2], 180000)

    def test_same_capture_can_only_append_menu_and_fill_missing_category(self):
        old = index(vendor("one", "", items=[["لاته", "", 70000, None, "کافه"]]))
        incoming = index(vendor("one", "کافه", items=[
            ["لاته", "", 70000, None, "کافه"], ["قهوه ترک", "", 60000, None, "کافه"]
        ]))
        merged, report, _ = MOD.merge_indexes(old, incoming)
        self.assertEqual(merged["vendors"][0]["t"], "کافه")
        self.assertEqual(len(merged["vendors"][0]["i"]), 2)
        self.assertEqual(report["appendedMenuItems"], 1)
        self.assertEqual(report["filledCategories"], 1)
        self.assertEqual(len(old["vendors"][0]["i"]), 1)

    def test_same_capture_conflicting_price_fails_closed(self):
        old = index(vendor("one", cap=1000, items=[["لاته", "", 70000, None, "کافه"]]))
        incoming = index(vendor("one", cap=1000, items=[["لاته", "", 50000, None, "کافه"]]))
        with self.assertRaisesRegex(ValueError, "same-capture conflict"):
            MOD.merge_indexes(old, incoming)

    def test_newer_capture_updates_without_dropping_old_menu(self):
        old = index(vendor("one", cap=1000, items=[["لاته", "", 70000, None, "کافه"]]))
        incoming = index(vendor("one", cap=2000, items=[
            ["لاته", "", 78000, None, "کافه"], ["قهوه ترک", "", 60000, None, "کافه"]
        ]))
        merged, report, history = MOD.merge_indexes(old, incoming)
        self.assertEqual(merged["vendors"][0]["i"][0][2], 78000)
        self.assertEqual(history[0]["i"][0][2], 70000)
        self.assertEqual(report["updatedVendors"], 1)
        self.assertEqual(report["historicalVendorVersionsArchived"], 1)

    def test_newer_capture_cannot_silently_drop_legacy_menu(self):
        old = index(vendor("one", cap=1000, items=[
            ["لاته", "", 70000, None, "کافه"], ["کاپوچینو", "", 75000, None, "کافه"]
        ]))
        incoming = index(vendor("one", cap=2000, items=[["لاته", "", 78000, None, "کافه"]]))
        with self.assertRaisesRegex(ValueError, "omits 1 existing menu keys"):
            MOD.merge_indexes(old, incoming)

    def test_older_capture_does_not_overwrite_prices_or_menu(self):
        old = index(vendor("one", cap=2000, items=[["لاته", "", 78000, None, "کافه"]]))
        incoming = index(vendor("one", cap=1000, items=[["لاته", "", 10000, None, "کافه"]]))
        merged, report, _ = MOD.merge_indexes(old, incoming)
        self.assertEqual(merged["vendors"][0]["i"][0][2], 78000)
        self.assertEqual(report["ignoredOlderVendors"], 1)

    def test_duplicate_ids_and_zero_price_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate vendor"):
            MOD.merge_indexes(index(vendor("one"), vendor("one")), index())
        with self.assertRaisesRegex(ValueError, "price must be positive or unknown"):
            MOD.merge_indexes(index(vendor("bad", items=[["کیک", "", 0, None, "شیرینی"]])), index())

    def test_cli_stages_new_files_without_touching_inputs_or_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / "baseline.gz"
            new = root / "candidate.gz"
            old.write_bytes(MOD._gzip_json(index(vendor("old"))))
            new.write_bytes(MOD._gzip_json(index(vendor("old"), vendor("rose", category="گل فروشی"))))
            prior = (old.read_bytes(), new.read_bytes())
            with redirect_stdout(StringIO()):
                self.assertEqual(MOD.main(["--baseline", str(old), "--candidate", str(new), "--dry-run"]), 0)
            self.assertFalse((root / "staging").exists())
            with redirect_stdout(StringIO()):
                self.assertEqual(MOD.main(["--baseline", str(old), "--candidate", str(new), "--out", str(root / "staging")]), 0)
            merged = MOD.read_index(root / "staging" / "food-index-v1.json.gz")
            self.assertEqual(len(merged["vendors"]), 2)
            self.assertEqual((old.read_bytes(), new.read_bytes()), prior)
            self.assertTrue((root / "staging" / "food-merge-report.json").is_file())
            with self.assertRaises(SystemExit):
                with redirect_stdout(StringIO()):
                    MOD.main(["--baseline", str(old), "--candidate", str(new), "--out", str(root / "staging")])

    def test_deterministic_gzip_for_identical_content(self):
        payload = index(vendor("same"))
        self.assertEqual(MOD._gzip_json(payload), MOD._gzip_json(payload))


if __name__ == "__main__":
    unittest.main()
