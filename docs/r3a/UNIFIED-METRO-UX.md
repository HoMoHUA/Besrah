# Unified Metro UX

Design recorded before UI edits, implementing the supplied owner direction (not a new approval gate).

## Structure
1. Existing Metro header/ride tabs; compact opt-in control in the header. No second Beta hero. OFF/left/unavailable retain functional legacy discovery/search/tracker/list; optional failure status is small, not a dead planner card.
2. ON + explicit opt-in: one journey surface. Shared controller owns line/from/to and readiness clock. From/to buttons open **one reused accessible station combobox**, filtered to selected line, using existing Persian search and keyboard behavior. Selection is session-only; opt-in alone may persist.
3. Results retain measured-data boundaries, calendar warning, expiry, destination (Ghadir vs Airport), wait/in-train metrics and earliest only in returned modeled choices. Fare unknown; no street routing/walking/transfer/live claims.
4. Complementary current-origin departures use `createBoard` and existing `/next` with explicit line. Their heading explicitly says current server time, not chosen future readiness. Refresh, as-of/day, notes, confidence, favorite and full station detail remain accessible. No destination input is required to inspect a board.
5. Compact nearest/recent/favorites actions, not a second repeated card stack. Nearest does not set platform readiness or request location without a click.
6. Collapsed current-line model tracker; preserving train buttons, destination labels, position info and station taps. Poll only when detail open, Metro visible and document visible. No option-to-marker link without exact identity.
7. Collapsed original station discovery, all/line1/line2 retained. Line discovery tabs feed the shared line; favorites use existing route. Full station sheet stays available from Home/Saved/Favorites and includes optional explicit “plan from here” bridge only when active.

## Flows and state
- Pick origin → current-time board loads once; choose destination → journey ready; swap → board follows new origin, stale request aborted. Future date changes do not reload current-time board.
- Change line → retain endpoints that belong to new line, clear incompatible endpoints; tracker and line discovery follow. Registry status refresh revalidates IDs without erasing valid selection.
- Leave/re-enter Metro → preserve form in memory, cancel requests/results on hide; recheck config on show. Runtime OFF/leave → stop unified work and restore original legacy functions.
- Full sheet → explicit build-from CTA closes sheet normally then feeds shared controller, without redefining global station opening.

## Small-screen HM7
Reuse AzarMehr, existing semantic tokens, 24px cards and 44px targets. Single-column endpoint controls below 390px, wrapping actions, bounded listbox, full readable notices near results. Native details provide keyboard-accessible disclosure and no new animation. No global CSS or dependency changes. Parent owns real viewport/theme/reduced-motion screenshots and browser review; official Telegram Android 10 remains human QA, currently PARTIAL.
