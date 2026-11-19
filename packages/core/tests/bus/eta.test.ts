import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { createBusEta, parseArrivals, parseProviderDate, validStation } from '../../src/bus/eta.js';

// Shape captured from map.mashhad.ir on 2026-11-19 (station 1001), trimmed.
const OBSERVED_MS = 1795082703000;
const SAMPLE = { success: true, status_code: 200, messages: [], result: { d: [
  { Blink: null, Destination: 'پایانه آزادی', ETA_Time: '-', Line_Id: '269', Line_Number: '38.1', Station_Id: '10359',
    bus_info: { bus_id: 0, date: '/Date(1795083004936+0330)/', latitude: 0, longitude: 0, speed: 0, station_number: 0 } },
  { Blink: '0', Destination: 'پايانه زكريا', ETA_Time: '1', Line_Id: '31', Line_Number: '38', Station_Id: '11235',
    bus_info: { bus_id: 3959, date: `/Date(${OBSERVED_MS}+0330)/`, distantce: 135, latitude: 36298986, longitude: 59605538, speed: 11.2, station_number: 4804 } },
] } };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('parsing (fail-closed)', () => {
  it('a fresh bus with an integer ETA is live; "-" is no bus; the soonest comes first', () => {
    const a = parseArrivals(SAMPLE, OBSERVED_MS + 40_000)!;
    expect(a[0]).toEqual({ line: '38', destination: 'پايانه زكريا', etaMin: 1, state: 'live', bus: { lat: 36.29899, lon: 59.60554, speedKmh: 11.2, observedAt: new Date(OBSERVED_MS).toISOString(), ageS: 40 } });
    expect(a[1]).toMatchObject({ line: '38.1', etaMin: null, state: 'no_bus', bus: null });
  });
  it('an old bus position makes the ETA unknown ("stale"), never a number', () => {
    expect(parseArrivals(SAMPLE, OBSERVED_MS + 600_000)!.find(x => x.line === '38')).toMatchObject({ etaMin: null, state: 'stale' });
  });
  it('an ETA without a real bus position, or a position outside Mashhad, is not shown as minutes', () => {
    const noPos = { success: true, result: { d: [{ Line_Number: '10', ETA_Time: '5', bus_info: { bus_id: 0, latitude: 0, longitude: 0 } }] } };
    expect(parseArrivals(noPos, OBSERVED_MS)![0]).toMatchObject({ etaMin: null, state: 'unknown' });
    const far = { success: true, result: { d: [{ Line_Number: '10', ETA_Time: '5', bus_info: { bus_id: 9, latitude: 35700000, longitude: 51400000, date: `/Date(${OBSERVED_MS})/` } }] } };
    expect(parseArrivals(far, OBSERVED_MS)![0]).toMatchObject({ etaMin: null, bus: null });
  });
  it('malformed bodies are rejected and rows without a line are dropped', () => {
    for (const bad of [null, {}, { success: false, result: { d: [] } }, { success: true, result: {} }, 'x']) expect(parseArrivals(bad, OBSERVED_MS)).toBeNull();
    expect(parseArrivals({ success: true, result: { d: [{ ETA_Time: '3' }, null] } }, OBSERVED_MS)).toEqual([]);
  });
  it('dates and station numbers are validated', () => {
    expect(parseProviderDate('/Date(1795082703000+0330)/')).toBe(1795082703000);
    expect(parseProviderDate('2026-11-19')).toBeNull();
    expect([validStation('1001'), validStation(4804), validStation('0'), validStation('12a'), validStation('1234567'), validStation(undefined)]).toEqual([1001, 4804, null, null, null, null]);
  });
});

describe('adapter', () => {
  it('caches a station for 30 s, shares an in-flight request, and sends nothing about the caller', async () => {
    let t = OBSERVED_MS, calls: string[] = [];
    const eta = createBusEta({ now: () => t, fetch: (async (url: string, init: RequestInit) => { calls.push(url); expect(JSON.stringify(init.headers)).not.toMatch(/cookie|authorization/i); return response(SAMPLE); }) as unknown as typeof fetch });
    const [a, b] = await Promise.all([eta.arrivals('1001'), eta.arrivals(1001)]);
    expect(a.status).toBe('ok'); expect(b).toBe(a);
    expect(calls).toEqual(['https://map.mashhad.ir/api/proxy/eta/?Station_Number=1001']);
    t += 20_000; await eta.arrivals('1001'); expect(calls).toHaveLength(1);
    t += 20_000; await eta.arrivals('1001'); expect(calls).toHaveLength(2);
  });
  it('upstream failures are "unavailable" and are not cached; a bad station never reaches the provider', async () => {
    let n = 0;
    const eta = createBusEta({ now: () => OBSERVED_MS, fetch: (async () => { n++; if (n === 1) throw new Error('timeout'); if (n === 2) return response({}, 500); return response(SAMPLE); }) as unknown as typeof fetch });
    expect((await eta.arrivals('1001')).status).toBe('unavailable');
    expect((await eta.arrivals('1001')).status).toBe('unavailable');
    expect((await eta.arrivals('1001')).status).toBe('ok');
    expect((await eta.arrivals('x')).status).toBe('bad_station');
    expect(n).toBe(3);
  });
});

