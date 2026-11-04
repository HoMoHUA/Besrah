// POST /app/api/trip and POST /app/api/places. POST on purpose: coordinates and search text then stay out of proxy access logs.
// Nothing here stores or logs a point; the router (Neshan) receives the coordinates needed to measure a route and nothing else.
import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { normName } from '../network.js';
import { tehranDay, tehranToEpoch } from '../time.js';
import { clientKey, createGate, createWindowLimiter } from '../journey-beta/limits.js';
import type { JourneyBetaHandle } from '../journey-beta/index.js';
import { type LatLon, type Router, noRouter } from './neshan.js';
import { planTrip, type MetroPlanner, type StationGeo } from './plan.js';
import { decideTrip, TRIP_PRIORITIES, type TripPriority } from '../decision/trip.js';

export const MASHHAD = { latMin: 35.9, latMax: 36.7, lonMin: 59.0, lonMax: 60.2 };
export interface TripRoutesOptions { router?: Router; stations?: readonly StationGeo[]; metro?: JourneyBetaHandle | MetroPlanner | null; now?: () => number; limiterClock?: () => number }

export function loadStationGeo(path: URL | string = new URL('../../../../data/network.json', import.meta.url)): StationGeo[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { stations?: Array<{ id: string; name: string; lat: number; lon: number; lines: number[] }> };
  if (!Array.isArray(raw.stations)) throw new Error('invalid_network');
  return raw.stations.filter(s => typeof s.lat === 'number' && typeof s.lon === 'number' && Array.isArray(s.lines))
    .map(s => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, lines: s.lines.filter((l): l is 1 | 2 => l === 1 || l === 2) })).filter(s => s.lines.length > 0);
}

const inMashhad = (p: LatLon): boolean => p.lat >= MASHHAD.latMin && p.lat <= MASHHAD.latMax && p.lon >= MASHHAD.lonMin && p.lon <= MASHHAD.lonMax;
const point = (v: unknown): LatLon | null => {
  if (!v || typeof v !== 'object') return null;
  const { lat, lon } = v as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 };
};
const exactKeys = (v: object, allowed: readonly string[]) => Object.keys(v).every(k => allowed.includes(k));

