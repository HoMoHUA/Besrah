# Opus55 HANDOFF

## Architecture of the changes
- `packages/core/src/trip/coords.ts` (new): pure `parseCoordinates(text)` → `none | point | invalid`. Handles Persian/Arabic digits, `٫`/`،`, swapped lat/lon (unambiguous around Mashhad), and `geo:`, `@lat,lon`, `?q=`, `?ll=`, `#map=z/lat/lon`. Requires ≥3 decimals.
- `trip/neshan.ts`: `geocodeDetailed()` → `ok | no_match | failed(code)`; `geocode()` wraps it (old contract kept). A 485/401/403 denial is remembered for 1 h.
- `trip/routes.ts` `POST /app/api/places`: response gained `coordinates` (`none|ok|invalid|outside_coverage`), richer `geocoder` (`ok|no_match|outside_coverage|unavailable|not_enabled|not_configured|skipped`), `lines` on station places, `kind/precision:'coordinates'` places with `nearStation`. `q` up to 400 chars only when it parses as coordinates; text is still capped at 60. **API change:** `geocoder` was `'unavailable'` for "no key" and is now `'not_configured'`.
- `trip/plan.ts`: `TripOption.choice`; `distinctUnrouted()` for the no-router case.
- `apps/miniapp/views/trip.js`: station `<select>` (filled in `onShow` from `state.stations`), empty-state messages, card chain, certainty and delta lines. `views/shop.js`: `scopeLabel()`, source link. `app.css`: a few `tp-*`/`sh-*` rules.
- `food/search.ts`: `ageNote()`.
No new dependencies. No new served files (asset allowlist unchanged).

## Delivery
Branch `opus55/transit-place-input` is on HoMoHUA/Besrah, rebased on `main` @ `f1fe833`, with a PR against `main`. The earlier bundle/patches (based on `a53dbaf`) are obsolete.

## Setup / test
- `cd packages/core && npm ci && TMPDIR=$(mktemp -d) npx vitest run --maxWorkers=1 --no-file-parallelism` (`mktemp -d` gives 0700).
- Root: `node --test --test-concurrency=1 apps/miniapp/*.test.mjs`; `python3 -m unittest discover -s tests/shop -p "test_*.py"`.
- Repo hygiene note: `packages/core/node_modules` is a **tracked symlink** to `/root/projects/besrah-3d/...` (a server path). `npm ci` replaces it locally; this branch does not commit that change.

## Deploy / rollback
Nothing was deployed. Deploying needs a new `PRODUCTION_DEPLOY_GO` (RELEASE-RUNBOOK). Rollback = redeploy the previous dist. The `places` change is backward compatible except for the `geocoder` value noted above (only `views/trip.js` reads it).

## Accepted debt
- The certainty line counts assumption seconds per leg; very short legs (<30 s) are not listed.
- The station picker lists stations from `api/stations` order arrays; stations without coordinates are hidden.

## Next actions
1. Owner: review and merge the PR; re-check the trip screen on a phone.
2. D: one shared evidence-chip component; then bus+metro transfer design notes (needs measured Shariati transfer time) and validated live data (none available).
3. Shopping: a human picks more SKUs into `data/shop/manifest-v1.json`; run the importer on an allowed host (never commit `catalog-v1.json`).
