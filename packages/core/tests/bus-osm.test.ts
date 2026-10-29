import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { osmToBusLines, OsmElement } from '../src/bus/osm.js';

const sample = JSON.parse(readFileSync(new URL('./fixtures/overpass-bus-format-sample.json', import.meta.url), 'utf8'));

describe('OSM bus converter (format only)', () => {
  const out = osmToBusLines(sample, '2026-10-24T00:00:00Z');

  it('keeps stop-like members in order, drops ways, dedupes repeated nodes', () => {
    const t1 = out.routes.find(r => r.ref === 'T1')!;
    expect(t1.stops.map(s => s.osm_node_id)).toEqual([11, 12, 13]);
    expect(t1.stops[0].name).toBe('ایستگاه یک');
  });

  it('never invents headways: every route is unknown', () => {
    expect(out.routes.every(r => r.headway_min === null && r.headway_quality === 'unknown')).toBe(true);
  });

  it('drops relations with fewer than 2 usable stops and says why', () => {
    expect(out.routes.some(r => r.ref === 'T2')).toBe(false);
    expect(out.dropped).toEqual([{ osm_relation_id: 1002, reason: 'only 1 usable stop(s)' }]);
  });

  it('ignores non-bus relations and nodes without coordinates', () => {
    const el: OsmElement[] = [
      { type: 'relation', id: 5, tags: { route: 'share_taxi' }, members: [{ type: 'node', ref: 1, role: 'stop' }, { type: 'node', ref: 2, role: 'stop' }] },
      { type: 'node', id: 1, lat: 36, lon: 59 }, { type: 'node', id: 2 },
    ];
    expect(osmToBusLines({ elements: el }).routes).toEqual([]);
  });
});
