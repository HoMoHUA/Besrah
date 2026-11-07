#!/usr/bin/env python3
"""Safely ENRICH the existing Besrah food index using a rebuild from the SAME private vendors.sqlite.

This tool does not scrape, modify SQLite, or touch the live index. It merges the old
index and a separately staged candidate by provider+vendor code. Old vendors never
disappear. Same-capture menu additions are appended; newer captures update a
vendor only if no earlier menu key disappears. Suspicious revisions fail closed.

Usage:
  python3 scripts/food/merge_food_index.py --baseline /private/current/food-index-v1.json.gz \
    --candidate /private/rebuilt/food-index-v1.json.gz --dry-run
  python3 scripts/food/merge_food_index.py --baseline /private/current/food-index-v1.json.gz \
    --candidate /private/rebuilt/food-index-v1.json.gz --out /private/new-staging-dir

Never use a Production output directory. The old index and raw SQLite stay unchanged.
"""
import argparse
import copy
import gzip
import hashlib
import json
import os
import re
import tempfile
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

VENDOR_ID = re.compile(r"^[st]:[a-zA-Z0-9]{1,32}$")
META = ("n", "b", "t", "la", "lo", "a", "m", "r", "cc", "o", "lk")


def _fold(value):
    return " ".join(unicodedata.normalize("NFC", str(value or "")).lower()
                    .replace("ي", "ی").replace("ك", "ک").replace("\u200c", " ").split())


def _item_key(item):
    return tuple(_fold(item[i]) for i in (0, 1, 4))


def _valid_index(payload, label):
    if not isinstance(payload, dict) or payload.get("v") != 1 or not isinstance(payload.get("vendors"), list):
        raise ValueError(f"{label}: expected Besrah food index schema v1")
    seen = set()
    for vendor in payload["vendors"]:
        if not isinstance(vendor, dict):
            raise ValueError(f"{label}: invalid vendor record")
        ident = vendor.get("id")
        if not isinstance(ident, str) or not VENDOR_ID.fullmatch(ident) or ident in seen:
            raise ValueError(f"{label}: malformed or duplicate vendor id: {ident!r}")
        seen.add(ident)
        if vendor.get("s") != ident[0] or str(vendor.get("c")) != ident[2:]:
            raise ValueError(f"{label}: vendor provider/code mismatch: {ident}")
        cap = vendor.get("cap")
        if cap is not None and (type(cap) is not int or cap < 0):
            raise ValueError(f"{label}: invalid capture time: {ident}")
        if not isinstance(vendor.get("i"), list):
            raise ValueError(f"{label}: missing menu array: {ident}")
        for item in vendor["i"]:
            if not isinstance(item, list) or len(item) != 5:
                raise ValueError(f"{label}: invalid menu item: {ident}")
            for price in item[2:4]:
                if price is not None and (type(price) is not int or price <= 0):
                    raise ValueError(f"{label}: price must be positive or unknown: {ident}")
    return payload


