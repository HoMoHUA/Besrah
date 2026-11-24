#!/usr/bin/env python3
"""Besrah's own map: OpenStreetMap (ODbL-1.0) Iran extract -> one archive of small JSON tiles drawn by apps/miniapp/map.

Usage: build_map_tiles.py <iran.osm.pbf> <out-dir> [--work DIR]

Output in <out-dir>:
  tiles-v1.bin       gzip JSON tiles back to back
  tiles-v1.idx.json  {"z/x/y": [offset, length], ...}
  tiles-v1.meta.json source, build time, zooms, counts

Zooms: 7 (country: main roads, big water, cities), 10 (region: + secondary, tertiary, rail, towns, big parks) and 13 (city:
every street with its name, water, parks, rail and metro, neighbourhood names). The app over-zooms 13 up to 19.

Tile JSON (coordinates are tile-local integers on a 4096 grid, first point absolute, then deltas):
  {"n": [names], "r": [[class, name, xy]], "l": [[class, name, xy]], "w": [[ring, ...]], "g": [[class, ring, ...]], "p": [[rank, name, x, y]]}
  r = roads (0 motorway, 1 trunk, 2 primary, 3 secondary, 4 tertiary, 5 street, 6 service)
  l = other lines (20 river, 21 canal, 22 coastline, 30 rail, 31 metro, 32 tram), w = water areas, g = green areas
  (0 park/garden, 1 wood/forest, 2 grass, 3 cemetery), p = place labels (0 city, 1 town, 2 suburb, 3 neighbourhood, 4 village).

Memory stays small: features are clipped per tile while streaming and written to bucket files (one per zoom-7 tile), then
each bucket is grouped into tiles on its own.
"""
import gzip, json, math, os, struct, sys, time
from array import array
import osmium
from osmium.filter import KeyFilter

E = 4096                 # tile grid
BUF = 64                 # clip buffer (grid units) so strokes do not end at tile edges
ZOOMS = (7, 10, 13)
TOL = 3.0                # simplification, grid units at each zoom

ROAD = {'motorway': 0, 'motorway_link': 0, 'trunk': 1, 'trunk_link': 1, 'primary': 2, 'primary_link': 2,
        'secondary': 3, 'secondary_link': 3, 'tertiary': 4, 'tertiary_link': 4,
        'residential': 5, 'unclassified': 5, 'living_street': 5, 'service': 6}
ROAD_ZOOM = {0: 7, 1: 7, 2: 7, 3: 10, 4: 10, 5: 13, 6: 13}
RAIL = {'rail': 30, 'subway': 31, 'light_rail': 31, 'tram': 32}
WATERWAY = {'river': 20, 'canal': 21}
PLACE = {'city': 0, 'town': 1, 'suburb': 2, 'quarter': 3, 'neighbourhood': 3, 'village': 4}
PLACE_ZOOM = {0: 7, 1: 10, 2: 13, 3: 13, 4: 13}
GREEN_LEISURE = {'park': 0, 'garden': 0, 'golf_course': 2}
GREEN_LANDUSE = {'forest': 1, 'grass': 2, 'recreation_ground': 0, 'village_green': 2, 'cemetery': 3, 'meadow': 2}
REC_LINE, REC_POLY, REC_POINT = 1, 2, 3
LAYER = {'r': 0, 'l': 1, 'w': 2, 'g': 3, 'p': 4}
LAYER_KEY = {v: k for k, v in LAYER.items()}


def name_of(tags):
    for k in ('name:fa', 'name'):
        v = tags.get(k)
        if v:
            return v.strip()[:80]
    return ''


def merc(lon, lat, z):
    s = E * (1 << z)
    lat = max(-85.0, min(85.0, lat))
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2
    return (lon + 180.0) / 360.0 * s, y * s


def simplify(pts, tol):
    """Radial-distance simplification; keeps the first and last point."""
    if len(pts) <= 2:
        return pts
    out = [pts[0]]
    t2 = tol * tol
    lx, ly = pts[0]
    for x, y in pts[1:-1]:
        if (x - lx) ** 2 + (y - ly) ** 2 >= t2:
            out.append((x, y)); lx, ly = x, y
    out.append(pts[-1])
    return out


