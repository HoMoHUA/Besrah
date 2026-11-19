// Live bus arrivals from the Mashhad municipal geoportal (map.mashhad.ir), research note:
// docs/transit/BUS-ETA-MUNICIPAL-API-2026-11-19.md. Public, no login. Server side only, bounded and fail-closed:
// an arrival is shown as a number of minutes only when the provider gave an integer ETA AND a real bus position that is
// fresh; "-", a zero bus id or an old position is "unknown", never 0 and never a guess. Station numbers are not personal
// data, but nothing about the caller (IP, account, location) is sent upstream or logged.
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { clientKey, createWindowLimiter } from '../journey-beta/limits.js';
import { normName } from '../network.js';

export const BUS_ETA_SOURCE = 'mashhad_geoportal';
export const MAX_POSITION_AGE_S = 180;

export interface BusArrival {
  line: string; destination: string | null;
  /** Minutes until arrival, only when the provider's estimate is backed by a fresh bus position. */
  etaMin: number | null;
  state: 'live' | 'no_bus' | 'stale' | 'unknown';
  bus: { lat: number; lon: number; speedKmh: number | null; observedAt: string; ageS: number } | null;
}
export interface BusEtaResult {
  schemaVersion: 1; status: 'ok' | 'unavailable' | 'bad_station'; station: number | null;
  source: typeof BUS_ETA_SOURCE; retrievedAt: string; arrivals: BusArrival[]; note: string;
}
export interface BusEtaOptions { fetch?: typeof fetch; now?: () => number; base?: string; timeoutMs?: number; ttlMs?: number; maxInFlight?: number }
export interface BusEta { arrivals(station: unknown): Promise<BusEtaResult> }

const NOTE = 'زمان رسیدن از سامانهٔ شهرداری مشهد است و با موقعیت لحظه ای اتوبوس محاسبه می شود؛ ممکن است با واقعیت اختلاف داشته باشد.';
const MASHHAD = { latMin: 35.9, latMax: 36.7, lonMin: 59.0, lonMax: 60.2 };

export const validStation = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,6}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isSafeInteger(n) && n >= 1 && n <= 999999 ? n : null;
};

/** "/Date(1795082703000+0330)/" -> epoch milliseconds (the number is already UTC; the offset is informational). */
export function parseProviderDate(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^\/Date\((\d{10,14})([+-]\d{4})?\)\/$/.exec(v.trim());
  if (!m) return null;
  const ms = Number(m[1]);
  return Number.isSafeInteger(ms) ? ms : null;
}

const str = (v: unknown, max = 80): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

export function parseArrivals(body: unknown, nowMs: number): BusArrival[] | null {
  const rows = (body as { success?: unknown; result?: { d?: unknown } } | null)?.result?.d;
  if ((body as { success?: unknown } | null)?.success !== true || !Array.isArray(rows)) return null;
  const out: BusArrival[] = [];
  for (const row of rows.slice(0, 40) as Array<Record<string, unknown>>) {
    const line = str(row?.Line_Number, 12);
    if (!line) continue;
    const info = (row.bus_info ?? null) as Record<string, unknown> | null;
    const rawEta = typeof row.ETA_Time === 'string' ? row.ETA_Time.trim() : typeof row.ETA_Time === 'number' ? String(row.ETA_Time) : '';
    const eta = /^\d{1,3}$/.test(rawEta) ? Number(rawEta) : null;
    const lat = typeof info?.latitude === 'number' ? info.latitude / 1e6 : NaN, lon = typeof info?.longitude === 'number' ? info.longitude / 1e6 : NaN;
    const observed = parseProviderDate(info?.date);
    const hasBus = typeof info?.bus_id === 'number' && info.bus_id > 0 && lat >= MASHHAD.latMin && lat <= MASHHAD.latMax && lon >= MASHHAD.lonMin && lon <= MASHHAD.lonMax && observed !== null;
    const ageS = hasBus ? Math.round((nowMs - observed!) / 1000) : null;
    const fresh = ageS !== null && ageS >= -60 && ageS <= MAX_POSITION_AGE_S;
    const speed = typeof info?.speed === 'number' && Number.isFinite(info.speed) && info.speed >= 0 && info.speed < 150 ? info.speed : null;
    const bus = hasBus ? { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, speedKmh: speed, observedAt: new Date(observed!).toISOString(), ageS: ageS! } : null;
    const state: BusArrival['state'] = rawEta === '-' || (!hasBus && eta === null) ? 'no_bus' : !hasBus ? 'unknown' : !fresh ? 'stale' : eta === null ? 'unknown' : 'live';
    out.push({ line, destination: str(row.Destination), etaMin: state === 'live' ? eta : null, state, bus });
  }
  // Soonest live arrival first; unknowns after, in the provider's order.
  return out.sort((a, b) => (a.etaMin ?? Infinity) - (b.etaMin ?? Infinity));
}

