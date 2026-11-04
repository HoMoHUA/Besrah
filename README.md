# بِسراه | Besrah

**Besrah** is a Mashhad-first, Persian RTL everyday-services assistant for **Transit, Besfood (Food), and Shopping**. It compares realistic choices using time, total cost, evidence quality and user-controlled preferences. The interface uses **HM7 / AzarMehr** and links users to original providers where transactions happen. It is **not** a metro-only app or a student-only product.

**Status at the 2026-11-04 handoff:** U7 (all three domains) was reported deployed at `https://besrah.arklyn.ir/`. U8 food-ranking improvements are present in this source tree but were **not deployed** at the handoff. Check the actual live release and Git HEAD before treating any dated report as current. The public `main` is a sanitized source snapshot, **not** the production commit or server worktree.

## Cloud development / Opus

- **Start here:** [`OPUS55-CLOUD-MISSION.md`](OPUS55-CLOUD-MISSION.md), with [`CLAUDE.md`](CLAUDE.md) as the active instruction entry point. The historical Mashhad-Waze Phase 0 brief in `CLAUDE.md` is explicitly archived.
- **Handoff:** [`docs/sprint/HANDOFF-FINAL.md`](docs/sprint/HANDOFF-FINAL.md), [`docs/sprint/DECISIONS-AND-BACKLOG.md`](docs/sprint/DECISIONS-AND-BACKLOG.md), [`docs/sprint/ARCHITECTURE-AND-API.md`](docs/sprint/ARCHITECTURE-AND-API.md), [`docs/sprint/DATA-SOURCES-AND-LICENSES.md`](docs/sprint/DATA-SOURCES-AND-LICENSES.md).
- **Workflow:** inspect actual code → implement → run relevant tests → commit to a **feature branch** → push / open a **Pull Request**. Do not merge or deploy without owner authorization.
- **Progress:** cloud agents should maintain `docs/opus55/PROGRESS.md` on their feature branch. It will not appear on `main` until merged.
- **Security:** no provider keys, .env values, private conversation archives, live user locations or unauthorized provider datasets in commits.

## Development

Node.js **20+**. Run from repository root:

```sh
cd packages/core
npm ci
npm test
npm run typecheck
npm run build
npm start
```

The core API defaults to `127.0.0.1:3080`. See [`packages/core/README.md`](packages/core/README.md) and [`docs/sprint/ARCHITECTURE-AND-API.md`](docs/sprint/ARCHITECTURE-AND-API.md). Mini App and data test commands are documented in the sprint handoff and repository tests.

**Data limits in this public repository:** the production food index `data/food/food-index-v1.json.gz`, shop catalog `data/shop/catalog-v1.json` and private vendor database `research/vendors.sqlite` are deliberately excluded. Some integration tests **skip** when these are absent; they are not a full Production dataset validation. Do not commit regenerated copies or claim live/complete product-market coverage.

## Interfaces and deployments

- **Web / Telegram Mini App:** `apps/miniapp/`, preserving the existing metro board/tracker, bus guide and all three services.
- **Telegram bot / n8n:** `integrations/n8n/` and `deploy/README.md`. No tokens or live workflows should be committed.
- **Release status and rollback:** `docs/sprint/U7-DEPLOY-REPORT.md` and `docs/sprint/RELEASE-RUNBOOK.md`. Cloud development is not authorization to change production.

## Historical origin

The codebase originated as **Mashhad-Waze** (2026-10-29); older technical and field notes remain in `HANDOFF.md`, `docs/FINDINGS.md` and `docs/FIRST_PROMPT.md`. These are valuable historical references, **not current onboarding commands**. In particular, do not run an initial `git init` in this existing GitHub repository.
