// Door-to-door trip: adapter honesty, planner arithmetic, option distinctness, routes validation and privacy.
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { createNeshan, neshanOptionsFromEnv, RouterError, noRouter, type LatLon, type RouteMode, type Router } from '../../src/trip/neshan.js';
import { loadStationGeo } from '../../src/trip/routes.js';
import { ACCESS_S, EGRESS_S, hhmm, planTrip, pickDistinct, type MetroAnswer, type MetroPlanner, type StationGeo } from '../../src/trip/plan.js';

const NOW_MS = Date.parse('2026-11-04T09:00:00Z');
const NOW = NOW_MS / 1000;
const KEY = 'service.abcdefghijklmnop0123456789abcdef';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const dirBody = (sec: number, m: number) => ({ routes: [{ overview_polyline: { points: 'x' }, legs: [{ duration: { value: sec }, distance: { value: m }, steps: [] }] }] });

describe('Neshan adapter', () => {
  it('sends the key only as a header, never in the URL, and parses seconds and metres', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const r = createNeshan({ directionKey: KEY, geocodingKey: KEY, now: () => NOW_MS, fetch: (async (url: string, init: RequestInit) => { seen.push({ url, headers: init.headers as Record<string, string> }); return json(dirBody(600, 1200)); }) as typeof fetch });
    const leg = await r.route('pedestrian', { lat: 36.3, lon: 59.6 }, { lat: 36.31, lon: 59.61 });
    expect(leg).toMatchObject({ durationS: 600, distanceM: 1200, traffic: 'none', source: 'neshan' });
    const car = await r.route('car', { lat: 36.3, lon: 59.6 }, { lat: 36.31, lon: 59.61 });
    expect(car.traffic).toBe('provider_traffic');
    expect(seen[0]!.url).toContain('type=pedestrian');
    for (const s of seen) { expect(s.url).not.toContain(KEY); expect(s.headers['Api-Key']).toBe(KEY); }
  });

  it('answers repeated identical routes from a short cache and respects the daily cap', async () => {
    let calls = 0;
    const r = createNeshan({ directionKey: KEY, dailyCap: 2, now: () => NOW_MS, fetch: (async () => { calls++; return json(dirBody(60, 100)); }) as typeof fetch });
    const a = { lat: 36.3, lon: 59.6 };
    await r.route('car', a, { lat: 36.31, lon: 59.6 }); await r.route('car', a, { lat: 36.31, lon: 59.6 });
    expect(calls).toBe(1);
    await r.route('car', a, { lat: 36.32, lon: 59.6 });
    await expect(r.route('car', a, { lat: 36.33, lon: 59.6 })).rejects.toMatchObject({ code: 'rate_limited' });
    expect(calls).toBe(2);
  });

  it.each([
    ['HTTP 403', () => json({}, 403), 'unauthorized'],
    ['body code 485', () => json({ status: 'ERROR', code: 485, message: 'Api Key services not match.' }), 'unauthorized'],
    ['HTTP 429', () => json({}, 429), 'rate_limited'],
    ['malformed legs', () => json({ routes: [{ legs: [{ duration: { value: 'x' }, distance: { value: 1 } }] }] }), 'bad_response'],
    ['no routes', () => json({ routes: [] }), 'no_route'],
  ])('maps %s to %s and never invents a duration', async (_n, reply, code) => {
    const r = createNeshan({ directionKey: KEY, now: () => NOW_MS, fetch: (async () => reply()) as typeof fetch });
    await expect(r.route('car', { lat: 36.3, lon: 59.6 }, { lat: 36.31, lon: 59.6 })).rejects.toMatchObject({ code });
  });

  it('turns a network failure and a timeout into typed errors; a missing key is unavailable', async () => {
    const down = createNeshan({ directionKey: KEY, fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    await expect(down.route('car', { lat: 36.3, lon: 59.6 }, { lat: 36.31, lon: 59.6 })).rejects.toMatchObject({ code: 'unavailable' });
    const slow = createNeshan({ directionKey: KEY, fetch: (async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }) as typeof fetch });
    await expect(slow.route('car', { lat: 36.3, lon: 59.6 }, { lat: 36.31, lon: 59.6 })).rejects.toMatchObject({ code: 'timeout' });
    const none = createNeshan({});
    expect(none.configured).toBe(false);
    await expect(none.route('car', { lat: 36.3, lon: 59.6 }, { lat: 36.31, lon: 59.6 })).rejects.toBeInstanceOf(RouterError);
  });

  it('queues calls beyond the in-flight cap instead of failing them', async () => {
    let active = 0, peak = 0;
    const r = createNeshan({ directionKey: KEY, maxInFlight: 2, now: () => NOW_MS, fetch: (async () => { active++; peak = Math.max(peak, active); await new Promise(res => setTimeout(res, 20)); active--; return json(dirBody(60, 100)); }) as typeof fetch });
    const legs = await Promise.all([1, 2, 3, 4, 5].map(i => r.route('pedestrian', { lat: 36.3, lon: 59.6 }, { lat: 36.3 + i / 1000, lon: 59.6 })));
    expect(legs).toHaveLength(5); expect(peak).toBe(2);
  });

  it('geocoding: a denied key (485) is remembered and stops calling; results are coordinates only', async () => {
    let calls = 0;
    const denied = createNeshan({ geocodingKey: KEY, now: () => NOW_MS, fetch: (async () => { calls++; return json({ status: 'ERROR', code: 485 }); }) as typeof fetch });
    expect(await denied.geocode('مشهد دانشگاه')).toBeNull(); expect(await denied.geocode('مشهد دانشگاه')).toBeNull();
    expect(calls).toBe(1);
    const ok = createNeshan({ geocodingKey: KEY, fetch: (async () => json({ status: 'OK', location: { x: 59.5, y: 36.3 } })) as typeof fetch });
    expect(await ok.geocode('مشهد')).toEqual({ lat: 36.3, lon: 59.5 });
  });

  it('reads the key from the environment by name only and rejects malformed values', () => {
    expect(neshanOptionsFromEnv({ BESRAH_NESHAN_KEY: KEY })).toMatchObject({ directionKey: KEY, geocodingKey: KEY });
    expect(neshanOptionsFromEnv({ BESRAH_NESHAN_KEY: 'short' }).directionKey).toBeUndefined();
    expect(neshanOptionsFromEnv({ BESRAH_NESHAN_KEY: 'bad key with spaces and more than 16' }).directionKey).toBeUndefined();
    expect(neshanOptionsFromEnv({ BESRAH_NESHAN_DIRECTION_KEY: KEY, BESRAH_NESHAN_GEOCODING_KEY: KEY + 'z' })).toMatchObject({ directionKey: KEY, geocodingKey: KEY + 'z' });
  });
});

