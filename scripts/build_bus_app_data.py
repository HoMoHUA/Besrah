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
OVERLAY = ROOT / 'data/bus/corrections/ui-v1.json'


def natural(ref):
    match = re.match(r'(?:EXP-)?(\d+)', ref)
    return (0, int(match.group(1)), ref) if match else (1, 0, ref)


def require(condition, message):
    if not condition:
        raise ValueError('Invalid corrections overlay: ' + message)


def keys(value, required, optional=()):
    require(isinstance(value, dict), 'expected an object')
    require(set(required) <= value.keys() <= set(required) | set(optional),
            'missing or unsupported fields: ' + ', '.join(sorted(value)))


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON key: ' + key)
        result[key] = value
    return result


def text(value):
    return isinstance(value, str) and bool(value.strip())


def positive_id(value):
    return type(value) is int and 0 < value <= 9007199254740991


def validate_overlay(overlay, manifest_bytes, names, lines):
    keys(overlay, ('schema_version', 'overlay_id', 'base_guide_manifest_sha256',
                   'preserved_ui_sha256', 'preserved_ui_semantics_sha256',
                   'appended_names', 'ref_corrections', 'added_lines'))
    require(type(overlay['schema_version']) is int and overlay['schema_version'] == 1,
            'unsupported schema version')
    require(overlay['overlay_id'] == 'bus-ui-corrections-v1', 'unsupported overlay id')
    for field in ('base_guide_manifest_sha256', 'preserved_ui_sha256', 'preserved_ui_semantics_sha256'):
        require(isinstance(overlay[field], str) and re.fullmatch('[0-9a-f]{64}', overlay[field]),
                'malformed SHA-256: ' + field)
    require(overlay['base_guide_manifest_sha256'] == hashlib.sha256(manifest_bytes).hexdigest(),
            'base guide manifest hash mismatch')
    for field in ('appended_names', 'ref_corrections', 'added_lines'):
        require(isinstance(overlay[field], list), 'expected list: ' + field)
    all_names = set(names)
    for name in overlay['appended_names']:
        require(text(name) and name not in all_names, 'empty or duplicate appended name')
        all_names.add(name)
    name_count = len(names) + len(overlay['appended_names'])
    sources, targets = set(), set()
    for correction in overlay['ref_corrections']:
        keys(correction, ('from', 'to', 'variant_ids', 'evidence'))
        source, target = correction['from'], correction['to']
        require(text(source) and source in lines and source not in sources,
                'unknown or duplicate correction source')
        require(text(target) and re.fullmatch(r'(?:EXP-)?[0-9]+(?:[/.][0-9]+)?', target),
                'malformed correction target')
        require(source != target and target not in targets, 'cyclic or duplicate correction target')
        ids = correction['variant_ids']
        require(isinstance(ids, list) and all(positive_id(i) for i in ids)
                and ids == [v['i'] for v in lines[source]], 'correction variant IDs differ from source')
        evidence = correction['evidence']
        keys(evidence, ('kind', 'official_verification'))
        require(evidence['kind'] == 'owner_request' and evidence['official_verification'] is False,
                'unsupported correction evidence')
        sources.add(source)
        targets.add(target)
    require(not sources & targets, 'chained or cyclic corrections')
    refs = set(lines) | targets
    ids = {v['i'] for group in lines.values() for v in group}
    for line in overlay['added_lines']:
        keys(line, ('r', 'v', 'provenance'))
        ref = line['r']
        require(text(ref) and re.fullmatch(r'[0-9]+', ref) and ref not in refs,
                'malformed, duplicate or existing added ref')
        refs.add(ref)
        require(isinstance(line['v'], list) and bool(line['v']), 'empty variants')
        for variant in line['v']:
            keys(variant, ('i', 'f', 't', 'd', 's'))
            require(positive_id(variant['i']) and variant['i'] not in ids, 'invalid or duplicate variant ID')
            ids.add(variant['i'])
            require(text(variant['f']) and text(variant['t']), 'empty endpoint')
            require(type(variant['d']) is int and variant['d'] in (0, 1), 'invalid derived flag')
            require(isinstance(variant['s'], list) and bool(variant['s'])
                    and all(type(i) is int and 0 <= i < name_count for i in variant['s']),
                    'empty sequence or invalid stop index')
        provenance = line['provenance']
        keys(provenance, ('route_existence', 'areas_status', 'areas', 'endpoints_status',
                          'stop_sequence_status', 'official_verification', 'source'),
             ('headway_announcement',))
        require(provenance['route_existence'] == 'owner_specified'
                and provenance['official_verification'] is False
                and provenance['source'] == 'preserved_existing_ui_not_official_source',
                'unsupported route existence provenance')
        require(provenance['endpoints_status'] == 'assistant_entered_unverified'
                and provenance['stop_sequence_status'] == 'assistant_entered_unverified',
                'added endpoint and stop sequence must remain assistant-entered and unverified')
        require(isinstance(provenance['areas'], list) and all(text(area) for area in provenance['areas']),
                'invalid areas')
        require(provenance['areas_status'] == ('owner_specified' if ref == '129' else 'not_independently_verified'),
                'unsupported areas provenance')
        require(bool(provenance['areas']) if ref == '129' else not provenance['areas'],
                'areas must reflect the owner instruction, not assistant sequences')
        require(('headway_announcement' in provenance) == (ref == '129'),
                'only line 129 must retain its headway announcement')
        if 'headway_announcement' in provenance:
            announcement = provenance['headway_announcement']
            keys(announcement, ('minutes', 'kind', 'time_specific_schedule', 'operationally_verified'))
            require(ref == '129' and positive_id(announcement['minutes'])
                    and announcement['minutes'] == 10
                    and announcement['kind'] == 'owner_reported_announcement'
                    and announcement['time_specific_schedule'] is False
                    and announcement['operationally_verified'] is False,
                    'headway is only an unverified owner-reported announcement, never a schedule')


