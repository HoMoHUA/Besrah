# Besrah Mini App (v2)

A super-app style home for the Besrah metro guide, built **entirely from the owner's HM7 Commerce design system**
(`design/hm7-commerce/`). Vanilla ES modules, no build step, no CDN, no npm dependencies. Persian RTL.

The layout follows the structure of a Snapp-style home (search, banner carousel, service tiles, a second row of
smaller tiles with a `+N` tile, a coloured-marker section heading with a horizontal rail, a five-tab bottom bar) but
**every element carries real data or an honest "not built yet" label** — no promotions, prices, ratings, counts or
countdowns exist anywhere in the app.

## What is real, and what is not

| Real (works today) | Not built (visibly inert, labelled «به زودی», never opens a screen) |
| --- | --- |
| Metro **line 1** arrival estimates per station, from the schedule model of the core (services A/B). **Not live GPS.** | Line 2 timing (line-2 stations are listed but disabled) |
| Station list and line-1 order from `GET api/stations` | Bus, taxi / ride-hailing links, combined routing |
| Search (Persian-aware), recent searches, favourites (names only) | Payments, prices, discounts, accounts, deep links |
| Nearest station: computed **on the device**, only after an explicit tap | Other messengers |
| Server time (`as_of`, Tehran) on every board + manual refresh | Telegram login (the Telegram identity is not read or trusted) |

The "+N" tile is derived from the roadmap list (`services.js`), not a hard-coded number.

## Run / deploy

From `packages/core`: `npm run build`, then run the existing core entry point. Deploy the **entire `apps/miniapp`
tree including `vendor/`** next to `data` and `packages/core/dist`; files resolve relative to the module location,
never the working directory.

* `/app` redirects to `/app/`; `/app/` and every other static file are served from a fixed allowlist (see CSP section).
* `/app/api/stations` — station metadata, real line-1 order, `supportedLines: [1]`, `maxNearestKm: 10`.
* `/app/api/next` — the exact handler of `/v1/next` (timing logic untouched).
* All client URLs are relative, so the public host root `https://besrah.arklyn.ir/` → `/app/` works unchanged (the legacy `/besrah/` mount on the n8n host now redirects).
* `assets/telegram-web-app.js` is the unmodified Telegram SDK; brand assets `logo.svg`, `icon-192.png`, `icon-512.png` come from the brand owner.

## Design rationale → HM7 components

| Screen part | HM7 component(s) | Notes |
| --- | --- | --- |
| Floating header | `Header` (`.cm-frost.cm-header`), `SearchField`, `Menus` (`HM7.morph`), `ProgressiveBlur` | Search is an ARIA combobox/listbox, 250 ms debounce, `<mark>` on the matched part, recents as `Chips`. The menu button morphs into a panel (theme choice, link to About). |
| Hero carousel | `Stage` (`.hm7-stage`, radius-32) + `.hm7-glass` dots/pause + `.hm7-btn--primary` | Scroll-snap, dots, auto-advance every 7 s at most, paused on hover/focus/touch/hidden tab/off screen/reduced motion, plus a pause button. Slides come from `hero.js` (real state only). |
| Service tiles | `CategoryLamps` (`.hm7-cc-btn`, `HM7.light`) | 3 large live tiles + 3 small inert tiles (`aria-disabled`, `Badges`) + a `+N` roadmap tile. Tiles are *actions*, so `data-hm7-toggle` (which sets `aria-pressed`) is deliberately not used. |
| How estimates work | `Surfaces` (`.cm-card.cm-wash`), `GlassReveal` (`.rv`), `Buttons` | One honest explanatory card; no promo widget. |
| «ایستگاه های خط ۱» rail | `.cm-*` tokens, horizontal scroll-snap row with `mask-image` edges (01-layout) | Real station order; the interchange station has a dashed ring and a screen-reader note. |
| Bottom bar | `BottomNav` (`HM7.lensTabs`, `.hm7-tabs`), `ProgressiveBlur` (bottom) | 5 destinations; «سرویس ها» is the centre item, emphasised only by a tinted glyph inside the lens mechanism. |
| Station sheet | `.cm-sheet` + `.cm-scrim`, `Skeleton`, `EmptyState`, `Toasts`, `IconMorph` heart (`HM7.shop.fav`), `HM7.shop.roll` | Dialog with focus trap/return; Escape, scrim, Back and Telegram BackButton close it. ETA digits roll on refresh. |
| Lists / tabs | `FluidTabs` (`.cm-tabs.tb-wrap`), `Chips`, `Badges`, `EmptyState` | Stations tab: route spine (line-1 order) or A–Z list. |
| Settings | `Switch` (`.sw-wrap`), `FluidTabs` | Sound/haptics are **off by default** and persisted by `HM7.sound` / `HM7.haptics` themselves. |
| Page changes | **View Transitions** (documented alternative to `PageTransition`) | Only `<main>` animates; header/nav keep their own transition names. Skipped under reduced motion. `PageTransition`'s absolute-positioned `.page` model does not fit a scrolling document. |
| Accessibility modes | `GlassModes` (automatic) | `prefers-reduced-transparency`, `prefers-contrast`, `forced-colors` are handled by the bundle; `skin.css` re-tints the high-contrast values. |

