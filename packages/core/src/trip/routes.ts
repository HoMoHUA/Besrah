// POST /app/api/trip and POST /app/api/places. POST on purpose: coordinates and search text then stay out of proxy access logs.
// Nothing here stores or logs a point; the router (Neshan) receives the coordinates needed to measure a route and nothing else.
import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { normName } from '../network.js';
import { tehranDay, tehranToEpoch } from '../time.js';
import { clientKey, createGate, createWindowLimiter } from '../journey-beta/limits.js';
import type { JourneyBetaHandle } from '../journey-beta/index.js';
import { type LatLon, type Router, noRouter } from './neshan.js';
import { haversineM, planTrip, type MetroPlanner, type StationGeo } from './plan.js';
import { parseCoordinates } from './coords.js';
import type { GeocodeOutcome } from './neshan.js';

/** Why a geocoded address is or is not in `places`. `not_enabled` = the key is not entitled to the service (Neshan 485 / 401 / 403). */
export type GeocoderState = 'ok' | 'no_match' | 'outside_coverage' | 'unavailable' | 'not_enabled' | 'not_configured' | 'skipped';
export type CoordinateState = 'none' | 'ok' | 'invalid' | 'outside_coverage';
export interface Place {
  kind: 'station' | 'address' | 'coordinates'; name: string; lat: number; lon: number;
  precision: 'station' | 'geocoded' | 'coordinates'; source: 'network' | 'neshan_geocoding' | 'user_input';
  lines?: number[]; nearStation?: { name: string; distanceM: number };
}
const NOTES = {
  address: 'نقطهٔ نشانی پیدا شده تقریبی است؛ پیش از حرکت روی نقشهٔ مقصد بررسی کنید.',
  coordinates: 'این نقطه همان مختصاتی است که وارد کردید؛ بسراه آن را تغییر نمی دهد و نام مکان را حدس نمی زند.',
} as const;
function nearestStation(p: LatLon, stations: readonly StationGeo[]): { name: string; distanceM: number } | null {
  let best: { name: string; distanceM: number } | null = null;
  for (const s of stations) { const m = haversineM(p, s); if (!best || m < best.distanceM) best = { name: s.name, distanceM: Math.round(m) }; }
  return best && best.distanceM <= 6000 ? best : null;
}

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
    if (!body || typeof body !== 'object' || !exactKeys(body, ['from', 'to', 'time'])) return bad(reply, 'body');
    const { from: f, to: t, time } = body as Record<string, unknown>;
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
      const result = await planTrip(origin, destination, Math.max(readyEpoch, nowSec), { stations: geo(), router, metro, nowSec });
      return head(reply).send(result);
    } catch { return head(reply).code(503).send({ error: 'trip_unavailable' }); }
    finally { gate.leave(); }
  });

  app.post('/app/api/places', { bodyLimit: 1024 }, async (req, reply) => {
    if (!guard(req, reply)) return reply;
    const body = req.body;
    if (!body || typeof body !== 'object' || !exactKeys(body, ['q'])) return bad(reply, 'body');
    const q = (body as { q?: unknown }).q;
    if (typeof q !== 'string' || q.trim().length < 2 || q.length > 400) return bad(reply, 'q');
    const send = (places: Place[], geocoder: GeocoderState, coordinates: CoordinateState) =>
      head(reply).send({ schemaVersion: 1, places, geocoder, coordinates, note: NOTES[coordinates === 'ok' ? 'coordinates' : 'address'] });

    // 1) A pasted coordinate pair or map link: validated offline, never sent to the geocoder.
    const parsed = parseCoordinates(q);
    if (parsed.kind === 'invalid') return send([], 'skipped', 'invalid');
    if (parsed.kind === 'point') {
      if (!inMashhad(parsed.point)) return send([], 'skipped', 'outside_coverage');
      const nearest = nearestStation(parsed.point, geo());
      return send([{ kind: 'coordinates', name: parsed.swapped ? 'نقطهٔ واردشده (عرض و طول جابه جا بود)' : 'نقطهٔ واردشده', lat: parsed.point.lat, lon: parsed.point.lon, precision: 'coordinates', source: 'user_input',
        ...(nearest ? { nearStation: nearest } : {}) }], 'skipped', 'ok');
    }
    if (q.length > 60) return bad(reply, 'q');

    // 2) Station names, offline. 3) One single-result geocode (Neshan v6); multi-result search is not used.
    const key = normName(q);
    const places: Place[] = geo().filter(s => normName(s.name).includes(key)).slice(0, 5)
      .map(s => ({ kind: 'station', name: `ایستگاه ${s.name}`, lat: s.lat, lon: s.lon, precision: 'station', source: 'network', lines: [...s.lines] }));
    let geocoder: GeocoderState = 'not_configured';
    if (router.configured && places.length < 5) {
      if (!gate.tryEnter()) return head(reply).code(429).header('Retry-After', '2').send({ error: 'busy' });
      try {
        const text = /مشهد/.test(q) ? q : `مشهد ${q}`;
        const out: GeocodeOutcome = router.geocodeDetailed ? await router.geocodeDetailed(text)
          : await router.geocode(text).then(p => (p ? { status: 'ok', point: p } as const : { status: 'no_match' } as const));
        if (out.status === 'failed') geocoder = out.code === 'unauthorized' ? 'not_enabled' : 'unavailable';
        else if (out.status === 'no_match') geocoder = 'no_match';
        else if (!inMashhad(out.point)) geocoder = 'outside_coverage';
        else {
          geocoder = 'ok';
          places.push({ kind: 'address', name: q.trim(), lat: Math.round(out.point.lat * 1e5) / 1e5, lon: Math.round(out.point.lon * 1e5) / 1e5, precision: 'geocoded', source: 'neshan_geocoding' });
        }
      } finally { gate.leave(); }
    } else if (router.configured) geocoder = 'skipped';
    return send(places, geocoder, 'none');
  });
}
