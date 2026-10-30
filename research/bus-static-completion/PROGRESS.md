# Static bus data completion record

Plan: `docs/superpowers/plans/2026-10-30-bus-static-completion.md`.

- Task 1 completed: independent full-snapshot audit; parent checked all artifact hashes, source DB hash and SQL boarding-name/point availability.
- Task 2 bounded research completed: no current official census/feed obtained. Dated original news leads and access failures retained. Official citywide completeness remains blocked, not completed.
- Task 3 data projection produced: all known raw line/variant/stop/platform/geometry records assembled under `data/bus/guide/`; no product/runtime code or raw DB edits. Two display-only labels have exact explicit source-language/facility-alias evidence. A new full-source integrity test passed.
- Ruling: preserve raw missing/incorrect source values; use explicit labelled display derivations rather than silently rewriting canonical evidence.
- Ruling: preserve disconnected/unoriented road pieces and source member order. No synthetic return variant, connector, physical-stop deduplication or routing claim.
- Ruling: keep news refs 832/833, document refs and platform hints in reconciliation/research, not operational lines. A dated aggregate is not a current census denominator.
- Parent follow-up: downloaded the separately discovered PDF; it differs from the old 2019 copy, has 19 pages and a 2024 creation timestamp, but no cover validity date. Extracted numeric reference mentions remain research-only.
- Fresh data review completed with two findings. Both were reproduced and fixed: all raw members now explicit (including unclassified non-stop evidence), and safety/cardinality/audit checks reject all five originally accepted mutations plus a raw-member deletion. The guide integrity suite passes 7/7. Original review is preserved; resolution is recorded separately.
- Final post-fix verification passed: 56 core tests, 132 Node tests, 17 Python tests (205 total), and typecheck. Serial bounded-worker execution was used after kernel-confirmed host OOM; no suite was skipped and no production service was restarted.
- Task 4 remaining: scoped commit/readback and verified archive delivery. This does not close the unresolved citywide source gap.
