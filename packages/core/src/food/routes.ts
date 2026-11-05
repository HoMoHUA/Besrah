// GET /app/api/food/search and /app/api/food/vendor. The index loads on first use and only then: a missing or corrupt
// file answers 503 for food and never touches transit or startup.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { foodVendorDetail, loadFoodIndex, searchFood, type FoodIndex, type FoodQuery } from './search.js';
import { FOOD_VERTICALS, type FoodVerticalFilter } from './verticals.js';
import { decideFoodResults } from './decision.js';

const MASHHAD = { latMin: 35.9, latMax: 36.7, lonMin: 59.0, lonMax: 60.2 };
const SEARCH_KEYS = new Set(['q', 'source', 'maxPrice', 'minPrice', 'lat', 'lon', 'radiusKm', 'sort', 'limit', 'offset', 'vertical']);
const VENDOR_KEYS = new Set(['id', 'lat', 'lon']);
const SOURCES: Record<string, 's' | 't'> = { snappfood: 's', tapsifood: 't' };
const SORTS = new Set(['relevance', 'price', 'distance', 'rating']);

type Query = Record<string, unknown>;
const num = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !/^-?\d{1,12}(\.\d{1,6})?$/.test(v)) return null;
  return Number(v);
};

export interface FoodRoutesOptions { index?: FoodIndex | null; loader?: () => FoodIndex; now?: () => number }

export function registerFood(app: FastifyInstance, opts: FoodRoutesOptions = {}) {
  let index: FoodIndex | null | undefined = opts.index;
  const get = (): FoodIndex | null => {
    if (index !== undefined) return index;
    try { index = (opts.loader ?? loadFoodIndex)(); } catch { index = null; }
    return index;
  };
  const head = (reply: FastifyReply) => reply.header('Cache-Control', 'private, max-age=30').header('X-Content-Type-Options', 'nosniff');
  const bad = (reply: FastifyReply, field?: string) => head(reply).code(400).send({ error: 'bad_request', field: field ?? null });
  const unavailable = (reply: FastifyReply) => head(reply).code(503).send({ error: 'food_index_unavailable' });
  // The user's own point is only used to sort and to measure distance for this one response. It is not stored or logged.
  const place = (q: Query): { near: FoodQuery['near']; note: string | null } | 'bad' => {
    const lat = num(q.lat), lon = num(q.lon);
    if (lat === undefined && lon === undefined) return { near: null, note: null };
    if (lat == null || lon == null) return 'bad';
    if (lat < MASHHAD.latMin || lat > MASHHAD.latMax || lon < MASHHAD.lonMin || lon > MASHHAD.lonMax) return { near: null, note: 'موقعیت انتخاب شده خارج از محدودهٔ پوشش مشهد است؛ فاصله محاسبه نشد.' };
    return { near: { lat, lon }, note: null };
  };

  app.get<{ Querystring: Query }>('/app/api/food/search', async (req, reply) => {
    const q = req.query;
    if (Object.keys(q).some(k => !SEARCH_KEYS.has(k))) return bad(reply);
    const text = q.q === undefined ? '' : q.q;
    if (typeof text !== 'string' || text.length > 60) return bad(reply, 'q');
    const source = q.source === undefined ? null : SOURCES[String(q.source)];
    if (q.source !== undefined && !source) return bad(reply, 'source');
    const maxPrice = num(q.maxPrice), minPrice = num(q.minPrice), radiusKm = num(q.radiusKm), limit = num(q.limit), offset = num(q.offset);
    for (const [name, v, lo, hi] of [['maxPrice', maxPrice, 1000, 100_000_000], ['minPrice', minPrice, 0, 100_000_000], ['radiusKm', radiusKm, 0.1, 30], ['limit', limit, 1, 20], ['offset', offset, 0, 400]] as const) {
      if (v === null || (v !== undefined && (v < lo || v > hi))) return bad(reply, name);
    }
    const vertical = q.vertical === undefined ? undefined : String(q.vertical);
    if (vertical !== undefined && vertical !== 'all' && vertical !== 'meals' && !FOOD_VERTICALS.includes(vertical as typeof FOOD_VERTICALS[number])) return bad(reply, 'vertical');
    const sort = q.sort === undefined ? undefined : String(q.sort);
    if (sort !== undefined && !SORTS.has(sort)) return bad(reply, 'sort');
    const where = place(q);
    if (where === 'bad') return bad(reply, 'lat');
    if (sort === 'distance' && !where.near) return bad(reply, 'sort');
    const idx = get();
    if (!idx) return unavailable(reply);
    const result = searchFood(idx, { q: text, source, maxPrice: maxPrice ?? null, minPrice: minPrice ?? null, near: where.near, radiusM: radiusKm != null ? radiusKm * 1000 : null,
      sort: sort as FoodQuery['sort'], limit: limit ?? undefined, offset: offset ?? undefined, vertical: vertical as FoodVerticalFilter | undefined }, opts.now?.() ?? Date.now());
    if (where.note) result.notes.push(where.note);
    return head(reply).send({ ...result, decision: decideFoodResults(result.vendors, opts.now?.() ?? Date.now()) });
  });

  app.get<{ Querystring: Query }>('/app/api/food/vendor', async (req, reply) => {
    const q = req.query;
    if (Object.keys(q).some(k => !VENDOR_KEYS.has(k)) || typeof q.id !== 'string' || !/^[st]:[a-zA-Z0-9]{1,32}$/.test(q.id)) return bad(reply, 'id');
    const where = place(q);
    if (where === 'bad') return bad(reply, 'lat');
    const idx = get();
    if (!idx) return unavailable(reply);
    const detail = foodVendorDetail(idx, q.id, where.near);
    if (!detail) return head(reply).code(404).send({ error: 'unknown_vendor' });
    return head(reply).send(detail);
  });
}
