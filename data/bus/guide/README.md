# Reviewed static bus guide data

This is a **materialized, offline data projection**, not an app deployment, an official current operating-line census or a live-arrival integration.

## Input and preservation

- Source: `../mashhad-bus.sqlite`, pinned by `meta.source_database_sha256` in every JSON file.
- Original OSM snapshot, SQLite bytes, raw names/refs/endpoints, relation/member order, separate stop/platform elements and repeated visits are unchanged.
- All files retain **© OpenStreetMap contributors / ODbL-1.0** attribution.
- `lines.json`: one record for each exact imported line ID/ref, with observed variants and endpoint display evidence.
- `routes.json`: every retained variant, the complete original `members` sequence, separately identified `unclassified_members`, source-ordered stop/platform occurrences, original road segments and explicit audit flags. Unclassified members are source evidence, never additional bus stops.
- `stops.json`: the full stop-element inventory, including unlinked records and their actual missing names/nonpoint cases; no fabricated boarding points.
- `facilities.json`: mapped facility candidates, not a certified urban-terminal inventory.
- `endpoint-derivations.json`: the two reviewed display-only endpoint derivations described below.
- `manifest.json`: source metadata, computed counts and SHA-256/size of the other JSON files. The manifest does not hash itself or this explanatory document.

## Endpoints: raw versus display

Use raw `from_name` / `to_name` for provenance, never rewrite them from display fields. Most `endpoint_display` values are exact explicit source tags.

For `osm:relation:5815754` / raw ref `42`, both raw endpoint tags remain NULL. Its own source `name:en` explicitly names `Elahiyeh bus station → Shahid Javan bus station`. Each English endpoint exactly matches one municipal-tagged facility's `name:en`; the display label is that same facility's existing Persian `name`. Evidence includes both source IDs/tags/values. No nearest-stop guess, reverse-direction inference, translation, fuzzy match or provider-ID conversion was used. These are **source-derived community labels, not operator-confirmed current endpoints**.

## Consumer requirements

- A line ID is not an API provider ID; preserve refs such as `38.1`, `38/1`, `4` and `EXP-4` without automatic merging.
- Variants are not guaranteed to be an exact outbound/inbound pair. Keep loop/review statuses and repeated stop visits.
- Stop/platform counts describe mapped elements/occurrences, not deduplicated physical boarding places; no automatic one-to-one pairing exists.
- Render geometry as separate original segments. Do not add straight connectors, claim travel orientation or enable turn-by-turn navigation from this data.
- Keep unknown names/coordinates null where the source lacks them. All currently linked source stop/platform occurrences have names and points, but this does not verify operator ordering or current operation.
- All headways remain null, timing is unknown and arrivals are not connected. Null is not zero minutes or a disabled line.
- Dated news mentions and the separate document-reference research are not operational routes; do not add them to the guide as active services.

## Regeneration and validation

The existing `scripts/bus_catalog.py` reproduces the raw catalogue, **not this reviewed materialization**. A source change requires a new reviewed projection and manifest; do not reuse these guide files with a different source hash. The integrity test intentionally fails rather than accepting a stale projection.

Run from the repository root:

```bash
node --test tests/data/bus-guide-integrity.test.mjs
node --test tests/data/bus-catalog-integrity.test.mjs
```

The guide integrity test compares every line/route identity, full raw member sequence, ordered stop/platform member, original geometry segment, raw field and facility against read-only SQLite. It checks exact variant multiplicity and all existing safety flags, verifies pinned audit evidence, independently recomputes exact-vertex geometry components, proves both display derivations and validates file hashes. Six memory-only negative cases reject false operation/orientation claims, duplicates, unsupported summary endpoints, wrong component counts and lost raw members. Unlinked platform inventory remains in the source SQLite; the projection embeds linked platform occurrences, not a separate complete platform catalogue. Research/limitations are documented in `research/bus-static-completion/`.
