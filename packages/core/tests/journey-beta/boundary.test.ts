import Fastify from 'fastify';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { registerJourneyBeta } from '../../src/journey-beta/index.js';
import type { ModelDay, TimetableSource } from '../../src/transit-journey/contracts.js';
import { at, betaOn, DA, FRIDAY_14, H7, q, realSource, uuid } from './helpers.js';

// Deliberately corrupted SYNTHETIC provider replies; never live observations.
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const clean of cleanups.splice(0).reverse()) await clean(); });
const query = q({ line: '1', from: H7, to: DA });
const headers = { 'content-type': 'application/json', 'x-besrah-beta': '1', origin: 'https://besrah.arklyn.ir' };
async function appFor(source: TimetableSource, config: Record<string, unknown> = {}, now = FRIDAY_14) {
  const dir = await mkdtemp(join(tmpdir(), 'pb-boundary-'));
  const app = Fastify({ logger: false });
  registerJourneyBeta(app, { now: () => now, source, config: betaOn({ feedbackDir: dir, ...config }) });
  cleanups.push(() => rm(dir, { recursive: true, force: true }), () => app.close());
  return { app, dir };
}
function sourceWith(change: (day: ModelDay) => ModelDay): TimetableSource {
  const src = realSource();
  return { ...src, getDay: async (...args) => change(structuredClone(await src.getDay(...args))) };
}
async function report(source: TimetableSource, event = 'train_departure', stationId = H7) {
  const day = await realSource().getDay(1, '2026-10-16', 'friday');
  const trip = day.trips.find(t => t.direction === 'out' && t.stops.some(s => s.stationId === H7 && s.depart >= FRIDAY_14 / 1000))!;
  const stop = trip.stops.find(s => s.stationId === stationId)!;
  const { app, dir } = await appFor(source, {}, at('2026-10-16', '16:00:00'));
  const response = await app.inject({ method: 'POST', url: '/app/api/journey-feedback', headers, payload: {
    v: 1, reportId: uuid(9001), kind: 'train_observation', consent: { storeForModelImprovement: true }, modelVersion: realSource().dataVersion,
    context: { line: 1, originId: H7, destinationId: trip.stops.at(-1)!.stationId, serviceDate: '2026-10-16', tripId: trip.id },
    observation: { event, stationId, direction: 'out', observedAt: new Date(stop.depart * 1000).toISOString(), timePrecision: 'second' },
  } });
  expect(response.statusCode).toBe(201);
  return JSON.parse((await readFile(join(dir, 'feedback-2026-10.jsonl'), 'utf8')).trim());
}

