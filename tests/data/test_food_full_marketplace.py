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

if __name__ == '__main__':
    unittest.main()
