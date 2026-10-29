# Mashhad bus static catalogue — research snapshot

This is an **offline data foundation**, not a deployment or a connected live-arrival service. The app, bot, metro engine, raw field measurements, n8n workflows, nginx and proxy configuration are unchanged.

## What this snapshot contains

The original Overpass response is saved, compressed without changing the decompressed bytes, at `raw/overpass-mashhad-expanded.json.gz`. Its retrieval metadata and SHA-256 are in the adjacent `.source.json`. The query is in `research/bus-static/mashhad-bus-expanded.overpassql`. The query covers an explicitly recorded rectangle around Mashhad and retrieves complete relation descendants; peripheral/suburban stops can occur in the result. The Nominatim city-boundary response is also preserved for scope checking.[1][6]

The first verified import contains:

- **92 exact raw line-reference strings**, not a certified census of currently operating city lines.
- **180 route-relation variants**, including directions and potentially duplicate variants; these are not 180 distinct lines. One explicitly private university bus relation is recorded separately under `excluded_routes`.
- **2,196 stop-element records**, including 100 not linked to an imported route. OSM elements are not guaranteed to correspond one-to-one to distinct physical boarding places. One stop-position element is the Zakaria terminal polygon, so it has no invented point coordinate; its actual area geometry remains in `facilities`.
- **1,210 platform records**, kept separately rather than blindly concatenated with stop positions. The relation's stop members define the stop sequence. Stop-position/platform roles represent different mapping objects; OSM member order is preserved, not independently verified against the operator.[3][4]
- **39 mapped bus-facility candidates**, of which 19 carry a municipal-operator tag in OSM. Others are unclassified; the raw set includes intercity/freight/mis-tagged-looking features and must not all be called urban terminals. Even municipal tags are community observations, not authority confirmation.
- **11,644 road-way member segments** and 5,275 ordered stop occurrences. Segments are stored separately in original OSM-way orientation; no fabricated connector or claimed traversal orientation is added.
- **74 additional lookup hints**, compared after trimming only separator whitespace, found on platforms but without an exact matching route relation in this snapshot. Original raw tokens are preserved separately; some are malformed/combined values. They are leads, not proof of 74 additional active lines, and their identifiers are not silently repaired.

Counts are computed in `exports/summary.json`, not manually maintained as a network census. `research/bus-static/verification.json` records comparison of **every** included relation, member sequence and geometry segment against the saved snapshot. Source time and fetch time are distinct and preserved.

## Supplementary research quarantine

`reference_route_records` contains **205 separately sourced catalogue rows** (71 from MrChetor and 134 from an older Blogfa catalogue); `reference_pdf_mentions` contains **144 reference tokens** with PDF page/bounding-box evidence. These are not 349 additional lines. Original row JSON, exact raw identifiers, endpoints/corridor text and source URLs are retained without adding these records to `lines`, `routes`, stop sequences or arrivals. Their enforced quality is `research_only_not_current_verified`, even if an input claims otherwise.

Source extraction and retrieval evidence are under `research/bus-static-additional/`. Parent verification checked every manifest hash, all row counts and the real 32-page PDF metadata (created 2019-06-24). Files re-uploaded under 2023/2024 paths are byte-identical to the historical PDF, not a newer network. The PDF includes suburban/minibus categories; an extracted token is not automatically a current urban bus line. Reuse permission for supplementary publications has not been established. Full third-party page/PDF captures are retained locally for audit and are not included in the handoff ZIP or committed as article copies.

## Coverage and safety boundaries

**This does not establish coverage of all active Mashhad bus lines.** A current official route census/feed has not yet been validated. Missing current lines, changed routes, direction errors, stale platform route refs and community-map omissions remain possible. Do not infer an official coverage percentage from these counts.

