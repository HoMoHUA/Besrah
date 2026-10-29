# Mashhad bus static supplementary evidence

Retrieved 2026-10-29 UTC. This directory is research quarantine, not a current operational route database.

## Results

- Successfully retrieved the historical 1398/2019 guide as a genuine 32-page PDF, HTTP 200, 2,485,244 bytes. Its host's Last-Modified is 2019-11-02. Extracted 144 distinct numeric reference tokens from the rightmost route-number column, with exact raw strings, PDF page numbers and bounding boxes.[1]
- A 2023 upload and a 2024 upload on other sites are byte-identical to that 2019-hosted file: SHA-256 `33afb098f497d361bcae88ea24303ae5b2087933e77bce9494a6cbefb1cb34c7`. Their upload paths do NOT make the guide current.[1][4][5]
- Extracted 71 rows from MrChetor tables, with origin, destination and corridor prose. These are selected corridor points, NOT ordered stop inventories.[2]
- Extracted 134 rows (132 distinct raw references) from a historical Blogfa catalogue, with origin and destination. Duplicate references and exact source cells are retained.[3]
- No accessible first-party current census, GTFS or complete route geometries obtained. Direct bus.mashhad.ir and map.mashhad.ir requests failed DNS resolution in this environment; the bus host through the existing local proxy timed out. These failures do not establish geoblocking or permanent outage. Actual errors, response headers and UTC timestamps are in retrieval-status.json.
- Search evidence for a current census is retained in search-current-catalogue.json. Search snippets are leads only; no operational assertions from them were imported. A commercial GIS listing is not a retrieved dataset.

## Usable files

- `supplementary-route-tables.json` / `.csv`: 205 source rows, intentionally separated by source_id and classification. JSON retains cells_raw and route_type_raw where present. route_ref_raw is preserved exactly; route_ref only strips whitespace/NBSP. No slash/dot conversions.
- `historical-pdf-route-refs.json`: 144 reference tokens, not 144 verified current routes. The guide includes BRT, urban, suburban and minibus categories; do not treat every token as a current urban bus service.
- `guide_historical.pdf`, `.txt`, `.bbox.html`: original PDF and Poppler extraction evidence. PDF text/bbox extraction has bidi/visual-order artifacts in Persian; do not blindly ingest it as clean logical text or attach endpoints by proximity.
- `mrchetor-tables-raw.json`, `blogfa_historical-tables-raw.json`: source tables for auditing extraction. HTML/text copies are retained.
- `osm-reference-comparison.json`: exact-reference comparison to parent's OSM input, digits transliterated for matching only. Lists are research candidates, NOT missing-current-route claims. Reference equivalences, discontinuations and renumberings are unresolved.
- `retrieval-status.json`, `additional-pdf-status.json`: URL, timestamp, status/error, headers and byte counts; mirror SHA checks included.
- `retrieve.py`, `extract.py`: reproducible read-only fetch/extraction scripts. They write only inside this directory.

## Coverage limits

These sources cannot validate that all current city lines are covered. No current stop order, directions, schedules, live arrivals or route shapes were inferred. All supplemental records must remain excluded from production active-service tables until independently verified. No UI, core, deploy or client systems were modified.

## Sources

[1] https://www.mashhad-tourist.ir/wp-content/uploads/2019/11/راهنمای-خطوط-اتوبوسرانی-مشهد-98.pdf
[2] https://mrchetor.ir/mshhad-bus-routs
[3] https://darman1.blogfa.com/post/46
[4] https://hamyartrip.ir/wp-content/uploads/2024/09/mashhad-public-bus.pdf
[5] https://mrchetor.ir/wp-content/uploads/2023/06/mashhad-public-bus.pdf
