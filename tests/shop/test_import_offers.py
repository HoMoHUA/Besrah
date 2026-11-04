import importlib.util, json, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("imp", ROOT / "scripts/shop/import_offers.py")
imp = importlib.util.module_from_spec(spec); spec.loader.exec_module(imp)


def ld(offers, currency="IRR", sku="7"):
    return {"@type": "Product", "sku": sku, "name": "هدفون x", "brand": {"name": "برند|Brand"}, "offers": {"@type": "AggregateOffer", "priceCurrency": currency, "offers": [
        {"price": p, "priceCurrency": currency, "availability": "https://schema.org/InStock", "seller": {"name": s}} for s, p in offers]}}


def run(offers, **kw):
    return imp.normalise({"ld": ld(offers, **kw), "merchant": "تکنولایف", "category": "c"}, "2026-11-04T10:00:00Z", "https://www.technolife.com/product-7/")


class Normalise(unittest.TestCase):
    def test_irr_to_toman_and_two_resolved(self):
        p = run([("a", 10_000_000), ("b", 11_000_000)])
        self.assertEqual([o["priceToman"] for o in p["offers"]], [1_000_000, 1_100_000])
        self.assertEqual(p["summary"], {"resolved": 2, "minToman": 1_000_000, "maxToman": 1_100_000})
        self.assertTrue(all(o["matchState"] == "listing_declared" and o["stock"] == "unknown" and o["shipping"] == "unknown" for o in p["offers"]))

    def test_same_seller_two_prices_is_unresolved_not_averaged_or_minimised(self):
        p = run([("a", 10_000_000), ("a", 12_000_000), ("b", 11_000_000)])
        a = next(o for o in p["offers"] if o["seller"] == "a")
        self.assertEqual((a["state"], a["priceToman"], a["priceCandidatesToman"]), ("unresolved", None, [1_000_000, 1_200_000]))
        self.assertEqual(p["summary"]["resolved"], 1)

    def test_brand_keeps_the_persian_half_of_a_bilingual_name(self):
        self.assertEqual(run([("a", 10_000_000)])["brand"], "برند")

    def test_duplicate_identical_offers_collapse(self):
        p = run([("a", 10_000_000)] * 3)
        self.assertEqual(len(p["offers"]), 1)

    def test_outlier_is_quarantined_only_with_three_resolved(self):
        p = run([("a", 10_000_000), ("b", 10_500_000), ("c", 11_000_000), ("d", 1_000_000)])
        self.assertEqual({o["seller"]: o["state"] for o in p["offers"]}, {"a": "resolved", "b": "resolved", "c": "resolved", "d": "quarantined"})
        self.assertEqual(p["summary"]["minToman"], 1_000_000)
        two = run([("a", 10_000_000), ("b", 30_000_000)])
        self.assertTrue(all(o["state"] == "resolved" and o["spreadWarning"] for o in two["offers"]))

    def test_foreign_currency_and_bad_prices_are_rejected_not_guessed(self):
        with self.assertRaises(ValueError): run([("a", 5)], currency="USD")
        p = run([("a", 0), ("b", -4), ("c", 20_000_000)])
        self.assertEqual([o["seller"] for o in p["offers"]], ["c"])


class Offline(unittest.TestCase):
    def test_mismatched_sku_is_a_reported_failure_and_nothing_is_invented(self):
        with tempfile.TemporaryDirectory() as d:
            dd = Path(d); (dd / "9.html").write_text('<script type="application/ld+json">%s</script>' % json.dumps(ld([("a", 10_000_000)], sku="123")))
            (dd / "m.json").write_text(json.dumps({"v": 1, "products": [{"sku": "9", "category": "c"}]}))
            out = dd / "o.json"
            import sys; argv = sys.argv
            sys.argv = ["x", "--out", str(out), "--manifest", str(dd / "m.json"), "--offline-dir", str(dd)]
            try:
                rc = imp.main()
            finally:
                sys.argv = argv
            data = json.loads(out.read_text())
            self.assertEqual(rc, 1); self.assertEqual(data["products"], []); self.assertEqual(data["failures"][0]["error"], "no_matching_product_jsonld")


if __name__ == "__main__":
    unittest.main()
