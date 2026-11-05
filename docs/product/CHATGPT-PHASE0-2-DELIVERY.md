# Besrah — ChatGPT Phases 0–2 implementation and handoff

**Work branch:** `chatgpt/phase0-2-food-intelligence-memory`  
**Base:** `bd2ac470` (main, 2026-11-05)  
**Scope:** code + tests + an owner-reviewable PR. **No Production deployment, no private dataset upload, no automatic merge.**

## Status (three phases)

| Phase | Delivered | Scope caveat |
| --- | --- | --- |
| 0: Continuous integration | `.github/workflows/ci.yml` runs Core typecheck/build/Vitest, Mini App JS tests, Node and Python data/release/shop tests | Private production datasets and proprietary source archives intentionally unavailable in public CI; associated checks are skipped explicitly and must run on the owner VPS |
| 1: Food & Intelligent Decision | All marketplace categories retained in deterministic index builder; vertical classification and API filters; HM7 UI categories; v1 Core extended with `listedItemPriceToman` metric and strict scope for identical menu items; context-aware home category suggestions | Needs fresh **private** index rebuild; old production index previously excluded non-restaurants. Current Oct-31 snapshot stale: Core deliberately suppresses fresh-price superlatives |
| 2: Explicit preference and memory | User-selected favorite verticals (max 4) can sync through existing consented Telegram preference API; device-local saved vendors and products (max 24) with view/remove/clear controls | Not automatic behavioral learning, order tracking, server-side cross-device saved-item sync or event-driven notifications. Requires explicit new consent/policy before later phases |

## Marketplace data: never assume “restaurant only”

The existing **SnappFood and TapsiFood** provider feed includes categories beyond restaurant menus:
- Restaurants and Iranian dishes; fast food
- Cafés, juice and drinks; sweets, cakes, desserts and ice cream
- Bakeries; flower and gift vendors
- Groceries and supermarkets; fruit/produce, protein/meat, nuts/dried foods, other

All providers stay in the one source dataset with original provider `category` metadata retained. `food/verticals.ts` classifies:
`restaurant | fast_food | cafe | sweets | bakery | flowers | grocery | produce | protein | nuts | other`.
It reads explicit provider category first, then vendor name, then majority menu category; the `verticalBasis` field discloses how classification was derived. An ambiguous shop is **other**, not forcibly a restaurant.

`searchFood` supports `?vertical=...` plus `meals` and `all`. Side dish filtering is applied **only** in meal categories; a coffee, drink or flower is never discarded as a “side dish” just for having a drink/related menu category. The UI includes category chips, category labels and a provider web URL fallback for nonrestaurant vendors (old restaurant-deep-link behavior isn't asserted for florists).

**No fabricated offers:** stored prices are item-level snapshots, not current total checkout amount. Unknown remains unknown. Current cache capture dates remain visible.

## Context-aware recommendation policy

- Home card selection uses **Asia/Tehran** clock slots: morning `bakery/cafe/restaurant`, lunch and dinner `restaurant/fast_food`, snack `cafe/sweets`, late `sweets/cafe/grocery`.
- An *explicitly user-selected* preferred vertical influences a slot only if compatible. Example: an explicit `cafe` preference makes snack café-first. The system does **not** infer a birthday or force flowers into lunch just because a user searched for a florist.
- Flower / gift intent remains a visible, opt-in vertical search. More advanced occasion awareness requires a **user-supplied event or intent**, not inferred celebration dates or scraped messages.
- GPS only on explicit tap or existing opt-in; category preferences may be included in that single home POST but no browsing history, precise location or profile is stored by the recommendation endpoint.
- Currently this is **a verified-claim category recommendation / search hand-off**, not real-time merchant inventory, verified delivery radius, personalized menu recommendation, or multi-week behavior modeling.

## Core price evidence contract

`listedItemPriceToman` was added additively to `METRIC_UNITS` while leaving the existing `schemaVersion:1` wire structure intact. Existing `totalCostToman` semantics are unchanged. Source-specific evidence and TTL are mandatory to be comparable; a 48-hour expiry disqualifies stale menu-item snapshot prices from “lowest listed price” labeling. Equivalent items must share **normalized name + variation + vertical**. Only the presented page is compared, with `scope: same_named_item_in_current_page`, never “cheapest in Mashhad” or “cheapest delivery”.

**Contract caution:** An additive metric/label changes the *set of accepted values* in v1; existing v1 consumers should ignore unknown metric keys as they previously did. If strict external consumers or a deployment schema registry is introduced, formalize a v2 migration before exposing these additions externally. Do not change existing shipped decision fields.

## Device and server preferences

- `foodPreferredVerticals` is optional, explicit, max 4, whitelisted, persisted in the existing local store and consented `sync_preferences` server API. Revocation still deletes server preferences.
- Saved vendor/product references are stored only on the current device: minimal kind/id/title/category. Maximum 24. Clicking save/remove is required; there is **no automatic search/history tracking**.
- The profile includes editable category chips and saved-item management, and the clear-local-data action clears saved references.
- Follow-up: a server-synced save collection requires explicit consent, deletion/export rules and additional authorizations (not in this PR).

## Required owner/Hermes staging follow-up (NOT AUTHORIZED by this PR)

1. **Merge only after PR checks and review**. Check branch against any later main commits before merge.
2. With VPS disk budget checked and an explicit owner `PRODUCTION_DEPLOY_GO`, run a **read-only audit** of `research/vendors.sqlite`:
   - Group by `source` and original `category`; include florist, café, pastry, bakery, grocery etc.
   - Run existing importer on the original DB into a **new staging output directory** (e.g. `/tmp/besrah-food-full-verticals`) without changing raw DB or current Production index.
   - Generate manifest, check hash, counts, provider-deeplink integrity, price unknowns, category coverage and geographic filtering. Compare all-vendor count to prior 961 + previously excluded 66 rather than assuming either total will be exact.
   - Preserve backup of old `food-index-v1.json.gz` and existing manifest, compare importer re-run deterministic bytes, then deploy only the versioned, verified index with code updates.
   - Validate no evidence of unknown/incorrect category defaults, and one regression each for `چلوکباب`, `قهوه`, `کیک`, `دسته گل`, `سوپرمارکت`. Owner must visually verify at 320/360/390 widths and actual Android10 Telegram.
3. Add current data freshness and legal/provider-rights review; do not commit raw menu catalogs or API keys into public GitHub.
4. Existing U11 release work must be reconciled with this branch before a Production update. Use a new hash-pinned release plan and rollback. Do not use U7/U8/U10 GO tokens to authorize a new deployment.

## CI verdict and limitations

The GitHub workflow is the **source of truth for automated tests**. Unit and fixture tests run without private data. A real-gate Python test that requires intentionally withheld raw source archives explicitly skips in sanitized GitHub; a full on-VPS run must execute it.

**No Production claims:** this branch is not active at `besrah.arklyn.ir` unless separately deployed with owner authorization.
