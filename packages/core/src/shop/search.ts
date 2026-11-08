// Shopping: read-only search over a curated, versioned offer snapshot. Prices are what product pages declared at `observedAt`;
// nothing here is live, "cheapest on the market" is never claimed, stock and shipping stay unknown, unresolved prices stay unresolved.
import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { normalizeFa } from '../food/search.js';
import { decideShop } from '../decision/shop.js';

export const SHOP_CATALOG_URL = new URL('../../../../data/shop/catalog-v1.json', import.meta.url);
const STALE_HOURS = 48;

interface RawOffer { seller: string; merchant: string; url: string; matchState: string; variantUnresolved: string[]; stock: string; availabilityDeclared: string; shipping: string; state: 'resolved' | 'unresolved' | 'quarantined'; priceToman: number | null; priceCandidatesToman?: number[]; reason?: string; spreadWarning?: boolean }
interface RawProduct { canonicalProductId: string; sku: string; title: string; brand: string | null; category: string | null; variantBasis: string; observedAt: string; source: { kind: string; url: string; priceValidUntil?: string | null }; offers: RawOffer[]; summary: { resolved: number; minToman: number | null; maxToman: number | null } }
interface RawCatalog { v: 1; generatedAt: string; products: RawProduct[]; licenseNote: string }
export interface ShopCatalog { generatedAt: string; products: Array<{ raw: RawProduct; text: string }> }

export function parseShopCatalog(text: string): ShopCatalog {
  const raw = JSON.parse(text) as RawCatalog;
  if (raw?.v !== 1 || !Array.isArray(raw.products)) throw new Error('invalid_shop_catalog');
  return { generatedAt: raw.generatedAt, products: raw.products.map(p => ({ raw: p, text: normalizeFa(`${p.title} ${p.brand ?? ''} ${p.category ?? ''}`) })) };
}
export const loadShopCatalog = (path: URL | string = SHOP_CATALOG_URL): ShopCatalog => parseShopCatalog(readFileSync(path, 'utf8'));

const snapshotOf = (c: ShopCatalog, nowMs: number) => {
  const times = c.products.map(p => Date.parse(p.raw.observedAt)).filter(Number.isFinite);
  const oldest = times.length ? Math.min(...times) : NaN, newest = times.length ? Math.max(...times) : NaN;
  const ageHours = Number.isFinite(newest) ? Math.max(0, Math.round((nowMs - oldest) / 3_600_000)) : null;
  return { observedFrom: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null, observedTo: Number.isFinite(newest) ? new Date(newest).toISOString() : null, ageHours, stale: ageHours === null || ageHours > STALE_HOURS };
};
const NOTES = ['قیمت ها همان چیزی است که صفحهٔ محصول در زمان ثبت اعلام کرده؛ لحظه ای نیستند و پیش از خرید باید در فروشگاه تأیید شوند.',
  'موجودی، هزینهٔ ارسال و گارانتی در این فهرست بررسی نشده است. ارزان ترین بودن در بازار ادعا نمی شود؛ فقط در میان فروشندگان ثبت شدهٔ همین صفحه است.'];

export interface ShopQuery { q?: string; maxPrice?: number | null; limit?: number; offset?: number; sort?: 'relevance' | 'price' }
const offerDto = (o: RawOffer) => ({ seller: o.seller, merchant: o.merchant, state: o.state, priceToman: o.state === 'resolved' ? o.priceToman : null,
  priceCandidatesToman: o.state === 'unresolved' ? o.priceCandidatesToman ?? [] : [], reason: o.reason ?? null, spreadWarning: Boolean(o.spreadWarning), matchState: o.matchState,
  variantUnresolved: o.variantUnresolved, stock: o.stock, availabilityDeclared: o.availabilityDeclared, shipping: o.shipping, url: o.url });
const productDto = (p: RawProduct) => ({ id: p.canonicalProductId, title: p.title, brand: p.brand, category: p.category, observedAt: p.observedAt,
  source: { kind: p.source.kind, url: p.source.url }, minToman: p.summary.minToman, maxToman: p.summary.maxToman, resolvedOffers: p.summary.resolved, offerCount: p.offers.length,
  priceState: p.summary.resolved === 0 ? 'unresolved' : p.summary.resolved === 1 ? 'single_offer' : 'compared',
  // Several sellers on ONE marketplace page are not a market-wide comparison; the client must be able to say which it is.
  ...scopeOf(p) });
const scopeOf = (p: RawProduct) => {
  const merchants = [...new Set(p.offers.map(o => o.merchant).filter(Boolean))].sort();
  return { merchants, comparisonScope: merchants.length > 1 ? 'multi_marketplace' as const : 'single_marketplace' as const };
};

