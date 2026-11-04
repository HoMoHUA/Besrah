import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { at, betaOn, DA, FRIDAY_14, GHADIR, H7, AIRPORT, q, realSource, VAKILABAD } from './helpers.js';

const make = (extra = {}, now = FRIDAY_14) => buildServer({ now: () => now, journeySource: realSource(), journeyBeta: betaOn(extra), limiterClock: () => 1 });

describe('journey beta is OFF by default', () => {
  it('a default server exposes neither route and reports the flag off', async () => {
    const app = buildServer({ now: () => FRIDAY_14 });
    expect((await app.inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA }) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/app/api/journey-feedback', payload: {} })).statusCode).toBe(404);
    const beta = (await app.inject({ method: 'GET', url: '/app/api/beta' })).json();
    expect(beta.journey.enabled).toBe(false);
    expect(beta.journey.rolloutPercent).toBe(0);
  });
  it('previous routes keep working when the beta is enabled', async () => {
    const app = make();
    const next = await app.inject({ method: 'GET', url: '/v1/next?station=' + encodeURIComponent('شریعتی') + '&limit=3&line=1' });
    expect(next.statusCode).toBe(200);
    expect(next.json().passes.length).toBe(3);
    expect((await app.inject({ method: 'GET', url: '/app/api/stations' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/app/' })).statusCode).toBe(200);
  });
});

describe('GET /app/api/journey', () => {
  it('returns honest, integer-valued, model-only options on a Friday', async () => {
    const r = await make().inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA }) });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const b = r.json();
    expect(b).toMatchObject({ beta: true, modelOnly: true, live: false, status: 'partial', reason: 'display_candidate_limit', coverage: { complete: false, truncated: true }, calendar: { state: 'known', dayType: 'friday' } });
    expect(b.request).toMatchObject({ source: 'server_now', readyAt: '2026-10-16T14:00:00+03:30', originName: expect.any(String) });
    expect(b.options.length).toBeGreaterThan(0);
    expect(b.options.length).toBeLessThanOrEqual(5);
    const departures = b.options.map((o: any) => o.departEpoch);
    expect(departures).toEqual([...departures].sort((x: number, y: number) => x - y));
    for (const o of b.options) {
      for (const key of ['departEpoch', 'arriveEpoch', 'waitSeconds', 'inVehicleSeconds']) expect(Number.isInteger(o[key]), key).toBe(true);
      expect(o.departAt).toMatch(/^\d{2}:\d{2}$/);
      expect(o.waitSeconds).toBeGreaterThanOrEqual(0);
      expect(o.arriveEpoch).toBeGreaterThan(o.departEpoch);
    }
    expect(b.options.some((o: any) => o.earliestArrival)).toBe(true);
    expect(JSON.stringify(b)).not.toMatch(/timingsMs|stack|requestId/);
    expect(b.modelVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('separates Ghadir and airport services, and names the opposite direction', async () => {
    const app = make();
    const toGhadir = (await app.inject({ method: 'GET', url: q({ line: '1', from: VAKILABAD, to: GHADIR }) })).json();
    const labels = new Set(toGhadir.options.map((o: any) => o.toward));
    expect(labels.has('غدیر') || labels.has('فرودگاه')).toBe(true);
    for (const o of toGhadir.options) expect(['غدیر', 'فرودگاه']).toContain(o.toward);
    const toAirport = (await app.inject({ method: 'GET', url: q({ line: '1', from: VAKILABAD, to: AIRPORT }) })).json();
    expect(toAirport.options.length).toBeGreaterThan(0);
    for (const o of toAirport.options) { expect(o.toward).toBe('فرودگاه'); expect(o.service).toBe('B'); }
    const back = (await app.inject({ method: 'GET', url: q({ line: '1', from: DA, to: H7 }) })).json();
    expect(back.status).toBe('partial');
    expect(back.coverage).toMatchObject({ complete: false, truncated: true });
    for (const o of back.options) expect(o.toward).toBe('وکیل آباد');
  });

  it('serves line 2 in both directions', async () => {
    const stations = (await make().inject({ method: 'GET', url: '/app/api/stations' })).json();
    const order: string[] = stations.line2Order;
    const id = (name: string) => stations.stations.find((s: any) => s.name === name).id;
    const a = id(order[0]), z = id(order[order.length - 1]);
    for (const [from, to] of [[a, z], [z, a]]) {
      const b = (await make().inject({ method: 'GET', url: q({ line: '2', from, to }) })).json();
      expect(b.status).toBe('partial');
      expect(b.coverage).toMatchObject({ complete: false, truncated: true });
      expect(b.options.length).toBeGreaterThan(0);
      expect(b.options.every((o: any) => o.service === null)).toBe(true);
    }
  });

  it('weekday_baseline shows an explicit estimated-calendar warning; strict refuses to invent a schedule', async () => {
    const monday = at('2026-10-19', '09:00:00');
    const params = { line: '1', from: H7, to: DA, date: '2026-10-19', time: '09:05' };
    const est = (await make({}, monday).inject({ method: 'GET', url: q(params) })).json();
    expect(est.calendar).toMatchObject({ state: 'estimated', dayType: 'normal', warning: true });
    expect(est.calendar.label).toContain('تخمینی');
    expect(est.status).toBe('partial');
    expect(est.coverage.issueCodes).toEqual(['holidays_unverified_weekday_baseline']);
    expect(est.message).toContain('تخمینی');
    expect(est.options.length).toBeGreaterThan(0);
    const strict = (await make({ calendarMode: 'strict' }, monday).inject({ method: 'GET', url: q(params) })).json();
    expect(strict.status).toBe('insufficient_data');
    expect(strict.options).toEqual([]);
    expect(strict.calendar).toMatchObject({ state: 'unknown', warning: true });
    expect(strict.message).toBeTruthy();
    const thursday = (await make({}, at('2026-10-22', '09:00:00')).inject({ method: 'GET', url: q({ ...params, date: '2026-10-22' }) })).json();
    expect(thursday.calendar).toMatchObject({ state: 'estimated', dayType: 'thursday', warning: true });
  });

  it('reports no_feasible_option after the end of service without inventing a train', async () => {
    const late = at('2026-10-16', '23:59:30');
    const b = (await make({ searchMinutes: 5 }, late).inject({ method: 'GET', url: q({ line: '1', from: VAKILABAD, to: GHADIR }) })).json();
    // Coverage across the service-day boundary is incomplete, so the planner must not claim a complete empty answer or invent a train.
    expect(['no_feasible_option', 'insufficient_data']).toContain(b.status);
    expect(b.options).toEqual([]);
    expect(b.message).toBeTruthy();
  });

  it('accepts a future selected time and keeps the ready time explicit', async () => {
    const b = (await make().inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA, date: '2026-10-17', time: '08:30' }) })).json();
    expect(b.request).toMatchObject({ source: 'user_selected', readyAt: '2026-10-17T08:30:00+03:30' });
    for (const o of b.options) expect(o.waitSeconds).toBeGreaterThanOrEqual(0);
  });

  const bad: Array<[string, Record<string, string>, string]> = [
    ['unknown parameter', { line: '1', from: H7, to: DA, at: '2026-10-16T14:00:00Z' }, 'unknown_parameter'],
    ['injected parameter', { line: '1', from: H7, to: DA, limit: '999' }, 'unknown_parameter'],
    ['missing line', { from: H7, to: DA }, 'bad_line'],
    ['line 3', { line: '3', from: H7, to: DA }, 'bad_line'],
    ['malformed station', { line: '1', from: 'x', to: DA }, 'bad_station'],
    ['sql-like station', { line: '1', from: "METRO-107' OR 1=1", to: DA }, 'bad_station'],
    ['station not on the line', { line: '2', from: H7, to: DA }, 'bad_station'],
    ['same station', { line: '1', from: H7, to: H7 }, 'same_station'],
    ['date without time', { line: '1', from: H7, to: DA, date: '2026-10-16' }, 'date_and_time_together'],
    ['impossible date', { line: '1', from: H7, to: DA, date: '2026-02-30', time: '10:00' }, 'bad_date'],
    ['bad time', { line: '1', from: H7, to: DA, date: '2026-10-16', time: '24:00' }, 'bad_time'],
    ['too far ahead', { line: '1', from: H7, to: DA, date: '2026-10-30', time: '10:00' }, 'date_out_of_range'],
    ['yesterday', { line: '1', from: H7, to: DA, date: '2026-10-15', time: '10:00' }, 'date_out_of_range'],
    ['past time today', { line: '1', from: H7, to: DA, date: '2026-10-16', time: '12:00' }, 'time_in_past'],
  ];
  for (const [name, params, code] of bad) {
    it(`rejects ${name}`, async () => {
      const r = await make().inject({ method: 'GET', url: q(params) });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ error: 'bad_request', code });
    });
  }
  it('rejects repeated parameters and oversized values without echoing them', async () => {
    const app = make();
    const repeated = await app.inject({ method: 'GET', url: `/app/api/journey?line=1&line=2&from=${H7}&to=${DA}` });
    expect(repeated.statusCode).toBe(400);
    const long = await app.inject({ method: 'GET', url: q({ line: '1', from: 'METRO-' + '9'.repeat(5000), to: DA }) });
    expect(long.statusCode).toBe(400);
    expect(long.body).not.toContain('99999');
  });
});

