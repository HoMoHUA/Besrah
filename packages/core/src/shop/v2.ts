/**
 * V2 is an OPTIONAL, read-only, snapshot-based gateway.
 * Never substitute a V2 staging file for legacy catalog-v1.json.
 * No provider calls, user tracking, offer checkout, background polling or price alerts.
 */
import { readFileSync, statSync } from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { normalizeFa } from '../food/search.js';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PRODUCTS = 2500;
const MAX_OFFERS_PER_PRODUCT = 100;
const PRICE_TTL_MS = 48 * 60 * 60 * 1000;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, cap = 180): v is string => typeof v === 'string' && !!v.trim() && v.length <= cap;
const natural = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const validTime = (v: unknown): v is string => str(v, 42) && Number.isFinite(Date.parse(v)) && /(Z|[+-]\d\d:\d\d)$/.test(v);
const safeLink = (v: unknown): v is string => {
  if (!str(v, 800)) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password && (u.port === '' || u.port === '443') && !u.hash; }
  catch { return false; }
};
const identityKeys = ['brand','model','variant','warranty','condition'] as const;
type Identity = Record<typeof identityKeys[number], string>;
export type V2OfferStatus = 'candidate' | 'stale' | 'price_unknown' | 'declared_out_of_stock';
export interface ShopV2Offer {
  sourceId: string; sourceProductId: string; merchantId: string; merchant: string;
  title: string; priceToman: number | null; shippingToman: number | null;
  stock: string; status: V2OfferStatus; sourceUrl: string; observedAt: string; validUntil: string;
}
export interface ShopV2Product {
  canonicalId: string; identity: Identity; priceComparisonAvailable: boolean;
  lowestListedPriceToman: number | null; checkoutTotalKnown: false; offers: ShopV2Offer[];
}
export interface ShopV2Catalog { schemaVersion: 2; generatedAt: string; products: ShopV2Product[] }

export function parseShopV2Catalog(text: string): ShopV2Catalog {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('shop_v2_oversized');
  const raw: unknown = JSON.parse(text);
  if (!isObject(raw) || raw.schemaVersion !== 2 || !validTime(raw.generatedAt) ||
    !Array.isArray(raw.products) || raw.products.length > MAX_PRODUCTS) throw new Error('invalid_shop_v2_catalog');
  const seen = new Set<string>();
  const products = raw.products.map((item: unknown): ShopV2Product => {
    if (!isObject(item) || !str(item.canonicalId, 86) || !/^besrah:[a-z0-9][a-z0-9_.-]{1,79}$/.test(item.canonicalId) ||
      seen.has(item.canonicalId) || !isObject(item.identity) ||
      !Array.isArray(item.offers) || item.offers.length > MAX_OFFERS_PER_PRODUCT) throw new Error('invalid_shop_v2_product');
    seen.add(item.canonicalId);
    for (const key of identityKeys) if (!str(item.identity[key])) throw new Error('invalid_shop_v2_identity');
    const identity = Object.fromEntries(identityKeys.map(k => [k, item.identity![k]])) as Identity;
    const offers = item.offers.map((offer: unknown): ShopV2Offer => {
      if (!isObject(offer) || !str(offer.sourceId, 64) || !str(offer.sourceProductId, 80) ||
        !str(offer.merchantId, 64) || !str(offer.merchant) || !str(offer.title) ||
        !['candidate','stale','price_unknown','declared_out_of_stock'].includes(String(offer.status)) ||
        !safeLink(offer.sourceUrl) || !validTime(offer.observedAt) || !validTime(offer.validUntil) ||
        (offer.priceToman !== null && !natural(offer.priceToman)) ||
        (offer.shippingToman !== null && !(Number.isSafeInteger(offer.shippingToman) && (offer.shippingToman as number) >= 0)) ||
        !str(offer.stock, 48)) throw new Error('invalid_shop_v2_offer');
      if (Date.parse(offer.validUntil) < Date.parse(offer.observedAt)) throw new Error('invalid_shop_v2_evidence_time');
      return {
        sourceId: offer.sourceId, sourceProductId: offer.sourceProductId,
        merchantId: offer.merchantId, merchant: offer.merchant, title: offer.title,
        priceToman: offer.priceToman as number | null,
        shippingToman: offer.shippingToman as number | null,
        stock: offer.stock, status: offer.status as V2OfferStatus,
        sourceUrl: offer.sourceUrl, observedAt: offer.observedAt, validUntil: offer.validUntil,
      };
    });
    // The verified group is represented by one identity; comparisons are recomputed per request,
    // not trusted from a file's now-stale precomputed "cheapest" flags.
    return { canonicalId: item.canonicalId, identity, offers, priceComparisonAvailable: false,
      lowestListedPriceToman: null, checkoutTotalKnown: false };
  });
  return { schemaVersion: 2, generatedAt: raw.generatedAt, products };
}

export function loadShopV2Catalog(path: string): ShopV2Catalog {
  if (!str(path, 2048) || statSync(path).size > MAX_BYTES) throw new Error('shop_v2_missing_or_oversized');
  return parseShopV2Catalog(readFileSync(path, 'utf8'));
}

