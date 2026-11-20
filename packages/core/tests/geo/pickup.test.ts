import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { createRoadIndex, distM, pickupCandidates, type RoadWay } from '../../src/geo/pickup.js';

// A synthetic crossing near Shohada: a north-south avenue, an east-west street 60 m north, and three places a car cannot
// stop for a passenger: a motorway, a tunnel and a bridge.
const LAT = 36.2975, LON = 59.6059, M_LAT = 1 / 111195, M_LON = 1 / (111195 * Math.cos(LAT * Math.PI / 180));
const pt = (northM: number, eastM: number): [number, number] => [LAT + northM * M_LAT, LON + eastM * M_LON];
const WAYS: RoadWay[] = [
  { id: 1, tags: { highway: 'primary', name: 'خیابان امام رضا' }, geometry: [pt(-400, 20), pt(400, 20)] },
  { id: 2, tags: { highway: 'residential', name: 'کوچهٔ ۱۲' }, geometry: [pt(60, -300), pt(60, 300)] },
  { id: 3, tags: { highway: 'motorway', name: 'بزرگراه' }, geometry: [pt(-400, -30), pt(400, -30)] },
  { id: 4, tags: { highway: 'primary', name: 'تونل شرقی', tunnel: 'yes' }, geometry: [pt(-400, 5), pt(400, 5)] },
  { id: 5, tags: { highway: 'secondary', name: 'پل هوایی', bridge: 'yes' }, geometry: [pt(-15, -300), pt(-15, 300)] },
];
const index = createRoadIndex(WAYS);

describe('pickup candidates on nearby streets', () => {
  it('nearest point of each street first, then points along them; never a motorway, tunnel or bridge; spread at least 30 m', () => {
    const c = pickupCandidates(index, { lat: LAT, lon: LON });
    expect(c.length).toBeGreaterThanOrEqual(4);
    expect(c.slice(0, 2).map(x => x.street)).toEqual(['خیابان امام رضا', 'کوچهٔ ۱۲']);
    expect(c[0]).toMatchObject({ walkM: 20, kind: 'nearest' });
    expect(c.every(x => !['بزرگراه', 'تونل شرقی', 'پل هوایی'].includes(x.street ?? '') && x.walkM <= 200)).toBe(true);
    expect(index.size).toBe(2);
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) expect(distM([c[i]!.lat, c[i]!.lon], [c[j]!.lat, c[j]!.lon])).toBeGreaterThanOrEqual(30);
    expect(c.some(x => x.kind === 'along' && x.street === 'خیابان امام رضا')).toBe(true);
  });
  it('a point far from every street has no candidates', () => {
    expect(pickupCandidates(index, { lat: LAT + 0.01, lon: LON + 0.01 })).toEqual([]);
  });
  it('POST /app/api/snapp/candidates answers for both ends; without road data it says 503', async () => {
    const app = buildServer({ snapp: { client: null, roads: () => index } as never });
    const r = await app.inject({ method: 'POST', url: '/app/api/snapp/candidates', payload: { from: { lat: LAT, lon: LON }, to: { lat: LAT + 0.0005, lon: LON } } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ schemaVersion: 1, source: 'osm', origins: expect.any(Array), destinations: expect.any(Array) });
    const none = buildServer({ snapp: { client: null, roads: () => null } as never });
    expect((await none.inject({ method: 'POST', url: '/app/api/snapp/candidates', payload: { from: { lat: LAT, lon: LON }, to: { lat: LAT, lon: LON } } })).json()).toEqual({ error: 'no_roads' });
  });
});
