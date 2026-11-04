import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import type { TimetableSource } from '../../src/transit-journey/contracts.js';
import { at, betaOn, DA, FRIDAY_14, H7, q, realSource, uuid } from './helpers.js';

const url = q({ line: '1', from: H7, to: DA });
const headers = { 'content-type': 'application/json', 'x-besrah-beta': '1', origin: 'https://besrah.arklyn.ir' };
const dir = () => mkdtempSync(join(tmpdir(), 'pb-hardening-'));
const body = (extra: Record<string, unknown> = {}) => ({ v: 1, reportId: uuid(2301), kind: 'timing_quality',
  consent: { storeForModelImprovement: true }, modelVersion: realSource().dataVersion,
  context: { line: 1, originId: H7, destinationId: DA, readyAt: '2026-10-16T14:00:00+03:30', serviceDate: '2026-10-16' }, timingQuality: 'unknown', ...extra });

describe('beta HTTP hardening', () => {
  it('checks feedback origin before parsing an untrusted body', async () => {
    const app = buildServer({ now: () => FRIDAY_14, journeySource: realSource(), journeyBeta: betaOn({ feedbackDir: dir() }) });
    try {
      const r = await app.inject({ method: 'POST', url: '/app/api/journey-feedback', headers: { ...headers, origin: 'https://attacker.invalid' }, payload: '{not json' });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({ error: 'forbidden' });
    } finally { await app.close(); }
  });
  it('does not release compute capacity while a timed-out source is still outstanding', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const source: TimetableSource = { ...realSource(), getDay: async (...args) => { calls++; await blocked; return realSource().getDay(...args); } };
    const app = buildServer({ now: () => FRIDAY_14, journeySource: source,
      journeyBeta: betaOn({ maxConcurrent: 1, requestTimeoutMs: 40, journeyClientPerMinute: 1000 }) });
    try {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(503);
      const before = calls;
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode).toBe(429);
      expect(r.json()).toEqual({ error: 'busy' });
      expect(calls).toBe(before);
      release();
      await pause(100);
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);
    } finally { release(); await app.close(); }
  });
  it('returns explicit freshness and calendar dates for modeled options', async () => {
    const app = buildServer({ now: () => FRIDAY_14, journeySource: realSource(), journeyBeta: betaOn() });
    try {
      const result = (await app.inject({ method: 'GET', url })).json();
      expect(Date.parse(result.validUntil) - Date.parse(result.asOf)).toBe(30_000);
      for (const option of result.options) {
        expect(option.departDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(option.arriveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    } finally { await app.close(); }
  });
  it('does not produce numerical error from a contradicted observation direction', async () => {
    const day = await realSource().getDay(1, '2026-10-16', 'friday');
    const trip = day.trips.find(t => t.direction === 'out' && t.stops.some(s => s.stationId === H7 && s.depart >= FRIDAY_14 / 1000));
    expect(trip).toBeDefined();
    const stop = trip!.stops.find(s => s.stationId === H7)!;
    const observedAt = new Date(stop.depart * 1000).toISOString();
    const payload = body({ reportId: uuid(2302), kind: 'train_observation', timingQuality: undefined,
      context: { line: 1, originId: H7, destinationId: DA, readyAt: '2026-10-16T14:00:00+03:30', serviceDate: '2026-10-16', tripId: trip!.id },
      observation: { stationId: H7, direction: 'back', event: 'train_departure', observedAt } });
    const folder = dir();
    const app = buildServer({ now: () => at('2026-10-16', '15:00:00'), journeySource: realSource(), journeyBeta: betaOn({ feedbackDir: folder }) });
    try {
      const r = await app.inject({ method: 'POST', url: '/app/api/journey-feedback', headers, payload });
      expect(r.statusCode).toBe(201);
      await app.close();
      const { readFileSync } = await import('node:fs');
      const record = JSON.parse(readFileSync(join(folder, 'feedback-2026-10.jsonl'), 'utf8').trim());
      expect(record.comparison.deltaSeconds).toBeNull();
      expect(record.comparison.tripMatch).not.toBe('matched');
    } finally { await app.close(); }
  });
});