describe('provider trust boundary', () => {
  for (const [name, change] of [
    ['negative dwell', (d: ModelDay) => { for (const t of d.trips) for (const s of t.stops) (s as { depart: number }).depart = s.arrive - 1; return d; }],
    ['invalid positional sequence', (d: ModelDay) => { for (const t of d.trips) for (const s of t.stops) (s as { sequence: number }).sequence += 1; return d; }],
    ['contradicted direction', (d: ModelDay) => { for (const t of d.trips) t.direction = t.direction === 'out' ? 'back' : 'out'; return d; }],
  ] as const) it(`does not display options from ${name}`, async () => {
    const { app } = await appFor(sourceWith(change));
    const response = await app.inject({ method: 'GET', url: query });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'insufficient_data', options: [], coverage: { complete: false } });
  });
  it('does not execute provider accessors or expose provider issue text', async () => {
    let touched = false;
    const { app } = await appFor(sourceWith(day => {
      Object.defineProperty(day, 'trips', { enumerable: true, get() { touched = true; throw new Error('PRIVATE_PROVIDER'); } });
      return day;
    }));
    const response = await app.inject({ method: 'GET', url: query });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'insufficient_data', options: [] });
    expect(touched).toBe(false);
    expect(response.body).not.toContain('PRIVATE_PROVIDER');
  });
  it('does not copy arbitrary provider issue codes to public responses', async () => {
    const { app } = await appFor(sourceWith(day => ({ ...day, complete: false, issues: [{ code: 'private-user@example.invalid' }] })));
    const response = await app.inject({ method: 'GET', url: query });
    expect(response.body).not.toContain('private-user');
  });
  it('never derives feedback error against the wrong source day version', async () => {
    const record = await report(sourceWith(day => ({ ...day, dataVersion: 'sha256:' + 'f'.repeat(64) })));
    expect(record.comparison).toEqual({ tripMatch: 'unmatched', modelEventAt: null, deltaSeconds: null });
    expect(record.provenance.independentlyVerified).toBe(false);
  });
  it('does not turn a terminal arrival into a modeled terminal departure', async () => {
    const day = await realSource().getDay(1, '2026-10-16', 'friday');
    const trip = day.trips.find(t => t.direction === 'out' && t.stops.some(s => s.stationId === H7 && s.depart >= FRIDAY_14 / 1000))!;
    const record = await report(realSource(), 'train_departure', trip.stops.at(-1)!.stationId);
    expect(record.comparison.deltaSeconds).toBeNull();
    expect(record.comparison.tripMatch).toBe('unmatched');
  });
  it('uses arrival rather than departure during dwell, with opposite signed deltas', async () => {
    const arrival = await report(realSource(), 'train_arrival');
    const departure = await report(realSource(), 'train_departure');
    expect(arrival.comparison.tripMatch).toBe('matched');
    expect(departure.comparison.tripMatch).toBe('matched');
    expect(Date.parse(departure.comparison.modelEventAt)).toBeGreaterThan(Date.parse(arrival.comparison.modelEventAt));
    expect(arrival.comparison.deltaSeconds).toBeGreaterThan(departure.comparison.deltaSeconds);
    expect(arrival.provenance).toMatchObject({ independentlyVerified: false, modelTimetableUpdated: false });
  });
  it('retains healthy trips as partial, not complete, when one provider trip is corrupt', async () => {
    const { app } = await appFor(sourceWith(day => { day.trips[0].stops[0].sequence = -1; return day; }));
    const response = await app.inject({ method: 'GET', url: query });
    expect(response.json().options.length).toBeGreaterThan(0);
    expect(response.json()).toMatchObject({ status: 'partial', coverage: { complete: false, rejectedTrips: 1 } });
    expect(response.json().coverage.issueCodes).toContain('invalid_trip');
  });
  it('recovers from a source lookup fault without modifying the model or the source', async () => {
    let broken = true;
    const source = realSource();
    const { app } = await appFor({ ...source, getDay: async (...args) => { if (broken) throw new Error('PRIVATE_FAULT'); return source.getDay(...args); } });
    const fault = await app.inject({ method: 'GET', url: query });
    expect(fault.json()).toMatchObject({ status: 'insufficient_data', options: [] });
    expect(fault.body).not.toContain('PRIVATE_FAULT');
    broken = false;
    expect((await app.inject({ method: 'GET', url: query })).json().options.length).toBeGreaterThan(0);
  });
  it('honours a trusted explicit holiday declaration in strict mode, never a client query declaration', async () => {
    const now = at('2026-10-19', '09:00:00');
    const { app } = await appFor(realSource(), { calendarMode: 'strict', calendarDays: [
      { date: '2026-10-19', dayType: 'friday', sourceId: 'synthetic:test-calendar', dataVersion: 'synthetic-v1' },
    ] }, now);
    const response = await app.inject({ method: 'GET', url: query });
    expect(response.json().options.length).toBeGreaterThan(0);
    expect(response.json().calendar).toMatchObject({ state: 'known', dayType: 'friday' });
    expect(response.json().calendar.label).not.toContain('تأیید نشده');
    expect((await app.inject({ method: 'GET', url: query + '&calendar=strict' })).statusCode).toBe(400);
  });
});
