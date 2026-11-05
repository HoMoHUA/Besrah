# BESRAH — factual feature matrix (source versus Production)

**Updated:** 2026-11-05. The **main GitHub branch is not the VPS live commit**. All claims below are about source unless explicitly labelled as a historical deployment report. Do not assume any PR is live before its own release evidence.

| Capability | GitHub source | Production proof / next gate |
|---|---|---|
| Destination-first home, optional GPS as origin, manual fallback | Implemented | U7/U10 historically deployed; current phone QA required |
| Home time + (optional) location recommendations | Implemented | Needs real Android 10 QA |
| Explicit home need: coffee, sweets, gifts/flowers, everyday grocery | Phase 3–5 code; PR pending | Not deployed; no invented special occasions |
| Up to two end-to-end transit options and Neshan walking/car legs | Implemented | Only tested scope; not bus/metro/taxi optimization |
| Metro timetable model, board, tracker and station favorites | Implemented | Schedules are models, never live GPS |
| Interline transfer and verified internal station geometry | Not complete | Requires field geometry and real timings |
| Neshan multi-result search / direct map picker | Not complete | Search entitlement (485) and web map key unresolved |
| Food search over SnappFood/TapsiFood snapshots | Implemented | Private production data; snapshot not live |
| Food category separation: meals, café, sweets, bakery, flowers, grocery, produce, protein, nuts, other | Code merged in PR #1 | **Must rebuild private index**: prior importer excluded nonrestaurants |
| Food price comparisons through Intelligence Core | Implemented, scope limited to fresh equivalent menu items on one page | Snapshot older than TTL yields no “lowest” label; delivery cost unknown |
| Food preference categories and budget in profile | Implemented and opt-in | Consent required to sync cross-device |
| Saved marketplace merchants/products | On-device only | Source ready, not server-synced; user can remove |
| Saved tab integrates services + marketplace references | Phase 3–5 code; PR pending | Needs real device QA |
| Shopping curated offer comparison and source timestamps | Implemented on small catalog | Private catalog not included in public GitHub |
| Shopping offer variant verification and truthful listed-price label | Phase 3–5 code; PR pending | Existing source may have no fully verified variants; no claim of best final cost |
| Multi-source fresh shopping price and stock tracking | Not complete | Requires legitimate provider feeds + variant identity |
| Telegram Mini App profile, login, consent, export, deletion | Code built; reported U10 deployed | Real Android Telegram login QA outstanding |
| Mobile/email/Google/Bale login or multi-provider account linking | Not complete | Provider credentials, legal/privacy review |
| Intelligence Core for trip / shopping / food | Code built; food via PR #1 | Not fully deployed/verified with private Production data |
| Cross-channel memory/behavioral learning and lifecycle automation | Not complete | Requires explicit consent design + instrumentation |
| Weekly/monthly food subscription + authorized automatic ordering | Not complete | Needs seller/provider authorization and checkout flow |
| Optional Web Push metro reminder | Code built | VAPID, HTTPS, real WebView and device confirmation required |
| Internal wallet/Bespay | Not built | Separate regulated/payment-provider integration |
| CI Core/MiniApp/Node/Python | GitHub Actions running after PR #1 | Private archives and VPS integrations explicitly not reproducible in public CI |

## Acceptance rule

A feature is **complete for users** only after code, tests, real source data, accessible UI, real-device QA, production release, rollback and observed operation. An uploaded doc, a green fixture test, or a GitHub merge alone does not meet this definition.

See `BESRAH-MASTER-SPEC.md`, `CHATGPT-PHASE0-2-DELIVERY.md`, `CHATGPT-PHASE3-5-DELIVERY.md` and `docs/sprint/HANDOFF-FINAL.md`.
