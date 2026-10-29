# بِسراه (Besrah)

Mashhad multimodal transit assistant, imported from the Mashhad-Waze handoff dated 2026-10-29.

## Development

```sh
cd packages/core
npm ci
npm test
npm run typecheck
npm start
```

The API listens on `127.0.0.1:3080` by default. See `packages/core/README.md` for API usage and `HANDOFF.md` for data quality, known limitations, and the project handoff. Original package identifiers are preserved.

Private conversation archives in `session/` are retained locally and excluded from Git, along with dependencies and secrets. Raw field data is preserved unchanged.

## Telegram workflow

The product's Persian name is **بِسراه**. The dedicated bot is `@Besrahbot`.

```sh
node --test tests/n8n/*.test.mjs
node scripts/build-n8n-workflow.mjs
```

See `integrations/n8n/README.md` for behavior, service bounds and privacy limitations; see `deploy/README.md` for the verified runtime installation and activation/rotation procedures. Generated exports contain no credentials and remain inactive for safe re-import.

## Original project notes

بسته‌ی شروع پروژه برای Claude Code.

1. `CLAUDE.md` را Claude Code خودکار می‌خواند.
2. `data/network.json` منبع اصلی داده است.
3. `docs/FINDINGS.md` خلاصه‌ی یافته‌ها و ناهماهنگی‌های باز.
4. `docs/FIRST_PROMPT.md` متن اولین پیام برای Claude Code.

شروع:
```
cd mashhad-waze
git init && git add . && git commit -m "init: data + brief"
claude
```
بعد متن `docs/FIRST_PROMPT.md` را بچسبان.