def read_index(path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return _valid_index(json.load(handle), str(path))


def _same_capture(old, new, report):
    """At an identical/unknown capture time, never rewrite existing prices."""
    merged = copy.deepcopy(old)
    existing = {_item_key(item): item for item in old["i"]}
    for item in new["i"]:
        key = _item_key(item)
        if key in existing:
            if existing[key] != item:
                raise ValueError(f"same-capture conflict at {old['id']} / {key!r}; review source rather than overwriting")
        else:
            merged["i"].append(copy.deepcopy(item))
            existing[key] = item
            report["appendedMenuItems"] += 1
    if not merged.get("t") and new.get("t"):
        merged["t"] = new["t"]
        report["filledCategories"] += 1
    return merged


def merge_indexes(baseline, candidate):
    _valid_index(baseline, "baseline")
    _valid_index(candidate, "candidate")
    original = {v["id"]: v for v in baseline["vendors"]}
    result = {key: copy.deepcopy(v) for key, v in original.items()}
    history = []
    report = {
        "baselineVendors": len(original), "candidateVendors": len(candidate["vendors"]),
        "addedVendors": 0, "updatedVendors": 0, "sameCaptureVendors": 0,
        "ignoredOlderVendors": 0, "appendedMenuItems": 0, "filledCategories": 0,
        "blockedMenuRemovals": 0,
    }
    for incoming in candidate["vendors"]:
        ident = incoming["id"]
        old = result.get(ident)
        if old is None:
            result[ident] = copy.deepcopy(incoming)
            report["addedVendors"] += 1
            report["appendedMenuItems"] += len(incoming["i"])
            continue
        old_cap, new_cap = old.get("cap"), incoming.get("cap")
        if new_cap is not None and (old_cap is None or new_cap > old_cap):
            older_keys = {_item_key(item) for item in old["i"]}
            newer_keys = {_item_key(item) for item in incoming["i"]}
            vanished = older_keys - newer_keys
            if vanished:
                report["blockedMenuRemovals"] += len(vanished)
                raise ValueError(
                    f"newer capture for {ident} omits {len(vanished)} existing menu keys; "
                    "no implicit removal is allowed. Preserve the older snapshot and review explicitly."
                )
            # Preserve old vendor metadata if the incoming field is blank/unknown,
            # but NEVER carry over an old open/price snapshot under the new capture.
            merged = copy.deepcopy(incoming)
            for key in ("n", "b", "t", "a", "lk"):
                if not merged.get(key):
                    merged[key] = old.get(key)
            history.append(copy.deepcopy(old))  # audit/rollback artifact, NOT public repo
            result[ident] = merged
            report["updatedVendors"] += 1
            report["appendedMenuItems"] += len(newer_keys - older_keys)
        elif old_cap == new_cap:
            result[ident] = _same_capture(old, incoming, report)
            report["sameCaptureVendors"] += 1
        else:
            report["ignoredOlderVendors"] += 1
    if not set(original).issubset(result):
        raise AssertionError("baseline vendors must never be removed")
    vendors = [result[k] for k in sorted(result)]
    captures = [v["cap"] for v in vendors if v.get("cap") is not None]
    payload = {"v": 1, "capturedFrom": min(captures) if captures else None,
               "capturedTo": max(captures) if captures else None, "vendors": vendors}
    report["finalVendors"] = len(vendors)
    report["finalMenuItems"] = sum(len(v["i"]) for v in vendors)
    report["baselineMenuItems"] = sum(len(v["i"]) for v in baseline["vendors"])
    report["perProvider"] = dict(sorted(Counter(v["s"] for v in vendors).items()))
    report["providerCategories"] = dict(sorted(Counter((v.get("t") or "(unknown)").strip() or "(unknown)"
                                                     for v in vendors).items()))
    report["historicalVendorVersionsArchived"] = len(history)
    if report["finalVendors"] < report["baselineVendors"]:
        raise AssertionError("vendor count regressed")
    return payload, report, history


def _gzip_json(payload):
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    with tempfile.TemporaryFile() as buf:
        with gzip.GzipFile(filename="", mode="wb", fileobj=buf, compresslevel=9, mtime=0) as zipped:
            zipped.write(raw)
        buf.seek(0)
        return buf.read()


def _write_new(path, data):
    if path.exists():
        raise FileExistsError(f"refusing to overwrite {path}")
    fd, tmp = tempfile.mkstemp(prefix=".besrah-food-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        # This tool only creates files in a new staging directory.
        if path.exists():
            raise FileExistsError(f"refusing to overwrite {path}")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True, help="Existing protected index")
    parser.add_argument("--candidate", type=Path, required=True, help="Rebuilt index using ONLY the existing private SQLite")
    parser.add_argument("--out", type=Path, help="New private staging DIRECTORY, never production")
    parser.add_argument("--dry-run", action="store_true", help="Audit counts only; write nothing")
    args = parser.parse_args(argv)
    if not args.dry_run and args.out is None:
        parser.error("--out is required without --dry-run")
    if args.baseline.resolve() == args.candidate.resolve():
        parser.error("candidate must be built separately from the current baseline")
    if not args.baseline.is_file() or not args.candidate.is_file():
        parser.error("both input indexes must already exist")
    baseline = read_index(args.baseline)
    candidate = read_index(args.candidate)
    merged, report, previous = merge_indexes(baseline, candidate)
    report["inputs"] = {
        "baselineSha256": hashlib.sha256(args.baseline.read_bytes()).hexdigest(),
        "candidateSha256": hashlib.sha256(args.candidate.read_bytes()).hexdigest(),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    if args.dry_run:
        return 0
    out = args.out.resolve()
    final = out / "food-index-v1.json.gz"
    if final in {args.baseline.resolve(), args.candidate.resolve()}:
        parser.error("output must never overwrite a source index")
    if out.exists() and any(out.iterdir()):
        parser.error("output must be a NEW empty staging directory")
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    output = _gzip_json(merged)
    report["resultSha256"] = hashlib.sha256(output).hexdigest()
    report["policy"] = "baseline-preserving merge; source sqlite untouched; never deploy without owner review"
    report["generatedAt"] = datetime.now(timezone.utc).isoformat()
    _write_new(final, output)
    if previous:
        _write_new(out / "previous-vendor-versions.json.gz", _gzip_json({"historicalVendors": previous}))
    _write_new(out / "food-merge-report.json", (json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