Documented components deliberately **not** used: `FlashDeal`, `PromoWidget`, `ProductCard`, `PriceRating`, `BuyBox`,
`QuantityStepper`, `CartLines`, `DropToCart`, `CheckoutSteps`, `PriceFilter` (commerce features Besrah does not have —
using them would show fake prices/promotions), `QuickActions`/`NavDock` (not needed), `EdgeLight` (no sidebar),
`FieldMotion`, `Radio`, `TextField` (the two inputs use the `SearchField` pattern).

### Themes and skinning

* `skin.css` is the only Besrah-specific colour file (README §«پوسته برای هر پروژه»), loaded **after `tokens.css` and
  before `bundle.css`**. Selectors are `:root[data-theme=…]` so they out-rank `bundle.css`, which re-declares
  `--accent-rgb`, `--hm7-rv-*`, `--hm7-sand-*`, `--hm7-solid` later in the cascade.
* **Dark (default, Salli precedent):** accent = citron `#D7FF63` on near-black teal `#061C1D`, `--on-accent` = midnight teal `#092D2E`.
* **Light:** chalk `#F3F5EF`, accent = deep teal `#0A5556`, `--on-accent` white; citron is never used as text on light.
* `--accent-rgb` and every dependent soft/hi/deep/reveal/sand token were re-derived and contrast-checked (table at the end of `skin.css`).
* **Stages** use a deep-teal family in both themes (`--hm7-cobalt*`), as the system keeps its stage colour theme-independent.
* Where `bundle.css` hard-codes cobalt (stage background end stop `#2225cf`, lilac ribbon, `.hm7-btn--primary` blue, violet glass shadow) `skin.css` overrides those rules with stage-local tokens (section "hard-coded cobalt"). The additive finger light / lamp bloom and the ribbon are capped because at full strength they bleached the stage under white text (measured 1.9:1).
* `data-theme` is set **before first paint** by `theme-boot.js` (preference > Telegram colour scheme, only inside Telegram > OS > dark) and updated on Telegram `themeChanged` and OS changes while the preference is «خودکار».
* Fonts: AzarMehr / HMSymbol / JetBrains Mono from `tokens.css`. The old Vazirmatn file was removed.

### Desktop

The app is a deliberate **phone-width column (max 480 px)** centred on a darker/lighter backdrop with two faint accent
glows. Header and bottom bar stay inside the column; the design system's "no bottom bar from 768 px" is intentionally
not followed because a Mini App has no desktop site to switch to.

## Honesty rules in code

* `hero.js` builds slides only from real state: before the user taps the location button the first slide is a call to action with **no numbers**; a station slide exists only if there is a last-viewed or favourite station; the note slide says "schedule estimate, not live" and quotes `as_of` only if a board was actually fetched.
* No countdown uses the device clock. ETA numbers are what the server returned at `as_of`; "refresh" fetches again. Optional auto-refresh (60 s) runs only while the station sheet is open and the document is visible, and uses `AbortController` + request sequencing (`async.js`) so stale responses are never rendered. Requests time out after 15 s.
* Coordinates exist only inside `locate()` in `app.js`; they are compared with the station list and dropped. Only the station *name* and the straight-line distance (in memory) survive. A line-2 nearest station is reported as "line 2 not built", with no times.
* `confidence` from the API is shown as a small label («بر پایهٔ جدول رسمی» / «برآورد از فاصلهٔ حرکت» / «زمان سنجی میدانی»), one per direction when all its trains agree.
* Labels such as «ورودی از …» are rendered exactly as the API provides.

## localStorage keys

| Key | Content |
| --- | --- |
| `besrah:recents` | up to 6 recently opened station **names** |
| `besrah:favs` | up to 24 favourite station **names** |
| `besrah:last` | last viewed station **name** (for the hero summary) |
| `besrah:theme` | `auto` / `light` / `dark` |
| `hm7-sound`, `hm7-haptics`, `hm7-haptics-strength` | written by the HM7 runtime itself |

Nothing else is stored; never coordinates, identity or tokens. Storage failures (private mode, quota) are tolerated.

## File map