const eligible = (p: ShopV2Product, nowMs: number): ShopV2Offer[] => p.offers.filter(o =>
  o.status === 'candidate' && natural(o.priceToman) &&
  Date.parse(o.observedAt) <= nowMs && Date.parse(o.validUntil) >= nowMs &&
  nowMs - Date.parse(o.observedAt) <= PRICE_TTL_MS
);
const scopedPrice = (p: ShopV2Product, nowMs: number) => {
  const offers = eligible(p, nowMs);
  const merchants = new Set(offers.map(o => o.merchantId));
  const comparable = offers.length >= 2 && merchants.size >= 2;
  const lowest = comparable ? Math.min(...offers.map(o => o.priceToman!)) : null;
  return { comparable, lowest, merchants: merchants.size, offers };
};
const NOTE = 'فقط قیمت ثبت‌شده و واریانت دستی تأییدشده میان همین فروشندگان قابل مقایسه است؛ موجودی لحظه‌ای، ارسال و هزینه نهایی سفارش تأیید نشده است.';

export function searchShopV2(c: ShopV2Catalog, query: {q?: string; maxPrice?: number | null; limit?: number; offset?: number}, nowMs: number) {
  const tokens = normalizeFa(query.q ?? '').split(' ').filter(Boolean).slice(0, 6);
  let found = c.products.map(p => ({p, price: scopedPrice(p, nowMs)}))
    .filter(({p}) => tokens.every(t => normalizeFa(Object.values(p.identity).join(' ')).includes(t)));
  if (query.maxPrice != null) found = found.filter(x => x.price.lowest != null && x.price.lowest <= query.maxPrice!);
  const total = found.length, offset = Math.max(0, Math.min(10000, query.offset ?? 0)), limit = Math.max(1, Math.min(20, query.limit ?? 10));
  return {schemaVersion: 2, total, offset, limit, generatedAt: c.generatedAt,
    products: found.slice(offset, offset + limit).map(({p,price}) => ({
      canonicalId:p.canonicalId, identity:p.identity, comparable:price.comparable,
      lowestListedPriceToman:price.lowest, checkoutTotalKnown:false, offerCount:p.offers.length,
    })), note:NOTE};
}

export function shopV2Product(c: ShopV2Catalog, id: string, nowMs: number) {
  const p = c.products.find(x => x.canonicalId === id);
  if (!p) return null;
  const price = scopedPrice(p, nowMs);
  const eligibleMerchants = new Set(price.offers.map(o => o.merchantId));
  return {schemaVersion:2, canonicalId:p.canonicalId, identity:p.identity,
    comparable:price.comparable, lowestListedPriceToman:price.lowest,
    checkoutTotalKnown:false, generatedAt:c.generatedAt,
    offers:p.offers.map(o => ({
      sourceId:o.sourceId, sourceProductId:o.sourceProductId, merchant:o.merchant,
      priceToman:o.priceToman, stock:o.stock, status:o.status,
      observedAt:o.observedAt, validUntil:o.validUntil, sourceUrl:o.sourceUrl,
      eligibleForComparison:price.comparable && eligibleMerchants.has(o.merchantId) && price.offers.includes(o),
      lowestWithinVerifiedGroup:price.comparable && price.offers.includes(o) && o.priceToman === price.lowest,
    })), note:NOTE};
}

export interface ShopV2RoutesOptions { catalog?: ShopV2Catalog | null; loader?: () => ShopV2Catalog; now?: () => number }
export function registerShopV2(app: FastifyInstance, opts: ShopV2RoutesOptions = {}) {
  let catalog: ShopV2Catalog | null | undefined = opts.catalog;
  const get = (): ShopV2Catalog | null => {
    if (catalog !== undefined) return catalog;
    try { catalog = (opts.loader ?? (() => {throw new Error('shop_v2_not_configured');}))(); }
    catch { catalog = null; }
    return catalog;
  };
  const head = (reply: FastifyReply) => reply.header('Cache-Control','no-store')
    .header('X-Content-Type-Options','nosniff');
  const bad = (reply:FastifyReply) => head(reply).code(400).send({error:'bad_request'});
  const parseIntQuery = (v:unknown, min:number, max:number) => typeof v === 'string' && /^\d{1,10}$/.test(v) &&
    Number(v) >= min && Number(v) <= max ? Number(v) : null;
  app.get<{Querystring:Record<string,unknown>}>('/app/api/shop/v2/search', async(req,reply)=>{
    const q=req.query;
    if(Object.keys(q).some(k=>!['q','maxPrice','offset','limit'].includes(k)) ||
       (q.q!==undefined && (typeof q.q!=='string'||q.q.length>60))) return bad(reply);
    const maxPrice=q.maxPrice===undefined?undefined:parseIntQuery(q.maxPrice,1000,10_000_000_000);
    const offset=q.offset===undefined?undefined:parseIntQuery(q.offset,0,10000);
    const limit=q.limit===undefined?undefined:parseIntQuery(q.limit,1,20);
    if(maxPrice===null||offset===null||limit===null) return bad(reply);
    const c=get();if(!c)return head(reply).code(503).send({error:'shop_v2_unavailable'});
    return head(reply).send(searchShopV2(c,{q:q.q as string|undefined,maxPrice,offset,limit},(opts.now??Date.now)()));
  });
  app.get<{Querystring:Record<string,unknown>}>('/app/api/shop/v2/product',async(req,reply)=>{
    const q=req.query;
    if(Object.keys(q).some(k=>k!=='id')||typeof q.id!=='string'||
      !/^besrah:[a-z0-9][a-z0-9_.-]{1,79}$/.test(q.id))return bad(reply);
    const c=get();if(!c)return head(reply).code(503).send({error:'shop_v2_unavailable'});
    const p=shopV2Product(c,q.id,(opts.now??Date.now)());
    return p?head(reply).send(p):head(reply).code(404).send({error:'unknown_product'});
  });
}
