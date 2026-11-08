# Opus55 cloud session — PROGRESS

- Base: `main` @ `f1fe833` (HoMoHUA/Besrah; rebased from `a53dbaf` after PRs #10 and #12 landed). Branch: `opus55/transit-place-input`.
- Push: done after the owner attached the repository; branch rebased onto current `main` and force-pushed with lease. PR opened against `main`.

## Done

| # | Workstream | Commit | What |
|---|---|---|---|
| 1 | A Transit | `8a1bc49` | Place input with no multi-result Search: pasted coordinates / map links (offline, validated, nearest station named), explicit station picker grouped by line, geocoder outcome states (`no_match`, `not_enabled` = 485, `unavailable`, `outside_coverage`, `not_configured`). Cards: why shown (`choice`), step chain, measured/model/assumed split, "N min later than option 1". Fix: without a router, two cards no longer repeat the same train from the same boarding station. |
| 2 | B Food | `910da60` | U8 verified present (fixture tests), not re-implemented. Fix: stale note said "حدود 96 ساعت" (Latin digits, hours) and "?" for an unknown capture time; now Persian days/hours and an explicit unknown message. |
| 3 | C Shopping | `116d1c4` | `merchants[]` + `comparisonScope` in product DTOs; UI says "only the sellers on this marketplace page; not a market-wide comparison"; https-only link to the source product page. No SKUs or prices added. |

## Tests (actually run, serially, on the rebased branch)

- After rebase onto `f1fe833`: **core 751 passed / 6 skipped (65 files)**, `tsc --noEmit` clean; **Mini App 283/283**; **tests/shop 30 OK**; `git diff --check` clean.
- Core must run with a private TMPDIR (`TMPDIR=<0700 dir>`): with the world-writable `/tmp`, the feedback-storage safety check (`feedback_unsafe_path`) fails 38 tests. Environment, not a regression.
- Rebase conflicts resolved in `trip/plan.ts`, `trip/routes.ts`, `views/trip.js`, `app.css`, `trip.test.mjs`, `views/shop.js`, `shop.test.mjs`. Main's new decision labels, GPS-default origin, saved shop choices and the shopping budget were kept; my station picker, coordinate input, card lines and marketplace-scope line were layered on top.
- Browser check (Chromium, 320/360/390 px, zero overflow) was done BEFORE the rebase, on the old trip view. The merged view (new GPS-default origin plus my station picker) has been tested by DOM tests only, not re-shot in a browser. Telegram WebView not tested.

## Blockers

1. Review the PR; re-check the merged trip screen on a phone (see the browser note above).
2. **Shopping growth:** the importer's source host is not reachable from this cloud network, and the manifest is human-curated. Growth needs a human-chosen SKU list and an importer run on an allowed machine.
3. Address search quality still depends on Neshan single-result geocoding; multi-result Search needs the entitlement (owner, Neshan panel).

## Next unblocked task

D: unify the evidence labels (`routed/model/assumption/unknown` in trip, `known/unknown/stale` in food, `resolved/unresolved/quarantined` in shop) behind one shared chip component in `apps/miniapp/ui/`.