// --- planner on a tiny synthetic city: S1 and S2 on line 1, S3 on line 2 only ---
const ST: StationGeo[] = [
  { id: 'S1', name: 'مبدأ', lat: 36.300, lon: 59.500, lines: [1] },
  { id: 'S2', name: 'مقصد', lat: 36.300, lon: 59.600, lines: [1] },
  { id: 'S3', name: 'جدا', lat: 36.300, lon: 59.610, lines: [2] },
];
const home: LatLon = { lat: 36.3, lon: 59.4985 }, work: LatLon = { lat: 36.3, lon: 59.6015 };

const fakeRouter = (walkS: number, carS: number | null, log: string[] = []): Router => ({
  configured: true, stats: () => ({ calls: 0, day: '', cap: 0, lastFailure: null }), async geocode() { return null; },
  async route(mode: RouteMode, a: LatLon, b: LatLon) {
    log.push(mode);
    if (mode === 'car') { if (carS === null) throw new RouterError('unavailable'); return { mode, durationS: carS, distanceM: 11000, traffic: 'provider_traffic', source: 'neshan', fetchedAt: 0 }; }
    const m = Math.round(Math.hypot(a.lat - b.lat, a.lon - b.lon) * 111000);
    return { mode, durationS: m > 9000 ? 99999 : walkS, distanceM: m, traffic: 'none', source: 'neshan', fetchedAt: 0 };
  },
});
const trains = (departs: number[], rideS = 600): MetroPlanner => async (_line, _o, _d, ready) => {
  const options = departs.map(d => NOW + d).filter(d => d >= ready).map(d => ({ departEpoch: d, arriveEpoch: d + rideS, service: 'A' as const, toward: 'غدیر', confidence: 'official_sheet_phase', eventId: `ev1_${d}`, derivedExtension: false }));
  return { status: options.length ? 'ok' : 'no_feasible_option', message: '', options, calendarWarning: false } satisfies MetroAnswer;
};

