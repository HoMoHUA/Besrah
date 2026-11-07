# Besrah bus source audit and offline route discovery — 2026-11-07

## Current evidence: DO NOT label static stops as realtime

A November 2026 public-source audit found:

1. **Mashhad municipal map** — https://map.mashhad.ir/ — The municipal "نقشه همراه مشهد" has been described as showing bus stop arrivals, route information and vehicle positions. This is a **public user-facing product**, not proof of a public developer API. Its website timed out from the auditing environment; the stop-specific page format and current live functionality were not verified in an interactive browser.
2. **Neshan web/app** — https://neshan.org/maps — Neshan has publicly described approximate bus arrival times in Mashhad **in its app**. The web site loads a JavaScript app, but an exact stop-ETA page and publicly documented bus-arrival developer endpoint could not be verified. The web transit itinerary view may omit duration; an unofficial project's summary is not authorization to query internal APIs.
3. **Official developer APIs:** None of the searched public municipal/Neshan developer pages established an approved, stable, licensed and accessible stop-ETA endpoint. **Do not reverse engineer browser sessions, decode private transports, scrape the app, or assume generic Neshan routing API delivers bus ETAs.**
4. **USSD warning:** the commonly cited `*137*22#` is a Tehran municipality service, NOT verified for Mashhad; do not show it as a Mashhad bus ETA option.
5. The reviewed OSM bus catalog already in Besrah is useful for possible service discovery but states `current_operator_service_verified:false`, `real_time_arrivals_connected:false`. It has no official mapping from its stop names to official stop IDs or the line/direction IDs needed for stop-specific ETA. Routes and stop names can be stale or ambiguous.

### Reference URLs (research only)

- https://map.mashhad.ir/ (municipal map portal)
- https://bus.mashhad.ir/ (municipal bus operator portal)
- https://neshan.org/maps (Neshan web map)
- https://www.beytoote.com/news/social/mashhad02-bus-service.html (third-party description of municipal app bus arrival function)
- https://www.tasnimnews.ir/fa/news/1401/09/13/2816437/ (municipal statement about vehicle positioning and arrival information)
- https://telegram.me/s/neshan_nav?before=645 (Neshan's own historical bus arrival announcement; not proof of current API)
- https://github.com/sepehr071/neshan-mcp (UNOFFICIAL reverse-engineering project; not included, not a permitted API)

## Delivered without VPS/provider access

- Pure bounded `bus-paths.js` route discovery: directly connected journeys and one-change candidate paths by **directional stop ordering** in existing `bus-guide.json`. Matches exact local stop names, avoids impossible reverse travel on a one-way variant, caps results at 3, and returns NULL travel time, wait and fare.
- Mini App stop-to-stop discovery with explicit origin/destination input and stop selection from the already indexed catalog; users can choose a stop from the existing search results.
- Public **source handoff** from the bus stop view and general help: `https://map.mashhad.ir/` and `https://neshan.org/maps` are hardcoded allowlisted landing pages. They are NOT deep links to the selected station. Users must match the real stop/code on the external site. No API keys, backend networking, scraping, geolocation or passive tracking.
- Offline unit tests for directionality, loops, transfers, empty results, result bounds and safe external link handling.

## Exact next data needed to calculate a real bus ETA

A legally authorized provider or municipality should supply:

- A **verified stable stop identifier** (stop/side/platform, not just shared name) and station-coordinate/direction mapping against the OSM guide. Source version and review date are required.
- A route/operator/line identifier plus direction/trip identity, so arrival at a stop is not confused with a bus for the opposite direction.
- Provider-observed/updated timestamps and next predicted arrival timestamp(s), source clock/timezone (Asia/Tehran).
- Maximum TTL, error/outage behavior, redistribution/attribution terms and explicit permission for storing and showing results to Besrah users.
- Evidence of actual operational coverage for Mashhad and service-hours. A route shown in OSM is **not** proof of running buses.
- An SDK/API credential or formal feed specification and sandbox. Do not commit tokens or raw personal travel data to GitHub.

A future adapter must fail closed on stale evidence, missing platform mapping, mismatched route IDs, implausible times, unauthorized source, or network failures. Until that integration passes QA, show **no bus ETA**, never infer arrival from OSM hop count, and never rank bus+metro against other modes by total travel time as if the ETA were observed.

## Not deployed

GitHub source changes here do **not** mean the VPS is running them. Only merge after CI, checkpoint, actual Android/Telegram UI QA and owner authorization as applicable. No Nginx, service manager or production data changes are part of this branch.
