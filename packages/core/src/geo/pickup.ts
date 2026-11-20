// Nearby pickup / drop-off points on the OSM street network (F4, «کمترین قیمت ممکن اسنپ»).
// A ride-hailing price depends on the exact point: ten metres onto another street, or past an intersection, can change
// the route (U-turns, one-way streets) and the price. For a point P this returns a few candidate points on car streets
// within a short walk: the nearest point of each nearby street, then points before and after it along that street.
// Pure geometry over OpenStreetMap data (ODbL); no provider is asked here.
import { readFileSync } from 'node:fs';

export interface RoadWay { id: number; tags: { highway?: string; name?: string; oneway?: string; access?: string; tunnel?: string; bridge?: string }; geometry: Array<[number, number]> }
export interface Candidate { lat: number; lon: number; walkM: number; street: string | null; wayId: number; kind: 'nearest' | 'along' }
interface Seg { way: RoadWay; i: number }

const NO_PICKUP = new Set(['motorway', 'motorway_link', 'trunk_link']);   // freeways and their ramps: no stopping
const R = 6371000, RAD = Math.PI / 180;
const CELL = 0.002;                                                    // ~220 m north-south

/** Local metric frame around a latitude: metres east and north. */
const frame = (lat0: number) => ({ kx: R * RAD * Math.cos(lat0 * RAD), ky: R * RAD });
export function distM(a: [number, number], b: [number, number]): number {
  const { kx, ky } = frame((a[0] + b[0]) / 2);
  return Math.hypot((b[1] - a[1]) * kx, (b[0] - a[0]) * ky);
}

/** A car can stop here for a passenger: not a freeway or ramp, not private, not inside a tunnel or on a bridge. */
export function canStop(w: RoadWay): boolean {
  const t = w.tags ?? {};
  return Array.isArray(w.geometry) && w.geometry.length >= 2 && !NO_PICKUP.has(t.highway ?? '') && t.access !== 'private' && t.access !== 'no'
    && (t.tunnel === undefined || t.tunnel === 'no') && (t.bridge === undefined || t.bridge === 'no');
}

export function loadRoads(path: string | URL): RoadWay[] {
  const d = JSON.parse(readFileSync(path, 'utf8')) as { ways?: unknown };
  if (!Array.isArray(d.ways)) throw new Error('bad roads file');
  return (d.ways as RoadWay[]).filter(canStop);
}

export function createRoadIndex(all: readonly RoadWay[]) {
  const ways = all.filter(canStop);
  const grid = new Map<string, Seg[]>();
  const key = (i: number, j: number) => `${i}:${j}`;
  for (const way of ways) {
    for (let i = 0; i + 1 < way.geometry.length; i++) {
      const [a, b] = [way.geometry[i]!, way.geometry[i + 1]!];
      const i0 = Math.floor(Math.min(a[0], b[0]) / CELL), i1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const j0 = Math.floor(Math.min(a[1], b[1]) / CELL), j1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let x = i0; x <= i1; x++) for (let y = j0; y <= j1; y++) (grid.get(key(x, y)) ?? grid.set(key(x, y), []).get(key(x, y))!).push({ way, i });
    }
  }
  function near(p: [number, number], radiusM: number): Seg[] {
    const span = Math.ceil(radiusM / 180) + 1, ci = Math.floor(p[0] / CELL), cj = Math.floor(p[1] / CELL), out = new Set<Seg>();
    for (let x = ci - span; x <= ci + span; x++) for (let y = cj - span; y <= cj + span; y++) for (const s of grid.get(key(x, y)) ?? []) out.add(s);
    return [...out];
  }
  return { near, size: ways.length };
}
export type RoadIndex = ReturnType<typeof createRoadIndex>;

/** Closest point of segment a-b to p (all [lat, lon]); t in [0, 1]. */
function project(p: [number, number], a: [number, number], b: [number, number]): { pt: [number, number]; t: number; d: number } {
  const { kx, ky } = frame(p[0]);
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const x = ax + t * dx, y = ay + t * dy;
  return { pt: [p[0] + y / ky, p[1] + x / kx], t, d: Math.hypot(x, y) };
}

/** The point `offsetM` metres along a way from (segment i, fraction t); null past either end. */
function along(way: RoadWay, i: number, t: number, offsetM: number): [number, number] | null {
  const g = way.geometry;
  let seg = i, frac = t, left = Math.abs(offsetM);
  const fwd = offsetM > 0;
  while (left > 0) {
    const a = g[seg]!, b = g[seg + 1]!, len = distM(a, b);
    const avail = fwd ? (1 - frac) * len : frac * len;
    if (left <= avail && len > 0) {
      const f = fwd ? frac + left / len : frac - left / len;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    left -= avail;
    if (fwd) { seg++; frac = 0; if (seg + 1 >= g.length) return null; }
    else { seg--; frac = 1; if (seg < 0) return null; }
  }
  return null;
}

export function pickupCandidates(index: RoadIndex, at: { lat: number; lon: number }, opts: { radiusM?: number; max?: number; minGapM?: number; steps?: number[] } = {}): Candidate[] {
  const radiusM = opts.radiusM ?? 200, max = opts.max ?? 6, minGapM = opts.minGapM ?? 30, steps = opts.steps ?? [70, -70, 140, -140];
  const p: [number, number] = [at.lat, at.lon];
  // Nearest point of every nearby way.
  const best = new Map<number, { way: RoadWay; i: number; t: number; pt: [number, number]; d: number }>();
  for (const s of index.near(p, radiusM)) {
    const pr = project(p, s.way.geometry[s.i]!, s.way.geometry[s.i + 1]!);
    const cur = best.get(s.way.id);
    if (pr.d <= radiusM && (!cur || pr.d < cur.d)) best.set(s.way.id, { way: s.way, i: s.i, t: pr.t, pt: pr.pt, d: pr.d });
  }
  const nearest = [...best.values()].sort((a, b) => a.d - b.d);
  const pool: Candidate[] = [];
  const name = (w: RoadWay) => (typeof w.tags.name === 'string' && w.tags.name.trim() ? w.tags.name.trim().slice(0, 60) : null);
  for (const n of nearest) pool.push({ lat: n.pt[0], lon: n.pt[1], walkM: Math.round(n.d), street: name(n.way), wayId: n.way.id, kind: 'nearest' });
  for (const n of nearest.slice(0, 4)) {
    for (const off of steps) {
      const q = along(n.way, n.i, n.t, off);
      if (!q) continue;
      const d = distM(p, q);
      if (d <= radiusM) pool.push({ lat: q[0], lon: q[1], walkM: Math.round(d), street: name(n.way), wayId: n.way.id, kind: 'along' });
    }
  }
  // Varied and spread out: nearest points of different streets first, then along-street points; never two within minGapM.
  const chosen: Candidate[] = [];
  const far = (c: Candidate) => chosen.every(x => distM([x.lat, x.lon], [c.lat, c.lon]) >= minGapM) && distM(p, [c.lat, c.lon]) >= 8;
  const ordered = [...pool.filter(c => c.kind === 'nearest'), ...pool.filter(c => c.kind === 'along').sort((a, b) => a.walkM - b.walkM)];
  for (const c of ordered) { if (chosen.length >= max) break; if (far(c)) chosen.push({ ...c, lat: Math.round(c.lat * 1e6) / 1e6, lon: Math.round(c.lon * 1e6) / 1e6 }); }
  return chosen;
}
