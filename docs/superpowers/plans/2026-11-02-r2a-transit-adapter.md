# R2a Transit Adapter Implementation Plan

> **For agentic workers:** Use executing-plans for native implementation; the owner has explicitly authorized execution of this specification. Implement vertical RED/GREEN slices and keep all work in the new R2a worktree.

**Goal:** Solve bounded, same-line platform-to-platform journeys using the existing modeled Metro 1/2 timetable and feed honest candidates into the approved Intelligence Core.

**Architecture:** Add internal TypeScript modules, not a service or public route. A bounded model source wraps unchanged `dayTrains(forDay(...))` and `line2DayTrains`; a pure normalizer separates physical stations, line membership and trip stop sequence; an asynchronous planner scans bounded service dates and hands bounded candidates to unchanged R1.

**Tech Stack:** Existing Node.js/TypeScript, Vitest, standard Node fs/crypto/timers only; no dependencies.

**Spec:** Owner R2a authorization, `docs/r1/R2-TRANSIT-ADAPTER-PROPOSAL.md`, `docs/r1/FOUNDATION-DESIGN.md`, `docs/r0/ARCHITECTURE-DECISIONS.md`.

## Global constraints

- Base `50dd9eea95509ae922a278495a9abb687fcb0988`, branch `feature/r2a-transit-station-planner`, worktree `/root/projects/besrah-r2a`; preserve dirty main and clean R1 and Production.
- No UI/HM7, public API, provider, LLM, memory persistence, deployment or R2b work.
- Preserve existing engines, APIs, raw network and R1 contracts. Source snapshots and timetable hashes describe models, never live GPS or verified fares.
- 192 MiB existing service limit is an integration constraint, not permission to raise limits or restart it.
- Maximum 64 stations, 32 stops/trip, 512 trips/service day, three service dates, six-hour query horizon, 64 output candidates, two cached line/date/type snapshots per source instance.
- Full suites run serially with a single worker. Benchmark separate child processes; never run load tests against Production.

## Review focus

1. An arriving train is boardable through modeled departure inclusive; a terminal arrival alone is not a new departure or a joined return trip.
2. Thursday must call `forDay` before `dayTrains`; A Ghadir cannot become an airport trip; travel ends at destination arrival, not terminal layover end.
3. Calendar unknown must not silently become normal. Strict mode requires source-backed per-date schedule declarations (Friday can be derived from weekday); optional explicit weekday-baseline mode is labeled incomplete because holidays are unverified.
4. Include prior service day only in the bounded possible spill window and next day only when the search crosses midnight; missing dates produce partial/insufficient data.
5. Candidate caps must retain earliest eligible arrivals, not merely earliest departures or an arbitrary ID prefix; all truncation and invalid source trips must be visible.

## Files and interfaces

Create `packages/core/src/transit-journey/{contracts,validation,calendar,registry,normalize,model-source,planner,index}.ts` and focused tests under `packages/core/tests/transit-journey/`.

- `createStationCatalog(stations, line1Order, line2Order, ghadirId): StationCatalog` validates unique physical IDs/names and exact line memberships.
- `resolveCalendar(date, policy): CalendarResolution` returns known, baseline-estimated, or unknown; no built-in holiday truth.
- `normalizeModelDay(raw, catalog): NormalizedDay` validates trip identity, date/line, direction, contiguous unique stop ordering, times, patterns and bounded source shape. Duplicate trip IDs invalidate all colliding records.
- `createModelSource(path?): TimetableSource` loads model once, fingerprints actual local runtime/network inputs, and implements async `getDay(line,date,dayType)` with a two-entry LRU, stats and explicit clear.
- `planJourney(request:unknown, source:TimetableSource): Promise<JourneyResult>` validates the request, chooses service dates, scans valid trips, checks boarding/departure, ranks bounded eligibility buckets, creates evidence and invokes `evaluateDecision`.
- R1 metrics remain unchanged. Candidate `durationSeconds` and `arrivalEpochSeconds` feed time comparison; waiting and in-vehicle time are additional journey metrics using R1 `NumericMetric` and Evidence, linked by candidate ID. Fare is unknown, walking not applicable, transfers known zero only for a complete same-trip itinerary.
- Journey trace includes service date, line, direction, A/B pattern, original train ID, namespaced trip ID and ordered stop sequence plus physical station IDs and line indices.

## Task 1 — Catalog and calendar

- [x] RED/GREEN physical Shariati membership on both lines but one ID; duplicate IDs/names and missing membership are rejected.
- [x] RED/GREEN strict calendar missing day, actual Friday, Thursday, explicit holiday override and explicit weekday-baseline caveat. Reject malformed date/offset/clock and contradictory day type declarations.
- [x] Implement contracts, catalog and calendar with bounded runtime validation; record concrete policy decisions.

## Task 2 — One working journey and real model source

- [x] RED/GREEN synthetic complete trip with origin departure after platform-ready time; validate evidence and unchanged R1 input.
- [x] RED/GREEN model source calls existing raw engines and Thursday overrides; cache bound/eviction/no exposed mutation.
- [x] Normalize real physical IDs using existing network station names; never reuse a stop index as physical station ID.
- [x] RED/GREEN both real lines at fixed dates, preserving confidence/quality/source fingerprint.

## Task 3 — Journey edge cases and independent oracle

- [x] RED/GREEN dwelling boardable, missed departure, exact departure boundary, reverse direction, last train, terminal return departure and Ghadir/airport differences.
- [x] RED/GREEN unknown/malformed source records, duplicate trains, repeated/misordered stops, no path, horizon/candidate caps and denied permission.
- [x] RED/GREEN service-day spill across midnight, unknown calendar and explicit normal/Thursday/Friday timetable differences.
- [x] Compare against an independently written exhaustive stop-pair oracle on small generated timetables; no reuse of planner filtering or ranking helpers in the oracle.

## Task 4 — CLI and measurements

- [x] Add internal `scripts/demo-transit-journey.mjs`, CLI argument validation, fixed real-model examples, and separate `scripts/benchmark-transit-journey.mjs`.
- [x] Measure cold model construction, cold/warm adapter time, R1 evaluation, cache capacity and process RSS/heap separately; exercise dates/lines and invalidated-cache churn.
- [x] In an isolated loopback process, compare existing Metro API latency/event-loop heartbeat with and without asynchronous planner work. Preserve public server/API source and do not expose the adapter as a route.
- [x] Verify cgroup/process memory constraints where permitted; disclose if only local process measurements, not 192 MiB cgroup assurance, are available.

## Task 5 — Review and delivery

- [x] Full serial baseline/regressions: core, Mini App/data/n8n, release Python, bus catalogue Python, generated bus check, typecheck and build.
- [x] Independent code review and concrete regression fixes; no invented benchmark results.
- [x] Topic commits; checkpoint/bundle recovery; byte inventories of main/R1/Production, index/status and unchanged protected paths.
- [x] Deliver `docs/r2a/R2a-COMPLETION-REPORT.md`, machine verification summary, real-model examples and remaining R2b/data/resource risks; stop without API/deployment approval.