def build(*, overlay_path=OVERLAY):
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
    guide_counts = {'lines': len(lines), 'variants': len(routes),
                    'stop_occurrences': sum(len(v['s']) for group in lines.values() for v in group),
                    'stop_names': len(names)}
    overlay_bytes = overlay_path.read_bytes()
    overlay = json.loads(overlay_bytes, object_pairs_hook=unique_object)
    validate_overlay(overlay, manifest_bytes, names, lines)
    names.extend(overlay['appended_names'])
    for correction in overlay['ref_corrections']:
        lines.setdefault(correction['to'], []).extend(lines.pop(correction['from']))
    for line in overlay['added_lines']:
        lines[line['r']] = line['v']
    final_lines = [{'r': ref, 'v': lines[ref]} for ref in sorted(lines, key=natural)]
    variants = [v for line in final_lines for v in line['v']]
    used_names = {i for v in variants for i in v['s']}
    semantics = json.dumps({'n': names, 'l': final_lines}, ensure_ascii=False, separators=(',', ':'))
    semantics_hash = hashlib.sha256(semantics.encode('utf-8')).hexdigest()
    require(semantics_hash == overlay['preserved_ui_semantics_sha256'], 'preserved UI semantics hash mismatch')
    meta = manifest['meta']
    data = {
        'v': 1,
        'meta': {
            'source_database_sha256': meta['source_database_sha256'],
            'guide_manifest_sha256': hashlib.sha256(manifest_bytes).hexdigest(),
            'osm_base': meta['source_snapshot']['osm3s']['timestamp_osm_base'],
            'attribution': meta['attribution'], 'license': meta['license'],
            'official_completeness_verified': False, 'live_arrivals': False,
            'counts': {'lines': len(final_lines), 'variants': len(variants),
                       'stop_occurrences': sum(len(v['s']) for v in variants), 'stop_names': len(names),
                       'used_stop_names': len(used_names), 'unused_stop_names': len(names) - len(used_names)},
            'guide_counts': guide_counts,
            'overlay_counts': {
                'added_lines': len(overlay['added_lines']),
                'added_variants': sum(len(line['v']) for line in overlay['added_lines']),
                'added_stop_occurrences': sum(len(v['s']) for line in overlay['added_lines'] for v in line['v']),
                'appended_stop_names': len(overlay['appended_names']),
                'ref_corrections': len(overlay['ref_corrections']),
            },
            'corrections_overlay_id': overlay['overlay_id'],
            'corrections_overlay_sha256': hashlib.sha256(overlay_bytes).hexdigest(),
            'ui_semantics_sha256': hashlib.sha256(semantics.encode('utf-8')).hexdigest(),
            'preserved_ui_sha256': overlay['preserved_ui_sha256'],
            'ref_aliases': {c['from']: c['to'] for c in overlay['ref_corrections']},
            'ref_correction_provenance': overlay['ref_corrections'],
            'overlay_provenance': [
                {'ref': line['r'], 'variant_ids': [v['i'] for v in line['v']], **line['provenance']}
                for line in overlay['added_lines']
            ],
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
