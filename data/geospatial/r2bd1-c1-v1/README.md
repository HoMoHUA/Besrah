# R2b-D1 C1 geospatial evidence, version 1

**Gate: BLOCKED.** This is a private research data package and offline validation tooling, not a deployable route network or a public A-to-B capability.

## Layers

- `scope.json`: the bounded acquisition envelope and unchanged registry hash.
- `queries/`: exact pedestrian/entrance/access Overpass query, not a city-wide query.
- `raw/`: immutable actual response bodies, headers and acquisition metadata. `.gitattributes` disables byte normalization/diff for captured bodies and headers.
- `external-sources.json`: every additional public-source attempt, failures included. Unknown-rights historical/public pages and research captures are in the durable private checkpoint referenced there, not the 24-hour scratch cache.
- `derived/c1-source-topology.json`: source entities, exact-node associations, public endpoint proposals and unknown physical claims.
- `derived/c1-source-geometry.geojson`: source geometry only. Road lines are not certified pedestrian edges; platform outlines are not walkable centerlines.
- `derived/r2a-c1-platform-only-replay.json`: actual unchanged approved R2a replay, historical Friday, both directions, **platform-ready only**, never A-start. Nondeterministic runtime performance counters are explicitly omitted; actual travel values are unchanged. Raw original execution is archived in the private checkpoint.
- `derived/walking-speed-evidence.json`: historical literature-based speed reference, not a locally measured walking speed or a total station-access model.
- `derived/gate-evaluation.json`: fail-closed per-leg audit, not computed itineraries. Canonical copy: `docs/r2b/R2b-D1-EVIDENCE.json`.
- `templates/field-observation.json`: an empty form, explicitly **not an observation**. Null means unknown, not zero.
- `manifest.json` and `SHA256SUMS`: final package inventory and byte checksums. SHA-256 proves integrity relative to the recorded bytes, not source authenticity or physical passage.

## Reproduce offline

From the repository root:

```bash
python3 -B scripts/r2bd1/derive.py data/geospatial/r2bd1-c1-v1
python3 -B scripts/r2bd1/build_evidence.py
python3 -B -m unittest discover -s tests/data -p 'test_r2bd1_*.py' -v
(cd data/geospatial/r2bd1-c1-v1 && sha256sum -c SHA256SUMS)
```

The evidence builder requires the durable private archive because it rechecks every archived-source hash, including failed-response artifacts. If copying this package elsewhere, copy that archive too and explicitly update its location in a new package version; never silently substitute a new fetch for an archived response.

Optional replay using the existing **approved, unchanged R2a** build:

```bash
node scripts/r2bd1/replay.mjs /root/projects/besrah-r2a
```

This emits canonical JSON on stdout and does not overwrite an artifact, contact providers, start HTTP or store user memory. Node dependencies were not installed in D1. The existing approved compiled modules were read only; Git HEAD alone is not a build attestation, so complete protected-tree hashes were checked separately.

## Fresh fetches are not offline reproduction

The original exact fetch invocation was:

```bash
python3 scripts/r2bd1/acquire.py data/geospatial/r2bd1-c1-v1 overpass-de-c1-01 \
  https://overpass-api.de/api/interpreter \
  --query data/geospatial/r2bd1-c1-v1/queries/c1-pedestrian.overpassql \
  --license ODbL-1.0 --license-url https://www.openstreetmap.org/copyright
```

Running it again intentionally refuses because the source ID already exists. A new fetch requires a new source ID/package version and evidence review. Requests must remain bounded and spaced at least two seconds apart per host; the tool does not automatically retry. Preserve timeout/HTTP/partial-response failures instead of replacing them with an empty successful graph.

## Assurance boundary

An OSM tag, stop-area membership, exact shared-node topology, physical passage, directional platform access and a sourced time model are separate claims. No coordinate snapping, line-intersection connector, guessed indoor edge or unknown-to-zero conversion is present. `layer` is not an indoor `level`. Candidate A/B points remain unverified. Neither a historical operator station marker nor an OSM station center is an entrance.

No product code, public assets, source database, old research, production config, memory limit, service or deployment is changed by this package. Even a future READY result requires separate owner approval of the R2b-B design before implementing a planner.
