#!/usr/bin/env python3
"""Project the reviewed static bus guide into the compact Mini App file (names only: no coordinates, no geometry).

Usage: build_bus_app_data.py [--check]   (--check fails if the committed file is stale)
"""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / 'data/bus/guide'
OUT = ROOT / 'apps/miniapp/assets/bus-guide.json'


def natural(ref):
    match = re.match(r'\d+', ref)
    return (0, int(match.group()), ref) if match else (1, 0, ref)


def build():
    manifest_bytes = (GUIDE / 'manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    for item in manifest['files']:
        data = (GUIDE / item['path']).read_bytes()
        if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Guide file does not match its manifest: ' + item['path'])
    routes = json.loads((GUIDE / 'routes.json').read_text(encoding='utf-8'))['routes']
    names, name_ids, lines = [], {}, {}
    for route in sorted(routes, key=lambda r: int(r['id'].rsplit(':', 1)[1])):
        ends = route['endpoint_display']
        origin, destination = ends['from']['name'], ends['to']['name']
        if not origin or not destination or not route['ref_raw']:
            raise ValueError('Route without display endpoints or ref: ' + route['id'])
        stops = []
        for stop in route['stops']:
            name = stop['name_raw']
            if not name:
                raise ValueError('Linked stop without a name: ' + route['id'])
            if name not in name_ids:
                name_ids[name] = len(names)
                names.append(name)
            stops.append(name_ids[name])
        derived = int(any(ends[k]['method'] != 'explicit_source_tag' for k in ('from', 'to')))
        lines.setdefault(route['ref_raw'], []).append(
            {'i': int(route['id'].rsplit(':', 1)[1]), 'f': origin, 't': destination, 'd': derived, 's': stops})
    meta = manifest['meta']
    data = {
        'v': 1,
        'meta': {
            'source_database_sha256': meta['source_database_sha256'],
            'guide_manifest_sha256': hashlib.sha256(manifest_bytes).hexdigest(),
            'osm_base': meta['source_snapshot']['osm3s']['timestamp_osm_base'],
            'attribution': meta['attribution'], 'license': meta['license'],
            'official_completeness_verified': False, 'live_arrivals': False,
            'counts': {'lines': len(lines), 'variants': len(routes), 'stop_occurrences': sum(len(v['s']) for g in lines.values() for v in g), 'stop_names': len(names)},
        },
        'n': names,
        'l': [{'r': ref, 'v': lines[ref]} for ref in sorted(lines, key=natural)],
    }
    return json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'


if __name__ == '__main__':
    content = build()
    if sys.argv[1:] == ['--check']:
        if not OUT.exists() or OUT.read_text(encoding='utf-8') != content:
            sys.exit('apps/miniapp/assets/bus-guide.json is stale; rerun scripts/build_bus_app_data.py')
        print('bus-guide.json is current')
    else:
        OUT.write_text(content, encoding='utf-8')
        print('wrote', OUT, len(content.encode()), 'bytes')
