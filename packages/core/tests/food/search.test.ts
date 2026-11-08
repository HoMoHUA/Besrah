// Food search: Persian folding, unknown-price semantics, budget, distance, snapshot honesty, routes.
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { FOOD_INDEX_URL, foodVendorDetail, loadFoodIndex, normalizeFa, parseFoodIndex, searchFood } from '../../src/food/search.js';

const CAP = Date.parse('2026-10-31T10:00:00Z') / 1000;
const NOW = Date.parse('2026-11-04T10:00:00Z');
const vendor = (id: string, n: string, over: Record<string, unknown> = {}) => ({ id, s: id[0], c: id.slice(2), n, b: '', t: 'رستوران', la: 36.30, lo: 59.58, a: 'مشهد', m: null, r: 8, cc: 10, o: 1, cap: CAP, lk: `https://example.test/${id}`, i: [], ...over });
const fixture = () => parseFoodIndex(gzipSync(Buffer.from(JSON.stringify({ v: 1, capturedFrom: CAP, capturedTo: CAP, vendors: [
  vendor('s:aaa', 'پیتزا شمال', { la: 36.30, lo: 59.58, m: 150000, i: [['پیتزا پپرونی', 'متوسط', 250000, null, 'پیتزا'], ['پیتزا مخصوص', '', 180000, 150000, 'پیتزا'], ['نوشابه', '', null, null, 'نوشیدنی'], ['پیتزا قارچ', '', 0 || null, null, 'پیتزا']] }),
  vendor('t:bbb', 'کبابی دور', { la: 36.40, lo: 59.50, o: 0, i: [['چلو کباب کوبیده', '', 320000, null, 'کباب'], ['پیتزا کبابی', '', 400000, null, 'فست فود']] }),
  vendor('t:ccc', 'کافه خالی', { la: 36.31, lo: 59.59, o: null, i: [] }),
]}))));

describe('normalizeFa', () => {
  it('folds Arabic letters, digits, ZWNJ and case so one query matches every spelling', () => {
    expect(normalizeFa('كباب  كوبيده')).toBe(normalizeFa('کباب کوبیده'));
    expect(normalizeFa('می‌خوام ۱۲۳')).toBe('می خوام 123');
    expect(normalizeFa('Pizza   ')).toBe('pizza');
    expect(normalizeFa('')).toBe('');
  });
});

