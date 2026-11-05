#!/usr/bin/env python3
"""Build the compact, read-only food search index from research/vendors.sqlite.

Output (deterministic, versioned):
  data/food/food-index-v1.json.gz        vendors + menu items, no descriptions
  data/food/food-index-v1.manifest.json  counts, capture window, sha256, rules applied

What is fixed on the way (all found in the 2026-10-31 audit and re-checked on the real database):
  * `fetched_at` in the database is the export time; the real capture time is the mtime of the raw provider file.
  * a price of 0 or NULL is *unknown*, never 0 toman.
  * `in_mashhad_bbox` is unusable (always 0); the Mashhad box is recomputed from the coordinates.
  * all marketplace verticals are retained (food, cafe, sweets, flowers, groceries and other services).
  * the open flag is a snapshot, kept as `o` with its capture time; it is never presented as "open now".
Usage: build_food_index.py [--db PATH] [--research DIR] [--out DIR]
"""
import argparse, gzip, hashlib, json, os, re, sqlite3, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BBOX = (36.10, 36.50, 59.30, 59.90)            # Mashhad, with margin


def captured_at(research: Path, raw_file: str):
    p = research / raw_file
    return int(p.stat().st_mtime) if p.is_file() else None


def build(db_path: Path, research: Path):
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    vendors, dropped = [], {"outside_mashhad": 0, "non_restaurant": 0, "no_coordinates": 0}
    items_by_vendor = {}
    for r in db.execute("select source, vendor_code, product, variation, price_toman, discounted_price_toman, menu_category from menu_items"):
        price = r["price_toman"] if r["price_toman"] and r["price_toman"] > 0 else None
        disc = r["discounted_price_toman"] if r["discounted_price_toman"] and r["discounted_price_toman"] > 0 else None
        items_by_vendor.setdefault((r["source"], r["vendor_code"]), []).append(
            [(r["product"] or "").strip(), (r["variation"] or "").strip(), price, disc, (r["menu_category"] or "").strip()])
    cap_min, cap_max = None, None
    per_source = {}
    for v in db.execute("select * from vendors order by source, vendor_code"):
        lat, lon = v["lat"], v["lon"]
        name = (v["name"] or "").strip()
        if lat is None or lon is None:
            dropped["no_coordinates"] += 1; continue
        if not (BBOX[0] <= lat <= BBOX[1] and BBOX[2] <= lon <= BBOX[3]):
            dropped["outside_mashhad"] += 1; continue
        cap = captured_at(research, v["raw_file"]) if v["raw_file"] else None
        items = items_by_vendor.get((v["source"], v["vendor_code"]), [])
        if cap:
            cap_min = cap if cap_min is None else min(cap_min, cap); cap_max = cap if cap_max is None else max(cap_max, cap)
        mo = v["min_order_toman"]
        rec = {
            "id": ("s" if v["source"] == "snappfood" else "t") + ":" + v["vendor_code"],
            "s": "s" if v["source"] == "snappfood" else "t", "c": v["vendor_code"], "n": name, "b": (v["branch"] or "").strip(),
            "t": (v["category"] or "").strip(), "la": round(lat, 5), "lo": round(lon, 5), "a": (v["address"] or "").strip(),
            "m": mo if mo and mo > 0 else None, "r": v["rating"] if v["rating"] else None, "cc": v["comment_count"] or None,
            "o": None if v["is_open"] is None else int(bool(v["is_open"])), "cap": cap, "lk": v["link"], "i": items,
        }
        vendors.append(rec)
        s = per_source.setdefault(rec["s"], {"vendors": 0, "items": 0, "priceUnknown": 0, "capMin": None, "capMax": None})
        s["vendors"] += 1; s["items"] += len(items); s["priceUnknown"] += sum(1 for i in items if i[2] is None)
        if cap:
            s["capMin"] = cap if s["capMin"] is None else min(s["capMin"], cap); s["capMax"] = cap if s["capMax"] is None else max(s["capMax"], cap)
    return vendors, dropped, per_source, cap_min, cap_max


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="/root/projects/besrah/research/vendors.sqlite")
    ap.add_argument("--research", default="/root/projects/besrah/research")
    ap.add_argument("--out", default=str(ROOT / "data" / "food"))
    a = ap.parse_args()
    vendors, dropped, per_source, cap_min, cap_max = build(Path(a.db), Path(a.research))
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    payload = {"v": 1, "capturedFrom": cap_min, "capturedTo": cap_max, "vendors": vendors}
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    gz_path = out / "food-index-v1.json.gz"
    with gzip.GzipFile(filename="", mode="wb", fileobj=open(gz_path, "wb"), mtime=0, compresslevel=9) as f:
        f.write(raw)
    sha = hashlib.sha256(gz_path.read_bytes()).hexdigest()
    manifest = {
        "schema": 1, "file": gz_path.name, "sha256": sha, "rawBytes": len(raw), "gzBytes": gz_path.stat().st_size,
        "vendors": len(vendors), "items": sum(len(v["i"]) for v in vendors), "dropped": dropped, "perSource": per_source,
        "capturedFrom": datetime.fromtimestamp(cap_min, timezone.utc).isoformat() if cap_min else None,
        "capturedTo": datetime.fromtimestamp(cap_max, timezone.utc).isoformat() if cap_max else None,
        "rules": ["price 0/NULL -> unknown (null)", "capture time = mtime of the raw provider file, not the export time",
                  "Mashhad box recomputed from coordinates", "all marketplace verticals retained; category filtering happens in Core",
                  "open flag kept as a snapshot with its capture time", "descriptions are not indexed"],
        "source": "research/vendors.sqlite (SnappFood and TapsiFood vendor-detail pages, public marketplace data, private research archive not committed)",
    }
    (out / "food-index-v1.manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n")
    print(json.dumps({k: manifest[k] for k in ("vendors", "items", "rawBytes", "gzBytes", "dropped", "capturedFrom", "capturedTo")}, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
