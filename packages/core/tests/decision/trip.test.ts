// Phase 3: the real Intelligence Core decides between the planner's options. No mocks of the Core itself.
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { decideTrip, tripCandidate, walkingSeconds } from '../../src/decision/trip.js';
import type { Leg, TripOption, TripResult } from '../../src/trip/plan.js';
import { loadStationGeo } from '../../src/trip/routes.js';
import { noRouter, type Router } from '../../src/trip/neshan.js';

const NOW = Date.parse('2026-11-05T08:30:00Z') / 1000;
const walk = (s: number | null): Leg => ({ type: 'walk', from: 'a', to: 'b', durationS: s, distanceM: s === null ? null : s * 1.2, basis: s === null ? 'unknown' : 'routed', straightLineM: 500 });
const metro = (): Leg => ({ type: 'metro', line: 1, service: 'A', toward: 'غدیر', from: 'x', to: 'y', departAt: '12:20', arriveAt: '12:35', durationS: 900, basis: 'model', confidence: 'official_sheet_phase', eventId: null });
const opt = (id: string, kind: TripOption['kind'], arriveInS: number | null, legs: Leg[]): TripOption => ({ id, kind, title: id, leaveAt: '12:00', leaveEpoch: NOW, arriveAt: arriveInS === null ? null : '12:40', arriveEpoch: arriveInS === null ? null : NOW + arriveInS, totalS: arriveInS, legs, ifMissed: null, notes: [] });
const trip = (options: TripOption[]): TripResult => ({ schemaVersion: 1, status: 'ok', reason: 'ok', readyAt: '', readyEpoch: NOW, origin: { lat: 36.3, lon: 59.5 }, destination: { lat: 36.3, lon: 59.6 }, options, assumptions: { stationAccessS: 180, stationEgressS: 120, note: '' }, routing: { provider: 'neshan', walk: 'routed', car: 'routed', trafficLabel: '' }, disclaimers: [] });
// car: faster, no walking. metro: slower, 17 minutes of walking.
const car = opt('car', 'car', 1500, [{ type: 'car', durationS: 1500, distanceM: 9000, basis: 'routed', traffic: 'provider_traffic' }]);
const train = opt('m:s1', 'metro', 2400, [walk(600), metro(), walk(420)]);
const fastTrain = opt('m:fast', 'metro', 1200, [walk(600), metro(), walk(420)]);
const slowCar = opt('car', 'car', 3000, [{ type: 'car', durationS: 3000, distanceM: 9000, basis: 'routed', traffic: 'provider_traffic' }]);
const decide = (t: TripResult, priority: Parameters<typeof decideTrip>[1]['priority'] = null, maxWalkS: number | null = null) => decideTrip(t, { priority, maxWalkS, nowSec: NOW, requestId: 'r1' });

describe('candidates', () => {
  it('walking is only a sum when every walking leg was measured', () => {
    expect(walkingSeconds([walk(600), metro(), walk(420)])).toBe(1020);
    expect(walkingSeconds([walk(600), walk(null)])).toBeNull();
  });
  it('unknown arrival or walking stays unknown, car walking is an estimate with its caveat, and cost is always unknown', () => {
    const c = tripCandidate(opt('x', 'metro', null, [walk(null), metro()]), NOW, NOW, 't');
    expect(c.metrics.durationSeconds).toMatchObject({ state: 'unknown' });
    expect(c.metrics.walkingSeconds).toMatchObject({ state: 'unknown' });
    expect(c.metrics.totalCostToman).toMatchObject({ state: 'unknown', reason: 'no_fare_source' });
    const k = tripCandidate(car, NOW, NOW, 't');
    expect(k.metrics.walkingSeconds).toMatchObject({ state: 'estimated', value: 0 });
    expect(JSON.stringify(k.metrics.walkingSeconds)).toMatch(/not included/);
  });
});