def clip_segment(x0, y0, x1, y1, a, b, c, d):
    """Liang-Barsky against [a,c]x[b,d]; returns the clipped segment or None."""
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0 - a), (dx, c - x0), (-dy, y0 - b), (dy, d - y0)):
        if p == 0:
            if q < 0:
                return None
        else:
            r = q / p
            if p < 0:
                if r > t1:
                    return None
                if r > t0:
                    t0 = r
            else:
                if r < t0:
                    return None
                if r < t1:
                    t1 = r
    return (x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy)


def line_pieces(pts):
    """{(tx, ty): [run, ...]} with tile-local runs of a global polyline."""
    out = {}
    last = {}
    for i in range(len(pts) - 1):
        x0, y0 = pts[i]; x1, y1 = pts[i + 1]
        tx0, ty0, tx1, ty1 = int(x0 // E), int(y0 // E), int(x1 // E), int(y1 // E)
        if tx0 == tx1 and ty0 == ty1:
            tiles = ((tx0, ty0),)
        else:
            tiles = [(tx, ty) for tx in range(min(tx0, tx1) - (1 if min(x0, x1) % E < BUF else 0), max(tx0, tx1) + 1 + (1 if max(x0, x1) % E > E - BUF else 0))
                     for ty in range(min(ty0, ty1) - (1 if min(y0, y1) % E < BUF else 0), max(ty0, ty1) + 1 + (1 if max(y0, y1) % E > E - BUF else 0))]
        for t in tiles:
            ox, oy = t[0] * E, t[1] * E
            if len(tiles) == 1:
                seg = (x0 - ox, y0 - oy, x1 - ox, y1 - oy)
            else:
                seg = clip_segment(x0 - ox, y0 - oy, x1 - ox, y1 - oy, -BUF, -BUF, E + BUF, E + BUF)
                if seg is None:
                    continue
            a = (round(seg[0]), round(seg[1])); b = (round(seg[2]), round(seg[3]))
            runs = out.setdefault(t, [])
            if last.get(t) == i and runs and runs[-1][-1] == a:
                runs[-1].append(b)
            else:
                runs.append([a, b])
            last[t] = i + 1
    for t, runs in out.items():
        cleaned = []
        for r in runs:
            d = [r[0]]
            for p in r[1:]:
                if p != d[-1]:
                    d.append(p)
            if len(d) >= 2:
                cleaned.append(d)
        out[t] = cleaned
    return {t: r for t, r in out.items() if r}


def clip_ring(ring, a, b, c, d):
    """Sutherland-Hodgman against an axis-aligned box."""
    def clip(points, inside, cross):
        res = []
        if not points:
            return res
        prev = points[-1]
        for cur in points:
            if inside(cur):
                if not inside(prev):
                    res.append(cross(prev, cur))
                res.append(cur)
            elif inside(prev):
                res.append(cross(prev, cur))
            prev = cur
        return res
    def ix(p, q, x):
        t = (x - p[0]) / (q[0] - p[0]); return (x, p[1] + t * (q[1] - p[1]))
    def iy(p, q, y):
        t = (y - p[1]) / (q[1] - p[1]); return (p[0] + t * (q[0] - p[0]), y)
    pts = ring
    pts = clip(pts, lambda p: p[0] >= a, lambda p, q: ix(p, q, a))
    pts = clip(pts, lambda p: p[0] <= c, lambda p, q: ix(p, q, c))
    pts = clip(pts, lambda p: p[1] >= b, lambda p, q: iy(p, q, b))
    pts = clip(pts, lambda p: p[1] <= d, lambda p, q: iy(p, q, d))
    return pts


def poly_pieces(rings):
    """rings: [outer, inner...] in global coords -> {(tx, ty): [ring, ...]} tile-local."""
    xs = [p[0] for p in rings[0]]; ys = [p[1] for p in rings[0]]
    out = {}
    for tx in range(int((min(xs) - BUF) // E), int((max(xs) + BUF) // E) + 1):
        for ty in range(int((min(ys) - BUF) // E), int((max(ys) + BUF) // E) + 1):
            ox, oy = tx * E, ty * E
            got = []
            for k, ring in enumerate(rings):
                local = [(x - ox, y - oy) for x, y in ring]
                c = clip_ring(local, -BUF, -BUF, E + BUF, E + BUF)
                q = []
                for x, y in c:
                    p = (round(x), round(y))
                    if not q or q[-1] != p:
                        q.append(p)
                if len(q) >= 3:
                    got.append(q)
                elif k == 0:
                    break
            if got and len(got[0]) >= 3:
                out[(tx, ty)] = got
    return out


def ring_area(ring):
    s = 0.0
    for i in range(len(ring)):
        x0, y0 = ring[i - 1]; x1, y1 = ring[i]
        s += x0 * y1 - x1 * y0
    return abs(s) / 2


class Buckets:
    """Append-only record files, one per (zoom, zoom-7 parent tile)."""
    def __init__(self, work):
        self.work, self.files, self.names, self.name_list, self.count = work, {}, {'': 0}, [''], 0

    def name(self, s):
        i = self.names.get(s)
        if i is None:
            i = self.names[s] = len(self.name_list); self.name_list.append(s)
        return i

    def put(self, z, t, layer, kind, cls, name, parts):
        shift = z - 7
        key = (z, t[0] >> shift, t[1] >> shift)
        f = self.files.get(key)
        if f is None:
            f = self.files[key] = open(os.path.join(self.work, f'b{z}_{key[1]}_{key[2]}.bin'), 'ab', buffering=1 << 16)
        head = struct.pack('<BIIBBBiH', z, t[0], t[1], layer, kind, cls, name, len(parts))
        body = []
        for part in parts:
            body.append(struct.pack('<I', len(part)))
            flat = array('h', [max(-32000, min(32000, v)) for p in part for v in p])
            body.append(flat.tobytes())
        f.write(head); f.write(b''.join(body))
        self.count += 1

    def close(self):
        for f in self.files.values():
            f.close()


def emit_line(B, layer, cls, name, lonlat, minzoom):
    if len(lonlat) < 2:
        return
    for z in ZOOMS:
        if z < minzoom:
            continue
        pts = simplify([merc(lon, lat, z) for lon, lat in lonlat], TOL if z == 13 else TOL * 1.5)
        if len(pts) < 2:
            continue
        for t, runs in line_pieces(pts).items():
            for run in runs:
                B.put(z, t, LAYER[layer], REC_LINE, cls, name if z >= 10 or layer != 'r' else 0, [run])


def emit_poly(B, layer, cls, rings_lonlat, area_m2):
    for z in ZOOMS:
        if z == 7 and (layer != 'w' or area_m2 < 20e6):
            continue
        if z == 10 and area_m2 < (100e3 if layer == 'w' else 300e3):
            continue
        rings = []
        for k, r in enumerate(rings_lonlat):
            pts = simplify([merc(lon, lat, z) for lon, lat in r], TOL)
            if len(pts) >= 4:
                rings.append(pts)
            elif k == 0:
                break
        if not rings or ring_area(rings[0]) < 30:
            continue
        for t, parts in poly_pieces(rings).items():
            B.put(z, t, LAYER[layer], REC_POLY, cls, 0, parts)


def emit_point(B, rank, name, lon, lat):
    for z in ZOOMS:
        if z < PLACE_ZOOM[rank]:
            continue
        x, y = merc(lon, lat, z)
        t = (int(x // E), int(y // E))
        B.put(z, t, LAYER['p'], REC_POINT, rank, name, [[(round(x - t[0] * E), round(y - t[1] * E))]])


def classify_way(tags):
    hw = tags.get('highway')
    if hw in ROAD and tags.get('area') != 'yes':
        return ('r', ROAD[hw], ROAD_ZOOM[ROAD[hw]])
    rw = tags.get('railway')
    if rw in RAIL and not tags.get('service'):
        return ('l', RAIL[rw], 10 if rw == 'rail' else 13)
    ww = tags.get('waterway')
    if ww in WATERWAY:
        return ('l', WATERWAY[ww], 7 if ww == 'river' and tags.get('name') else 10 if ww == 'river' else 13)
    if tags.get('natural') == 'coastline':
        return ('l', 22, 7)
    return None


def classify_area(tags):
    if tags.get('natural') == 'water' or tags.get('waterway') == 'riverbank' or tags.get('landuse') in ('reservoir', 'basin'):
        return ('w', 0)
    if tags.get('leisure') in GREEN_LEISURE:
        return ('g', GREEN_LEISURE[tags['leisure']])
    if tags.get('landuse') in GREEN_LANDUSE:
        return ('g', GREEN_LANDUSE[tags['landuse']])
    if tags.get('natural') == 'wood':
        return ('g', 1)
    return None


def wanted(o):
    t = o.tags
    if o.is_node():
        return t.get('place') in PLACE and bool(name_of(t))
    if o.is_way():
        return classify_way(t) is not None or classify_area(t) is not None
    if o.is_relation():
        return t.get('type') in ('multipolygon',) and classify_area(t) is not None
    return False


def filter_pbf(src, dst):
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return
    t0 = time.time()
    # libosmium detects the format from the last extension.
    part = os.path.join(os.path.dirname(dst), '.filtered-part.osm.pbf')
    w = osmium.BackReferenceWriter(part, ref_src=src, overwrite=True)
    n = 0
    for o in osmium.FileProcessor(src).with_filter(KeyFilter('highway', 'railway', 'waterway', 'natural', 'leisure', 'landuse', 'place')):
        if wanted(o):
            w.add(o); n += 1
    w.close()
    os.replace(part, dst)
    print(f'filtered {n:,} objects -> {os.path.getsize(dst) / 1e6:.0f} MB ({time.time() - t0:.0f}s)', flush=True)


def stream(filtered, B):
    t0 = time.time()
    lines = areas = points = 0
    for o in osmium.FileProcessor(filtered).with_locations('flex_mem').with_areas():
        if o.is_node():
            rank = PLACE.get(o.tags.get('place'))
            if rank is not None and o.location.valid():
                emit_point(B, rank, B.name(name_of(o.tags)), o.location.lon, o.location.lat); points += 1
        elif o.is_way():
            c = classify_way(o.tags)
            if c is None:
                continue
            try:
                lonlat = [(n.location.lon, n.location.lat) for n in o.nodes if n.location.valid()]
            except osmium.InvalidLocationError:
                continue
            layer, cls, minzoom = c
            emit_line(B, layer, cls, B.name(name_of(o.tags)) if layer == 'r' or cls in (20, 21) else 0, lonlat, minzoom)
            lines += 1
        elif o.is_area():
            c = classify_area(o.tags)
            if c is None:
                continue
            layer, cls = c
            for outer in o.outer_rings():
                rings = [[(n.lon, n.lat) for n in outer]]
                rings += [[(n.lon, n.lat) for n in inner] for inner in o.inner_rings(outer)]
                if len(rings[0]) < 4:
                    continue
                # Rough area (m^2) for the zoom thresholds.
                lat0 = rings[0][0][1]
                k = 111320.0 * math.cos(math.radians(lat0))
                a = ring_area([(x * k, y * 110540.0) for x, y in rings[0]])
                emit_poly(B, layer, cls, rings, a)
                areas += 1
        if (lines + areas) and (lines + areas) % 200000 == 0:
            print(f'  {lines:,} lines, {areas:,} areas, {points:,} places, {B.count:,} pieces ({time.time() - t0:.0f}s)', flush=True)
    print(f'streamed {lines:,} lines, {areas:,} areas, {points:,} places -> {B.count:,} pieces ({time.time() - t0:.0f}s)', flush=True)


def delta(flat_pairs):
    out, px, py = [], 0, 0
    for i, (x, y) in enumerate(flat_pairs):
        if i == 0:
            out += [x, y]
        else:
            out += [x - px, y - py]
        px, py = x, y
    return out


def read_bucket(path):
    with open(path, 'rb') as f:
        data = f.read()
    i, n = 0, len(data)
    hs = struct.calcsize('<BIIBBBiH')
    while i < n:
        z, x, y, layer, kind, cls, name, nparts = struct.unpack_from('<BIIBBBiH', data, i); i += hs
        parts = []
        for _ in range(nparts):
            (cnt,) = struct.unpack_from('<I', data, i); i += 4
            a = array('h'); a.frombytes(data[i:i + cnt * 4]); i += cnt * 4
            parts.append(list(zip(a[0::2], a[1::2])))
        yield z, x, y, layer, kind, cls, name, parts


def assemble(work, out_dir, names):
    t0 = time.time()
    index, offset, tiles, total = {}, 0, 0, 0
    bin_path = os.path.join(out_dir, 'tiles-v1.bin.part')
    with open(bin_path, 'wb') as out:
        for fn in sorted(os.listdir(work)):
            if not fn.startswith('b') or not fn.endswith('.bin'):
                continue
            groups = {}
            for z, x, y, layer, kind, cls, name, parts in read_bucket(os.path.join(work, fn)):
                groups.setdefault((z, x, y), []).append((layer, kind, cls, name, parts))
            for (z, x, y), recs in groups.items():
                local, table = {}, []
                def nm(i):
                    if not i:
                        return -1
                    j = local.get(i)
                    if j is None:
                        j = local[i] = len(table); table.append(names[i])
                    return j
                doc = {'r': [], 'l': [], 'w': [], 'g': [], 'p': []}
                # Same road class + name -> one feature with several runs keeps the tile small and labels unique.
                merged = {}
                for layer, kind, cls, name, parts in recs:
                    key = LAYER_KEY[layer]
                    if kind == REC_LINE:
                        merged.setdefault((key, cls, name), []).append(delta(parts[0]))
                    elif kind == REC_POLY:
                        rings = [delta(r) for r in parts]
                        doc[key].append(rings if key == 'w' else [cls, *rings])
                    else:
                        (px, py), = parts[0][:1]
                        doc['p'].append([cls, nm(name), px, py])
                for (key, cls, name), runs in merged.items():
                    doc[key].append([cls, nm(name), *runs])
                doc['r'].sort(key=lambda f: -f[0])           # minor roads first, main roads drawn on top
                doc['p'].sort(key=lambda f: f[0])
                doc = {k: v for k, v in doc.items() if v}
                doc['n'] = table
                blob = gzip.compress(json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8'), 9, mtime=0)
                out.write(blob)
                index[f'{z}/{x}/{y}'] = [offset, len(blob)]
                offset += len(blob); tiles += 1; total += len(blob)
            os.remove(os.path.join(work, fn))
    os.replace(bin_path, os.path.join(out_dir, 'tiles-v1.bin'))
    with open(os.path.join(out_dir, 'tiles-v1.idx.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'))
    print(f'{tiles:,} tiles, {total / 1e6:.1f} MB ({time.time() - t0:.0f}s)', flush=True)
    return tiles, total


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        sys.exit(__doc__)
    src, out_dir = args[0], args[1]
    work = args[args.index('--work') + 1] if '--work' in args else os.path.join(out_dir, 'work')
    os.makedirs(out_dir, exist_ok=True); os.makedirs(work, exist_ok=True)
    filtered = os.path.join(work, 'filtered.osm.pbf')
    filter_pbf(src, filtered)
    for fn in os.listdir(work):
        if fn.startswith('b') and fn.endswith('.bin'):
            os.remove(os.path.join(work, fn))
    B = Buckets(work)
    stream(filtered, B)
    B.close()
    tiles, total = assemble(work, out_dir, B.name_list)
    meta = {'schemaVersion': 1, 'source': 'OpenStreetMap contributors (ODbL-1.0) via Geofabrik iran-latest.osm.pbf',
            'builtAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'zooms': list(ZOOMS), 'extent': E,
            'tiles': tiles, 'bytes': total, 'names': len(B.name_list)}
    with open(os.path.join(out_dir, 'tiles-v1.meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print(json.dumps(meta), flush=True)


if __name__ == '__main__':
    main()
