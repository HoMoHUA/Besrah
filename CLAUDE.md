# Mashhad-Waze — project brief for Claude Code

## Mission
Fast multimodal trip assistant for Mashhad. The differentiator: it does not just show "public transit" or "taxi" like Neshan/Google; it computes **combined routes** (metro + walking + ride-hailing for a leg) and picks the fastest/cheapest given live-ish conditions (e.g. Friday-evening traffic makes metro to Kowsar + walk beat a direct Snapp ride).
Long-term goal: pitch to Mashhad Innovation Park and Mashhad Municipality as a city platform. Treat it like a startup product.
Surfaces (in order): Telegram bot (n8n, exists, v0) -> web app/PWA -> Bale/other messengers -> deep links/integration with Snapp/Tapsi.

## Owner
Hojjat. WordPress/WooCommerce developer; reads and writes Persian. **Reply in Persian** (code, identifiers, commit messages in English).
Strict constraint: Iranian intranet environment, **no external CDN**, self-hosted fonts (Vazirmatn), inline SVG, everything must run on his own VPS.
n8n already runs on his VPS. He prefers JS/TS and PHP over exotic stacks.

## Current state (2026-10-29)
- Phase 0 (metro core) is done in `packages/core`: time, network loader, engine (schedules, trips, nextPasses), Fastify API `GET /v1/next`, Persian bot text. 27 tests pass (`npm test`), typecheck passes.
- n8n is NOT yet rewired on the VPS. Replacement steps are in `packages/core/README.md` (HTTP Request -> IF -> Telegram). Time-AI, Time-Cal, Metro-Text must be removed.
- Friday 2026-10-16: golden-tested (A: Vakilabad 13:59:51 -> Shariati 14:29:43, Ghadir 14:40:28; B passes Ghadir within 22 s of the printed sheet).
- Thursday 2026-10-22: one partial train (`data/field/2026-10-22_line1_thursday_kowsar-vakilabad-ghadir.csv`). B phase :05:17 mod 30 (sheet + board). Vakilabad turnaround 119 s observed (the 431 s Friday value is day-specific). Thursday block in `network.json`.
- Normal days: site JSON headways (A 15 / 10.9 / 10, B 30), phase NOT measured (low confidence). Sheet's 24-min normal-day alternative is kept in `data/official` but not used.
- Buses: `packages/core/src/bus/osm.ts` converts Overpass `route=bus` output into `data/bus/lines.json`. Run `scripts/overpass/bus_mashhad.overpassql` on the VPS (Overpass is blocked in the build sandbox). Headways are unknown for all bus lines.
- Routing engine (walking/driving) is on hold by the owner. Neshan docs were not readable (robots); only search snippets were seen.
- Line 2 is not in the engine yet (only field data for Shariati->Fakouri and the legacy travel times).
- Full handoff: `HANDOFF.md`.

## Repo layout
- `data/network.json`  single source of truth (stations, coordinates, segment run times, dwell, terminals, services, derived estimates, open questions). Every number has a `quality` tag: measured / legacy_estimate / derived / hypothesis.
- `data/official/`      official site JSON (headways) + transcription of the printed airport-route sheet. Official headways are *averages*.
- `data/field/`         raw operator logs (never edit) + `corrections.json` (documented mis-taps).
- `packages/core/`      TypeScript engine + HTTP API (Phase 0). See its README.
- `data/bus/`           bus lines from OSM (after running the Overpass query on the VPS).
- `tools/`              original field logger (metro-logger.html) and the network generator (build_network.py).
- `data/anchors.json`   phase anchors for generating concrete departure times.
- `docs/FINDINGS.md`    what we learned; `docs/ROADMAP.md`; `docs/TASKS.md`.

## Domain model (important)
Line 1 has 24 stations: Vakilabad(terminal) ... Ghadir ... Bustan-e Reyhaneh, Airport. Two services share Vakilabad-Ghadir:
- **A (shuttle)**: Vakilabad <-> Ghadir.
- **B (airport through-service)**: Vakilabad <-> Airport via Ghadir and Bustan-e Reyhaneh. Hypothesis, well supported (see network.json evidence).
Official "main route" headway = combined A+B. Friday: 12 = 1/24+1/24. Weekday off-peak: 10 = 1/15+1/30 (the old "1 of 3 trains goes to airport" rule is valid on weekdays only).
Terminals: trains do not cross over by points; they loop on track, so terminal entry/exit segments are ~2x slower (about 16 km/h vs ~40 km/h average) and layover is about 7 min (Ghadir total 442 s measured; Vakilabad ~430 s derived). Fakouri (Line 2) now has two platforms (total layover ~358 s).
Times: Iran uses Asia/Tehran (+03:30; no DST now) — **never use server-local time** (v0 bug).
Operator reaction error ~ +-5 s per timestamp.

## What to build first (Phase 0/1)
1. TypeScript (Node >=20), strict mode, vitest. No framework in the core package.
2. `packages/core`: zod schema + validator for `data/network.json`; clock module (Asia/Tehran, day type: friday / thursday / normal; holidays config file, initially empty).
3. `nextDepartures({ stationId, at, limit })` -> list of { line, service, towardStation, departAt, etaSeconds, confidence }. Generate departures at origin terminals from headway/anchors, propagate with cumulative run+dwell per station and direction. Use measured values where present, else legacy estimates (lower confidence).
4. Golden tests from `data/field/*.csv`: the engine, anchored to the Friday patterns, must reproduce observed pass times (A service: Vakilabad depart 13:59:51 reaches Shariati 14:29:44, Ghadir 14:40:34) within +-30 s, and must reproduce the sheet's Friday Ghadir pass times for service B.
5. Thin HTTP API (Fastify) + replace n8n Time-Cal with an HTTP Request node calling it. n8n stays as the Telegram glue only.
6. Only after the above: routing (RAPTOR over the same network + walking graph from OSM), ride-hailing leg estimates.

## Rules
- Do not invent data. If something is not in `data/` and not stated by the user, ask (see `open_questions` in network.json). Mark any new estimate with a quality tag.
- Never edit raw files in `data/field/`; add entries to `corrections.json`.
- Persian user-facing strings, RTL, Vazirmatn; no CDN.
- Small commits, tests first for time logic; run tests before declaring done.
- Plan before large changes; ask Hojjat one concise question at a time when blocked.

## Known gaps (collect more field data before trusting)
Weekday/Thursday run times; return-direction Shariati->Vakilabad; Line 2 Tabarsi..Shariati (legacy only); Line 3 stations; extension Ghadir->Airport (derived only, ~9.5 min one way); buses (only approximate headways ever).
