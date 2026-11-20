import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { baseName, createStopMatcher, distanceM, loadStopPoints, sameName, type StopPoint } from '../../src/bus/stop-match.js';
import type { OfficialStop } from '../../src/bus/eta.js';

// Synthetic street running north along lon 59.6; 1 m east is about 0.0000112 degrees of longitude here.
const LAT = 36.3, LON = 59.6, M_LON = 1 / (111320 * Math.cos(LAT * Math.PI / 180)), M_LAT = 1 / 110950;
const at = (northM: number, eastM: number) => ({ lat: LAT + northM * M_LAT, lon: LON + eastM * M_LON });
const official = (number: number, name: string, northM: number, eastM: number): OfficialStop => ({ number, name, ...at(northM, eastM) });
const point = (name: string, northM: number, ref: number | null = null, eastM = 0): StopPoint => ({ name, ref, ...at(northM, eastM) });

describe('names and distances', () => {
  it('compares stop names without the prefix, side numbers, digits style, spacing or letter variants', () => {
    expect(baseName('ایستگاه پانیذ ۳')).toBe('پانیذ');
    expect(sameName('ایستگاه چوبک', 'چوبک1')).toBe(true);
    expect(sameName('ايستگاه ميدان شهدا', 'میدان شهدا')).toBe(true);
    expect(sameName('ایستگاه پایانه امام رضا', 'پایانه امام رضا (ع)')).toBe(true);
    expect(sameName('ایستگاه تقاطع فجر', 'ابتدای بلوار طبرسی شمالی')).toBe(false);
    expect(sameName('ایستگاه ۱', '2')).toBe(false);
  });
  it('measures short distances in metres', () => {
    const a = at(0, 0), b = at(100, 0), c = at(0, 100);
    expect(Math.round(distanceM(a.lat, a.lon, b.lat, b.lon))).toBe(100);
    expect(Math.round(distanceM(a.lat, a.lon, c.lat, c.lon))).toBe(100);
  });
});

describe('matching a variant to official stations (fail-closed)', () => {
  it('an OSM ref within 150 m is the station, even when the official name was changed', () => {
    const m = createStopMatcher([official(4804, 'شهید دارایی 13', 30, 12)]);
    expect(m.matchVariant([point('ایستگاه پانیذ ۹', 0, 4804)])[0]).toEqual({ match: { number: 4804, name: 'شهید دارایی 13', method: 'osm_ref', distanceM: 32 }, candidates: [] });
  });
  it('a ref that points far away is not trusted: the stop falls back to name and distance', () => {
    const m = createStopMatcher([official(1, 'میدان شهدا', 400, 0), official(2, 'میدان شهدا', 0, 12)]);
    expect(m.matchVariant([point('ایستگاه میدان شهدا', 0, 1)])[0]!.match).toMatchObject({ number: 2, method: 'nearby_name' });
  });
  it('the two sides of a street share a name: the station on the right of the direction of travel is chosen', () => {
    const m = createStopMatcher([official(11, 'کوثر', 0, 14), official(12, 'کوثر', 0, -14)]);
    const north = [point('ایستگاه الف', -300), point('ایستگاه کوثر', 0), point('ایستگاه ب', 300)];
    const south = [...north].reverse();
    expect(m.matchVariant(north)[1]!.match).toMatchObject({ number: 11, method: 'nearby_side' });   // heading north: east is right
    expect(m.matchVariant(south)[1]!.match).toMatchObject({ number: 12, method: 'nearby_side' });   // heading south: west is right
  });
  it('several same-name stations on one side (a terminal) stay unmatched and are offered as candidates, nearest first', () => {
    const m = createStopMatcher([official(21, 'پایانه انقلاب اسلامی', 0, 40), official(22, 'پایانه انقلاب اسلامی', 0, 20), official(23, 'پایانه انقلاب اسلامی', 10, 30)]);
    const [first] = m.matchVariant([point('ایستگاه پایانه انقلاب اسلامی', 0), point('ایستگاه بعدی', 300)]);
    expect(first!.match).toBeNull();
    expect(first!.candidates.map(c => c.number)).toEqual([22, 23, 21]);
  });
  it('no same-name station within 60 m means no match and no candidates (never the nearest stranger)', () => {
    const m = createStopMatcher([official(31, 'بیمارستان امام رضا', 0, 10), official(32, 'کوثر', 0, 90)]);
    expect(m.matchVariant([point('ایستگاه کوثر', 0)])[0]).toEqual({ match: null, candidates: [] });
  });
});

describe('stop points file', () => {
  it('the committed OSM points load: every guide variant from OSM, every point inside Mashhad, refs plain numbers', () => {
    const points = loadStopPoints();
    expect(points.size).toBe(180);
    let positions = 0;
    for (const rows of points.values()) for (const p of rows) {
      positions++;
      expect(p.lat).toBeGreaterThan(35.9); expect(p.lat).toBeLessThan(36.7);
      expect(p.ref === null || (Number.isInteger(p.ref) && p.ref > 0)).toBe(true);
      expect(p.name.trim()).not.toBe('');
    }
    expect(positions).toBe(5275);
  });
});

describe('GET /app/api/bus/variant-stops', () => {
  const stops = [official(4804, 'میدان شهدا', 5, 8), official(11, 'کوثر', 300, 14), official(12, 'کوثر', 300, -14)];
  const points = new Map<number, StopPoint[]>([[77, [point('ایستگاه میدان شهدا', 0, 4804), point('ایستگاه کوثر', 300), point('ایستگاه ناشناخته', 600)]]]);
  it('returns the official station (or candidates) for every stop, cacheable for 10 minutes', async () => {
    const app = buildServer({ busStops: () => stops, busPoints: () => points });
    const r = await app.inject({ method: 'GET', url: '/app/api/bus/variant-stops?variant=77' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('private, max-age=600');
    expect(r.json()).toEqual({ schemaVersion: 1, source: 'mashhad_geoportal', variant: 77, stops: [
      { match: { number: 4804, name: 'میدان شهدا', method: 'osm_ref' }, candidates: [] },
      { match: { number: 11, name: 'کوثر', method: 'nearby_side' }, candidates: [] },
      { match: null, candidates: [] },
    ] });
  });
  it('400 for a malformed variant, 404 for an unknown one, 503 without the official list; errors are no-store', async () => {
    const app = buildServer({ busStops: () => stops, busPoints: () => points });
    for (const [url, code] of [['?variant=abc', 400], ['', 400], ['?variant=1234567890123', 400], ['?variant=78', 404]] as const) {
      const r = await app.inject({ method: 'GET', url: '/app/api/bus/variant-stops' + url });
      expect(r.statusCode).toBe(code);
      expect(r.headers['cache-control']).toBe('no-store');
    }
    const none = buildServer({ busStops: () => null, busPoints: () => points });
    expect((await none.inject({ method: 'GET', url: '/app/api/bus/variant-stops?variant=77' })).statusCode).toBe(503);
    const broken = buildServer({ busStops: () => stops, busPoints: () => { throw new Error('missing file'); } });
    expect((await broken.inject({ method: 'GET', url: '/app/api/bus/variant-stops?variant=77' })).statusCode).toBe(503);
  });
});
