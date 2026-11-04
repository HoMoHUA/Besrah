// Food search over the committed vendor/menu snapshot (data/food/food-index-v1.json.gz).
// Everything here is read-only and pure: no network, no provider call, no price invented. Unknown stays unknown.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const FOOD_INDEX_URL = new URL('../../../../data/food/food-index-v1.json.gz', import.meta.url);

/** [name, variation, price|null, discountedPrice|null, menuCategory] */
type RawItem = [string, string, number | null, number | null, string];
interface RawVendor {
  id: string; s: 's' | 't'; c: string; n: string; b: string; t: string; la: number; lo: number; a: string;
  m: number | null; r: number | null; cc: number | null; o: 0 | 1 | null; cap: number | null; lk: string; i: RawItem[];
}
interface RawIndex { v: 1; capturedFrom: number | null; capturedTo: number | null; vendors: RawVendor[] }

const DIGITS: Record<string, string> = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
/** Persian/Arabic folding used for both the index and the query: yeh/kaf variants, digits, ZWNJ, tatweel, diacritics, case. */
export function normalizeFa(input: string): string {
  return String(input ?? '').toLowerCase()
    .replace(/[٠-٩۰-۹]/g, d => DIGITS[d] ?? d)
    .replace(/[يى]/g, 'ی').replace(/[ك]/g, 'ک').replace(/[ةۀ]/g, 'ه').replace(/[أإآ]/g, 'ا').replace(/ؤ/g, 'و').replace(/ئ/g, 'ی')
    .replace(/[\u200c\u200d\u200f\u200e\u0640\u064b-\u065f\u0670]/g, m => (m === '\u200c' ? ' ' : ''))
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

export interface FoodVendorRef { id: string }
interface IndexedVendor { raw: RawVendor; vText: string; iText: string[]; iName: string[]; iSide: boolean[] }
export interface FoodIndex {
  readonly vendors: ReadonlyArray<IndexedVendor>;
  readonly byId: ReadonlyMap<string, IndexedVendor>;
  readonly capturedFrom: number | null; readonly capturedTo: number | null;
  readonly itemCount: number;
}

// Cutlery, sauces, drinks, bread and pickles are real menu lines but not "the dish": they are kept out of a dish search
// (a 3 000 toman spoon is not the cheapest chelo kabab) unless the query itself asks for them.
const SIDE_WORDS = /قاشق|چنگال|ظرف|بسته بندی|کیسه|سس|ترشی|زیتون|دوغ|نوشابه|نوشیدنی|آب معدنی|لواش|سنگک|بربری|تافتون|ماست|اضافات|افزودنی|هزینه|کالابرگ/;
const SIDE_START = /^(قاشق|چنگال|ظرف|بسته بندی|کیسه|سس|ترشی|زیتون|دوغ|نوشابه|آب معدنی|نان|ماست|پیاز|لیمو|سیب زمینی)( |$)/;
export function parseFoodIndex(bytes: Buffer): FoodIndex {
  const raw = JSON.parse(gunzipSync(bytes).toString('utf8')) as RawIndex;
  if (raw.v !== 1 || !Array.isArray(raw.vendors)) throw new Error('unsupported food index');
  const vendors = raw.vendors.map<IndexedVendor>(v => ({ raw: v, vText: normalizeFa(`${v.n} ${v.b} ${v.t}`), iText: v.i.map(it => normalizeFa(`${it[0]} ${it[1]} ${it[4]}`)),
    iName: v.i.map(it => normalizeFa(`${it[0]} ${it[1]}`)),
    iSide: v.i.map(it => SIDE_WORDS.test(normalizeFa(it[4])) || SIDE_START.test(normalizeFa(it[0]))) }));
  return { vendors, byId: new Map(vendors.map(v => [v.raw.id, v])), capturedFrom: raw.capturedFrom, capturedTo: raw.capturedTo, itemCount: vendors.reduce((t, v) => t + v.raw.i.length, 0) };
}
export function loadFoodIndex(path: URL | string = FOOD_INDEX_URL): FoodIndex {
  return parseFoodIndex(readFileSync(typeof path === 'string' ? path : fileURLToPath(path)));
}

export type PriceState = 'known' | 'unknown';
export interface FoodItemDto { name: string; variation: string | null; category: string | null; priceToman: number | null; finalPriceToman: number | null; discounted: boolean; priceState: PriceState }
const itemDto = (it: RawItem): FoodItemDto => {
  const price = it[2], disc = it[3];
  const final = disc !== null && price !== null && disc < price ? disc : price;
  return { name: it[0], variation: it[1] || null, category: it[4] || null, priceToman: price, finalPriceToman: final, discounted: final !== null && price !== null && final < price, priceState: price === null ? 'unknown' : 'known' };
};
const finalPrice = (it: RawItem): number | null => { const f = it[3] !== null && it[2] !== null && it[3] < it[2] ? it[3] : it[2]; return f; };

/** Rating pulled toward 8/10 until a vendor has enough reviews, so a perfect 10 from three people does not top the list. */
const weightedRating = (v: RawVendor): number => { const n = v.cc ?? 0, r = v.r ?? 8; return (r * n + 8 * 20) / (n + 20); };

const R = 6371008.8;
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180, dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface FoodQuery {
  q?: string; source?: 's' | 't' | null; maxPrice?: number | null; minPrice?: number | null;
  near?: { lat: number; lon: number } | null; radiusM?: number | null; sort?: 'relevance' | 'price' | 'distance' | 'rating';
  limit?: number; offset?: number;
}
export interface FoodVendorDto {
  id: string; provider: 'snappfood' | 'tapsifood'; name: string; branch: string | null; category: string; address: string | null;
  lat: number; lon: number; distanceM: number | null; rating: number | null; commentCount: number | null;
  minOrderToman: number | null; minOrderState: 'known' | 'unknown';
  openSnapshot: { value: 'open' | 'closed' | 'unknown'; capturedAt: string | null; note: string };
  capturedAt: string | null; orderUrl: string; orderCode: string;
  matchedCount: number; matched: FoodItemDto[]; cheapestMatchedToman: number | null;
}
export interface FoodSearchResult {
  total: number; offset: number; limit: number; vendors: FoodVendorDto[];
  unknownPriceExcluded: number;
  snapshot: { capturedFrom: string | null; capturedTo: string | null; ageHours: number | null; stale: boolean };
  notes: string[];
}

const iso = (s: number | null) => (s === null ? null : new Date(s * 1000).toISOString());
const STALE_HOURS = 48;

function vendorDto(v: RawVendor, matched: RawItem[], total: number, near: FoodQuery['near']): FoodVendorDto {
  const open = v.o === null ? 'unknown' : v.o ? 'open' : 'closed';
  const prices = matched.map(finalPrice).filter((p): p is number => p !== null);
  return {
    id: v.id, provider: v.s === 's' ? 'snappfood' : 'tapsifood', name: v.n, branch: v.b || null, category: v.t, address: v.a || null, lat: v.la, lon: v.lo,
    distanceM: near ? Math.round(distanceM(near.lat, near.lon, v.la, v.lo)) : null, rating: v.r, commentCount: v.cc,
    minOrderToman: v.m, minOrderState: v.m === null ? 'unknown' : 'known',
    openSnapshot: { value: open, capturedAt: iso(v.cap), note: 'وضعیت باز یا بسته فقط در زمان ثبت دادهٔ فروشگاه دیده شده است؛ وضعیت فعلی را در پلتفرم سفارش ببینید.' },
    capturedAt: iso(v.cap), orderUrl: v.lk, orderCode: v.c, matchedCount: total, matched: matched.slice(0, 4).map(itemDto),
    cheapestMatchedToman: prices.length ? Math.min(...prices) : null,
  };
}

export function searchFood(index: FoodIndex, query: FoodQuery, nowMs = Date.now()): FoodSearchResult {
  const tokens = normalizeFa(query.q ?? '').split(' ').filter(Boolean).slice(0, 6);
  const limit = Math.min(20, Math.max(1, Math.floor(query.limit ?? 10))), offset = Math.min(400, Math.max(0, Math.floor(query.offset ?? 0)));
  const askedForSide = tokens.some(t => SIDE_WORDS.test(t) || SIDE_START.test(t));
  const near = query.near ?? null;
  const radius = near && query.radiusM ? query.radiusM : null;
  const priced = query.maxPrice != null || query.minPrice != null;
  let unknownExcluded = 0;
  const hits: Array<{ v: IndexedVendor; items: RawItem[]; score: number; dist: number | null; cheapest: number | null; full: boolean }> = [];
  for (const v of index.vendors) {
    if (query.source && v.raw.s !== query.source) continue;
    let dist: number | null = null;
    if (near) { dist = distanceM(near.lat, near.lon, v.raw.la, v.raw.lo); if (radius && dist > radius) continue; }
    // a token must appear either in the item (name, variation, menu category) or in the vendor (name, branch, category)
    const vendorHits = tokens.filter(t => v.vText.includes(t));
    // Items that name every query word themselves outrank items that only sit in a vendor whose NAME matches
    // (a pizzeria's "pepperoni pastry" is not a pepperoni pizza).
    const items: RawItem[] = [], viaVendor: RawItem[] = [], named: RawItem[] = []; let best = 0, bestVia = 0, bestNamed = 0;
    for (let k = 0; k < v.raw.i.length; k++) {
      if (v.iSide[k] && !askedForSide) continue;
      const text = v.iText[k];
      let inItem = 0, ok = true;
      for (const t of tokens) { if (text.includes(t)) inItem++; else if (!vendorHits.includes(t)) { ok = false; break; } }
      if (!ok) continue;
      const it = v.raw.i[k], p = finalPrice(it);
      if (priced) {
        // only count what the user asked for by name: an item that matched through the vendor name alone is not "unknown price of the dish"
        if (p === null) { if (inItem === tokens.length) unknownExcluded++; continue; }
        if (query.maxPrice != null && p > query.maxPrice) continue;
        if (query.minPrice != null && p < query.minPrice) continue;
      }
      const startsWith = tokens.length && text.startsWith(tokens[0]) ? 1 : 0, rank = inItem * 2 + startsWith;
      // An item that carries every query word in its OWN name is the dish; one that matches only because its menu category does
      // (a single grilled tomato filed under "chelo kabab") is kept as a fallback, never ranked above a real dish.
      if (tokens.length && inItem === tokens.length && tokens.every(t => v.iName[k]!.includes(t))) { named.push(it); bestNamed = Math.max(bestNamed, rank); }
      if (!tokens.length || inItem === tokens.length) { items.push(it); best = Math.max(best, rank); }
      else { viaVendor.push(it); bestVia = Math.max(bestVia, rank); }
    }
    if (named.length) { items.length = 0; items.push(...named); best = bestNamed; }
    const full = items.length > 0;
    if (!items.length && viaVendor.length) { items.push(...viaVendor); best = bestVia; }
    if (!items.length) { if (!tokens.length && !priced && v.raw.i.length === 0) { hits.push({ v, items: [], score: 0, dist, cheapest: null, full: true }); } continue; }
    const prices = items.map(finalPrice).filter((p): p is number => p !== null);
    hits.push({ v, items, score: best + vendorHits.length * 0.5 + Math.min(1, weightedRating(v.raw) / 10), dist, cheapest: prices.length ? Math.min(...prices) : null, full });
  }
  const sort = query.sort ?? (near && !tokens.length ? 'distance' : 'relevance');
  hits.sort((a, b) => {
    // a vendor that really lists the dish always beats one that only has a similar name
    if (a.full !== b.full) return a.full ? -1 : 1;
    if (sort === 'price') return (a.cheapest ?? Infinity) - (b.cheapest ?? Infinity) || b.score - a.score;
    if (sort === 'distance') return (a.dist ?? Infinity) - (b.dist ?? Infinity) || b.score - a.score;
    if (sort === 'rating') return weightedRating(b.v.raw) - weightedRating(a.v.raw) || b.score - a.score;
    return b.score - a.score || weightedRating(b.v.raw) - weightedRating(a.v.raw);
  });
  // within a vendor: cheapest known first when budget is set, otherwise best name match first
  const page = hits.slice(offset, offset + limit).map(h => {
    const items = priced ? h.items.slice().sort((a, b) => (finalPrice(a) ?? Infinity) - (finalPrice(b) ?? Infinity)) : h.items;
    return vendorDto(h.v.raw, items, h.items.length, near);
  });
  const ageHours = index.capturedTo === null ? null : Math.max(0, Math.round((nowMs / 1000 - index.capturedTo) / 3600));
  const stale = ageHours === null || ageHours > STALE_HOURS;
  const notes = [
    'قیمت ها و منو آخرین مشاهدهٔ ثبت شده از فروشگاه ها هستند، نه قیمت لحظه ای؛ پیش از سفارش در پلتفرم اصلی تأیید کنید.',
    'هزینهٔ ارسال، کارمزد، تخفیف روز و محدودهٔ ارسال به موقعیت شما در این فهرست نیست؛ مجموع پرداخت از اینجا محاسبه نمی شود.',
  ];
  if (stale) notes.unshift(`این داده حدود ${ageHours ?? '?'} ساعت پیش ثبت شده و قدیمی است.`);
  if (priced && unknownExcluded) notes.push(`${unknownExcluded} قلم بدون قیمت معلوم از نتیجهٔ بودجه کنار گذاشته شد؛ نبود قیمت به معنای صفر تومان نیست.`);
  return { total: hits.length, offset, limit, vendors: page, unknownPriceExcluded: unknownExcluded,
    snapshot: { capturedFrom: iso(index.capturedFrom), capturedTo: iso(index.capturedTo), ageHours, stale }, notes };
}

export interface FoodVendorDetail extends Omit<FoodVendorDto, 'matched' | 'matchedCount' | 'cheapestMatchedToman'> {
  menu: Array<{ category: string; items: FoodItemDto[] }>; itemCount: number; truncated: boolean;
}
export function foodVendorDetail(index: FoodIndex, id: string, near?: FoodQuery['near']): FoodVendorDetail | null {
  const v = index.byId.get(id);
  if (!v) return null;
  const base = vendorDto(v.raw, [], 0, near ?? null);
  const { matched: _m, matchedCount: _c, cheapestMatchedToman: _p, ...rest } = base;
  const cap = 400, groups = new Map<string, FoodItemDto[]>();
  for (const it of v.raw.i.slice(0, cap)) { const key = it[4] || 'سایر'; (groups.get(key) ?? groups.set(key, []).get(key)!).push(itemDto(it)); }
  return { ...rest, menu: [...groups].map(([category, items]) => ({ category, items })), itemCount: v.raw.i.length, truncated: v.raw.i.length > cap };
}
