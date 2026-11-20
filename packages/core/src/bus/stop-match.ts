// Which official (municipal) station each stop of a bus guide variant is, so a stop opened from a line can show live
// arrivals. Public OpenStreetMap points (data/bus/stop-points-v1.json, built by scripts/build_bus_stop_points.py) are
// joined at run time with the private municipal stop list (BESRAH_BUS_STOPS_FILE); nothing new is stored.
//
// Fail-closed, in this order:
// 1. osm_ref     the OSM `ref` tag names an official station that is at most 150 m away (most stops; the tag is the
//                municipal numbering, checked by distance and never trusted alone).
// 2. nearby_name exactly one official station within 60 m has the same base name.
// 3. nearby_side several do (the two sides of a street usually share a name): the one on the right of the bus's
//                direction of travel (Iran drives on the right), when exactly one is.
// Anything else has no match. Same-name stations nearby are returned as candidates for the person to choose; a
// station is never guessed.
import { readFileSync } from 'node:fs';
import type { OfficialStop } from './eta.js';

export const STOP_POINTS_URL = new URL('../../../../data/bus/stop-points-v1.json', import.meta.url);
export const REF_MAX_M = 150;
export const NEAR_MAX_M = 60;
export const CANDIDATE_LIMIT = 6;

export interface StopPoint { lat: number; lon: number; ref: number | null; name: string }
export type MatchMethod = 'osm_ref' | 'nearby_name' | 'nearby_side';
export interface StopMatch { number: number; name: string; method: MatchMethod; distanceM: number }
export interface StopCandidate { number: number; name: string; distanceM: number }
export interface VariantStop { match: StopMatch | null; candidates: StopCandidate[] }

const MASHHAD = { latMin: 35.9, latMax: 36.7, lonMin: 59.0, lonMax: 60.2 };
const inMashhad = (lat: number, lon: number) => lat >= MASHHAD.latMin && lat <= MASHHAD.latMax && lon >= MASHHAD.lonMin && lon <= MASHHAD.lonMax;

/** Variant id -> its stops in guide order. Throws on a malformed file (the caller turns that into "unavailable"). */
export function loadStopPoints(path: URL | string = STOP_POINTS_URL): Map<number, StopPoint[]> {
  const data = JSON.parse(readFileSync(path, 'utf8')) as { v?: unknown; n?: unknown; p?: unknown };
  if (data.v !== 1 || !Array.isArray(data.n) || !data.p || typeof data.p !== 'object') throw new Error('bad stop points file');
  const names = data.n as unknown[];
  const out = new Map<number, StopPoint[]>();
  for (const [key, rows] of Object.entries(data.p as Record<string, unknown>)) {
    const id = Number(key);
    if (!/^\d{1,12}$/.test(key) || !Number.isSafeInteger(id) || !Array.isArray(rows) || !rows.length) throw new Error('bad variant ' + key);
    out.set(id, rows.map(row => {
      const [lat, lon, ref, nameIndex] = Array.isArray(row) ? row : [];
      const name = typeof nameIndex === 'number' ? names[nameIndex] : undefined;
      if (typeof lat !== 'number' || typeof lon !== 'number' || !inMashhad(lat, lon) || typeof name !== 'string' || !name.trim()
        || !(ref === null || (typeof ref === 'string' && /^[1-9]\d{0,5}$/.test(ref)))) throw new Error('bad point in variant ' + key);
      return { lat, lon, ref: ref === null ? null : Number(ref), name };
    }));
  }
  return out;
}

/** Metres between two nearby points (equirectangular; ample for distances under a kilometre). */
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const x = (bLon - aLon) * rad * Math.cos((aLat + bLat) / 2 * rad), y = (bLat - aLat) * rad;
  return 6371000 * Math.hypot(x, y);
}

/** Comparable name: Latin digits, one spelling per letter, no "ایستگاه" prefix, no side number at the end, no spaces or marks. */
export function baseName(s: string): string {
  return s.replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ۀ/g, 'ه').replace(/[أإآ]/g, 'ا')
    .replace(/[‌‍\s\-_.،,()«»"']/g, '').replace(/^ایستگاه/, '').replace(/\d+$/, '');
}
export function sameName(a: string, b: string): boolean {
  const x = baseName(a), y = baseName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const short = x.length <= y.length ? x : y, long = short === x ? y : x;
  return short.length >= 3 && long.includes(short);
}

export function createStopMatcher(official: readonly OfficialStop[]) {
  const byNumber = new Map(official.map(s => [s.number, s]));
  // ~200 m cells; a 3 x 3 neighbourhood covers every radius used here.
  const CELL = 0.002, grid = new Map<string, OfficialStop[]>();
  const cellKey = (i: number, j: number) => `${i}:${j}`;
  for (const s of official) {
    const key = cellKey(Math.floor(s.lat / CELL), Math.floor(s.lon / CELL));
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(s);
  }
  function near(lat: number, lon: number, maxM: number): Array<{ stop: OfficialStop; d: number }> {
    const ci = Math.floor(lat / CELL), cj = Math.floor(lon / CELL), out: Array<{ stop: OfficialStop; d: number }> = [];
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      for (const stop of grid.get(cellKey(i, j)) ?? []) { const d = distanceM(lat, lon, stop.lat, stop.lon); if (d <= maxM) out.push({ stop, d }); }
    }
    return out.sort((a, b) => a.d - b.d || a.stop.number - b.stop.number);
  }
  const match = (stop: OfficialStop, method: MatchMethod, d: number): VariantStop =>
    ({ match: { number: stop.number, name: stop.name, method, distanceM: Math.round(d) }, candidates: [] });

  function matchVariant(points: readonly StopPoint[]): VariantStop[] {
    return points.map((p, k) => {
      if (p.ref !== null) {
        const tagged = byNumber.get(p.ref);
        if (tagged) { const d = distanceM(p.lat, p.lon, tagged.lat, tagged.lon); if (d <= REF_MAX_M) return match(tagged, 'osm_ref', d); }
      }
      const named = near(p.lat, p.lon, NEAR_MAX_M).filter(c => sameName(p.name, c.stop.name));
      if (named.length === 1) return match(named[0]!.stop, 'nearby_name', named[0]!.d);
      if (named.length > 1) {
        const prev = points[Math.max(0, k - 1)]!, next = points[Math.min(points.length - 1, k + 1)]!;
        const kx = Math.cos(p.lat * Math.PI / 180), vx = (next.lon - prev.lon) * kx, vy = next.lat - prev.lat;
        if (vx !== 0 || vy !== 0) {
          // Right of travel: the cross product of the direction and the offset is negative.
          const right = named.filter(c => vy * ((c.stop.lon - p.lon) * kx) - vx * (c.stop.lat - p.lat) > 0);
          if (right.length === 1) return match(right[0]!.stop, 'nearby_side', right[0]!.d);
        }
      }
      return { match: null, candidates: named.slice(0, CANDIDATE_LIMIT).map(c => ({ number: c.stop.number, name: c.stop.name, distanceM: Math.round(c.d) })) };
    });
  }
  return { matchVariant };
}
