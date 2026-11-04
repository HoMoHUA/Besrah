# R1 — Intelligence Core Foundation: design boundaries

This is a local, versioned TypeScript library inside the existing modular monolith. It is not a deployed service, a public API, a journey planner, a provider adapter, an authentication layer or an execution permission system.

## Location and dependency direction

`packages/core/src/intelligence/` depends only on its own contracts/helpers and ECMAScript built-ins. Existing transit, food, HTTP, UI, HM7 and data files are not imported or rewritten. The entry point is `evaluateDecision(unknown)`; it validates a complete request before evaluating any candidate. Typed helpers are also exported for testing and future integration.

```text
validated DecisionInput
  → request-scoped context + optional MemorySnapshot
  → permission gate
  → explicit preference resolution
  → availability + tri-state hard constraints
  → equivalence groups + complete objective sets
  → conservative Pareto frontier
  → optional explicit lexicographic priorities
  → scoped labels + evidence-linked explanation
  → at most one counterfactual-tested question
```

## Contracts and metric states

- Schema version is 1. Unknown versions and unsupported fields are rejected, not silently coerced.
- Domains: transit, food and shopping. Provider IDs and candidate IDs are caller-supplied stable identifiers; real identity mapping is an adapter responsibility in R2/later.
- Metrics: total cost in integer toman; durations/walking in seconds; transfers as count; arrival as epoch seconds; quality on an explicitly declared 0..100 scale. No conversion from arbitrary provider ratings is performed.
- `known` has a numeric value and evidence; `estimated` has a value and/or interval, evidence and explicit assumptions.
- `unknown`, `stale`, and `not_applicable` have reasons and cannot contain a usable numeric value. Known zero remains different from missing.
- Every usable metric has bounded source/evidence references and dataVersion. Derived evidence needs a method. Fixture evidence can never be live.
- Expired validity, future observations or future retrievals relative to the supplied request clock are unusable. No wall clock is consulted.
- An estimate interval is never replaced by its midpoint. A point estimate without an interval remains an estimate; no confidence interval is invented.
- Missing validity metadata is not a freshness certification. Real adapters must decide appropriate observation/expiry semantics; the library cannot detect an unreported provider cache or a falsely supplied known value.

## Constraints and decision policy

- Constraint checks are `satisfied`, `violated`, or `undetermined`; unknown is not compliant.
- Hard numerical bounds, availability and decisionPermission gate preferences. `requireKnown` is available when estimates must not satisfy a constraint.
- Interval checks are conservative: entirely inside a limit can satisfy; entirely outside can violate; crossing a bound is undetermined.
- No account is needed. A supplied decisionPermission describes a trusted caller's recommendation policy, not proof of server identity, payment authorization, or a user-granted provider capability.
- Cross-domain/task candidates are excluded from that request. Different equivalenceKey groups are never ranked against one another.
- Pareto comparison uses one complete declared objective set per group; it never compares each pair only on whichever fields happen to overlap. Incomplete candidates are reported separately.
- Priorities are explicit lexicographic permutations of declared objectives, not hidden scores, weights or money-for-time conversion factors.
- Interval overlap cannot be resolved by a fabricated expected value. Equal objective representations are ties; tests define exactly when a secondary priority may be consulted.
- Multiple labels may attach to one option. No requirement for three cards. Options may be zero, one or many.
- Labels only claim within the supplied, eligible, equivalent group. They are not city-wide or provider-wide best claims. Incomplete groups retain provisional complete-evidence options but receive neither categorical Pareto labels nor cost/time superlatives.

## Preference and memory from the beginning

Preference and MemorySnapshot are first-class contracts, not placeholders for a distant server implementation.

- Each preference includes domain, device/request scope, provenance (explicit/inferred), confirmation, version, update/expiry, and separate storage/use consent.
- R1 consumes confirmed explicit preferences only. Inferred preferences remain representable but are not used for learning or ranking.
- Request overrides can be used once with storage denied. Nothing automatically writes them into memory.
- Request overrides outrank matching domain-device preferences, which outrank global-device preferences. Within one tier, the newest applicable update wins. Equally current conflicting orders are surfaced, not broken by ID or a guessed weight.
- Revoked/denied use consent, expiry, wrong request/domain, future updates and incomplete objective permutations cannot silently influence selection. Identical ordered inputs give identical output; ignored-preference diagnostics preserve input order rather than promising canonical serialization across reordered memory arrays.
- Pure memory operations create/update/delete/clear/revoke snapshots without mutating callers. Storage requires explicit storage consent and device scope, version progression and capacity bounds.
- This is a serializable, local-memory model with deterministic behavior. It does not wire localStorage into the current UI, persist files, authenticate a user, sync accounts, observe behavior, or infer consent.

## Explanation and one useful question

Numerical claims are copied only from usable metric values or interval endpoints and point back to candidate/metric/evidence IDs. No new savings, ETA, conversion or midpoint is generated by the explanation layer.

Questions simulate explicit priority answers against the actual existing candidates, using at most six objective-promotion orders (not all 720 permutations). The remaining declared order is preserved; this intentionally incomplete search may abstain rather than discover every possible lower-priority trade-off. A question is returned only when two tested selected candidate sets differ. It is suppressed for an active preference, missing evidence, insufficient alternatives, or non-equivalent groups. The orchestrator also suppresses questions when eligibility is unresolved. A useful question may be declined; anonymous evaluation remains valid.

## Bounded work

Input caps: 128 candidates, 6 objectives, 16 constraints, 64 stored preferences and 64 request preferences, 8 evidence records per metric, and bounded text fields. Caps are checked before candidate comparison. No recursion, network retries, background loop, persistent cache or unbounded training history is part of the library.

Pareto comparison is quadratic in the bounded group size, with counters in the result. Counterfactual question work is also bounded by candidate/objective caps; the displayed pairComparisons counter describes the main Pareto pass, not every helper call. Runtime and process memory are measured by the local demo, not claimed as a guaranteed service SLO or a strict V8 allocation ceiling.

## Executable experiment

Fixtures live under `packages/core/fixtures/intelligence/`, never under Mini App assets. Every case and evidence source is explicitly synthetic. The CLI only reads those fixtures and the compiled library:

```sh
npm --prefix packages/core run build
node scripts/demo-intelligence.mjs --scenario anonymous-question
node scripts/demo-intelligence.mjs --scenario request-override
node scripts/demo-intelligence.mjs --scenario hard-gates
node scripts/demo-intelligence.mjs --scenario anonymous-question --benchmark 100
```

The existing server does not register an intelligence route or serve fixture files. No provider, LLM, database or account is needed for these experiments.

## R2 proposal only

Add a thin adapter consuming existing `dayTrains`, `line2DayTrains` and timed stop epochs. Namespace trips by service date and retain canonical station IDs, boarding/departure semantics and source quality. Keep the existing engines and APIs unchanged. Begin station-to-station, then add a separately validated corridor with entrance/walking/transfer/fare evidence. Do not turn current bus topology into a timed quote. Do not derive a journey from rounded `/next` ETA or tracker pixel positions.

Real adapters must establish equivalent tasks, meaningful metric scopes, freshness, availability and permissions. R1 does not supply that missing evidence and is not authorization to implement R2 or deploy anything.
