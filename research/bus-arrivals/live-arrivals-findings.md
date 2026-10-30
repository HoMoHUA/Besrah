# Mashhad public bus-arrival investigation

Fetched 2026-10-29, 22:07–22:13 UTC. **No reusable anonymous live-arrival API was verified.** This is not evidence that live arrivals do not exist.

## Latest follow-up: User-Agent and municipal map, 2026-10-30

Normal ready desktop and Android web pages both displayed a numeric prediction for line 1093; Android still displayed it after a new normal refresh request. This supersedes any interpretation that the web always returns unknown. It does not establish feed measurement time, prediction accuracy, an official native-app User-Agent, a causal UA effect, or an approved production API. Direct UA variants still returned non-plain-JSON bodies. Municipal DNS now resolved and TCP connected, but direct/proxy TLS handshakes timed out before HTTP. See `ua-municipal-20261030/README.fa.md` and `findings.json`. Older Piroozi 24 results below remain timestamped historical observations, not permanent availability claims.

## Follow-up: owner-supplied Piroozi 24, 2026-10-30

The exact short link supplied by the owner opened in the normal public web app. Its existing public-transport tab exposed an internal `passing-lines` request, but two accepted foreground observations over one refresh interval showed unknown ETAs for all four displayed lines. Direct/proxy HTTP 200 responses were not plain JSON, and no reverse-engineered decoder or production adapter was built. This does not establish a fresh numeric ETA or permission for product reuse. See `piroozi24/README.fa.md` and `piroozi24/findings.json` for timestamped evidence. Do not generalise the earlier curl browser-check results to normal browser rendering of this supplied link.

## Concrete outcomes

- **Neshan officially advertises Mashhad arrivals.** Its first-party features page served real HTML, HTTP 200 through both direct and existing proxy access. It specifically identifies Mashhad and Tehran for bus-arrival display.[1]
- **A real public stop example was discovered, not invented:** پایانه شهید مفتح, `https://neshan.org/maps/places/9c77cf1056e246c4fb7a185b1cd8d9b3`. Search/indexed output includes a line 68 entry with a minute value. This is **indexed content with unknown crawl freshness, not a current prediction**. All three tested stop pages returned HTTP 200 but only 2,071-byte browser-check HTML on both paths. No challenge was bypassed and no arrival payload was obtained.[2]
- **Developer API ≠ consumer app capability.** Public Neshan Nearby documentation includes `bus_station` and requires a registered `Api-Key`. POI Details requires a key **and support-ticket activation**, accepts the `poiHash` supplied by search/nearby, and documents ordinary place details, not arrival predictions. The public place URL's 32-hex identifier must not be assumed to be the API's `poiHash`. Routing documents car/motorcycle, not a transit-arrivals contract. All these documentation pages were live HTTP 200 direct and proxy.[3][4][5]
- **Municipal products:** نقشه همراه مشهد at `https://map.mashhad.ir` and the operator portal `https://bus.mashhad.ir` are published addresses. Both yielded direct DNS-resolution timeouts and proxy TLS timeouts, not an HTTP denial or a working app. Therefore no municipal public JavaScript bundle, ETA endpoint or feed contract was inspectable. No GeoIP conclusion is justified.[6][7]
- **Exact current municipal citizen app identity:** اپلیکیشن شهروندی شهرمن, package `shahreman.mashhad.app`, publisher سازمان فناوری اطلاعات و ارتباطات شهرداری مشهد. Bazaar and Myket listings responded HTTP 200; Bazaar's developer-provided description identifies the publisher. No documented ETA API was supplied by these listings. Avoid unrelated `ir.shahrman` and the generic `shahr.app` product. Ticket payment/routing is not equivalent to live arrival access.[8]
- **Actionable partnership lead beyond SEO:** an article in Podium's named publication, linking author `@fanap.podium`, explicitly offers Mashhad bus-stop arrival information. It served HTTP 200 on both paths and its body was inspected. Official Podium homepage indexed content describes registration, service selection and signing an undertaking before connecting. Its homepage, published `/apis` marketplace and `/docs` routes all timed out at TLS on both paths here. **The advertisement is verified; current product availability, endpoint, credentials, pricing and licence are not.** Ask Podium whether the municipality's stop ETA product remains supplied.[9][10]
- **Secondary/historical lead only:** Apieco's indexed Mashhad Bus listing attributes stop-code-based arrival estimates to Finnotech. Both that page and Finnotech's official docs timed out at TLS on both paths; current Finnotech search did not expose a bus operation. Do not implement against an invented historical endpoint.[11]
- **No first-party Mashhad GTFS or GTFS-Realtime URL discovered.** Generic directories and train-tracker marketing were not treated as official feed evidence. This is a bounded negative finding, not a declaration of absence.

