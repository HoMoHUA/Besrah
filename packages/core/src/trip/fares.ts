// Fares for the legs Besrah can price. The metro and bus numbers are the owner's statement of 2026-11-19
// ("3,000 toman from any origin to any destination; bus the same"); they are tagged `owner_reported`, not an
// attached official tariff. Change them here, together with the source, when an official tariff is recorded.
// A car leg has no fare source (fuel, taxi and ride-hailing prices are not modelled), so its cost stays unknown.
import type { Leg } from './plan.js';

export const FARE_SOURCE = Object.freeze({ id: 'owner_reported_flat_fare', statedAt: '2026-11-19', quality: 'owner_reported' as const });
export const FLAT_FARE_TOMAN = Object.freeze({ metro: 3000, bus: 3000 });

export type Fare =
  | { state: 'known'; toman: number; basis: 'walking' | 'flat_fare'; rides: number; quality: 'owner_reported' | 'not_applicable'; source: string | null; statedAt: string | null }
  | { state: 'unknown'; reason: 'car_cost_unknown' | 'leg_cost_unknown' };

/** One flat fare per uninterrupted metro journey (consecutive metro legs, i.e. a transfer inside the paid area, are one ride). */
export function metroRides(legs: readonly Leg[]): number {
  let rides = 0, inMetro = false;
  for (const leg of legs) {
    if (leg.type === 'metro') { if (!inMetro) rides++; inMetro = true; }
    else if (leg.type === 'walk' || leg.type === 'car') inMetro = false;
  }
  return rides;
}

export function optionFare(legs: readonly Leg[]): Fare {
  if (legs.length === 0) return { state: 'unknown', reason: 'leg_cost_unknown' };
  if (legs.some(l => l.type === 'car')) return { state: 'unknown', reason: 'car_cost_unknown' };
  const priced = new Set(['walk', 'metro', 'station_access', 'station_egress']);
  if (legs.some(l => !priced.has(l.type))) return { state: 'unknown', reason: 'leg_cost_unknown' };
  const rides = metroRides(legs);
  if (rides === 0) return { state: 'known', toman: 0, basis: 'walking', rides: 0, quality: 'not_applicable', source: null, statedAt: null };
  return { state: 'known', toman: rides * FLAT_FARE_TOMAN.metro, basis: 'flat_fare', rides, quality: FARE_SOURCE.quality, source: FARE_SOURCE.id, statedAt: FARE_SOURCE.statedAt };
}
