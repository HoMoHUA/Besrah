# Metro 2026-11-05 — field-data integration (candidate; NOT deployed)

## Source and verified boundary

Owner supplied `hermes-update-2026-11-05.zip` (uploaded as `hermes-update-2026-11-05(1).zip`). All entries listed in its `CHECKSUMS.sha256` were verified against extracted bytes before integration.

The ZIP was built for an **older Mashhad-Waze layout**, so its entire `engine.ts`/`service.ts`/`network.json` must **not** be copied over Besrah's current Core. This branch cherry-picks measured data and adds an independently validated Thursday overlay while preserving the existing normal-day NET01 overlay, line 2 and Friday baseline.

The two Nov 5 raw CSVs and the correction ledger are held in the owner-provided ZIP; source provenance hashes and the derived schedule are recorded in `data/timetable/thursday-2026-11-05-field-v1.json`. Raw ride logs, images, personal observations and infrastructure configuration were **not** published in this GitHub branch.

## What is applied in code (line 1, Thursdays)

1. `data/network.json` adds `lines.1.thursday_2026-11-05` and a Thursday-only extension evidence block, without removing Oct 22 or the existing line-2 data.
2. `network.forDay(..., 'thursday')` overlays new Nov 5 segment measurements over Oct 22, for Thursday **only**. It uses the separately measured 23 forward runs and 14 backward runs (segments 0–8 and 18–22), the explicit station dwell observations and Thursday-only layovers: airport 907s, Ghadir A 216s, Ghadir B pass 33s. Missing runs remain extrapolations with Thursday/Friday factor 1.005; **not measured**.
3. `thursday-field.ts` reads the versioned Thursday evidence and the previously committed Kowsar airport-service sheet; it builds **one** Vakilabad physical departure sequence. Its candidate lattice is every 10 minutes from 06:15:17, with sheet-derived B departures occupying corresponding slots and other slots assigned A. A 06:00:17 B departure comes from the sheet, not the lattice.
4. `timetable-overlay.createTimetableModel()` applies this Thursday schedule alongside the unchanged normal-day overlay, and mixes the two Thursday source byte streams into the model fingerprint. Thus board, tracker and journey planner use the same model identity. If Thursday evidence is unavailable or malformed, the old Thursday model is retained with a warning rather than partially applying a corrupt schedule.
5. Confidence is scoped: B is **sheet-derived**, A is **generalized/extrapolated** except the independently timed Nov 5 16:55:17 A departure on its actual service date. This is a **timetable model**, not live train GPS.

**Important uncertainty:** A's all-day 10-minute lattice was generalized from limited observed Thursday departures and is contradicted by an older Nov 5 board sample. The 907s airport layover is from one observed train. Neither may be described as validated operator policy or current real-time service. An additional field survey is needed before the claim becomes stronger.

## Line 3 (data only, NO engine activation)

The ZIP's Nov 5 paper timetable transcriptions are staged at:

- `data/official/line3_bassij_board_2026-11-05.json`
- `data/official/line3_board_bab_aljavad_2026-11-05.json`

`data/network.json` now also preserves the owner-reported open portion: Terminal, Bassij, Bab al-Jawad, Shohada open; 15 Khordad, Chaharrah Danesh, Sharestan not open. Service S (Shohada ↔ Bab al-Jawad) and Service T (Terminal ↔ Bab al-Jawad via Bassij) are separate, not a single through train. Board inconsistencies, an unphotographed holiday Shohada schedule and one handwritten end-of-day row are unresolved; line 3 is **not** fed to `engine.ts` or a public journey ETA.

## Compatibility and release gates

- `main` and Production unchanged by this branch.
- Normal-day NET01 timetable, Friday timetable and line-2 model remain untouched.
- Existing geospatial D2 mission registry and offline HTML source fingerprint are regenerated to account for the data-network SHA change; no new geospatial observations were fabricated.
- CI: `npm run typecheck`, `npm run build`, Core Vitest, MiniApp node tests, Python data/release/shop suites and Node integration tests.
- Prior to production: obtain explicit `PRODUCTION_DEPLOY_GO`, create a **new** hash-pinned release plan, verify stage snapshots and rollback, test on real Android 10 Telegram, compare line-1 Thursday board/event IDs and trip parity via actual HTTP, inspect coverage of the new model and explain inferred timings honestly.

This branch does not authorize a Production deployment. Older deployment GO tokens are not reusable.
