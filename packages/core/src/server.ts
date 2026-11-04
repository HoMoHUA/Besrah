import Fastify from 'fastify';
import { registerMiniapp } from './miniapp.js';
import { createService } from './service.js';
import { readFileSync } from 'node:fs';
import { fetchTapsifoodStatus } from './food-status.js';
import { registerFood, type FoodRoutesOptions } from './food/routes.js';
import { openAccountStore } from './account/store.js';
import { registerAccount, type AccountRoutesOptions } from './account/routes.js';
import { registerHomeRecommendations } from './home/recommendations.js';
import { registerShop, type ShopRoutesOptions } from './shop/search.js';
import { createNeshan, neshanOptionsFromEnv } from './trip/neshan.js';
import { registerTrip, type TripRoutesOptions } from './trip/routes.js';
import { registerJourneyBeta, type JourneyBetaConfig } from './journey-beta/index.js';
import type { TimetableSource } from './transit-journey/contracts.js';
import { createTimetableModel, type TimetableModel } from './timetable-overlay.js';

export function buildServer(opts: { now?: () => number; foodStatusFetch?: typeof fetch; journeyBeta?: Partial<JourneyBetaConfig>; journeySource?: TimetableSource; limiterClock?: () => number; food?: FoodRoutesOptions; trip?: TripRoutesOptions; account?: AccountRoutesOptions; shop?: ShopRoutesOptions; timetable?: TimetableModel } = {}) {
  // Product wiring: the validated overlay (or, on any problem, the baseline generator) serves board, tracker and journey alike.
  const timetable = opts.timetable ?? createTimetableModel();
  const svc = createService(undefined, undefined, timetable);
  const app = Fastify({ logger: false });
  const now = opts.now ?? (() => Date.now());

  app.get('/health', async () => ({ ok: true }));

  // The public catalogue, not the client, supplies the point sent to the provider.
  const vendors = new Map<string, { latitude: number; longitude: number }>();
  let foodStatusAvailable = false;
  try {
    const catalog = JSON.parse(readFileSync(new URL('../../../apps/miniapp/assets/food-catalog.json', import.meta.url), 'utf8')) as { vendors: Array<{ s: string; c: string; la: number; lo: number }> } | null;
    if (!Array.isArray(catalog?.vendors)) throw new Error('invalid_food_catalog');
    const ambiguous = new Set<string>();
    for (const v of catalog.vendors) {
      if (!v || v.s !== 't' || typeof v.c !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(v.c) || !Number.isFinite(v.la) || v.la < 35.9 || v.la > 36.6 || !Number.isFinite(v.lo) || v.lo < 59.1 || v.lo > 60.1) continue;
      const existing = vendors.get(v.c);
      if (existing && (existing.latitude !== v.la || existing.longitude !== v.lo)) ambiguous.add(v.c);
      vendors.set(v.c, { latitude: v.la, longitude: v.lo });
    }
    for (const code of ambiguous) vendors.delete(code);
    foodStatusAvailable = true;
  } catch {
    // Food is optional: a missing/corrupt catalogue must not stop transit startup.
    vendors.clear();
  }
  let windowStart = 0, requests = 0;
  const lastVendorRequest = new Map<string, number>();
  app.get<{ Querystring: { vendor?: string } }>('/app/api/food-status', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (Object.keys(req.query).some(key => key !== 'vendor') || typeof req.query.vendor !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(req.query.vendor)) return reply.code(400).send({ error: 'bad_request' });
    if (!foodStatusAvailable) return reply.code(503).send({ error: 'food_status_unavailable', status: 'unknown', observedAt: null });
    const point = vendors.get(req.query.vendor);
    if (!point) return reply.code(404).send({ error: 'unknown_vendor' });
    const time = Date.now();
    if (time - windowStart >= 60_000) { windowStart = time; requests = 0; }
    if (requests >= 60 || time - (lastVendorRequest.get(req.query.vendor) ?? 0) < 5000) return reply.code(429).send({ error: 'rate_limited' });
    requests++;
    lastVendorRequest.set(req.query.vendor, time);
    return fetchTapsifoodStatus({ vendorCode: req.query.vendor, ...point }, opts.foodStatusFetch);
  });

  registerFood(app, { now, ...opts.food });
  registerShop(app, { now, ...opts.shop });
  // Guest-first accounts: enabled only when BESRAH_ACCOUNT_DB points at a writable file; otherwise the app stays guest-only.
  const accountDb = process.env.BESRAH_ACCOUNT_DB?.trim();
  registerAccount(app, { now, limiterClock: opts.limiterClock, ...(accountDb ? { open: () => openAccountStore(accountDb) } : {}),
    ...(process.env.BESRAH_TELEGRAM_BOT_ID ? { botId: process.env.BESRAH_TELEGRAM_BOT_ID } : {}),
    allowedOrigins: (process.env.BESRAH_ALLOWED_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean), ...opts.account });
  registerHomeRecommendations(app, { now, limiterClock: opts.limiterClock });

  app.get<{ Querystring: { station?: string; at?: string; limit?: string; line?: string } }>('/v1/next', nextHandler);
  app.get<{ Querystring: { station?: string; at?: string; limit?: string; line?: string } }>('/app/api/next', nextHandler);

  async function nextHandler(req: import('fastify').FastifyRequest<{ Querystring: { station?: string; at?: string; limit?: string; line?: string } }>, reply: import('fastify').FastifyReply) {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    const station = (req.query.station ?? '').trim();
    if (!station) return reply.code(400).send({ error: 'station_required' });
    const at = req.query.at ? Math.floor(Date.parse(req.query.at) / 1000) : Math.floor(now() / 1000);
    if (!Number.isFinite(at)) return reply.code(400).send({ error: 'bad_at' });
    const limit = Math.min(10, Math.max(1, Number(req.query.limit ?? 4) || 4));
    let line: 1 | 2 | undefined;
    if (req.query.line !== undefined) {
      if (req.query.line !== '1' && req.query.line !== '2') return reply.code(400).send({ error: 'bad_line' });
      line = Number(req.query.line) as 1 | 2;
    }
    try {
      return svc.next(station, at, limit, line);
    } catch (e: any) {
      return reply.code(404).send({ error: 'unknown_station', station });
    }
  }

  type TrainsQuery = { Querystring: { line?: string; at?: string } };
  async function trainsHandler(req: import('fastify').FastifyRequest<TrainsQuery>, reply: import('fastify').FastifyReply) {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (req.query.line !== '1' && req.query.line !== '2') return reply.code(400).send({ error: 'bad_line' });
    const at = req.query.at ? Math.floor(Date.parse(req.query.at) / 1000) : Math.floor(now() / 1000);
    if (!Number.isFinite(at)) return reply.code(400).send({ error: 'bad_at' });
    return svc.positions(Number(req.query.line) as 1 | 2, at);
  }
  app.get<TrainsQuery>('/v1/trains', trainsHandler);
  app.get<TrainsQuery>('/app/api/trains', trainsHandler);

  // Controlled beta: reads BESRAH_JOURNEY_* from the environment, default OFF. Registered before the static allowlist.
  const journey = registerJourneyBeta(app, { now, config: opts.journeyBeta, source: opts.journeySource, limiterClock: opts.limiterClock, timetable });
  // Door-to-door planning: routing via a server-side key (absent key = honest 'unavailable'), metro legs via the beta engine.
  registerTrip(app, { now, limiterClock: opts.limiterClock, router: createNeshan(neshanOptionsFromEnv()), metro: journey, ...opts.trip });

  registerMiniapp(app);
  return app;
}