export function createBusEta(options: BusEtaOptions = {}): BusEta {
  const doFetch = options.fetch ?? fetch, now = options.now ?? Date.now, base = options.base ?? 'https://map.mashhad.ir';
  const timeoutMs = options.timeoutMs ?? 12000, ttlMs = options.ttlMs ?? 30000, maxInFlight = options.maxInFlight ?? 3;
  const cache = new Map<number, { at: number; result: BusEtaResult }>(), pending = new Map<number, Promise<BusEtaResult>>();
  let inFlight = 0;
  const result = (station: number | null, status: BusEtaResult['status'], arrivals: BusArrival[] = []): BusEtaResult =>
    ({ schemaVersion: 1, status, station, source: BUS_ETA_SOURCE, retrievedAt: new Date(now()).toISOString(), arrivals, note: NOTE });

  async function load(station: number): Promise<BusEtaResult> {
    if (inFlight >= maxInFlight) return result(station, 'unavailable');
    inFlight++;
    try {
      const response = await doFetch(`${base}/api/proxy/eta/?Station_Number=${station}`, {
        headers: { Accept: 'application/json', Referer: `${base}/` }, signal: AbortSignal.timeout(timeoutMs), credentials: 'omit', redirect: 'error' } as RequestInit);
      if (!response.ok) return result(station, 'unavailable');
      const arrivals = parseArrivals(await response.json().catch(() => null), now());
      return arrivals ? result(station, 'ok', arrivals) : result(station, 'unavailable');
    } catch { return result(station, 'unavailable'); }
    finally { inFlight--; }
  }

  return {
    async arrivals(raw) {
      const station = validStation(raw);
      if (station === null) return result(null, 'bad_station');
      const hit = cache.get(station);
      if (hit && now() - hit.at < ttlMs) return hit.result;
      const running = pending.get(station);
      if (running) return running;
      const p = load(station).then(r => { if (r.status === 'ok') { cache.set(station, { at: now(), result: r }); if (cache.size > 500) cache.delete(cache.keys().next().value!); } return r; })
        .finally(() => pending.delete(station));
      pending.set(station, p);
      return p;
    },
  };
}

// Official stop list (municipal WFS layer `vwbusstations`), kept OUTSIDE the public repository (third-party data) and
// pointed to by BESRAH_BUS_STOPS_FILE. Without it, stop search answers 503 and the user can still type a stop number.
export interface OfficialStop { number: number; name: string; lat: number; lon: number }
export function loadOfficialStops(path: string): OfficialStop[] {
  const geo = JSON.parse(readFileSync(path, 'utf8')) as { features?: Array<{ properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } }> };
  const out: OfficialStop[] = [], seen = new Set<number>();
  for (const f of geo.features ?? []) {
    const p = f.properties ?? {}, number = validStation(p.stationnumber), name = str(p.stationname, 80);
    const [lon, lat] = Array.isArray(f.geometry?.coordinates) ? f.geometry!.coordinates as number[] : [NaN, NaN];
    if (number === null || !name || p.isactive === false || seen.has(number) || !(lat! >= MASHHAD.latMin && lat! <= MASHHAD.latMax && lon! >= MASHHAD.lonMin && lon! <= MASHHAD.lonMax)) continue;
    seen.add(number); out.push({ number, name, lat: Math.round(lat! * 1e5) / 1e5, lon: Math.round(lon! * 1e5) / 1e5 });
  }
  return out;
}
export function searchOfficialStops(stops: readonly OfficialStop[], q: string, limit = 8): OfficialStop[] {
  const query = q.trim();
  if (/^\d{1,6}$/.test(query)) return stops.filter(s => String(s.number).startsWith(query)).slice(0, limit);
  const key = normName(query);
  if (key.length < 2) return [];
  const starts: OfficialStop[] = [], contains: OfficialStop[] = [];
  for (const s of stops) { const n = normName(s.name); if (n.startsWith(key)) starts.push(s); else if (n.includes(key)) contains.push(s); }
  return [...starts, ...contains].slice(0, limit);
}

export function registerBusEta(app: FastifyInstance, opts: { eta?: BusEta; limiterClock?: () => number; stops?: () => readonly OfficialStop[] | null } = {}) {
  const eta = opts.eta ?? createBusEta();
  const limiter = createWindowLimiter(30, 60_000, opts.limiterClock ?? Date.now);
  app.get<{ Querystring: { station?: string } }>('/app/api/bus/eta', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (!limiter.allow(clientKey(req))) return reply.code(429).header('Retry-After', '10').send({ error: 'rate_limited' });
    const r = await eta.arrivals(req.query.station);
    return r.status === 'bad_station' ? reply.code(400).send(r) : r.status === 'unavailable' ? reply.code(503).send(r) : r;
  });
  let stops: readonly OfficialStop[] | null | undefined;
  const stopList = () => { if (stops !== undefined) return stops; try { stops = opts.stops ? opts.stops() : null; } catch { stops = null; } return stops; };
  // POST so typed text never lands in a URL or an access log.
  app.post('/app/api/bus/stops', { bodyLimit: 256 }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (!limiter.allow(clientKey(req))) return reply.code(429).header('Retry-After', '10').send({ error: 'rate_limited' });
    const b = req.body as { q?: unknown } | null;
    if (!b || typeof b !== 'object' || Object.keys(b).some(k => k !== 'q') || typeof b.q !== 'string' || b.q.length > 60) return reply.code(400).send({ error: 'bad_request' });
    const list = stopList();
    if (!list) return reply.code(503).send({ error: 'stops_unavailable' });
    return { schemaVersion: 1, source: BUS_ETA_SOURCE, stops: searchOfficialStops(list, b.q).map(s => ({ number: s.number, name: s.name })) };
  });
}