export function registerTrip(app: FastifyInstance, opts: TripRoutesOptions = {}) {
  const router = opts.router ?? noRouter, now = opts.now ?? Date.now, clock = opts.limiterClock ?? Date.now;
  let stations: readonly StationGeo[] | null = opts.stations ?? null;
  const geo = (): readonly StationGeo[] => (stations ??= loadStationGeo());
  const metro: MetroPlanner | null = !opts.metro ? null : typeof opts.metro === 'function' ? opts.metro : (l, o, d, r) => (opts.metro as JourneyBetaHandle).planMetro(l, o, d, r) as ReturnType<MetroPlanner>;
  const gate = createGate(3), global = createWindowLimiter(90, 60_000, clock, 1), client = createWindowLimiter(20, 60_000, clock);
  const head = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
  const guard = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) { head(reply).code(415).send({ error: 'unsupported_media_type' }); return false; }
    if (!global.allow('all') || !client.allow(clientKey(req))) { head(reply).code(429).header('Retry-After', '10').send({ error: 'rate_limited' }); return false; }
    return true;
  };
  const bad = (reply: FastifyReply, field: string) => head(reply).code(400).send({ error: 'bad_request', field });

  app.post('/app/api/trip', { bodyLimit: 1024 }, async (req, reply) => {
    if (!guard(req, reply)) return reply;
    const body = req.body;
    if (!body || typeof body !== 'object' || !exactKeys(body, ['from', 'to', 'time', 'maxWalkMin', 'priority'])) return bad(reply, 'body');
    const { from: f, to: t, time, maxWalkMin, priority } = body as Record<string, unknown>;
    if (priority !== undefined && !(TRIP_PRIORITIES as readonly unknown[]).includes(priority)) return bad(reply, 'priority');
    if (maxWalkMin !== undefined && (typeof maxWalkMin !== 'number' || !Number.isInteger(maxWalkMin) || maxWalkMin < 3 || maxWalkMin > 40)) return bad(reply, 'maxWalkMin');
    const origin = point(f), destination = point(t);
    if (!origin) return bad(reply, 'from');
    if (!destination) return bad(reply, 'to');
    if (!inMashhad(origin) || !inMashhad(destination)) return head(reply).code(422).send({ error: 'outside_coverage', message: 'مسیریابی فقط برای محدودهٔ مشهد است.' });
    const nowSec = Math.floor(now() / 1000);
    let readyEpoch = nowSec;
    if (time !== undefined) {
      if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return bad(reply, 'time');
      const today = tehranToEpoch(tehranDay(nowSec), `${time}:00`);
      readyEpoch = today >= nowSec - 60 ? today : today + 86400;
      if (readyEpoch > nowSec + 24 * 3600) return bad(reply, 'time');
    }
    if (!gate.tryEnter()) return head(reply).code(429).header('Retry-After', '2').send({ error: 'busy' });
    try {
      const maxWalkS = typeof maxWalkMin === 'number' ? maxWalkMin * 60 : null;
      const result = await planTrip(origin, destination, Math.max(readyEpoch, nowSec), { stations: geo(), router, metro, nowSec, ...(maxWalkS ? { maxWalkS } : {}) });
      // The Intelligence Core compares the options the planner produced; the user's stated priority is the only preference it sees.
      const decision = decideTrip(result, { priority: (priority as TripPriority | undefined) ?? null, maxWalkS, nowSec, requestId: `trip-${nowSec}` });
      const options = decision.preferred ? [...result.options].sort((x, y) => Number(y.id === decision.preferred) - Number(x.id === decision.preferred)) : result.options;
      return head(reply).send({ ...result, options, decision });
    } catch { return head(reply).code(503).send({ error: 'trip_unavailable' }); }
    finally { gate.leave(); }
  });

  app.post('/app/api/places', { bodyLimit: 512 }, async (req, reply) => {
    if (!guard(req, reply)) return reply;
    const body = req.body;
    if (!body || typeof body !== 'object' || !exactKeys(body, ['q'])) return bad(reply, 'body');
    const q = (body as { q?: unknown }).q;
    if (typeof q !== 'string' || q.trim().length < 2 || q.length > 60) return bad(reply, 'q');
    const key = normName(q);
    const places: Array<{ kind: 'station' | 'address'; name: string; lat: number; lon: number; precision: 'station' | 'geocoded'; source: string }> = geo()
      .filter(s => normName(s.name).includes(key)).slice(0, 5).map(s => ({ kind: 'station', name: `ایستگاه ${s.name}`, lat: s.lat, lon: s.lon, precision: 'station', source: 'network' }));
    let geocoder: 'ok' | 'unavailable' = router.configured ? 'ok' : 'unavailable';
    if (router.configured && places.length < 5) {
      if (!gate.tryEnter()) return head(reply).code(429).header('Retry-After', '2').send({ error: 'busy' });
      try {
        const hit = await router.geocode(/مشهد/.test(q) ? q : `مشهد ${q}`);
        if (!hit) geocoder = 'unavailable';
        else if (inMashhad(hit)) places.push({ kind: 'address', name: q.trim(), lat: Math.round(hit.lat * 1e5) / 1e5, lon: Math.round(hit.lon * 1e5) / 1e5, precision: 'geocoded', source: 'neshan_geocoding' });
      } finally { gate.leave(); }
    }
    return head(reply).send({ schemaVersion: 1, places, geocoder, note: 'نقطهٔ نشانی پیدا شده تقریبی است؛ پیش از حرکت روی نقشهٔ مقصد بررسی کنید.' });
  });
}
