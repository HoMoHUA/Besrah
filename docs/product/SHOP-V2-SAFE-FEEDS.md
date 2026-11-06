# Besrah Shop V2 — safe offline multi-merchant staging

This code adds an **additive, offline** V2 path for seller-provided offer snapshots. It does **not** modify the existing V1 production catalog or the live `/app/api/shop/*` routes. No provider account credentials, scraping, web calls, real inventory or live prices are included.

## Components

- `scripts/shop/partner_feed_v2.py` reads owner-authorized JSON feeds from multiple independent merchants and a **human-verified** crosswalk of the same exact product variant. Output: `schemaVersion: 2` staging JSON.
- `scripts/shop/price_watch_v2.py` compares two properly ordered, recent V2 snapshots against an **explicit opt-in** watchlist. It returns candidate price drops only; it sends no notification and never places an order.
- `tests/shop/test_partner_feed_v2.py` and `tests/shop/test_price_watch_v2.py` validate price currency, provenance, identity, license/host parameters, unknown and stale prices, notification consent and no-silent-overwrite safeguards.

## Run safely

```bash
python3 -m unittest discover -s tests/shop -p 'test_*.py' -v

python3 scripts/shop/partner_feed_v2.py \
  --feed /path/to/owner-authorized-feed-a.json \
  --feed /path/to/owner-authorized-feed-b.json \
  --crosswalk /path/to/manually-reviewed-crosswalk.json \
  --at '2026-11-06T10:00:00Z' \
  --out /tmp/besrah-shop-v2-STAGING.json

python3 scripts/shop/price_watch_v2.py \
  --previous /path/to/previous/shop-v2.json \
  --current /path/to/current/shop-v2.json \
  --watchlist /path/to/opt-in/watchlist.json \
  --at '2026-11-06T10:00:00Z' \
  --out /tmp/besrah-shop-v2-watch-candidates.json
```

Do not replace `data/shop/catalog-v1.json` with V2 output; this is a different schema and V1 routes accept only `tl:<digits>` listing IDs.

## Feed contract

Each input feed specifies `schemaVersion:2`, `sourceId`, `merchantId`, `merchant`, `licenseRef`, `allowedHosts`, `observedAt`, `offers`. Each offer provides `sourceProductId`, `title`, exact `identity` (`brand/model/variant/warranty/condition`), `price` (null or positive integer with IRR/IRT currency), `stock` (declared/unknown), `shippingToman` (null unless verified), `sourceUrl` (HTTPS allowed host).

Crosswalk groups must have `canonicalId` and a matching exact identity; `verification.type=manual`, timestamp and review note. Merely similar product titles are **not** valid evidence of equivalent variations. Unknown matches remain in `unmatched` output. Fresh, comparable offers must have independent merchant IDs and a maximum 48-hour age. A declared license reference is not independent proof of lawful permission; the owner must verify supplier rights.

## Watchlist contract

```json
{
  "schemaVersion": 1,
  "userOptIn": true,
  "watches": [
    {
      "canonicalId": "besrah:verified-sku-variant",
      "minDropPercent": 5,
      "maxPriceToman": null
    }
  ]
}
```

A candidate is generated only with equivalent identity in both snapshots, fresh current data, multiple independent merchants, strictly lower listed price and the user's stated thresholds. `deliveryStatus:not_sent` is not a user notification. No account or location information is recorded by these scripts.

## Integration gate

Before wiring the module to the production API or Telegram app:
1. Obtain permitted, sustained real partner feeds and human-reviewed canonical mappings.
2. Define independent catalog V2 route+parser and backup/rollback separate from V1.
3. Add explicit watchlist consent, deletion/export, scheduling and notification channel gating.
4. Review seller terms, actual fresh price/stock validation and real-device acceptance.
5. Reconcile with Hermes' Production branch (Liquid Glass, Web Push, Smart Hints and `/field/`) before any release.

**Safety boundary:** all code here is read-only until the operator chooses a new staging output path; the output refuses to overwrite an existing file. Never push user watchlists, private feeds or credentials to public GitHub.
