# Opus55 cloud session — PROGRESS

- Base: `main` @ `a53dbaf` (HoMoHUA/Besrah). Branch: `opus55/transit-place-input`.
- **Push status: BLOCKED.** This cloud session has read-only access to HoMoHUA/Besrah (GitHub refused write access; `gh` has no valid token, so a fork was not possible either). All commits are local to the session and were exported as a git bundle and patch files.

## Done

| # | Workstream | Commit | What |
|---|---|---|---|
| 1 | A Transit | `8a1bc49` | Place input with no multi-result Search: pasted coordinates / map links (offline, validated, nearest station named), explicit station picker grouped by line, geocoder outcome states (`no_match`, `not_enabled` = 485, `unavailable`, `outside_coverage`, `not_configured`). Cards: why shown (`choice`), step chain, measured/model/assumed split, "N min later than option 1". Fix: without a router, two cards no longer repeat the same train from the same boarding station. |
| 2 | B Food | `910da60` | U8 verified present (fixture tests), not re-implemented. Fix: stale note said "حدود 96 ساعت" (Latin digits, hours) and "?" for an unknown capture time; now Persian days/hours and an explicit unknown message. |
| 3 | C Shopping | `116d1c4` | `merchants[]` + `comparisonScope` in product DTOs; UI says "only the sellers on this marketplace page; not a market-wide comparison"; https-only link to the source product page. No SKUs or prices added. |

## Tests (actually run, serially, in this session)

- Baseline before changes: core 622 passed / 6 skipped, Mini App 219/219, tests/shop 7/7.
- After: **core 634 passed / 6 skipped (51 files)**, `tsc --noEmit` clean; **Mini App 224/224**; **tests/shop 7/7 OK**; `git diff --check` clean.
- Core must run with a private TMPDIR (`TMPDIR=<0700 dir>`): with the world-writable `/tmp`, the feedback-storage safety check (`feedback_unsafe_path`) fails 38 tests. That is the environment, not a regression.
- Browser: Chromium (Playwright) against the local preview without a Neshan key. Trip view at 320/360/390 px: zero horizontal overflow. Telegram WebView not tested. The shop UI was not checked in a browser (the catalog is absent from the public repo, so the endpoint answers 503); it is covered by DOM tests.

## Blockers

1. **Push / PR:** grant this cloud session write access to HoMoHUA/Besrah (GitHub App / collaborator), or apply the bundle yourself (see HANDOFF.md).
2. **Shopping growth:** the importer's source host is not reachable from this cloud network, and the manifest is human-curated. Growth needs a human-chosen SKU list and an importer run on an allowed machine.
3. Address search quality still depends on Neshan single-result geocoding; multi-result Search needs the entitlement (owner, Neshan panel).

## Next unblocked task

D: unify the evidence labels (`routed/model/assumption/unknown` in trip, `known/unknown/stale` in food, `resolved/unresolved/quarantined` in shop) behind one shared chip component in `apps/miniapp/ui/`.