export function searchShop(catalog: ShopCatalog, query: ShopQuery, nowMs: number) {
  const tokens = normalizeFa(query.q ?? '').split(' ').filter(Boolean);
  let rows = catalog.products.filter(p => tokens.every(t => p.text.includes(t)));
  if (query.maxPrice != null) rows = rows.filter(p => p.raw.summary.minToman !== null && p.raw.summary.minToman <= query.maxPrice!);
  const total = rows.length;
  if (query.sort === 'price') rows = [...rows].sort((a, b) => (a.raw.summary.minToman ?? Infinity) - (b.raw.summary.minToman ?? Infinity));
  const limit = Math.min(Math.max(query.limit ?? 10, 1), 20), offset = Math.max(query.offset ?? 0, 0);
  return { total, offset, limit, products: rows.slice(offset, offset + limit).map(p => productDto(p.raw)), snapshot: snapshotOf(catalog, nowMs), notes: NOTES };
}

export function shopProduct(catalog: ShopCatalog, id: string, nowMs: number) {
  const p = catalog.products.find(x => x.raw.canonicalProductId === id)?.raw;
  if (!p) return null;
  const rank = (o: RawOffer) => (o.state === 'resolved' ? 0 : o.state === 'unresolved' ? 1 : 2);
  const offers = [...p.offers].sort((a, b) => rank(a) - rank(b) || (a.priceToman ?? Infinity) - (b.priceToman ?? Infinity) || a.seller.localeCompare(b.seller, 'fa'));
  const resolved = offers.filter(o => o.state === 'resolved').map(o => o.priceToman!);
  const spread = resolved.length >= 2 ? { minToman: Math.min(...resolved), maxToman: Math.max(...resolved), ratio: Math.round((Math.max(...resolved) / Math.min(...resolved)) * 100) / 100 } : null;
  const ageHours = Math.max(0, Math.round((nowMs - Date.parse(p.observedAt)) / 3_600_000));
  const decision = decideShop({ productId: p.canonicalProductId, observedAt: p.observedAt, nowSec: Math.floor(nowMs / 1000), offers: offers.map(o => ({ seller: o.seller, state: o.state, priceToman: o.priceToman, variantUnresolved: o.variantUnresolved, matchState: o.matchState, merchant: o.merchant })) });
  return { ...productDto(p), variantBasis: p.variantBasis, offers: offers.map(offerDto), spread, snapshot: { observedAt: p.observedAt, ageHours, stale: ageHours > STALE_HOURS }, decision, notes: NOTES };
}

export interface ShopRoutesOptions { catalog?: ShopCatalog | null; loader?: () => ShopCatalog; now?: () => number }
export function registerShop(app: FastifyInstance, opts: ShopRoutesOptions = {}) {
  let catalog: ShopCatalog | null | undefined = opts.catalog;
  const get = (): ShopCatalog | null => { if (catalog !== undefined) return catalog; try { catalog = (opts.loader ?? loadShopCatalog)(); } catch { catalog = null; } return catalog; };
  const head = (r: FastifyReply) => r.header('Cache-Control', 'private, max-age=30').header('X-Content-Type-Options', 'nosniff');
  const bad = (r: FastifyReply, field: string) => head(r).code(400).send({ error: 'bad_request', field });
  const int = (v: unknown, lo: number, hi: number): number | undefined | null => {
    if (v === undefined) return undefined;
    if (typeof v !== 'string' || !/^\d{1,9}$/.test(v)) return null;
    const n = Number(v); return n < lo || n > hi ? null : n;
  };
  app.get<{ Querystring: Record<string, unknown> }>('/app/api/shop/search', async (req, reply) => {
    const q = req.query;
    if (Object.keys(q).some(k => !['q', 'maxPrice', 'sort', 'limit', 'offset'].includes(k))) return bad(reply, 'query');
    if (q.q !== undefined && (typeof q.q !== 'string' || q.q.length > 60)) return bad(reply, 'q');
    const maxPrice = int(q.maxPrice, 1000, 10_000_000_000), limit = int(q.limit, 1, 20), offset = int(q.offset, 0, 10_000);
    if (maxPrice === null) return bad(reply, 'maxPrice'); if (limit === null) return bad(reply, 'limit'); if (offset === null) return bad(reply, 'offset');
    if (q.sort !== undefined && q.sort !== 'relevance' && q.sort !== 'price') return bad(reply, 'sort');
    const c = get();
    if (!c) return head(reply).code(503).send({ error: 'shop_catalog_unavailable' });
    return head(reply).send(searchShop(c, { ...(q.q !== undefined ? { q: q.q as string } : {}), maxPrice: maxPrice ?? null, ...(limit !== undefined ? { limit } : {}), ...(offset !== undefined ? { offset } : {}), sort: q.sort as ShopQuery['sort'] }, opts.now?.() ?? Date.now()));
  });
  app.get<{ Querystring: Record<string, unknown> }>('/app/api/shop/product', async (req, reply) => {
    const q = req.query;
    if (Object.keys(q).some(k => k !== 'id') || typeof q.id !== 'string' || !/^tl:\d{1,9}$/.test(q.id)) return bad(reply, 'id');
    const c = get();
    if (!c) return head(reply).code(503).send({ error: 'shop_catalog_unavailable' });
    const dto = shopProduct(c, q.id, opts.now?.() ?? Date.now());
    return dto ? head(reply).send(dto) : head(reply).code(404).send({ error: 'unknown_product' });
  });
}