```
index.html            static shell: header (search, menu), <main>, bottom nav, toast host, sheet root
theme-boot.js         sync, external: sets data-theme before paint; exposes BesrahTheme
skin.css              Besrah tokens for HM7 (dark + light + stage) and the few hard-coded-cobalt overrides
app.css               app-specific layout only (column, hero, tiles, rails, lists, sheet, view transitions)
app.js                entry: Telegram, theme, router, locate(), station/roadmap sheets, search wiring
tg.js                 defensive Telegram WebApp wrapper (ready/expand, colours, BackButton, haptics, themeChanged)
state.js              tiny observable state
logic.js              folding/normalize, nearestStation, groupPasses, requestPosition (original + tests)
search.js             ranking, highlight ranges, "ایستگاه" prefix, did-you-mean
store.js              recents/favourites/last/theme with injected storage and caps
async.js              request sequencer, debounce, linked timeout
api.js                same-origin client (relative URLs), error classification
format.js             Persian digits, ETA, as_of, distance, labels, board summary
route.js              line-1 spine / neighbours / rows
hero.js               hero slides from real state
services.js           services + roadmap data driving tiles, tab and sheet
ui/dom.js             h() builder (no innerHTML, no style attributes), focus trap
ui/hm7.js             glue to window.HM7 (init, roll, toast, haptics bridge)
ui/carousel.js        scroll-snap carousel + polite autoplay
ui/sheet.js           bottom-sheet host (dialog, history/Back, focus return)
ui/station.js         station sheet content (board, refresh, favourite, notes, spine)
ui/board.js           arrival board + skeleton, in-place digit roll
ui/searchbox.js       combobox/listbox search
views/*.js            home, stations, services, favourites, about
assets/               logo.svg, icons, hero-metro.svg (original illustration), telegram-web-app.js (unmodified SDK)
vendor/hm7/           design-system runtime, unmodified (tokens.css, components/bundle.*, fonts/)
*.test.mjs            node --test unit tests (pure logic, theme boot via vm, Telegram wrapper)
```

## CSP and server

`packages/core/src/miniapp.ts` serves a fixed allowlist (`MINIAPP_ASSETS`) with correct MIME types, `nosniff`,
`Cache-Control: no-cache` and a content-hash `ETag` (`If-None-Match` → `304`, so the 756 KB icon font and other heavy
files are revalidated, never re-downloaded, and updates are picked up immediately). Compression is left to nginx.
Unlisted and traversal paths return 404.

```
default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:;
connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org
```

The only change from the previous policy is `img-src … data:`. Measured reason: the vendored HM7 runtime builds its
dissolve/sweep masks at run time (`canvas.toDataURL()` → `mask-image: url(data:…)`), which fired CSP violations the
first time a toast dissolved. No `unsafe-inline` and no `unsafe-eval` anywhere; `data:` is not allowed for script,
style, font or connect. The app itself never produces inline styles: it uses classes and `element.style.setProperty`
(CSSOM, allowed). `tests/miniapp.test.ts` pins the exact header.

Note: inside Telegram Web (iframe mode) the Telegram SDK may try to inject a `<style>`; `style-src 'self'` blocks it,
which only affects Telegram's cosmetic scrollbar style.

## Telegram integration

`ready()`, `expand()`, `disableVerticalSwipes()` (7.7+, so dragging the sheet/page never minimises the app),
`setHeaderColor/BackgroundColor/BottomBarColor` from the resolved `--bg`, `BackButton` (shown while a sheet is open or
a tab other than home is active), `themeChanged`, `HapticFeedback` (only when the user enabled haptics; bridged from HM7
cues), safe-area insets via `env()` and the SDK's `--tg-*safe-area-inset-*` variables. Outside Telegram everything is a no-op.

## Verify

```sh
node --test apps/miniapp/*.test.mjs
npm --prefix packages/core test
npm --prefix packages/core run typecheck
npm --prefix packages/core run build
# browser check against a spare port (never the production 3080):
PORT=3191 node packages/core/dist/index.js    # then open http://127.0.0.1:3191/app/
```

Browser QA done for this version: widths 360/390/768/1440, dark and light; no console errors, no CSP violations,
no horizontal overflow, all controls ≥ 44 px, text contrast measured on rendered pixels (≥ 4.5:1, large ≥ 3:1).
Still needed from the integrating owner: a real Telegram client (iOS/Android/Desktop), the public proxy
(host root → `/app/`, `at=` rejection) and deployment of the whole `apps/miniapp` tree **including `vendor/`**.

## Known gaps

* The station sheet cannot be dragged down to close (Escape, scrim, close button, Back do work).
* Digit-roll and View Transitions need a modern WebView; older ones fall back to instant changes.
* `HMSymbol.woff2` is 756 KB (the whole icon font, vendored unmodified); it is cached with ETag revalidation.
* Fonts and the icon font are licensed to the design-system owner: confirm public redistribution before opening the Mini App beyond the private deployment.
