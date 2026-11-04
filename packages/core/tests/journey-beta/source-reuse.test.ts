import { describe, expect, it } from 'vitest';
import { boundedSource } from '../../src/journey-beta/source.js';
import { tehranDay, tehranParts, epochToTehranHms, dayTypeOf } from '../../src/time.js';
import type { ModelDay, TimetableSource } from '../../src/transit-journey/contracts.js';
import { realSource } from './helpers.js';

// Synthetic wrappers around the real in-repo model; nothing here is field evidence.
const FRIDAY = ['friday', '2026-10-16'] as const;
function counting(source: TimetableSource, mutate?: (day: ModelDay) => ModelDay) {
  let calls = 0;
  const wrapped: TimetableSource = { ...source, getDay: async (...args) => { calls++; const day = await source.getDay(...args); return mutate ? mutate(day) : day; } };
  return { wrapped, calls: () => calls };
}

describe('provider snapshot reuse is limited to frozen in-repo days', () => {
  it('reuses one validated snapshot for the same frozen day object when explicitly enabled', async () => {
    const bounded = boundedSource(realSource(), { reuseFrozenSnapshots: true });
    const a = await bounded.getDay(1, FRIDAY[1], FRIDAY[0]);
    const b = await bounded.getDay(1, FRIDAY[1], FRIDAY[0]);
    expect(a).toBe(b);
    expect(a.trips.length).toBeGreaterThan(0);
  });

  it('keeps full per-call validation for an external provider by default', async () => {
    const bounded = boundedSource(realSource());
    const a = await bounded.getDay(1, FRIDAY[1], FRIDAY[0]);
    const b = await bounded.getDay(1, FRIDAY[1], FRIDAY[0]);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('never reuses a mutable provider object even when reuse is enabled, so later corruption is still caught', async () => {
    let state: ModelDay | null = null;
    const base = realSource();
    const source: TimetableSource = { ...base, getDay: async (...args) => (state ??= structuredClone(await base.getDay(...args))) };
    const bounded = boundedSource(source, { reuseFrozenSnapshots: true });
    const good = await bounded.getDay(1, FRIDAY[1], FRIDAY[0]);
    expect(good.trips.length).toBeGreaterThan(0);
    for (const trip of state!.trips) for (const stop of trip.stops) (stop as { depart: number }).depart = stop.arrive - 1;
    const bad = await bounded.getDay(1, FRIDAY[1], FRIDAY[0]);
    expect(bad.trips).toHaveLength(0);
    expect(bad.complete).toBe(false);
  });

  it('does not let a memoized snapshot answer for a different identity request', async () => {
    const { wrapped, calls } = counting(realSource());
    const bounded = boundedSource(wrapped, { reuseFrozenSnapshots: true });
    await bounded.getDay(1, FRIDAY[1], FRIDAY[0]);
    await bounded.getDay(2, FRIDAY[1], FRIDAY[0]);
    expect(calls()).toBe(2);
  });
});

describe('Tehran time helpers after formatter reuse', () => {
  it('returns the same fixed UTC+03:30 values with no DST drift', () => {
    const epoch = Date.UTC(2026, 9, 16, 10, 29, 51) / 1000; // 13:59:51 Tehran
    expect(epochToTehranHms(epoch)).toBe('13:59:51');
    expect(tehranDay(epoch)).toBe('2026-10-16');
    expect(tehranParts(epoch).weekday).toBe('Fri');
    expect(dayTypeOf(epoch)).toBe('friday');
    const lateNight = Date.UTC(2026, 9, 16, 20, 30, 0) / 1000; // 00:00 next day Tehran
    expect(tehranDay(lateNight)).toBe('2026-10-17');
    expect(epochToTehranHms(lateNight)).toBe('00:00:00');
  });
});
