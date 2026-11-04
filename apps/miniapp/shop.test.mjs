// Besshop view: unresolved prices stay unresolved, nothing is claimed live, merchant links are explicit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShopView } from './views/shop.js';
import { createApi } from './api.js';
import { installFoodDom, flushView, button, findAll } from './test-support/food-dom.mjs';

const OBS = '2026-11-04T10:00:00.000Z';
const product = (id, title, over = {}) => ({ id, title, brand: 'برند', category: 'هدفون', observedAt: OBS, source: { kind: 'x', url: 'https://www.technolife.com/product-1/' }, minToman: 1000000, maxToman: 1400000, resolvedOffers: 3, offerCount: 3, priceState: 'compared', ...over });
const list = (products, over = {}) => ({ total: products.length, offset: 0, limit: 10, products, snapshot: { observedFrom: OBS, observedTo: OBS, ageHours: 60, stale: true }, notes: ['قیمت ها لحظه ای نیستند.'], ...over });
const offer = (seller, state, price, over = {}) => ({ seller, merchant: 'تکنولایف', state, priceToman: price, priceCandidatesToman: [], reason: null, spreadWarning: false, matchState: 'listing_declared', variantUnresolved: ['رنگ'], stock: 'unknown', availabilityDeclared: 'InStock', shipping: 'unknown', url: 'https://www.technolife.com/product-1/', ...over });

function setup(t, handler) {
  installFoodDom(t);
  const requests = [];
  const api = createApi({ fetch: async url => {
    requests.push(url);
    const out = handler ? await handler(url) : null;
    if (out) return out;
    if (url.startsWith('api/shop/search')) return new Response(JSON.stringify(list([product('tl:1', 'هدفون سونی'), product('tl:3', 'اسپیکر', { priceState: 'unresolved', minToman: null, maxToman: null, resolvedOffers: 0 })])));
    if (url.startsWith('api/shop/product')) return new Response(JSON.stringify({ ...product('tl:1', 'هدفون سونی'), offers: [offer('الف', 'resolved', 1000000), offer('ب', 'unresolved', null, { priceCandidatesToman: [1100000, 1200000], reason: 'same_seller_multiple_prices' }), offer('ج', 'quarantined', null, { reason: 'outlier_vs_median' })],
      spread: { minToman: 1000000, maxToman: 1400000, ratio: 1.4 }, snapshot: { observedAt: OBS, ageHours: 60, stale: true }, variantBasis: 'x', notes: ['ارزان ترین بودن در بازار ادعا نمی شود.'] }));
    throw new Error('unexpected ' + url);
  } });
  const view = createShopView({ api, state: {}, actions: { go() {} } });
  return { view, requests };
}
const text = v => v.el.textContent;

test('first show runs one search; results show ranges, unresolved products without any price, and a stale non-live note', async t => {
  const { view, requests } = setup(t);
  view.onShow(); view.onShow(); await flushView();
  assert.equal(requests.length, 1);
  const out = text(view);
  assert.match(out, /هدفون سونی/); assert.match(out, /۱٬۰۰۰٬۰۰۰ تومان/); assert.match(out, /۱٬۴۰۰٬۰۰۰ تومان/);
  assert.match(out, /قیمت قابل اتکا ندارد/);
  assert.match(out, /قدیمی/); assert.match(out, /لحظه ای نیستند/);
  assert.doesNotMatch(out, /(^|\s)۰ تومان/);
});

test('a budget chip becomes maxPrice and a quick term becomes q', async t => {
  const { view, requests } = setup(t);
  view.onShow(); await flushView();
  await button(view.el, 'تا ۲ میلیون').dispatch('click'); await flushView();
  assert.match(requests.at(-1), /maxPrice=2000000/);
  await button(view.el, 'هدفون').dispatch('click'); await flushView();
  assert.match(requests.at(-1), /q=%D9%87%D8%AF%D9%81%D9%88%D9%86/);
});

test('the comparison page lists resolved, unresolved and quarantined offers differently and never mentions stock as known', async t => {
  const { view, requests } = setup(t);
  view.onShow(); await flushView();
  await button(view.el, 'مقایسهٔ فروشندگان').dispatch('click'); await flushView();
  assert.match(requests.at(-1), /id=tl%3A1/);
  const out = text(view);
  assert.match(out, /چند قیمت متفاوت \(۱٬۱۰۰٬۰۰۰ تومان، ۱٬۲۰۰٬۰۰۰ تومان\)؛ تنوع نامشخص/);
  assert.match(out, /قیمت غیرعادی؛ کنار گذاشته شد/);
  assert.match(out, /موجودی و ارسال نامعلوم/);
  assert.match(out, /۱٫۴ برابر/);
  assert.match(out, /ارزان ترین بودن در بازار ادعا نمی شود/);
  assert.equal(findAll(view.el, n => n.tagName === 'button' && n.textContent === 'مشاهده در تکنولایف').length, 3);
  assert.doesNotMatch(out, /موجود است|ارسال رایگان/);
});

test('errors and an unavailable catalog show retry; empty results explain the small catalog', async t => {
  let mode = 'error';
  const { view } = setup(t, url => {
    if (!url.startsWith('api/shop/search')) return null;
    if (mode === 'error') return new Response('{}', { status: 500 });
    if (mode === 'down') return new Response('{}', { status: 503 });
    if (mode === 'empty') return new Response(JSON.stringify(list([], { total: 0 })));
    return null;
  });
  view.onShow(); await flushView();
  assert.match(text(view), /جست وجو انجام نشد/);
  mode = 'down'; await button(view.el, 'تلاش دوباره').dispatch('click'); await flushView();
  assert.match(text(view), /فهرست کالا اکنون در دسترس نیست/);
  mode = 'empty'; await button(view.el, 'تلاش دوباره').dispatch('click'); await flushView();
  assert.match(text(view), /چند کالای منتخب/);
});
