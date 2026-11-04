# R3-A Unified Metro Implementation Plan

**Goal:** Deliver a real loopback-only unified Metro preview, preserving useful station, board and tracker capabilities without another parallel Beta section.
**Spec:** Owner documents `BESRAH-METRO-UNIFIED-ROADMAP.md` and `BESRAH-R3A-HERMES-UNIFIED-METRO-PROMPT.md` received in this conversation.
**Architecture:** Preserve vanilla modules, HM7 tokens/AzarMehr, immutable R1/R2a timetable engines and installed APIs. One route-local selection model connects journey endpoints to the current-time station board; tracker is contextual detail and explicitly not a future journey prediction.

## Global constraints

- Branch `feature/r3a-unified-metro`, worktree `/root/projects/besrah-r3a`, base `7bb827c95e98ad3d5b6cc9f6882af3be4f081bf7`.
- Base reconciles with deployed reference `587accb6d92e4a93c468047745743b856c651804`: only documentation/hash evidence differs.
- No Production writes/restart, switch changes, public binding, new dependency, raw-data/network.json change or feedback writes.
- Keep `apps/miniapp/vendor/hm7`, home, global navigation and unrelated services intact; only narrow metro wiring may touch app.js.
- Test suites serial; Vitest `--maxWorkers=1 --no-file-parallelism`, Node `--test-concurrency=1`.

## Review focus

1. Selecting or swapping shared stations must not silently choose another line or leave a stale board response.
2. A future journey time cannot be merged with the board/tracker's current-time clock.
3. Leaving, changing input, hiding route or receiving OFF must abort/ignore stale results and stop background work.
4. Station search, favourite toggles, board notes/directions and saved entry points must retain a real counterpart.
5. OFF and error states must preserve usable legacy Metro without a dead planner card; feedback must remain disabled.

## Tasks

- [ ] Preserve baseline: private source checkpoint and extraction rehearsal; protected file/mode/symlink inventories, Git HEAD/status/index, Production config hashes and unit PIDs.
- [ ] Read actual source, deployed code and state/fetch lifecycles; write feature inventory and short UX/wireflow BEFORE UI edits. Assign KEEP/MERGE/UPGRADE/UNKNOWN; no unsupported deprecation.
- [ ] TDD vertical integration slices: shared selection and board, journey embedded flow, contextual tracker, entry-point parity, cancellation and errors. Scope CSS to Metro and keep engine/API contracts unchanged.
- [ ] Build isolated preview runner using real `buildServer` with `switchFile:null`, `feedbackDir:null`, loopback binding and normal admission limits. Exercise ON/OFF/strict from actual HTTP processes. Never reuse the old feedback-enabled preview harness.
- [ ] Browser before/after evidence: real local engine; widths 320/360/390/768 (plus desktop verification), both themes, reduced motion, text scaling, overflow/contrast and click flows. Fixtures explicitly labelled and used only for error/edge states.
- [ ] Execute final UI/Core/Node/Python regressions, legacy API comparison on preview and protected-state check. Report exact executed suites and any skipped criterion.
- [ ] Write migration ledger, completion report, runnable preview instructions; independently review code and run regressions after fixes. Create bounded review commits, bundle/restore verification, shareable docs/screenshots ZIP. Stop before deployment and human phone QA.

## Baseline evidence

Checkpoint pointer: `/root/.hermes/cache/scratch/r3a-ck.txt`. Restore rehearsal proved 634 source entries equal excluding the `.git` worktree pointer intentionally absent from the archive. Existing worktrees untouched. Baseline Core: 506 tests / 40 files; Mini App: 152 tests. These are baseline results, not final unified UI verification.

## Execution choice

Owner supplied a detailed execution specification and explicitly requires implementation rather than stopping at design; no further product-choice gate is introduced. An isolated implementation worker owns only Metro UI/parity documents while the parent owns the runner, protected-state verification, real browser QA, regression and delivery. No broad rewrite or new framework.