describe('decideTrip with the real Core', () => {
  it('a trade-off (metro faster but 17 minutes of walking, car slower with none) puts both on the frontier, so the Core asks one useful question', () => {
    const d = decide(trip([car, fastTrain]));
    expect(d.status).toBe('ok');
    expect(d.question?.answers.map(a => a.priority).sort()).toEqual(['time', 'walk']);
    expect(d.question?.prompt).toBe('کدام برایتان مهم تر است؟');
    expect(d.preferred).toBeNull();
  });
  it('a dominated option does not trigger a question: the car is both faster and walks less than the slow train', () => {
    const d = decide(trip([car, train]));
    expect(d.question).toBeNull();
  });
  it('stated priority "time" prefers the faster option, labels it with the Core wording, and asks nothing more', () => {
    const d = decide(trip([car, fastTrain]), 'time');
    expect(d.preferred).toBe('m:fast');
    expect(d.byOption['m:fast']!.preferred).toBe(true);
    expect(d.byOption['m:fast']!.labels).toContain('هماهنگ با اولویت شما');
    expect(d.question).toBeNull();
  });
  it('stated priority "walk" flips the preference to the option with less measured walking', () => {
    expect(decide(trip([car, fastTrain]), 'walk').preferred).toBe('car');
    const a = opt('m:a', 'metro', 2100, [walk(900), metro(), walk(300)]), b = opt('m:b', 'metro', 2600, [walk(300), metro(), walk(240)]);
    expect(decide(trip([a, b]), 'walk').preferred).toBe('m:b');
    expect(decide(trip([a, b]), 'time').preferred).toBe('m:a');
  });
  it('"balanced" says both matter equally, so no question and no preferred option', () => {
    const d = decide(trip([car, fastTrain]), 'balanced');
    expect(d.question).toBeNull(); expect(d.preferred).toBeNull();
  });
  it('cost priority is honoured honestly: no fare data, so the note says the comparison used arrival time', () => {
    const d = decide(trip([car, fastTrain]), 'cost');
    expect(d.notes.join(' ')).toMatch(/هزینهٔ مسیرها در دسترس نیست/);
    expect(d.preferred).toBeNull();
  });
  it('a dominating option gets the Core "fastest" label and the Core explanation text', () => {
    const better = opt('m:ok', 'metro', 1500, [walk(300), metro(), walk(200)]);
    const d = decide(trip([better, opt('m:slow', 'metro', 2400, [walk(600), metro(), walk(500)])]));
    expect(d.byOption['m:ok']!.labels).toContain('سریع ترین');
    expect(d.byOption['m:ok']!.claims.join(' ')).toMatch(/در میان گزینه های هم ارز و واجد شرایط ارائه شده، سریع ترین است/);
    expect(d.byOption['m:slow']!.labels).toEqual([]);
  });
  it('the user\'s walking limit is a hard constraint on measured walking and an unmeasured walk is never "satisfied"', () => {
    const d = decide(trip([car, train]), null, 900);
    expect(d.byOption.car!.labels).toBeDefined();
    expect(d.byOption['m:s1']).toEqual({ labels: [], claims: [], preferred: false });   // 1020 s of walking exceeds 900 s
    const unknownWalk = decide(trip([car, opt('m:u', 'metro', 2000, [walk(null), metro()])]), null, 900);
    expect(unknownWalk.notes.join(' ')).toMatch(/اندازه گیری نشده/);
  });
  it('a lone option is never called the fastest or the preferred one, and no question is asked', () => {
    for (const priority of [null, 'time', 'walk', 'balanced', 'cost'] as const) {
      const d = decide(trip([car]), priority);
      expect(d.byOption.car).toEqual({ labels: [], claims: [], preferred: false });
      expect(d.question).toBeNull(); expect(d.preferred).toBeNull();
    }
  });
  it('no options or a rejected input degrade to "skipped" without throwing', () => {
    expect(decide(trip([]))).toMatchObject({ status: 'skipped', reason: 'no_options', byOption: {} });
    const weird = decide(trip([{ ...car, id: '' }]));
    expect(['skipped', 'ok', 'partial', 'insufficient_data', 'no_feasible_option']).toContain(weird.status);
  });
  it('the output never carries a cost claim or a superlative that the Core did not authorise', () => {
    const d = decide(trip([car, fastTrain]));
    const text = JSON.stringify(d);
    expect(text).not.toMatch(/ارزان ترین|کم هزینه ترین|تومان/);
  });
});

describe('POST /app/api/trip carries the decision', () => {
  const stations = loadStationGeo();
  const router: Router = { configured: true, stats: () => ({ calls: 0, day: '', cap: 0, lastFailure: null }), async geocode() { return null; },
    async route(mode) { return mode === 'car' ? { mode, durationS: 900, distanceM: 9000, traffic: 'provider_traffic', source: 'neshan', fetchedAt: 0 } : { mode, durationS: 420, distanceM: 500, traffic: 'none', source: 'neshan', fetchedAt: 0 }; } };
  const metroFn = async (_l: 1 | 2, _o: string, _d: string, ready: number) => ({ status: 'ok', message: '', calendarWarning: false, options: [{ departEpoch: ready + 120, arriveEpoch: ready + 1320, service: 'A' as const, toward: 'غدیر', confidence: 'official_sheet_phase', eventId: null, derivedExtension: false }] });
  const make = () => buildServer({ now: () => NOW * 1000, trip: { router, stations, metro: metroFn }, account: { store: null } });
  const post = (app: ReturnType<typeof make>, body: unknown) => app.inject({ method: 'POST', url: '/app/api/trip', payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const base = { from: { lat: 36.346, lon: 59.442 }, to: { lat: 36.257, lon: 59.62 } };

  it('returns a decision block, validates priority, and reorders only when the user stated a priority', async () => {
    const app = make();
    const plain = (await post(app, base)).json();
    expect(plain.decision).toMatchObject({ schemaVersion: 1, priority: null });
    expect(plain.options.length).toBeLessThanOrEqual(2);
    const timed = (await post(app, { ...base, priority: 'time' })).json();
    if (timed.options.length === 2) expect(timed.options[0].id).toBe(timed.decision.preferred);
    expect((await post(app, { ...base, priority: 'fastest' })).statusCode).toBe(400);
    expect((await post(app, { ...base, priority: 'walk', maxWalkMin: 15 })).statusCode).toBe(200);
    await app.close();
  });
  it('without a router the decision is skipped or partial but the answer is still honest', async () => {
    const app = buildServer({ now: () => NOW * 1000, trip: { router: noRouter, stations, metro: metroFn }, account: { store: null } });
    const body = (await post(app, base)).json();
    expect(body.status).toBe('partial');
    expect(JSON.stringify(body.decision)).not.toMatch(/سریع ترین/);
    await app.close();
  });
});
