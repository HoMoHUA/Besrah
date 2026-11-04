#!/usr/bin/env python3
"""Besrah Shopping importer: curated product list -> versioned, provenance-carrying offer snapshot.

Source: each product page's own schema.org JSON-LD (Product -> AggregateOffer.offers[]), fetched politely (one request per
product, sequential, fixed delay). Nothing else is scraped. The manifest lists product ids chosen by a human; the importer
never discovers or crawls.

Rules that keep the output honest:
  - IRR -> toman (/10); any other currency rejects the product.
  - Offers are grouped by seller. One seller with several different prices is `unresolved` (variant/warranty unknown): no single
    price is chosen for it.
  - `canonicalProductId` is the marketplace sku of one exact listing (model + capacity + type are in its title); colour/warranty
    differences between sellers are NOT resolved, so every offer is `listing_declared`, never `exact_variant`.
  - With >= 3 resolved offers, one below 0.5x or above 1.6x of the median is quarantined. With 2 it can only be flagged.
  - stock and shipping are `unknown`; the declared availability is kept as a declaration at observedAt.
Run:  python3 scripts/shop/import_offers.py --out data/shop/catalog-v1.json
"""
import argparse, json, re, statistics, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "data/shop/manifest-v1.json"
UA = "BesrahImporter/1 (+personal research; contact: owner)"
DELAY_S = 1.5
LD = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "fa"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "ignore")


def product_ld(html: str):
    for block in LD.findall(html):
        try:
            d = json.loads(block)
        except ValueError:
            continue
        if isinstance(d, dict) and d.get("@type") == "Product":
            return d
    return None


def normalise(entry: dict, observed_at: str, url: str) -> dict:
    ld = entry["ld"]
    agg = ld.get("offers") or {}
    if agg.get("priceCurrency") != "IRR":
        raise ValueError("unsupported_currency:%s" % agg.get("priceCurrency"))
    by_seller: dict[str, set] = {}
    declared: dict[str, str] = {}
    for o in agg.get("offers") or []:
        seller = (o.get("seller") or {}).get("name", "").strip()
        price = o.get("price")
        if not seller or not isinstance(price, (int, float)) or price <= 0 or o.get("priceCurrency") != "IRR":
            continue
        by_seller.setdefault(seller, set()).add(int(price))
        declared[seller] = str(o.get("availability", "")).rsplit("/", 1)[-1] or "unknown"
    offers = []
    for seller, prices in sorted(by_seller.items()):
        base = {"seller": seller, "merchant": entry["merchant"], "url": url, "matchState": "listing_declared",
                "variantUnresolved": ["رنگ", "گارانتی"], "stock": "unknown", "availabilityDeclared": declared[seller], "shipping": "unknown"}
        if len(prices) == 1:
            offers.append({**base, "state": "resolved", "priceToman": next(iter(prices)) // 10})
        else:
            offers.append({**base, "state": "unresolved", "priceToman": None, "priceCandidatesToman": sorted(p // 10 for p in prices),
                           "reason": "same_seller_multiple_prices"})
    resolved = [o for o in offers if o["state"] == "resolved"]
    if len(resolved) >= 3:
        med = statistics.median(o["priceToman"] for o in resolved)
        for o in resolved:
            if o["priceToman"] < 0.5 * med or o["priceToman"] > 1.6 * med:
                o["state"] = "quarantined"; o["reason"] = "outlier_vs_median"
    elif len(resolved) == 2:
        lo, hi = sorted(o["priceToman"] for o in resolved)
        if hi > 1.6 * lo:
            for o in resolved: o["spreadWarning"] = True
    prices = [o["priceToman"] for o in offers if o["state"] == "resolved"]
    brand = ld.get("brand") or {}
    return {"canonicalProductId": "tl:%s" % ld["sku"], "sku": str(ld["sku"]), "title": ld["name"].strip(),
            "brand": ((brand.get("name") if isinstance(brand, dict) else str(brand)) or "").split("|")[0].strip() or None,
            "category": entry.get("category"), "variantBasis": "marketplace listing (title carries model and capacity)",
            "observedAt": observed_at, "source": {"kind": "technolife_product_page_jsonld", "url": url, "priceValidUntil": (agg.get("offers") or [{}])[0].get("priceValidUntil")},
            "offers": offers,
            "summary": {"resolved": len(prices), "minToman": min(prices) if prices else None, "maxToman": max(prices) if prices else None}}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--manifest", default=str(MANIFEST))
    ap.add_argument("--offline-dir", help="read <sku>.html fixtures instead of fetching (tests)")
    args = ap.parse_args()
    manifest = json.loads(Path(args.manifest).read_text("utf-8"))
    products, failures = [], []
    for item in manifest["products"]:
        url = "https://www.technolife.com/product-%s/" % item["sku"]
        try:
            html = (Path(args.offline_dir) / ("%s.html" % item["sku"])).read_text("utf-8") if args.offline_dir else fetch(url)
            ld = product_ld(html)
            if not ld or str(ld.get("sku")) != str(item["sku"]):
                raise ValueError("no_matching_product_jsonld")
            observed = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            products.append(normalise({"ld": ld, "merchant": "تکنولایف", "category": item.get("category")}, observed, url))
        except Exception as error:  # a failed product is reported, never replaced with made-up data
            failures.append({"sku": item["sku"], "error": str(error)[:120]})
        if not args.offline_dir:
            time.sleep(DELAY_S)
    out = {"v": 1, "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "importer": "scripts/shop/import_offers.py",
           "manifest": str(Path(args.manifest).relative_to(ROOT)) if Path(args.manifest).is_relative_to(ROOT) else Path(args.manifest).name,
           "licenseNote": "Private research snapshot of publicly visible product-page markup; not for redistribution.", "products": products, "failures": failures}
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True) + "\n", "utf-8")
    print("products=%d failures=%d" % (len(products), len(failures)), file=sys.stderr)
    return 0 if products else 1


if __name__ == "__main__":
    sys.exit(main())
