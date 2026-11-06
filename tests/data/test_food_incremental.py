"""Incremental food index regression tests; all inputs are synthetic/private-free."""
import copy
import gzip
import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("merge_food_index", ROOT / "scripts" / "food" / "merge_food_index.py")
import sys
sys.path.insert(0, str(ROOT / "scripts" / "food"))
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


def vendor(code, category, items, cap=100, source="s", link=True):
    return {
        "id": source + ":" + code, "s": source, "c": code,
        "n": category, "b": "", "t": category, "la": 36.3, "lo": 59.58,
        "a": "مشهد", "m": None, "r": 8, "cc": 20, "o": 1, "cap": cap,
        "lk": "https://example.test/" + code if link else "",
        "i": copy.deepcopy(items),
    }


class IncrementalMergeTests(unittest.TestCase):
    def setUp(self):
        self.old = [vendor("1", "رستوران", [
            ["چلو کباب", "", 160000, None, "غذای ایرانی"],
            ["خورش", "", 140000, None, "غذای ایرانی"],
        ])]

    def test_adds_all_verticals_without_deleting_previous_vendor_or_item(self):
        newer = vendor("1", "رستوران", [
            ["چلو کباب", "", 185000, None, "غذای ایرانی"],
            ["سوپ", "", 45000, None, "غذای ایرانی"],
        ], cap=200)
        flowers = vendor("2", "گل‌فروشی", [["دسته گل", "", 200000, None, "گل و گیاه"]], cap=200)
        cafe = vendor("3", "کافه", [["لاته", "", 75000, None, "نوشیدنی"]], cap=200, source="t")
        old_before = copy.deepcopy(self.old)
        result, report = MOD.reconcile(self.old, [cafe, newer, flowers])
        self.assertEqual(self.old, old_before)
        self.assertEqual([v["id"] for v in result], ["s:1", "s:2", "t:3"])
        self.assertEqual([it[0] for it in result[0]["i"]], ["چلو کباب", "خورش", "سوپ"])
        self.assertEqual(result[0]["i"][0][2], 160000)  # Default refuses to overwrite known price.
        self.assertEqual(result[0]["cap"], 100)
        self.assertEqual(report["vendorsAdded"], 2)
        self.assertEqual(report["itemsAdded"], 3)
        self.assertEqual(report["baselineItems"], 2)
        self.assertEqual(report["mergedItems"], 5)

    def test_full_verified_refresh_updates_price_and_vendor_timestamp(self):
        newer = vendor("1", "رستوران جدید", [
            ["چلو کباب", "", 180000, None, "غذای ایرانی"],
            ["خورش", "", 145000, None, "غذای ایرانی"],
        ], cap=200)
        result, report = MOD.reconcile(self.old, [newer], verified_updates=True)
        self.assertEqual(result[0]["cap"], 200)
        self.assertEqual([it[2] for it in result[0]["i"]], [180000, 145000])
        self.assertEqual(result[0]["t"], "رستوران جدید")
        self.assertEqual(report["capturesAdvanced"], 1)
        self.assertEqual(report["itemPricesUpdated"], 2)

    def test_partial_verified_refresh_keeps_original_capture_for_unseen_menu(self):
        newer = vendor("1", "رستوران", [["چلو کباب", "", 190000, None, "غذای ایرانی"]], cap=300)
        result, report = MOD.reconcile(self.old, [newer], verified_updates=True)
        self.assertEqual(result[0]["i"][0][2], 190000)
        self.assertEqual(result[0]["i"][1][2], 140000)
        self.assertEqual(result[0]["cap"], 100)  # Avoid treating old خورش as captured at t=300.
        self.assertEqual(report["capturesHeldForStaleMenu"], 1)
        self.assertGreater(report["existingItemsWithoutUniqueMatch"], 0)

    def test_old_candidate_never_overwrites_newer_price(self):
        older = vendor("1", "رستوران", [["چلو کباب", "", 50000, None, "غذای ایرانی"]], cap=30)
        result, report = MOD.reconcile(self.old, [older], verified_updates=True)
        self.assertEqual(result[0]["i"][0][2], 160000)
        self.assertEqual(result[0]["cap"], 100)
        self.assertEqual(report["olderCandidateVendors"], 1)

    def test_unknown_price_does_not_erase_known_baseline(self):
        new = vendor("1", "رستوران", [
            ["چلو کباب", "", None, None, "غذای ایرانی"],
            ["خورش", "", 150000, None, "غذای ایرانی"],
        ], cap=220)
        out, report = MOD.reconcile(self.old, [new], verified_updates=True)
        self.assertEqual(out[0]["i"][0][2], 160000)
        self.assertEqual(out[0]["i"][1][2], 150000)
        self.assertEqual(out[0]["cap"], 100)
        self.assertGreater(report["oldPricesProtected"], 0)

    def test_new_vendor_without_safe_original_link_is_held_for_review(self):
        candidate = vendor("5", "گلفروشی", [["گل", "", 100000, None, "گل"]], link=False)
        out, report = MOD.reconcile(self.old, [candidate])
        self.assertEqual(out, self.old)
        self.assertEqual(report["newVendorsSkippedInvalidLink"], 1)

    def test_duplicate_vendor_identifiers_are_rejected(self):
        duplicate = vendor("1", "رستوران", [])
        with self.assertRaisesRegex(ValueError, "duplicate vendor"):
            MOD.reconcile(self.old, [duplicate, duplicate])

    def test_duplicate_new_menu_keys_do_not_guess_which_price_is_valid(self):
        incoming = vendor("1", "رستوران", [
            ["چلو کباب", "", 150000, None, "غذای ایرانی"],
            ["چلو کباب", "", 100000, None, "غذای ایرانی"],
        ], cap=210)
        out, report = MOD.reconcile(self.old, [incoming], verified_updates=True)
        self.assertEqual(out[0]["i"][0][2], 160000)
        self.assertEqual(out[0]["cap"], 100)
        self.assertGreater(report["ambiguousNewItemKeys"], 0)

    def test_closed_status_zero_is_valid_metadata(self):
        updated = vendor("1", "رستوران", [it[:] for it in self.old[0]["i"]], cap=220)
        updated["o"] = 0
        out, _ = MOD.reconcile(self.old, [updated], verified_updates=True)
        self.assertEqual(out[0]["o"], 0)

    def test_full_cli_creates_only_staged_index_with_original_untouched(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            live = root / "live"
            live.mkdir()
            base = live / "food-index-v1.json.gz"
            raw = {"v": 1, "capturedFrom": 100, "capturedTo": 100, "vendors": self.old}
            with gzip.open(base, "wb") as f:
                f.write(json.dumps(raw, ensure_ascii=False).encode("utf-8"))
            base_bytes = base.read_bytes()

            dbpath = root / "research" / "vendors.sqlite"
            dbpath.parent.mkdir()
            con = sqlite3.connect(dbpath)
            con.execute("""CREATE TABLE vendors (
                source TEXT, vendor_code TEXT, lat REAL, lon REAL, name TEXT, category TEXT,
                raw_file TEXT, branch TEXT, min_order_toman INTEGER, rating REAL,
                comment_count INTEGER, is_open INTEGER, address TEXT, link TEXT)""")
            con.execute("""CREATE TABLE menu_items (
                source TEXT, vendor_code TEXT, product TEXT, variation TEXT,
                price_toman INTEGER, discounted_price_toman INTEGER, menu_category TEXT)""")
            for code, category, name, product, price in [
                ("2", "گلفروشی", "گل رز", "دسته گل", 150000),
                ("3", "کافه", "کافه نمونه", "لاته", 70000),
            ]:
                con.execute("INSERT INTO vendors VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                            ("snappfood", code, 36.3, 59.58, name, category, None, "", None, 9.1, 100, 1, "مشهد", "https://example.test/" + code))
                con.execute("INSERT INTO menu_items VALUES(?,?,?,?,?,?,?)",
                            ("snappfood", code, product, "", price, None, category))
            con.commit()
            con.close()
            stage = root / "stage"
            result = MOD.main(["--base-index", str(base), "--db", str(dbpath), "--research", str(dbpath.parent), "--out", str(stage)])
            self.assertEqual(result, 0)
            self.assertEqual(base.read_bytes(), base_bytes)
            self.assertTrue((stage / MOD.REPORT).is_file())
            self.assertTrue((stage / MOD.MANIFEST).is_file())
            merged = MOD.load_index(stage / MOD.FILENAME)
            self.assertEqual(len(merged["vendors"]), 3)
            self.assertEqual(merged["vendors"][0]["id"], "s:1")
            report = json.loads((stage / MOD.REPORT).read_text())
            self.assertEqual(report["counts"]["vendorsAdded"], 2)
            self.assertEqual({v["t"] for v in merged["vendors"]}, {"رستوران", "گلفروشی", "کافه"})
            with self.assertRaises(SystemExit):
                MOD.main(["--base-index", str(base), "--db", str(dbpath), "--research", str(dbpath.parent), "--out", str(live)])
            with self.assertRaises(SystemExit):
                MOD.main(["--base-index", str(base), "--db", str(dbpath), "--research", str(dbpath.parent), "--out", str(stage)])


if __name__ == "__main__":
    unittest.main()