describe('searchFood on a small fixture', () => {
  const idx = fixture();
  it('finds items by name and keeps unknown prices unknown, never zero', () => {
    const r = searchFood(idx, { q: 'پیتزا' }, NOW);
    const pizza = r.vendors.find(v => v.id === 's:aaa')!;
    expect(pizza.matched.map(i => i.name)).toContain('پیتزا قارچ');
    const mushroom = pizza.matched.concat().find(i => i.name === 'پیتزا قارچ')!;
    expect(mushroom.priceToman).toBeNull();
    expect(mushroom.priceState).toBe('unknown');
    expect(pizza.minOrderState).toBe('known');
    expect(r.vendors.find(v => v.id === 't:bbb')!.minOrderToman).toBeNull();
    expect(r.vendors.find(v => v.id === 't:bbb')!.minOrderState).toBe('unknown');
  });
  it('a budget keeps only items with a known price under it and says how many unknown ones it set aside', () => {
    const r = searchFood(idx, { q: 'پیتزا', maxPrice: 200000 }, NOW);
    expect(r.vendors.map(v => v.id)).toEqual(['s:aaa']);
    expect(r.vendors[0].matched.map(i => i.name)).toEqual(['پیتزا مخصوص']);
    expect(r.vendors[0].matched[0]).toMatchObject({ priceToman: 180000, finalPriceToman: 150000, discounted: true });
    expect(r.unknownPriceExcluded).toBe(1);
    expect(r.notes.join(' ')).toMatch(/صفر تومان/);
  });
  it('distance sorting and radius use the point given, and report meters', () => {
    const near = { lat: 36.30, lon: 59.58 };
    const r = searchFood(idx, { near, sort: 'distance' }, NOW);
    expect(r.vendors[0].id).toBe('s:aaa');
    expect(r.vendors[0].distanceM).toBeLessThan(50);
    expect(searchFood(idx, { near, radiusM: 3000 }, NOW).vendors.map(v => v.id)).not.toContain('t:bbb');
  });
  it('cutlery, sauces and drinks are not "the dish": a dish search skips them, an explicit search finds them', () => {
    const side = parseFoodIndex(gzipSync(Buffer.from(JSON.stringify({ v: 1, capturedFrom: CAP, capturedTo: CAP, vendors: [
      vendor('t:ddd', 'چلو کبابی', { i: [['چلو کباب', '', 300000, null, 'چلو کباب'], ['قاشق یک بار مصرف', '', 3000, null, 'چلو کباب'], ['نوشابه', '', 20000, null, 'نوشیدنی'], ['سس مخصوص', '', 10000, null, 'سس']] }),
    ] }))));
    const dish = searchFood(side, { q: 'کباب', sort: 'price' }, NOW);
    expect(dish.vendors[0].matched.map(i => i.name)).toEqual(['چلو کباب']);
    expect(searchFood(side, { q: 'نوشابه' }, NOW).vendors[0].matched.map(i => i.name)).toEqual(['نوشابه']);
    expect(searchFood(side, { q: 'قاشق' }, NOW).total).toBe(1);
  });
  it('an item filed under the dish category but not named for it is a fallback, never listed beside real dishes', () => {
    const f = parseFoodIndex(gzipSync(Buffer.from(JSON.stringify({ v: 1, capturedFrom: CAP, capturedTo: CAP, vendors: [
      vendor('t:fff', 'کبابی الف', { i: [['چلو کباب کوبیده', '', 300000, null, 'چلو کباب'], ['گوجه کبابی (یک سیخ)', '', 85000, null, 'چلو کباب'], ['چلو کباب برگ', '', 450000, null, 'چلو کباب']] }),
      vendor('t:ggg', 'کبابی ب', { i: [['کوبیده', '', 280000, null, 'چلو کباب'], ['گوجه کبابی', '', 70000, null, 'چلو کباب']] }),
    ] }))));
    const r = searchFood(f, { q: 'چلو کباب', sort: 'price' }, NOW);
    const a = r.vendors.find(v => v.id === 't:fff')!, b = r.vendors.find(v => v.id === 't:ggg')!;
    expect(a.matched.map(i => i.name)).toEqual(['چلو کباب کوبیده', 'چلو کباب برگ']);
    expect(a.cheapestMatchedToman).toBe(300000);
    // a vendor with no item named for the dish keeps its category items (nothing real is discarded)
    expect(b.matched.map(i => i.name).sort()).toEqual(['کوبیده', 'گوجه کبابی'].sort());
    expect(r.vendors[0].id).toBe('t:ggg');
  });
  it('an item that names every word itself outranks items that only sit in a vendor whose name matches', () => {
    const r = searchFood(idx, { q: 'پیتزا کبابی' }, NOW);
    expect(r.vendors[0].id).toBe('t:bbb');
    expect(r.vendors[0].matched.map(i => i.name)).toEqual(['پیتزا کبابی']);
    const priced = searchFood(idx, { q: 'پیتزا', sort: 'price' }, NOW);
    expect(priced.vendors[0].matched.every(i => /پیتزا/.test(i.name))).toBe(true);
  });
  it('a vendor name match is enough when the item names do not repeat it', () => {
    const r = searchFood(idx, { q: 'کبابی' }, NOW);
    expect(r.vendors.map(v => v.id)).toEqual(['t:bbb']);
  });
  it('source filter, paging and empty query behave', () => {
    expect(searchFood(idx, { source: 't' }, NOW).vendors.every(v => v.provider === 'tapsifood')).toBe(true);
    expect(searchFood(idx, { limit: 1, offset: 1 }, NOW).vendors).toHaveLength(1);
    expect(searchFood(idx, { q: 'چیزی که وجود ندارد' }, NOW).total).toBe(0);
  });
  it('the open flag is only a snapshot with its capture time and a caution, and an old snapshot is called stale', () => {
    const r = searchFood(idx, { q: 'کباب' }, NOW);
    const v = r.vendors[0];
    expect(v.openSnapshot.value).toBe('closed');
    expect(v.openSnapshot.capturedAt).toBe('2026-10-31T10:00:00.000Z');
    expect(v.openSnapshot.note).toMatch(/فقط در زمان ثبت/);
    expect(r.snapshot.stale).toBe(true);
    expect(r.notes[0]).toMatch(/قدیمی/);
    expect(searchFood(idx, { q: 'کباب' }, Date.parse('2026-10-31T12:00:00Z')).snapshot.stale).toBe(false);
  });
  it('says the snapshot age in days with Persian digits, and an unknown capture time as unknown, never "?"', () => {
    expect(searchFood(idx, { q: 'کباب' }, NOW).notes[0]).toBe('این داده حدود ۴ روز پیش ثبت شده و قدیمی است.');
    expect(searchFood(idx, { q: 'کباب' }, Date.parse('2026-11-02T13:00:00Z')).notes[0]).toBe('این داده حدود ۵۱ ساعت پیش ثبت شده و قدیمی است.');
    const unknown = parseFoodIndex(gzipSync(Buffer.from(JSON.stringify({ v: 1, capturedFrom: null, capturedTo: null, vendors: [] }))));
    const r = searchFood(unknown, {}, NOW);
    expect(r.snapshot).toMatchObject({ ageHours: null, stale: true });
    expect(r.notes[0]).toBe('زمان ثبت این داده معلوم نیست؛ آن را قدیمی در نظر بگیرید.');
    expect(r.notes.join(' ')).not.toContain('?');
  });
  it('vendor detail groups the menu by category and does not invent fields', () => {
    const d = foodVendorDetail(idx, 's:aaa')!;
    expect(d.menu.map(g => g.category)).toEqual(['پیتزا', 'نوشیدنی']);
    expect(d.itemCount).toBe(4);
    expect('matched' in d).toBe(false);
    expect(foodVendorDetail(idx, 's:nope')).toBeNull();
  });
});

