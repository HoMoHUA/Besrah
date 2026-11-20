#!/usr/bin/env python3
"""Mashhad car streets from a Geofabrik Iran extract (OpenStreetMap, ODbL-1.0) -> roads.json.

Output (BESRAH_ROADS_FILE, read by packages/core/src/geo/pickup.ts): {source, fetchedAt, ways:[{id, tags:{highway,name,oneway,junction,access,tunnel,bridge}, geometry:[[lat,lon],...]}]}.
Two passes keep memory small: (1) ids and positions of every node inside the box, (2) highway ways, cut to the runs
of nodes that are inside the box. Usage: build_osm_roads.py <iran.osm.pbf> <roads.json>
"""
import json, sys, time
from array import array
import numpy as np
import osmium
import osmium.filter

LA0, LA1, LO0, LO1 = 36.15, 36.45, 59.35, 59.80          # Mashhad
M = 0.01                                                  # margin so streets crossing the edge keep their first segment
HW = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
      'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'}
KEEP = ('highway', 'name', 'oneway', 'junction', 'access', 'tunnel', 'bridge')


def main(pbf: str, out: str) -> None:
    t0 = time.time()
    ids, lat, lon = array('q'), array('d'), array('d')
    for n in osmium.FileProcessor(pbf, osmium.osm.NODE):
        loc = n.location
        if not loc.valid():
            continue
        y, x = loc.lat, loc.lon
        if LA0 - M <= y <= LA1 + M and LO0 - M <= x <= LO1 + M:
            ids.append(n.id); lat.append(y); lon.append(x)
    nid = np.frombuffer(ids, dtype=np.int64)
    order = np.argsort(nid, kind='stable')
    nid, nlat, nlon = nid[order], np.frombuffer(lat, dtype=np.float64)[order], np.frombuffer(lon, dtype=np.float64)[order]
    print(f'nodes in box {len(nid):,} ({time.time() - t0:.0f}s)', flush=True)

    ways, cut = [], 0
    for w in osmium.FileProcessor(pbf, osmium.osm.WAY).with_filter(osmium.filter.KeyFilter('highway')):
        if w.tags.get('highway') not in HW:
            continue
        refs = np.fromiter((r.ref for r in w.nodes), dtype=np.int64)
        if len(refs) < 2:
            continue
        pos = np.searchsorted(nid, refs)
        pos[pos >= len(nid)] = 0
        found = nid[pos] == refs
        if not found.any():
            continue
        tags = {k: w.tags[k] for k in KEEP if k in w.tags}
        # Contiguous runs of nodes inside the box; a way leaving and re-entering becomes two pieces with the same id.
        runs, start = [], None
        for i, ok in enumerate(found):
            if ok and start is None:
                start = i
            if (not ok or i == len(found) - 1) and start is not None:
                end = i + 1 if ok else i
                if end - start >= 2:
                    runs.append((start, end))
                start = None
        if len(runs) != 1 or runs[0] != (0, len(found)):
            cut += 1
        for (a, b) in runs:
            p = pos[a:b]
            ways.append({'id': w.id, 'tags': tags, 'geometry': [[round(float(y), 6), round(float(x), 6)] for y, x in zip(nlat[p], nlon[p])]})
    meta = {'source': 'OpenStreetMap contributors (ODbL-1.0) via Geofabrik iran-latest.osm.pbf',
            'fetchedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'bbox': [LA0, LO0, LA1, LO1], 'ways': ways}
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))
    kinds = {}
    for w in ways:
        kinds[w['tags']['highway']] = kinds.get(w['tags']['highway'], 0) + 1
    named = sum(1 for w in ways if w['tags'].get('name'))
    print(f'ways {len(ways):,} (cut at the box edge {cut:,}), named {named:,}, {time.time() - t0:.0f}s', flush=True)
    print(json.dumps(dict(sorted(kinds.items(), key=lambda kv: -kv[1]))), flush=True)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('usage: build_osm_roads.py <iran.osm.pbf> <roads.json>')
    main(sys.argv[1], sys.argv[2])
