# Besrah Mini App

Dependency-free Persian RTL web client for the same-service transit API.

## Visual direction

Urban wayfinding / calm utility. Strong context fit, visual impact and implementation feasibility; restrained typography and a single accent keep consistency and performance risk low. The destination-grouped arrival board uses a transit-line spine instead of floating SaaS cards. Midnight teal, citron and paper surfaces; local Vazirmatn with a serif English Besrah wordmark. Restrained 8px-based spacing; no continuous motion.

## Run / deploy

From `packages/core`, `npm run build`, then run the existing core entry point. Deploy the entire `apps/miniapp` directory alongside `data` and `packages/core/dist`; URLs resolve relative to the module location, never the process working directory. Source and compiled modules both resolve three levels upward to the repository/runtime root.

- `/app` redirects to `/app/` (public proxy should canonicalize its own external mount).
- `/app/` serves HTML; CSS/JS/manifest/font/SDK and logo/icons have explicit fixed-file routes.
- `/app/api/stations` exposes canonical station metadata, real line-1 order, supportedLines `[1]`, maxNearestKm `10`.
- `/app/api/next` calls the exact handler used by `/v1/next` without loopback HTTP or altered timing logic.
- Relative client paths `api/stations` and `api/next` allow a proxy mount such as `/besrah/` mapped to `/app/`.

Brand assets `assets/logo.svg`, `assets/icon-192.png`, `assets/icon-512.png` are supplied separately by the brand owner. `assets/telegram-web-app.js` is the unmodified SDK downloaded from `https://telegram.org/js/telegram-web-app.js`; it is optional outside Telegram. Font is copied from the local Vazirmatn installation. No npm dependencies added.

## Privacy and freshness

Only explicit user interaction requests browser geolocation. Nearest lookup checks all stations locally, rejects distances beyond 10km and may return a line-2 station, which clearly has no arrival coverage. No coordinates are transmitted or persisted by app code. No identity claims are made from Telegram context. No service worker or cached timing data, no countdown based on the device clock, no auto-refresh. Every board includes the server-provided Tehran `as_of` time. Manual refresh clears the previous board and uses abort + request sequencing to prevent stale responses. Requests time out after 15 seconds.

## Verify

```sh
node --test apps/miniapp/logic.test.mjs
npm --prefix packages/core test
npm --prefix packages/core run typecheck
npm --prefix packages/core run build
```

Browser QA at 360/390/768/1440, Telegram client testing, proxy headers/rate limits and public deployment are the integrating owner's final gates. No services are restarted by this change.
