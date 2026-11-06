#!/usr/bin/env python3
"""Safely RECONCILE Besrah's existing food index with records from the same private vendors.sqlite.

Never deletes an existing vendor/menu item, never edits the original database, never writes
to the base index directory, and never fetches third-party data. A new snapshot is used as
evidence for additions and (only by explicit opt-in) verified newer field updates.

Run this only in a NEW staging directory, review report/manifest, then separately authorize
a production release. The original provider category is retained for Core vertical rules.
"""
import argparse
import copy
import gzip
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from build_food_index import build

FILENAME = "food-index-v1.json.gz"
MANIFEST = "food-index-v1.manifest.json"
REPORT = "food-reconciliation-report.json"
FIELDS = ("n", "b", "t", "a", "lk", "la", "lo", "m", "r", "cc", "o")
ID = re.compile(r"^[st]:[A-Za-z0-9]{1,32}$")


def _validate(records, label):
    if not isinstance(records, list):
        raise ValueError(f"{label}: vendors must be a list")
    found = set()
    for v in records:
        if not isinstance(v, dict) or not isinstance(v.get("id"), str) or not ID.fullmatch(v["id"]):
            raise ValueError(f"{label}: invalid vendor id")
        if v["id"] in found:
            raise ValueError(f"{label}: duplicate vendor id: {v['id']}")
        found.add(v["id"])
        if v.get("s") != v["id"][0] or str(v.get("c")) != v["id"][2:]:
            raise ValueError(f"{label}: source/code mismatch: {v['id']}")
        if not isinstance(v.get("i"), list):
            raise ValueError(f"{label}: missing menu items for {v['id']}")
        for item in v["i"]:
            if not isinstance(item, list) or len(item) != 5 or not isinstance(item[0], str) or not isinstance(item[1], str) or not isinstance(item[4], str):
                raise ValueError(f"{label}: invalid menu item in {v['id']}")
            for price in item[2:4]:
                if price is not None and (not isinstance(price, int) or isinstance(price, bool) or price <= 0):
                    raise ValueError(f"{label}: invalid price in {v['id']}")
        cap = v.get("cap")
        if cap is not None and (not isinstance(cap, int) or isinstance(cap, bool) or cap <= 0):
            raise ValueError(f"{label}: invalid capture time for {v['id']}")


def load_index(path: Path):
    with gzip.open(path, "rb") as f:
        data = json.load(f)
    if not isinstance(data, dict) or data.get("v") != 1:
        raise ValueError("base index schema must be v1")
    _validate(data.get("vendors"), "baseline")
    return data


def _fold(x):
    value = unicodedata.normalize("NFKC", str(x)).lower().replace("ي", "ی").replace("ى", "ی").replace("ك", "ک")
    value = value.replace("\u200c", " ")
    return " ".join(re.findall(r"[^\W_]+", value, flags=re.UNICODE))


def item_key(item):
    # Include variation and category: a similarly named but different item must never replace the old one.
    return (_fold(item[0]), _fold(item[1]), _fold(item[4]))


def _keys(items):
    grouped = defaultdict(list)
    for i, item in enumerate(items):
        grouped[item_key(item)].append(i)
    return grouped


def _positive(value):
    return value is not None and value != "" and value != 0


def _safe_link(link):
    return isinstance(link, str) and bool(re.match(r"^https?://[^/\s]+", link))