describe('GET /app/api/bus/eta', () => {
  it('answers 200 / 400 / 503 honestly with no-store', async () => {
    const eta = createBusEta({ now: () => OBSERVED_MS + 10_000, fetch: (async (url: string) => url.includes('=2') ? response({}, 502) : response(SAMPLE)) as unknown as typeof fetch });
    const app = buildServer({ busEta: eta });
    const ok = await app.inject({ method: 'GET', url: '/app/api/bus/eta?station=1001' });
    expect(ok.statusCode).toBe(200); expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.json()).toMatchObject({ status: 'ok', station: 1001, source: 'mashhad_geoportal', arrivals: [{ line: '38', etaMin: 1, state: 'live' }, { line: '38.1', state: 'no_bus' }] });
    expect((await app.inject({ method: 'GET', url: '/app/api/bus/eta?station=abc' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/app/api/bus/eta?station=2' })).statusCode).toBe(503);
    await app.close();
  });
});

describe('official stops (private file, POST search)', () => {
  const FILE = { features: [
    { properties: { stationnumber: 1001, stationname: 'میدان شهدا', isactive: true }, geometry: { coordinates: [59.6055, 36.2990] } },
    { properties: { stationnumber: 4804, stationname: 'ميدان شهداي اول', isactive: true }, geometry: { coordinates: [59.6050, 36.2985] } },
    { properties: { stationnumber: 17, stationname: 'چوبک1', isactive: true }, geometry: { coordinates: [59.2669, 36.3159] } },
    { properties: { stationnumber: 18, stationname: 'غیرفعال', isactive: false }, geometry: { coordinates: [59.5, 36.3] } },
    { properties: { stationnumber: 19, stationname: 'تهران', isactive: true }, geometry: { coordinates: [51.4, 35.7] } },
  ] };
  it('loads only active stops inside Mashhad and searches by normalised name or number prefix', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs'); const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'stops-')), path = join(dir, 's.json'); writeFileSync(path, JSON.stringify(FILE));
    const { loadOfficialStops, searchOfficialStops } = await import('../../src/bus/eta.js');
    const stops = loadOfficialStops(path);
    expect(stops.map(s => s.number)).toEqual([1001, 4804, 17]);
    expect(searchOfficialStops(stops, 'میدان شهدا').map(s => s.number)).toEqual([1001, 4804]);   // Arabic ي matches Persian ی
    expect(searchOfficialStops(stops, '48').map(s => s.number)).toEqual([4804]);
    expect(searchOfficialStops(stops, 'م')).toEqual([]);
  });
  it('POST /app/api/bus/stops returns names and numbers only; without the file it says 503', async () => {
    const stops = () => [{ number: 1001, name: 'میدان شهدا', lat: 36.299, lon: 59.6055 }];
    const app = buildServer({ busStops: stops });
    const post = (payload: unknown) => app.inject({ method: 'POST', url: '/app/api/bus/stops', payload: JSON.stringify(payload), headers: { 'content-type': 'application/json' } });
    expect((await post({ q: 'شهدا' })).json()).toEqual({ schemaVersion: 1, source: 'mashhad_geoportal', stops: [{ number: 1001, name: 'میدان شهدا' }] });
    expect((await post({ q: 'x', extra: 1 })).statusCode).toBe(400);
    expect((await post({ q: 'a'.repeat(61) })).statusCode).toBe(400);
    await app.close();
    const bare = buildServer({ busStops: () => null });
    expect((await bare.inject({ method: 'POST', url: '/app/api/bus/stops', payload: '{"q":"شهدا"}', headers: { 'content-type': 'application/json' } })).statusCode).toBe(503);
    await bare.close();
  });
});
