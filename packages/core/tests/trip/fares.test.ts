import { describe, expect, it } from 'vitest';
import { FLAT_FARE_TOMAN, metroRides, optionFare } from '../../src/trip/fares.js';
import type { Leg } from '../../src/trip/plan.js';

const walk: Leg = { type: 'walk', from: 'a', to: 'b', durationS: 300, distanceM: 400, basis: 'routed', straightLineM: 350 };
const metro: Leg = { type: 'metro', line: 1, service: 'A', toward: 'غدیر', from: 'x', to: 'y', departAt: '12:20', arriveAt: '12:35', durationS: 900, basis: 'model', confidence: 'model', eventId: null };
const access: Leg = { type: 'station_access', durationS: 180, basis: 'assumption' };
const car: Leg = { type: 'car', durationS: 1200, distanceM: 8000, basis: 'routed', traffic: 'provider_traffic' };

describe('flat fares (owner-reported 2026-11-19)', () => {
  it('metro and bus are 3,000 toman', () => { expect(FLAT_FARE_TOMAN).toEqual({ metro: 3000, bus: 3000 }); });
  it('walk + metro + walk is one ride of 3,000 toman, tagged owner_reported', () => {
    expect(optionFare([walk, access, metro, walk])).toEqual({ state: 'known', toman: 3000, basis: 'flat_fare', rides: 1, quality: 'owner_reported', source: 'owner_reported_flat_fare', statedAt: '2026-11-19' });
  });
  it('consecutive metro legs (a transfer inside the paid area) are one ride; leaving the station and riding again is two', () => {
    expect(metroRides([walk, metro, metro, walk])).toBe(1);
    expect(metroRides([metro, walk, metro])).toBe(2);
    expect(optionFare([metro, walk, metro])).toMatchObject({ state: 'known', toman: 6000, rides: 2 });
  });
  it('walking only is free; a car leg or no legs is unknown, never zero', () => {
    expect(optionFare([walk])).toMatchObject({ state: 'known', toman: 0, basis: 'walking' });
    expect(optionFare([car])).toEqual({ state: 'unknown', reason: 'car_cost_unknown' });
    expect(optionFare([walk, car, walk])).toEqual({ state: 'unknown', reason: 'car_cost_unknown' });
    expect(optionFare([])).toEqual({ state: 'unknown', reason: 'leg_cost_unknown' });
  });
});