def reconcile(base, updates, *, verified_updates=False):
    """Pure, deterministic, non-destructive merge; all source records remain untouched."""
    _validate(base, "baseline")
    _validate(updates, "candidate")
    current = {v["id"]: copy.deepcopy(v) for v in base}
    summary = Counter()
    old_order = [v["id"] for v in base]
    new_ids = []
    for candidate in sorted(updates, key=lambda v: v["id"]):
        original = current.get(candidate["id"])
        if original is None:
            if not _safe_link(candidate.get("lk")):
                summary["newVendorsSkippedInvalidLink"] += 1
                continue
            current[candidate["id"]] = copy.deepcopy(candidate)
            new_ids.append(candidate["id"])
            summary["vendorsAdded"] += 1
            summary["itemsAdded"] += len(candidate["i"])
            continue
        summary["vendorsMatched"] += 1
        old_cap, new_cap = original.get("cap"), candidate.get("cap")
        newer = bool(verified_updates and old_cap is not None and new_cap is not None and new_cap > old_cap)
        if new_cap is not None and old_cap is not None and new_cap < old_cap:
            summary["olderCandidateVendors"] += 1

        for field in FIELDS:
            prev, value = original.get(field), candidate.get(field)
            # is_open=0 means a recorded CLOSED state, not an absent value.
            value_present = value is not None if field == "o" else _positive(value)
            prev_present = prev is not None if field == "o" else _positive(prev)
            if not value_present:
                continue
            if field == "lk" and not _safe_link(value):
                summary["unsafeCandidateLinksIgnored"] += 1
                continue
            if not prev_present:
                original[field] = value
                summary["missingMetadataFilled"] += 1
            elif newer and prev != value:
                original[field] = value
                summary["verifiedMetadataUpdates"] += 1

        prev_items = original["i"]
        old_keys, new_keys = _keys(prev_items), _keys(candidate["i"])
        all_existing_observed = True
        for key, positions in old_keys.items():
            if len(positions) != 1 or len(new_keys.get(key, [])) != 1:
                all_existing_observed = False
                summary["existingItemsWithoutUniqueMatch"] += len(positions)
        if any(len(x) > 1 for x in new_keys.values()):
            all_existing_observed = False
            summary["ambiguousNewItemKeys"] += sum(len(x) for x in new_keys.values() if len(x) > 1)
        all_reobserved_prices = all_existing_observed
        for key in sorted(new_keys):
            positions = new_keys[key]
            if len(positions) != 1:
                continue  # Never guess which of several distinct offers is the same SKU.
            incoming = candidate["i"][positions[0]]
            old_pos = old_keys.get(key, [])
            if not old_pos:
                prev_items.append(copy.deepcopy(incoming))
                summary["itemsAdded"] += 1
                continue
            if len(old_pos) != 1:
                continue
            existing = prev_items[old_pos[0]]
            # Unknown/zero price must never erase an older known price. An unverified
            # observation can fill a missing price, but cannot change a known one.
            if incoming[2] is not None and (newer or existing[2] is None):
                if existing[2] != incoming[2] or existing[3] != incoming[3]:
                    existing[2], existing[3] = incoming[2], incoming[3]
                    summary["itemPricesUpdated"] += 1
            elif incoming[2] is None or existing[2] != incoming[2] or existing[3] != incoming[3]:
                all_reobserved_prices = False
                if existing[2] is not None:
                    summary["oldPricesProtected"] += 1
        # A vendor has ONE timestamp, not a timestamp per menu item. If ANY old
        # item was retained without verified fresh observation, advancing that
        # timestamp would falsely make stale prices look current.
        if newer and all_reobserved_prices:
            original["cap"] = new_cap
            summary["capturesAdvanced"] += 1
        elif newer:
            summary["capturesHeldForStaleMenu"] += 1

    summary["baselineVendors"] = len(base)
    summary["candidateVendors"] = len(updates)
    summary["mergedVendors"] = len(current)
    summary["oldVendorsPreservedWithoutCandidate"] = len(set(old_order) - {v["id"] for v in updates})
    summary["baselineItems"] = sum(len(v["i"]) for v in base)
    summary["mergedItems"] = sum(len(v["i"]) for v in current.values())
    vendors = [current[id] for id in old_order + new_ids]
    # Required invariant: no deletions of existing vendor/item identities.
    for v in base:
        merged = current[v["id"]]
        before, after = _keys(v["i"]), _keys(merged["i"])
        if any(len(after.get(k, [])) < len(old) for k, old in before.items()):
            raise AssertionError("baseline menu item unexpectedly removed")
    if summary["mergedVendors"] < summary["baselineVendors"] or summary["mergedItems"] < summary["baselineItems"]:
        raise AssertionError("reconciliation unexpectedly deleted data")
    _validate(vendors, "merged")
    return vendors, dict(sorted(summary.items()))


def category_counts(vendors):
    counts = Counter((v["s"], v.get("t") or "نامشخص") for v in vendors)
    return [{"source": source, "providerCategory": category, "vendors": number}
            for (source, category), number in sorted(counts.items())]