describe('planTrip arithmetic', () => {
  it('chains measured walk + assumed access + model ride + assumed egress, and sets the latest leave time', async () => {
    const r = await planTrip(home, work, NOW, { stations: ST, router: fakeRouter(300, 2400), metro: trains([1500, 2100]), nowSec: NOW });
    const m = r.options.find(o => o.kind === 'metro')!;
    expect(m).toBeTruthy();
    // first reachable train: ready NOW + 300 walk + 180 access = 480 s, so the 1500 s train departs; leave = 1500 - 180 - 300
    expect(m.leaveEpoch).toBe(NOW + 1500 - ACCESS_S - 300);
    expect(m.arriveEpoch).toBe(NOW + 1500 + 600 + EGRESS_S + 300);
    expect(m.totalS).toBe(m.arriveEpoch! - m.leaveEpoch!);
    expect(m.ifMissed).toEqual({ departAt: hhmm(NOW + 2100), arriveAt: hhmm(NOW + 2100 + 600 + EGRESS_S + 300) });
    expect(m.legs.map(l => l.type)).toEqual(['walk', 'station_access', 'metro', 'station_egress', 'walk']);
    for (const leg of m.legs) if (leg.type === 'station_access' || leg.type === 'station_egress') expect(leg.basis).toBe('assumption');
    expect(r.assumptions).toMatchObject({ stationAccessS: ACCESS_S, stationEgressS: EGRESS_S });
  });

  it('never leaves before now, even when the next train is imminent', async () => {
    const r = await planTrip(home, work, NOW, { stations: ST, router: fakeRouter(300, null), metro: trains([480]), nowSec: NOW });
    const m = r.options[0]!;
    expect(m.leaveEpoch).toBe(NOW);
  });

  it('returns two options only when they differ as whole trips: metro and car; car-only when no train fits', async () => {
    const both = await planTrip(home, work, NOW, { stations: ST, router: fakeRouter(300, 900), metro: trains([1500]), nowSec: NOW });
    expect(both.options.map(o => o.kind).sort()).toEqual(['car', 'metro']);
    expect(both.options[0]!.arriveEpoch!).toBeLessThanOrEqual(both.options[1]!.arriveEpoch!);
    const carOnly = await planTrip(home, work, NOW, { stations: ST, router: fakeRouter(300, 900), metro: trains([]), nowSec: NOW });
    expect(carOnly.options.map(o => o.kind)).toEqual(['car']);
    expect(carOnly.status).toBe('partial'); expect(carOnly.reason).toBe('metro_unavailable_for_this_trip');
    expect(carOnly.options[0]!.notes.join(' ')).toMatch(/زنده بودن آن تضمین نمی شود/);
  });

  it('without a router no arrival time, leave time or walk duration is ever produced', async () => {
    const r = await planTrip(home, work, NOW, { stations: ST, router: noRouter, metro: trains([300, 900, 1500, 2100]), nowSec: NOW });
    expect(r.status).toBe('partial'); expect(r.reason).toBe('router_not_configured');
    expect(r.routing).toMatchObject({ provider: null, walk: 'unavailable', car: 'unavailable' });
    const o = r.options[0]!;
    expect(o).toMatchObject({ kind: 'metro', arriveAt: null, arriveEpoch: null, leaveAt: null, totalS: null });
    expect(o.platformDepartures!.length).toBe(3);
    for (const leg of o.legs) if (leg.type === 'walk') { expect(leg.durationS).toBeNull(); expect(leg.basis).toBe('unknown'); expect(leg.straightLineM).toBeGreaterThan(0); }
  });

  it('a short trip is walk-only; routes the router cannot measure stay out', async () => {
    const near: LatLon = { lat: 36.3, lon: 59.5005 };
    const r = await planTrip(home, near, NOW, { stations: ST, router: fakeRouter(120, 60), metro: trains([100]), nowSec: NOW });
    expect(r.options.map(o => o.kind)).toEqual(['walk']);
    expect(r.options.some(o => o.kind === 'metro')).toBe(false);
  });

  it('does not offer a metro across lines it cannot transfer between and tolerates a metro failure', async () => {
    const onlyLine2 = await planTrip({ lat: 36.3, lon: 59.6095 }, { lat: 36.3, lon: 59.5005 }, NOW, { stations: ST, router: fakeRouter(200, 700), metro: trains([200]), nowSec: NOW });
    expect(onlyLine2.options.every(o => o.kind !== 'metro')).toBe(true);
    const broken = await planTrip(home, work, NOW, { stations: ST, router: fakeRouter(300, 900), metro: async () => { throw new Error('metro_disabled'); }, nowSec: NOW });
    expect(broken.options.map(o => o.kind)).toEqual(['car']);
    expect(broken.status).toBe('partial'); expect(broken.reason).toBe('metro_unavailable_for_this_trip');
  });

  it('everything unavailable is reported as unavailable, not as an empty success', async () => {
    const r = await planTrip(home, work, NOW, { stations: ST, router: fakeRouter(300, null), metro: trains([]), nowSec: NOW });
    expect(r.status).toBe('unavailable'); expect(r.options).toEqual([]);
  });

  it('pickDistinct prefers a different mode, then a different boarding station within 20 minutes', () => {
    const c = (id: string, kind: 'metro' | 'car', arrive: number, pairKey: string) => ({ arrive, pairKey, option: { id, kind } as never });
    expect(pickDistinct([c('a', 'metro', 10, 'S1>S2'), c('b', 'metro', 11, 'S1>S3'), c('c', 'car', 30, 'car')]).map(o => o.id)).toEqual(['a', 'c']);
    expect(pickDistinct([c('a', 'metro', 10, 'S1>S2'), c('b', 'metro', 11, 'S1>S3'), c('d', 'metro', 12, 'S4>S2')]).map(o => o.id)).toEqual(['a', 'd']);
    expect(pickDistinct([c('a', 'metro', 10, 'S1>S2'), c('b', 'metro', 5000, 'S4>S2')]).map(o => o.id)).toEqual(['a']);
    expect(pickDistinct([])).toEqual([]);
  });
});

