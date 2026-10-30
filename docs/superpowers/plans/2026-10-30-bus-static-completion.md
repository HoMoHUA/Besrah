# Mashhad Static Bus Data Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and validate the available static line/route/stop information before app guide work, while identifying rather than inventing unsupported city coverage.

**Architecture:** Keep the original OSM snapshot and SQLite catalogue immutable during discovery. Independent current-source research and read-only per-variant auditing produce bounded evidence and a reconciliation queue. Any subsequent supported enrichment must preserve its own source namespace, retrieval/version information and original values; it must not silently overwrite the OSM observations.

**Tech Stack:** Existing Python standard-library/sqlite3 pipeline, JSON/CSV evidence, existing Node/Vitest/Python regression suites; no new dependencies.

**Spec:** The owner's approved priority is static line data first, then line/route/station guides; ETA research is deferred. Existing invariants are in `data/bus/README.md` and the bus catalogue operations reference.

## Global Constraints

- No app/UI changes, bus activation, live-arrival probing, metro timing changes, production deployment, service restarts, proxy changes or subscriptions.
- Preserve raw source IDs, refs, punctuation, whitespace, stop/platform roles, repeated visits and member indices.
- No synthetic reverse direction, endpoint, coordinate, terminal, connector, operating status, headway or ETA.
- Historical/undated third-party rows remain quarantined; upload dates do not establish data currency.
- A verified current official denominator is required for a claim that all operating Mashhad lines are covered.
- OSM data attribution and ODbL stay attached to derived data. Full third-party captures remain local/ignored; public evidence excerpts remain bounded.
- Temporary work uses `/root/.hermes/cache/scratch`.

## Review Focus

- One or many variants are not automatically one or two travel directions; loops and aliases need explicit treatment.
- Missing endpoint metadata must not be filled from a nearby stop or guessed from another variant.
- An area/linear platform is not a verified boarding-point coordinate; stop and platform elements are not automatically deduplicated.
- Unstitched OSM road segments are not a direction-verified navigable trip; gaps must remain visible.
- An observed platform route-ref hint, historic table row or matching name is not proof of an active line or official identity.

## Task 1: Audit every existing line and variant

**Files:** Read `data/bus/mashhad-bus.sqlite`; write only `research/bus-static-completion/audit/`.

**Interfaces:** Input is the SQLite schema in `scripts/bus_catalog.py`. Output is a per-route/per-line metrics JSON/CSV plus definitions and a concise audit note.

- [ ] Verify the SQLite SHA-256 against `data/bus/exports/summary.json`, open with `mode=ro`, and preserve the same hash afterwards.
- [ ] Enumerate every line and variant, endpoint/name gaps, source-ordered stop/platform membership, coordinate/name gaps and geometry availability.
- [ ] Report reciprocal endpoint candidates and geometry connectivity concerns without turning them into verified directions or repairs.
- [ ] Reconcile declared totals against full enumerated rows programmatically.

## Task 2: Obtain current static authoritative evidence

**Files:** Read existing source research; write only `research/bus-static-completion/sources/`.

**Interfaces:** Output records contain URL, retrieval time, HTTP/access result, hash where available, source publisher, scope, source-version date where available and confidence/limitations.

- [ ] Search current official published line catalogues, downloads, route/station feeds and public static maps, avoiding ETA endpoints.
- [ ] Reuse previous failed-access and historical-source findings rather than treating them as newly verified data.
- [ ] Preserve any usable current official denominator and each source's actual scope, or explicitly record that it is unavailable.
- [ ] Keep bounded source facts separate from full local captures; do not reuse provider credentials or bypass access controls.

## Task 3: Reconcile supported facts and unresolved gaps

**Files:** Write `research/bus-static-completion/` reconciliation records; any data-layer change is conditional on received evidence and must have regression tests first.

**Interfaces:** Consume Task 1 metrics and Task 2 evidence. Produce an explicit supported-change list and unresolved queue keyed by literal source IDs/refs.

- [ ] Compare source-supported route identity, endpoints, stops, geometry and terminal candidates without automatic alias merging.
- [ ] For each proposed correction, record before/after, source and quality; leave unsupported values null/unknown.
- [ ] If a generator/importer must change, reproduce the exact issue with a failing fixture test first, implement the minimal correction and verify the complete snapshot.
- [ ] Keep current official completeness unknown unless a current authoritative source actually establishes it.

## Task 4: Verify and deliver the data result

**Files:** Update data documentation only to reflect actual verified output; publish no runtime changes.

- [ ] Validate all input/output hashes, SQLite integrity/FKs, sequences and preserved raw tokens.
- [ ] Run `npm --prefix packages/core test` and `npm --prefix packages/core run typecheck`.
- [ ] Run `node --test apps/miniapp/*.test.mjs tests/n8n/*.test.mjs tests/data/*.test.mjs`.
- [ ] Run `python3 -W error::ResourceWarning -m unittest discover -s tests/data -p 'test_bus_catalog.py' -v` and any new data tests.
- [ ] Stage only intended data/research/tests/docs changes, scan for secrets, commit/push and read back the exact remote target.
- [ ] Report precisely what was completed and what source gaps remain; do not call source omissions a complete city network.
