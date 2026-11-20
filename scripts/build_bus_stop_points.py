#!/usr/bin/env python3
"""Stop coordinates and OSM `ref` tags for every bus guide variant, in the Mini App guide's stop order.

The Mini App guide (apps/miniapp/assets/bus-guide.json) carries names only. To show live arrivals for a stop the
server must know the municipal station number, so it joins these OpenStreetMap points with the private municipal stop
list at run time (packages/core/src/bus/stop-match.ts). This file is public OpenStreetMap data (ODbL-1.0); it holds no
third-party stop list and no station numbers that did not come from an OSM `ref` tag.

Format: {"v":1,"meta":{...},"n":[guide stop names],"p":{"<variant id>":[[lat, lon, ref|null, name index], ...]}}
Variants that exist only in the corrections overlay (no OSM geometry) are left out.

Usage: build_bus_stop_points.py [--check] [--output PATH]
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / 'data/bus/guide'
APP_GUIDE = ROOT / 'apps/miniapp/assets/bus-guide.json'
OUT = ROOT / 'data/bus/stop-points-v1.json'
DIGITS = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
MASHHAD = (35.9, 36.7, 59.0, 60.2)


def station_ref(raw):
    """An OSM ref is kept only when it is one plain number (the municipal numbering); anything else is null."""
    value = (raw or '').translate(DIGITS).strip()
    return value if re.fullmatch(r'[1-9][0-9]{0,5}', value) else None


def coordinate(value):
    if not isinstance(value, (int, float)) or value != value:
        raise ValueError('non-numeric coordinate')
    return round(float(value), 6)


def build():
    manifest_bytes = (GUIDE / 'manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    checked = set()
    for item in manifest['files']:
        data = (GUIDE / item['path']).read_bytes()
        if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Guide file does not match its manifest: ' + item['path'])
        checked.add(item['path'])
    if 'routes.json' not in checked:
        raise ValueError('routes.json is not covered by the guide manifest')
    routes = json.loads((GUIDE / 'routes.json').read_text(encoding='utf-8'))['routes']
    app_bytes = APP_GUIDE.read_bytes()
    app = json.loads(app_bytes)
    names = app['n']
    variants = {v['i']: v['s'] for line in app['l'] for v in line['v']}
    points, with_ref = {}, 0
    for route in sorted(routes, key=lambda r: int(r['id'].rsplit(':', 1)[1])):
        variant_id = int(route['id'].rsplit(':', 1)[1])
        if variant_id not in variants:
            raise ValueError('Route missing from the Mini App guide: ' + route['id'])
        sequence = variants[variant_id]
        stops = route['stops']
        if [s['name_raw'] for s in stops] != [names[i] for i in sequence]:
            raise ValueError('Stop order differs from the Mini App guide: ' + route['id'])
        row = []
        for stop, name_index in zip(stops, sequence):
            lat, lon = coordinate(stop['lat']), coordinate(stop['lon'])
            if not (MASHHAD[0] <= lat <= MASHHAD[1] and MASHHAD[2] <= lon <= MASHHAD[3]):
                raise ValueError('Stop outside Mashhad: ' + stop['stop_id'])
            ref = station_ref(stop.get('ref_raw'))
            with_ref += ref is not None
            row.append([lat, lon, ref, name_index])
        points[str(variant_id)] = row
    data = {
        'v': 1,
        'meta': {
            'source': 'OpenStreetMap', 'attribution': '© OpenStreetMap contributors', 'license': 'ODbL-1.0',
            'osm_base': app['meta']['osm_base'],
            'guide_sha256': hashlib.sha256(app_bytes).hexdigest(),
            'guide_manifest_sha256': hashlib.sha256(manifest_bytes).hexdigest(),
            'ref_meaning': 'OSM ref tag, expected to be the municipal station number; verified against the official '
                           'list by distance at run time, never trusted alone',
            'counts': {'variants': len(points), 'positions': sum(len(r) for r in points.values()), 'with_ref': with_ref},
        },
        'n': names,
        'p': points,
    }
    return json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='fail if output bytes are not current; never write')
    parser.add_argument('--output', type=Path, default=OUT, help='output path')
    args = parser.parse_args()
    content = build().encode('utf-8')
    if args.check:
        if not args.output.exists() or args.output.read_bytes() != content:
            sys.exit(f'{args.output} is stale; rerun scripts/build_bus_stop_points.py')
        print(args.output, 'is current')
    else:
        args.output.write_bytes(content)
        print('wrote', args.output, len(content), 'bytes')