describe('protection of the shared 192 MiB service', () => {
  it('rate limits globally and per client, then recovers on a new window', async () => {
    let clock = 1;
    const app = buildServer({ now: () => FRIDAY_14, journeySource: realSource(), journeyBeta: betaOn({ journeyClientPerMinute: 3, journeyGlobalPerMinute: 5 }), limiterClock: () => clock });
    const call = (ip: string) => app.inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA }), headers: { 'x-real-ip': ip } });
    for (let i = 0; i < 3; i++) expect((await call('9.9.9.1')).statusCode).toBe(200);
    const limited = await call('9.9.9.1');
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeTruthy();
    expect((await call('9.9.9.2')).statusCode).toBe(200);
    expect((await call('9.9.9.3')).statusCode).toBe(200);
    expect((await call('9.9.9.4')).statusCode).toBe(429);
    clock += 61_000;
    expect((await call('9.9.9.4')).statusCode).toBe(200);
  });
  it('bounds concurrency instead of queueing unbounded planner work', async () => {
    const app = make({ maxConcurrent: 1, journeyClientPerMinute: 100, journeyGlobalPerMinute: 100 });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => app.inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA, date: '2026-10-1' + (6 + (i % 2)), time: '15:00' }), headers: { 'x-real-ip': `8.8.8.${i}` } })));
    const codes = results.map(r => r.statusCode);
    expect(codes).toContain(200);
    expect(codes).toContain(429);
    expect(results.filter(r => r.statusCode === 429).every(r => r.json().error === 'busy')).toBe(true);
    expect((await app.inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA }) })).statusCode).toBe(200);
  });
  it('times out a stuck response but holds its slot until real work settles', async () => {
    const real = realSource();
    const stuck = { ...real, catalog: real.catalog, dataVersion: real.dataVersion, evidence: real.evidence, getDay: () => new Promise<never>(() => {}), stats: real.stats.bind(real), clear: real.clear.bind(real) };
    const app = buildServer({ now: () => FRIDAY_14, journeySource: stuck, journeyBeta: betaOn({ requestTimeoutMs: 40, maxConcurrent: 1 }), limiterClock: () => 1 });
    const r = await app.inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA }) });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ error: 'journey_timeout' });
    expect((await app.inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA }) })).statusCode).toBe(429);
  });
});