describe('routes', () => {
  const stations = loadStationGeo();
  const post = (app: ReturnType<typeof buildServer>, url: string, payload: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    app.inject({ method: 'POST', url, payload: typeof payload === 'string' ? payload : JSON.stringify(payload), headers });
  const make = (router: Router = noRouter, metro: MetroPlanner | null = null) => buildServer({ now: () => NOW_MS, trip: { router, stations, metro } });

  it('loads the real network geometry for both lines', () => {
    expect(stations.length).toBe(36);
    expect(stations.some(s => s.lines.includes(2))).toBe(true);
    expect(stations.every(s => s.lat > 35.9 && s.lat < 36.7)).toBe(true);
  });

  it('validates body shape, coverage and time; only JSON is accepted', async () => {
    const app = make();
    const ok = { from: { lat: 36.346, lon: 59.442 }, to: { lat: 36.257, lon: 59.62 } };
    expect((await post(app, '/app/api/trip', ok)).statusCode).toBe(200);
    expect((await post(app, '/app/api/trip', ok, { 'content-type': 'text/plain' })).statusCode).toBe(415);
    expect((await post(app, '/app/api/trip', { ...ok, extra: 1 })).statusCode).toBe(400);
    expect((await post(app, '/app/api/trip', { ...ok, from: { lat: 'x', lon: 1 } })).statusCode).toBe(400);
    expect((await post(app, '/app/api/trip', { ...ok, time: '25:00' })).statusCode).toBe(400);
    expect((await post(app, '/app/api/trip', { ...ok, to: { lat: 35.7, lon: 51.4 } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: '/app/api/trip' })).statusCode).toBe(404);
    await app.close();
  });

  it('answers honestly without a router and without leaking any key or coordinates in the response headers', async () => {
    const app = make(noRouter, trains([600, 1200]));
    const res = await post(app, '/app/api/trip', { from: { lat: 36.346, lon: 59.442 }, to: { lat: 36.257, lon: 59.62 }, time: '12:40' });
    const body = res.json();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(body.status).toBe('partial'); expect(body.routing.provider).toBeNull();
    expect(body.options[0].arriveAt).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/Api-Key|service\./);
    await app.close();
  });

  it('places: stations match offline with ZWNJ-insensitive names; short or odd input is rejected', async () => {
    const app = make();
    const res = (await post(app, '/app/api/places', { q: 'وکیل آباد' })).json();
    expect(res.places[0]).toMatchObject({ kind: 'station', precision: 'station' });
    expect(res.places[0].name).toContain('وکیل');
    expect(res.geocoder).toBe('unavailable');
    expect((await post(app, '/app/api/places', { q: 'a' })).statusCode).toBe(400);
    expect((await post(app, '/app/api/places', { q: 'x', z: 1 })).statusCode).toBe(400);
    await app.close();
  });

  it('places: a geocoded address is returned only when inside Mashhad and is labelled approximate', async () => {
    const mk = (hit: LatLon | null): Router => ({ ...noRouter, configured: true, geocode: async () => hit });
    const inside = make(mk({ lat: 36.294, lon: 59.596 })), outside = make(mk({ lat: 35.7, lon: 51.4 }));
    const a = (await post(inside, '/app/api/places', { q: 'میدان آزادی' })).json();
    expect(a.places.find((p: { kind: string }) => p.kind === 'address')).toMatchObject({ precision: 'geocoded', source: 'neshan_geocoding' });
    const b = (await post(outside, '/app/api/places', { q: 'میدان آزادی' })).json();
    expect(b.places.some((p: { kind: string }) => p.kind === 'address')).toBe(false);
    await inside.close(); await outside.close();
  });

  it('rate limits per client', async () => {
    const app = make();
    let last = 200;
    for (let i = 0; i < 25; i++) last = (await post(app, '/app/api/places', { q: 'شریعتی' })).statusCode;
    expect(last).toBe(429);
    await app.close();
  });
});
