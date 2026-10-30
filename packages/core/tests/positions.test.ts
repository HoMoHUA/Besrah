import { describe, expect, it } from 'vitest';
import { createService } from '../src/service.js';
import { buildServer } from '../src/server.js';
import { tehranToEpoch } from '../src/time.js';

const svc = createService();
const at = (hms: string, day = '2026-11-01') => tehranToEpoch(day, hms); // 2026-11-01 is a Sunday (normal day)

describe('estimated train positions along the line', () => {
  it('places every active line 1 train between its stations, never outside the line', () => {
    const r = svc.positions(1, at('10:07:30'));
    expect(r.order.length).toBeGreaterThan(15);
    expect(r.trains.length).toBeGreaterThan(3);
    expect(new Set(r.trains.map(t => t.id)).size).toBe(r.trains.length);
    for (const t of r.trains) {
      expect(t.pos).toBeGreaterThanOrEqual(0);
      expect(t.pos).toBeLessThanOrEqual(r.order.length - 1);
      if (t.state === 'running') { expect(t.pos).toBeGreaterThan(Math.min(t.from, t.to)); expect(t.pos).toBeLessThan(Math.max(t.from, t.to)); expect(Math.abs(t.from - t.to)).toBe(1); }
      else expect(Number.isInteger(t.pos)).toBe(true);
    }
  });

  it('has no trains before the first service', () => {
    expect(svc.positions(1, at('03:00:00')).trains).toEqual([]);
    expect(svc.positions(2, at('03:00:00')).trains).toEqual([]);
  });

  it('moves a train monotonically in its direction of travel and not faster than the timetable', () => {
    const a = svc.positions(1, at('10:07:30')), b = svc.positions(1, at('10:07:50'));
    let compared = 0;
    for (const t of a.trains) {
      const u = b.trains.find(x => x.id === t.id);
      if (!u) continue;
      compared++;
      const d = (u.pos - t.pos) * (t.direction === 'out' ? 1 : -1);
      expect(d).toBeGreaterThanOrEqual(-1e-9);
      expect(d).toBeLessThanOrEqual(20 / 60 + 1e-9);   // at most one station per minute of timetable
    }
    expect(compared).toBeGreaterThan(2);
  });

  it('agrees with the next-arrival board about when the nearest train reaches each station', () => {
    const now = at('10:07:30'), r = svc.positions(1, now);
    let close = 0;
    for (let idx = 1; idx < r.order.length - 1; idx++) {
      const boardMin = Math.min(...svc.next(r.order[idx], now, 10, 1).passes.map(p => p.eta_min));
      const mine = r.trains.filter(t => t.next === idx && t.eta_s !== null).map(t => Math.ceil((t.eta_s as number) / 60));
      if (mine.length) expect(Math.min(...mine)).toBeGreaterThanOrEqual(boardMin);   // the board also counts trains not yet started
      // `next` is only the immediate next stop, so equality is required just where a train is really heading to this station.
      if (mine.length && Math.min(...mine) === boardMin) close++;
      if (mine.length && boardMin <= 3) expect(Math.abs(Math.min(...mine) - boardMin)).toBeLessThanOrEqual(3);
    }
    expect(close).toBeGreaterThan(0);
  });

  it('line 2 shows trains in both directions and states that the phase is unmeasured', () => {
    const r = svc.positions(2, at('10:07:30'));
    expect(r.order.length).toBe(13);
    expect(new Set(r.trains.map(t => t.direction))).toEqual(new Set(['out', 'back']));
    expect(r.trains.every(t => t.confidence === 'site_headway_assumed_phase' && t.service === null)).toBe(true);
    expect(r.notes.join(' ')).toContain('فاز');
  });

  it('is served by the app API and rejects a bad line', async () => {
    const app = buildServer();
    const ok = await app.inject('/app/api/trains?line=2&at=2026-11-01T06:37:30.000Z');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().line).toBe(2);
    expect((await app.inject('/app/api/trains?line=3')).statusCode).toBe(400);
    await app.close();
  });
});
