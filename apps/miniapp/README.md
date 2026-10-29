# Besrah Mini App — multi-service discovery

The HM7 Commerce runtime stays vendored and unmodified. This is a vanilla ES-module frontend with a strict same-origin CSP, local fonts and hand-drawn SVG service branding. No external CDN, added framework or build dependency.

## Product boundaries

- Global home: city/brand banner, service tiles, names and availability. No train board, station rail, station history or automatic location request.
- **ریل / Rail** (`metro`): line 1 and line 2, on-device nearest station, station search, route lists, station favourites and arrival boards. Exact timing is an estimate, not live train position. All data/engine logic is unchanged by this UI release.
- **کاروان / Caravan** (`bus`), **راهیاب / Rahyab** (`route`), **سوار / Savar** (`taxi`): clearly marked unavailable. Tapping shows an explanation, never a fake working screen.
- Global search (`ui/service-search.js`) only searches service names/categories. Station search (`ui/searchbox.js`) is inside Rail.
- Global tabs: home, saved services, services (central hub), settings, about. Station favourites remain inside Rail. Back returns to the actual origin and restores scroll/focus; native Forward restores route state.

## Code map

- `services.js`: one service registry; names, SVG paths, copy, status and actions.
- `navigation.js`: pure indexed history; nested views map to the services tab.
- `service-store.js`: separate versioned product-saves store. `store.js`: original station data/preferences, unchanged.
- `views/home.js`, `views/services.js`, `views/saved.js`: product discovery.
- `views/metro.js`: metro workspace wrapping the existing stations view and hero state helpers.
- `views/settings.js`: original theme/sound/haptic controls. `views/about.js`: product/privacy disclosure.
- `ui/service-card.js`: shared cards and vector branding; no per-render subscriptions.
- `assets/services/{rail,caravan,rahyab,savar}.svg`: original service illustrations. `assets/hero-brand.svg`: city illustration with no rail focus.
- `app.css`, `skin.css`: app layout and brand skin. `vendor/hm7/**`: do not edit.
- Server asset allowlist: `packages/core/src/miniapp.ts`. Every new module/SVG must be registered.

## Device-only storage and privacy

Existing station records are preserved: `besrah:recents`, `besrah:favs`, `besrah:last`, `besrah:theme`. New `besrah:services:v1` stores only product identifiers; it never overwrites station favourites. HM7 owns its sound/haptic preferences. No coordinates are persisted or sent to the API. Clearing site data removes local preferences/saves. The in-app disclosure and bot `/privacy` both disclose the service identifiers.

## Performance and accessibility

No pointer-follow light, reveal layer, multi-layer blur, infinite animation or backdrop-filter on service cards. Preserve the single masked scroll-edge under the header. SVGs are local and lightweight; no font dependency inside logos. Support dark/light, reduced motion, visible keyboard focus and 44px controls. Unavailable labels remain legible rather than dimmed below contrast requirements.

## Verification

```sh
npm --prefix packages/core test
npm --prefix packages/core run typecheck
npm --prefix packages/core run build
node --test apps/miniapp/*.test.mjs tests/n8n/*.test.mjs tests/data/*.test.mjs
```

Browser acceptance: 360/390/768/1440px × both themes × home/services/metro/saved/settings/about; no overflow, missing images, JS errors, external requests or CSP violations. Check nested Back/Forward, station sheets, service persistence, old station favourites, global-vs-metro search and themes. Validate populated metro boards using a fixed-time query on a spare local core only; the public edge continues to reject `at`.

## Deployment

Public `https://besrah.arklyn.ir/` maps to `/app/` on loopback core 3080. Take a private backup of `/srv/besrah/apps/miniapp` and `packages/core/dist`; run all checks before rsync/restart. Keep data and timing code unchanged. Read back live assets/API and verify the public browser, not only localhost. A Chromium pass is not a physical Telegram-client sign-off.