def _utc(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat() if seconds is not None else None


def make_manifest(vendors, data, summary, sha, gz_bytes, raw_bytes):
    caps = [v["cap"] for v in vendors if v.get("cap") is not None]
    per_source = {}
    for source in ("s", "t"):
        items = [v for v in vendors if v["s"] == source]
        per_source[source] = {"vendors": len(items), "items": sum(len(v["i"]) for v in items),
                              "priceUnknown": sum(1 for v in items for it in v["i"] if it[2] is None)}
    return {
        "schema": 1, "file": FILENAME, "sha256": sha, "rawBytes": raw_bytes, "gzBytes": gz_bytes,
        "vendors": len(vendors), "items": sum(len(v["i"]) for v in vendors),
        "capturedFrom": _utc(min(caps)) if caps else None,
        "capturedTo": _utc(max(caps)) if caps else None,
        "vendorsWithoutCapture": sum(v.get("cap") is None for v in vendors),
        "perSource": per_source, "reconciliation": summary,
        "rules": ["no existing vendor or item deleted", "no live provider fetch",
                  "older or unverified known price never overwritten",
                  "oldest applicable capture preserved for partially refreshed menus",
                  "provider category preserved; Core applies contextual vertical filtering",
                  "unknown price remains unknown; new price is NOT final checkout price"],
        "source": "local baseline index + same private research/vendors.sqlite (read-only)",
    }


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base-index", required=True, type=Path, help="Current existing food-index-v1.json.gz (read-only)")
    p.add_argument("--db", required=True, type=Path, help="Existing private research/vendors.sqlite (read-only)")
    p.add_argument("--research", required=True, type=Path, help="Existing research directory containing original raw captures")
    p.add_argument("--out", required=True, type=Path, help="NEW, empty staging directory only")
    p.add_argument("--allow-verified-updates", action="store_true",
                   help="Allow updating already-known fields only when raw capture timestamps are verified newer")
    a = p.parse_args(argv)
    base_path = a.base_index.resolve()
    out = a.out.resolve()
    if out == base_path.parent or out == a.db.resolve().parent or out == a.research.resolve():
        p.error("--out must NOT point to any live baseline, source DB or research directory")
    for name in (FILENAME, MANIFEST, REPORT):
        if (out / name).exists():
            p.error(f"staging output already exists: {out / name}; choose a NEW directory")
    if not base_path.is_file() or not a.db.is_file():
        p.error("both the existing base index and the source DB must exist")
    base = load_index(base_path)
    candidates, dropped, _, _, _ = build(a.db, a.research)
    merged, summary = reconcile(base["vendors"], candidates, verified_updates=a.allow_verified_updates)
    caps = [v["cap"] for v in merged if v.get("cap") is not None]
    payload = {"v": 1, "capturedFrom": min(caps) if caps else None,
               "capturedTo": max(caps) if caps else None, "vendors": merged}
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    out.mkdir(parents=True, exist_ok=True)
    gz_path = out / FILENAME
    # Deterministic gzip, no name or wall clock time embedded. Never writes to BASE.
    with gz_path.open("xb") as f:
        with gzip.GzipFile(filename="", mode="wb", fileobj=f, mtime=0, compresslevel=9) as gz:
            gz.write(raw)
    sha = hashlib.sha256(gz_path.read_bytes()).hexdigest()
    manifest = make_manifest(merged, candidates, summary, sha, gz_path.stat().st_size, len(raw))
    report = {
        "mode": "verified-updates" if a.allow_verified_updates else "additive-only",
        "baselineSha256": hashlib.sha256(base_path.read_bytes()).hexdigest(),
        "candidateDropsOutsideCoverage": dropped,
        "counts": summary,
        "providerCategoriesBefore": category_counts(base["vendors"]),
        "providerCategoriesCandidate": category_counts(candidates),
        "providerCategoriesAfter": category_counts(merged),
        "unverifiedCaptures": "Do not use --allow-verified-updates unless raw-file mtimes truly represent observation time.",
        "deployment": "NOT DEPLOYED; review staged data and request separate explicit deployment authorization",
    }
    (out / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / REPORT).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"staged": str(gz_path), "sha256": sha, "summary": summary, "report": str(out / REPORT)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