// The bulk snapshot is not part of the public repository; these tests run where data/food/food-index-v1.json.gz exists.
describe.skipIf(!existsSync(FOOD_INDEX_URL))('the committed Mashhad snapshot', () => {
  const idx = existsSync(FOOD_INDEX_URL) ? loadFoodIndex() : (null as never);
  it('has real vendors and menus with an honest capture window', () => {
    expect(idx.vendors.length).toBeGreaterThan(800);
    expect(idx.itemCount).toBeGreaterThan(40000);
    expect(idx.capturedFrom).toBeLessThanOrEqual(idx.capturedTo!);
  });
  it('contains no item whose unknown price was turned into zero', () => {
    for (const v of idx.vendors) for (const it of v.raw.i) expect(it[2] === null || it[2] > 0).toBe(true);
  });
  it('finds a real dish, its vendor and an order link', () => {
    const r = searchFood(idx, { q: 'چلو کباب' }, NOW);
    expect(r.total).toBeGreaterThan(5);
    expect(r.vendors[0].orderUrl).toMatch(/^https:\/\/(snappfood\.ir|tapsi\.food)\//);
    expect(r.vendors[0].matched.length).toBeGreaterThan(0);
  });
  it('a budget search on real data never returns an item over the budget', () => {
    const r = searchFood(idx, { q: 'پیتزا', maxPrice: 150000, limit: 20 }, NOW);
    expect(r.total).toBeGreaterThan(0);
    for (const v of r.vendors) for (const it of v.matched) expect(it.finalPriceToman!).toBeLessThanOrEqual(150000);
  });
  it('vendor types remain explicit; retail vendors are not mislabeled as restaurants', () => {
    for (const v of idx.vendors) {
      expect(v.assessment.vertical).toMatch(/^(restaurant|fast_food|cafe|sweets|bakery|flowers|grocery|produce|protein|nuts|other)$/);
      if (/هایپر|عطاری|قصابی|سوپرمارکت|گلفروشی/.test(v.raw.t))
        expect(v.assessment.vertical).not.toBe('restaurant');
    }
  });
});

describe('routes', () => {
  const app = buildServer({ food: { index: fixture(), now: () => NOW }, timetable: undefined });
  const get = (url: string) => app.inject({ method: 'GET', url });
  it('answers a search with provenance and no-store-free private caching', async () => {
    const r = await get('/app/api/food/search?q=' + encodeURIComponent('پیتزا') + '&maxPrice=200000');
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toMatch(/private/);
    expect(r.json().vendors[0].id).toBe('s:aaa');
    expect(r.json().snapshot.capturedTo).toBe('2026-10-31T10:00:00.000Z');
  });
  it('rejects unknown parameters, bad numbers and bad ids with 400', async () => {
    for (const url of ['/app/api/food/search?x=1', '/app/api/food/search?maxPrice=abc', '/app/api/food/search?limit=99', '/app/api/food/search?source=other',
      '/app/api/food/search?sort=distance', '/app/api/food/search?lat=36.3', '/app/api/food/vendor?id=bad', '/app/api/food/vendor']) {
      expect((await get(url)).statusCode, url).toBe(400);
    }
  });
  it('a point outside Mashhad is ignored with a note, not trusted', async () => {
    const r = await get('/app/api/food/search?lat=10&lon=10');
    expect(r.statusCode).toBe(200);
    expect(r.json().vendors[0].distanceM).toBeNull();
    expect(r.json().notes.join(' ')).toMatch(/خارج از محدودهٔ پوشش/);
  });
  it('vendor detail and unknown vendor', async () => {
    expect((await get('/app/api/food/vendor?id=s:aaa')).json().menu.length).toBe(2);
    expect((await get('/app/api/food/vendor?id=s:zzz')).statusCode).toBe(404);
  });
  it('a missing index answers 503 for food only; the rest of the server keeps working', async () => {
    const broken = buildServer({ food: { loader: () => { throw new Error('missing'); } } });
    expect((await broken.inject({ method: 'GET', url: '/app/api/food/search?q=x' })).statusCode).toBe(503);
    expect((await broken.inject({ method: 'GET', url: '/health' })).json()).toEqual({ ok: true });
    expect((await broken.inject({ method: 'GET', url: '/app/api/next?station=' + encodeURIComponent('هفت‌تیر') + '&line=1' })).statusCode).toBe(200);
  });
});
