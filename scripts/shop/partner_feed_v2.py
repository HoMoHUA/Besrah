#!/usr/bin/env python3
"""Offline, license-aware, provenance-first multi-merchant offer staging.

Intentionally DOES NOT scrape any website, call any provider, or write into the
existing production catalog. Requires explicit source files and a manually
verified cross-merchant identity map. Product names alone never establish identity.

Usage:
 python3 scripts/shop/partner_feed_v2.py \
   --feed fixtures/shop-feed-a.json --feed fixtures/shop-feed-b.json \
   --crosswalk fixtures/shop-crosswalk.json \
   --at 2026-11-06T12:00:00+03:30 --out /tmp/besrah-shop-v2-staged.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

SCHEMA_VERSION = 2
TTL_SECONDS = 48 * 3600
MAX_FEED_BYTES = 12 * 1024 * 1024
MAX_ITEMS = 25000
MAX_TEXT = 180
REQUIRED_IDENTITY = ("brand", "model", "variant", "warranty", "condition")
SOURCE_ID_RX = re.compile(r"^[a-z0-9][a-z0-9_.-]{1,63}$")
ITEM_ID_RX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$")
CANONICAL_RX = re.compile(r"^besrah:[a-z0-9][a-z0-9_.-]{1,79}$")


class FeedError(ValueError):
    """Invalid or unsupported content; never guess source identity or prices."""


def ensure(cond: bool, reason: str) -> None:
    if not cond:
        raise FeedError(reason)


def read_json(path: Path) -> dict:
    ensure(path.is_file(), "missing_file")
    ensure(path.stat().st_size <= MAX_FEED_BYTES, "oversized_json")
    data = json.loads(path.read_text(encoding="utf-8"))
    ensure(isinstance(data, dict), "not_object")
    return data


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    value = value.translate(str.maketrans("يىك٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "ییک01234567890123456789"))
    value = re.sub(r"[\u200c\u200f\u064b-\u065f]", " ", value)
    return " ".join(re.findall(r"[^\W_]+", value, re.UNICODE))


def nonempty(value: object, field: str, max_len: int = MAX_TEXT) -> str:
    ensure(isinstance(value, str) and 0 < len(value.strip()) <= max_len, "bad_" + field)
    return value.strip()


def iso(value: object, field: str) -> datetime:
    s = nonempty(value, field, 42)
    try:
        v = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError as exc:
        raise FeedError("invalid_" + field) from exc
    ensure(v.tzinfo is not None and v.utcoffset() is not None, "naive_" + field)
    return v.astimezone(timezone.utc)


def utc(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def check_url(url: object, allowed_hosts: set[str]) -> str:
    u = nonempty(url, "sourceUrl", 800)
    parsed = urlparse(u)
    ensure(parsed.scheme == "https" and parsed.hostname is not None, "non_https_source_url")
    ensure(parsed.username is None and parsed.password is None, "url_credentials_forbidden")
    ensure(parsed.hostname.lower() in allowed_hosts, "url_host_not_allowed")
    ensure(parsed.port in (None, 443), "url_nonstandard_port")
    ensure(not parsed.fragment, "url_fragment_not_allowed")
    return u


def toman(price: object, currency: object) -> int | None:
    if price is None:
        return None
    ensure(type(price) is int and 0 < price <= 10**13, "invalid_price")
    ensure(currency in ("IRR", "IRT"), "unsupported_currency")
    if currency == "IRR":
        ensure(price % 10 == 0, "nonintegral_rial_to_toman")
        return price // 10
    return price


def identity(raw: object) -> dict[str, str]:
    ensure(isinstance(raw, dict), "identity_not_object")
    ensure(set(raw) == set(REQUIRED_IDENTITY), "identity_fields_incomplete")
    result = {k: nonempty(raw[k], k) for k in REQUIRED_IDENTITY}
    return result


def identity_key(value: dict[str, str]) -> tuple[str, ...]:
    return tuple(normalized(value[k]) for k in REQUIRED_IDENTITY)


def normalize_feed(feed: dict, at: datetime) -> tuple[list[dict], dict]:
    ensure(feed.get("schemaVersion") == 2, "unsupported_feed_schema")
    source_id = nonempty(feed.get("sourceId"), "sourceId", 64)
    ensure(SOURCE_ID_RX.fullmatch(source_id) is not None, "unsafe_sourceId")
    merchant_id = nonempty(feed.get("merchantId"), "merchantId", 64)
    merchant = nonempty(feed.get("merchant"), "merchant")
    license_ref = nonempty(feed.get("licenseRef"), "licenseRef")
    # licenseRef is an owner-maintained provenance reference, NOT proof of legal authorization.
    allowed = feed.get("allowedHosts")
    ensure(isinstance(allowed, list) and allowed and len(allowed) <= 20, "invalid_allowedHosts")
    allowed_set = set()
    for host in allowed:
        h = nonempty(host, "host", 120).lower()
        ensure(re.fullmatch(r"[a-z0-9.-]+", h) is not None and "." in h, "invalid_host")
        allowed_set.add(h)
    observed = iso(feed.get("observedAt"), "observedAt")
    ensure(observed <= at, "future_observation")
    rows = feed.get("offers")
    ensure(isinstance(rows, list) and len(rows) <= MAX_ITEMS, "invalid_offers")
    seen = set()
    out = []
    for i, row in enumerate(rows):
        ensure(isinstance(row, dict), "row_not_object")
        source_product_id = nonempty(row.get("sourceProductId"), "sourceProductId", 80)
        ensure(ITEM_ID_RX.fullmatch(source_product_id) is not None, "unsafe_source_product_id")
        ensure(source_product_id not in seen, "duplicate_source_product_id")
        seen.add(source_product_id)
        item_identity = identity(row.get("identity"))
        stock = row.get("stock", "unknown")
        ensure(stock in ("unknown", "declared_in_stock", "declared_out_of_stock"), "unsupported_stock")
        quoted = row.get("price")
        ensure(quoted is None or isinstance(quoted, dict), "price_not_object")
        price_value = None if quoted is None else toman(quoted.get("amount"), quoted.get("currency"))
        shipping = row.get("shippingToman")
        ensure(shipping is None or type(shipping) is int and shipping >= 0, "invalid_shipping")
        if shipping is not None:
            ensure(bool(row.get("shippingVerified")), "shipping_provenance_missing")
        url = check_url(row.get("sourceUrl"), allowed_set)
        row_time = iso(row.get("observedAt", feed["observedAt"]), "itemObservedAt")
        ensure(row_time <= at and row_time <= observed, "row_date_newer_than_feed")
        age = (at - row_time).total_seconds()
        status = "stale" if age > TTL_SECONDS else "price_unknown" if price_value is None else "declared_out_of_stock" if stock == "declared_out_of_stock" else "candidate"
        out.append({
            "sourceId": source_id,
            "merchantId": merchant_id,
            "merchant": merchant,
            "licenseRef": license_ref,
            "sourceProductId": source_product_id,
            "title": nonempty(row.get("title"), "title"),
            "identity": item_identity,
            "priceToman": price_value,
            "shippingToman": shipping,
            "stock": stock,
            "sourceUrl": url,
            "observedAt": utc(row_time),
            "validUntil": utc(row_time.fromtimestamp(row_time.timestamp() + TTL_SECONDS, timezone.utc)),
            "status": status,
            "evidence": "merchant_supplied_snapshot",
        })
    return out, {"sourceId": source_id, "merchantId": merchant_id, "merchant": merchant, "licenseRef": license_ref, "observedAt": utc(observed), "offers": len(out)}


def crosswalk_lookup(crosswalk: dict, offers: list[dict], at: datetime) -> dict[tuple[str, str], str]:
    ensure(crosswalk.get("schemaVersion") == 2, "unsupported_crosswalk_schema")
    groups = crosswalk.get("groups")
    ensure(isinstance(groups, list), "crosswalk_missing_groups")
    by_ref = {(o["sourceId"], o["sourceProductId"]): o for o in offers}
    lookup: dict[tuple[str, str], str] = {}
    seen_groups = set()
    for group in groups:
        ensure(isinstance(group, dict), "group_not_object")
        gid = nonempty(group.get("canonicalId"), "canonicalId", 86)
        ensure(CANONICAL_RX.fullmatch(gid) is not None and gid not in seen_groups, "unsafe_or_duplicate_canonicalId")
        seen_groups.add(gid)
        expected_identity = identity(group.get("identity"))
        evidence = group.get("verification")
        ensure(isinstance(evidence, dict) and evidence.get("type") == "manual", "identity_not_manually_verified")
        reviewed = iso(evidence.get("observedAt"), "verificationDate")
        ensure(reviewed <= at, "future_verification")
        evidence_note = nonempty(evidence.get("note"), "verificationNote", 500)
        ensure(len(evidence_note) >= 16, "weak_verification_note")
        refs = group.get("items")
        ensure(isinstance(refs, list) and refs, "empty_crosswalk_group")
        for ref in refs:
            ensure(isinstance(ref, dict) and set(ref) == {"sourceId", "sourceProductId"}, "malformed_crosswalk_ref")
            key = (ref["sourceId"], ref["sourceProductId"])
            ensure(key in by_ref, "unresolved_crosswalk_ref")
            ensure(identity_key(by_ref[key]["identity"]) == identity_key(expected_identity), "variant_identity_mismatch")
            lookup[key] = gid
    return lookup


def build(feeds: list[dict], crosswalk: dict, at: datetime) -> dict:
    ensure(feeds, "no_feeds")
    all_offers: list[dict] = []
    sources = []
    seen_sources = set()
    for feed in feeds:
        offers, source = normalize_feed(feed, at)
        ensure(source["sourceId"] not in seen_sources, "duplicate_source")
        seen_sources.add(source["sourceId"])
        all_offers.extend(offers)
        sources.append(source)
    lookup = crosswalk_lookup(crosswalk, all_offers, at)
    groups: dict[str, list[dict]] = {}
    unmatched: list[dict] = []
    for offer in all_offers:
        group_id = lookup.get((offer["sourceId"], offer["sourceProductId"]))
        if group_id:
            groups.setdefault(group_id, []).append(offer)
        else:
            unmatched.append(offer)
    products = []
    for key, quotes in sorted(groups.items()):
        eligible = [o for o in quotes if o["status"] == "candidate"]
        # A comparison is useful only across independent merchants; not two listing variants
        # from a single merchant. Preserve quotes from every source, including stale/unknown.
        unique_merchants = {o["merchantId"] for o in eligible}
        compared = len(eligible) >= 2 and len(unique_merchants) >= 2
        best = min((o["priceToman"] for o in eligible), default=None) if compared else None
        for offer in quotes:
            offer["cheapestWithinVerifiedGroup"] = bool(compared and offer["status"] == "candidate" and offer["priceToman"] == best)
        products.append({
            "canonicalId": key, "identity": quotes[0]["identity"],
            "comparisonScope": "manual_variant_verified_group_and_current_snapshots_only",
            "priceComparisonAvailable": compared,
            "lowestListedPriceToman": best,
            "checkoutTotalKnown": False,  # even shipping-known quotes can have tax/fees unknown
            "offers": sorted(quotes, key=lambda o: (o["sourceId"], o["sourceProductId"])),
        })
    result = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": utc(at),
        "summary": {
            "sourceCount": len(sources), "productGroups": len(products), "offers": len(all_offers),
            "unmatchedOffers": len(unmatched), "priceComparableGroups": sum(p["priceComparisonAvailable"] for p in products),
            "freshOffers": sum(o["status"] == "candidate" for o in all_offers),
            "staleOffers": sum(o["status"] == "stale" for o in all_offers),
        },
        "sources": sorted(sources, key=lambda s: s["sourceId"]),
        "products": products,
        "unmatched": sorted(unmatched, key=lambda o: (o["sourceId"], o["sourceProductId"])),
        "notes": [
            "Do not treat source license references as independently verified legal permission.",
            "No network access or crawling; all observations come from provided partner exports.",
            "Prices are seller-declared snapshots; no real-time availability or delivery guarantee.",
            "Lowest listed price only applies among fresh, manually variant-verified different merchants.",
            "Unknown checkout fees, discounts, taxes and shipping must never become zero by default.",
        ],
    }
    return result


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--feed", action="append", required=True)
    ap.add_argument("--crosswalk", required=True)
    ap.add_argument("--at", required=True, help="ISO timestamp with explicit timezone; never system time inferred")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    try:
        clock = iso(args.at, "at")
        input_paths = [Path(p) for p in args.feed]
        result = build([read_json(p) for p in input_paths], read_json(Path(args.crosswalk)), clock)
        # Caller selects staging path; prevent overwriting existing files silently.
        out = Path(args.out)
        ensure(not out.exists(), "output_already_exists")
        ensure(out.parent.is_dir(), "output_parent_missing")
        output = (json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        out.write_bytes(output)
        print(json.dumps({"path": str(out), "sha256": hashlib.sha256(output).hexdigest(), "summary": result["summary"]}, ensure_ascii=False))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print("shop-v2 validation failure: " + str(error), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