- All 181 bus relations in the retrieved snapshot are accounted for: 180 retained and one explicit non-municipal operator exclusion. No relation is silently dropped for having few stops.
- Raw `ref`, `from`, `to`, names, tags, source IDs and all relation member indices remain available. `38.1` and `38/1` are **not automatically merged**. `ref_raw` preserves exact source tokens, including whitespace after semicolons; explicitly named `ref_lookup` trims whitespace only for lookup/candidate comparisons. The complete original stop-code tag is also retained. Duplicate route variants and master/child reference conflicts are retained and flagged.
- `routes.headway_min` is always `NULL`; `timing_quality` is `unknown`. OSM schedule-looking tags remain raw evidence, not a generated timetable.
- `arrival_observations` and `external_stop_mappings` are deliberately empty. Public OSM stop codes are **not verified municipal/Neshan API IDs**. A future mapping needs provider identity, explicit verification time and evidence.
- Raw stop-reference collisions, source graph anomalies and missing point coordinates are listed in `issues`.
- The Neshan/municipal/partner access investigation is separate: `research/bus-arrivals/live-arrivals-findings.md`. An HTTP 200 browser challenge, search-index minute value, ordinary traffic ETA or static route data is **not** a live bus prediction. GTFS-Realtime is a separate feed specification; this catalogue is not an official Mashhad GTFS or GTFS-RT feed.[5]

## Files and useful tables

- `mashhad-bus.sqlite`: SQLite catalogue, indexed stop-code lookup, route membership, road geometry, provenance and issues.
- `exports/line_inventory.csv`: line references with variant counts and raw endpoints.
- `exports/route_inventory.csv`: individual route variants and stop/geometry counts.
- `exports/stop_inventory.csv`: stop names, coordinates, raw codes and membership counts.
- `exports/municipal_terminal_candidates.csv`: the municipal-operator-tagged facility subset, not a certified complete terminal list.
- `exports/route_ref_hints_without_geometry.csv`: unresolved route-reference leads.
- `exports/catalog.json`: all tables and views in one machine-readable file.
- `exports/{routes,stops,facilities}.geojson`: WGS84 geometries using `[longitude, latitude]`.
- Every other database table/view also has a CSV export. Import CSV identifier columns as text to preserve leading zeroes; SQLite and JSON retain strings exactly.

### Reproduce offline

From the project root, using Python's standard library only:

```bash
python3 scripts/bus_catalog.py \
  --input data/bus/raw/overpass-mashhad-expanded.json.gz \
  --source data/bus/raw/overpass-mashhad-expanded.source.json \
  --reference-rows research/bus-static-additional/supplementary-route-tables.json \
  --historical-refs research/bus-static-additional/historical-pdf-route-refs.json \
  --db data/bus/mashhad-bus.sqlite \
  --out data/bus/exports

python3 -W error::ResourceWarning -m unittest discover \
  -s tests/data -p 'test_bus_catalog.py' -v
```

The importer checks a supplied raw SHA-256, rejects partial Overpass `remark` responses and empty/no-eligible-route inputs, builds in a sibling temporary file, validates integrity/foreign keys, closes the transaction/connection and atomically replaces the database. It does **not** fetch during normal builds. Fresh collection must preserve its own URL, query, fetch timestamp, source-base timestamp and raw hash rather than reusing this snapshot's metadata.

### Read-only query examples

```sql
-- One raw line ref, all observed directions/variants:
SELECT * FROM route_inventory WHERE ref_raw = '50';

-- Provider mapping is deliberately NOT assumed here:
SELECT s.id,s.name,s.lat,s.lon,x.ref_raw
FROM stop_refs x JOIN stops s ON s.id=x.stop_id
WHERE x.ref_lookup='4658';

-- Full stop sequence of a selected variant, preserving repeated loop visits:
SELECT q.sequence,q.member_index,s.id,s.name,s.lat,s.lon
FROM route_stops q JOIN stops s ON s.id=q.stop_id
WHERE q.route_id='osm:relation:5623657'
ORDER BY q.sequence;
```

## Licence and attribution

Derived OSM data is under **ODbL-1.0**. Preserve **© OpenStreetMap contributors** attribution and the source licence when redistributing the database or derived data. App code and unrelated project assets are not relicensed by this data import.[2]

## Sources

[1] https://overpass-api.de/api/interpreter
[2] https://www.openstreetmap.org/copyright
[3] https://wiki.openstreetmap.org/wiki/Relation:route
[4] https://wiki.openstreetmap.org/wiki/Tag:public_transport%3Dstop_position
[5] https://gtfs.org/documentation/realtime/reference
[6] https://nominatim.openstreetmap.org/search?q=Mashhad%2C+Iran&format=json&limit=3
