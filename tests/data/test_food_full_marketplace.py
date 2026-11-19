"""Regression: the builder must retain ALL legitimately captured marketplace categories."""
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("build_food_index", ROOT / "scripts" / "food" / "build_food_index.py")
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)

class FullMarketplaceTest(unittest.TestCase):
    def test_groceries_flowers_cafes_bakeries_and_restaurants_are_retained(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "vendors.sqlite"
            con = sqlite3.connect(path)
            con.execute("""CREATE TABLE vendors (
               source TEXT, vendor_code TEXT, lat REAL, lon REAL, name TEXT, category TEXT,
               raw_file TEXT, branch TEXT, min_order_toman INTEGER, rating REAL,
               comment_count INTEGER, is_open INTEGER, address TEXT, link TEXT)""")
            con.execute("""CREATE TABLE menu_items (
               source TEXT, vendor_code TEXT, product TEXT, variation TEXT,
               price_toman INTEGER, discounted_price_toman INTEGER, menu_category TEXT)""")
            items = [
                ('s1','گلفروشی','گل رز','دسته گل',80000),
                ('s2','سوپرمارکت','هایپر','شیر',40000),
                ('s3','کافه','قهوه','لاته',90000),
                ('s4','رستوران','کبابی','چلو کباب',160000),
                ('s5','نانوایی','بربری','نان سنگک',25000),
            ]
            for code, category, name, item, price in items:
                con.execute("INSERT INTO vendors VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    ('snappfood',code,36.3,59.58,name,category,None,'',None,8.4,20,None,'مشهد','https://example.test/'+code))
                con.execute("INSERT INTO menu_items VALUES(?,?,?,?,?,?,?)",
                    ('snappfood',code,item,'',price,None,category))
            con.commit()
            con.close()
            vendors, dropped, *_ = MOD.build(path, Path(tmp))
            self.assertEqual(len(vendors),5)
            self.assertEqual(dropped['non_restaurant'],0)
            self.assertEqual({v['t'] for v in vendors},{x[1] for x in items})
            self.assertEqual(sum(len(v['i']) for v in vendors),5)

class OpenFlagTest(unittest.TestCase):
    # Real values found in research/vendors.sqlite on 2026-11-19: Open, Close, باز, بسته, OutOfCoverage.
    def test_provider_text_states_map_to_open_closed_or_unknown(self):
        cases = {'Open': 1, 'open ': 1, 'باز': 1, 'Close': 0, 'Closed': 0, 'بسته': 0,
                 'OutOfCoverage': None, '': None, 'maybe': None, None: None, 1: 1, 0: 0, 2: None, True: 1, False: 0}
        for raw, expected in cases.items():
            self.assertEqual(MOD.open_flag(raw), expected, repr(raw))

    def test_out_of_coverage_vendor_is_not_reported_open(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "vendors.sqlite"
            con = sqlite3.connect(path)
            con.execute("""CREATE TABLE vendors (source TEXT, vendor_code TEXT, lat REAL, lon REAL, name TEXT, category TEXT,
               raw_file TEXT, branch TEXT, min_order_toman INTEGER, rating REAL, comment_count INTEGER, is_open TEXT, address TEXT, link TEXT)""")
            con.execute("""CREATE TABLE menu_items (source TEXT, vendor_code TEXT, product TEXT, variation TEXT,
               price_toman INTEGER, discounted_price_toman INTEGER, menu_category TEXT)""")
            for code, state in (('a', 'Open'), ('b', 'بسته'), ('c', 'OutOfCoverage')):
                con.execute("INSERT INTO vendors VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    ('tapsifood', code, 36.3, 59.58, 'فروشگاه ' + code, 'رستوران', None, '', None, 8.0, 5, state, 'مشهد', 'https://example.test/' + code))
                con.execute("INSERT INTO menu_items VALUES(?,?,?,?,?,?,?)", ('tapsifood', code, 'چلو کباب', '', 150000, None, 'رستوران'))
            con.commit(); con.close()
            vendors, *_ = MOD.build(path, Path(tmp))
            self.assertEqual({v['c']: v['o'] for v in vendors}, {'a': 1, 'b': 0, 'c': None})


if __name__ == '__main__':
    unittest.main()