## Repeatable procedure for a supplied stop link

1. Open exactly that link in browser session `bus-arrivals-research`; preserve redirects, final URL, stop label, coordinates and public identifiers.
2. If normally accessible without login or challenge bypass, inspect rendered arrival entries and only the public requests generated by that page. Capture method, URL, status, schema, stop/line/direction IDs, payload timestamp, cache/freshness and explicit access requirements. Do not reuse app/session tokens.
3. Repeat twice at a modest interval during Mashhad service hours. Compare against the owner's visible app values if available. A cached minute label, public POI hash, road travel-time response or HTTP 200 challenge is not enough.
4. If access stops at authentication, CAPTCHA/browser verification or an app-only deep link, document that boundary. Request approved integration access from Neshan/municipality/Podium, including stop-ID catalog, licence, quotas and outage semantics.

## Evidence and reproduction

- `live-arrivals-findings.json`: structured findings, exact discovered stop URLs, access requirements and selected short evidence quotations.
- `http-evidence.json`: **36 requests / 18 distinct published URLs**, each tested direct and with `http://127.0.0.1:10809`; timestamps, HTTP status (0 means no HTTP response), curl exit/error, size, content type, selected headers and SHA-256 of received body, plus bounded text evidence.
- `search-manifest.json`: queries, source URLs/titles, search provider and fetch window. These entries are discovery/index evidence, not origin responses. Long search text and fetched copyrighted HTML were removed after recording bounded evidence; body hashes identify the specific fetched representations.

Reproduce one origin check without credentials (do not persist full copyrighted pages):

```bash
curl -L --connect-timeout 10 --max-time 22 --max-filesize 1500000 \
  --proxy '' -sS -o /dev/null \
  -w 'status=%{http_code} type=%{content_type} bytes=%{size_download} final=%{url_effective}\n' \
  'https://neshan.org/maps/places/9c77cf1056e246c4fb7a185b1cd8d9b3'
# Repeat the same published URL with --proxy http://127.0.0.1:10809.
# For content classification, stream to a parser and retain only short text evidence.
```

Search used the configured web retrieval tool, which fell back from its unavailable native backend to keenable/exa. URL extraction was unavailable under that backend; bounded origin curl requests provided live evidence instead. No tool/provider/proxy configuration was changed. No UI, transport timing code, production service or private session was touched.

## Sources

[1] https://neshan.org/features/

[2] https://neshan.org/maps/places/9c77cf1056e246c4fb7a185b1cd8d9b3 — stop identity and indexed text; live origin challenge. Additional discovered examples: https://neshan.org/maps/places/d1a790a253af8019dddb770de0378148 and https://neshan.org/maps/places/bd46026078b702c25540f49be8a434ea .

[3] https://platform.neshan.org/docs/api/search-category/nearby/

[4] https://platform.neshan.org/docs/api/search-category/poi-details/

[5] https://platform.neshan.org/docs/api/routing-category/routing/

[6] https://map.mashhad.ir — published address corroborated in indexed https://www.yjc.ir/fa/amp/news/8544625 ; origin fetch failed.

[7] https://bus.mashhad.ir — published operator address in indexed https://sobhe-emrooz.ir/?p=28374&print=print ; origin fetch failed.

[8] https://cafebazaar.ir/app/shahreman.mashhad.app and https://myket.ir/app/shahreman.mashhad.app — developer-provided app listings, not municipal API documentation.

[9] https://virgool.io/PODIUM/apiهای-شهرداری-مشهد-در-پادیوم-aojo3h8wa3pt — provider-authored publication, author link https://virgool.io/@fanap.podium . Attribution is visible, not independent proof of current service operation.

[10] https://www.podium.ir/ ; https://podium.ir/apis ; https://podium.ir/docs — official URLs discovered in indexed first-party material, origin TLS failure in this run.

[11] https://apieco.ir/api/mashad-bus/ and https://docs.finnotech.ir/ — historical indexed marketplace lead; not a verified first-party arrival endpoint.
