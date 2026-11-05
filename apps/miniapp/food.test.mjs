// Besfood search view: real view, real API client, test DOM. Location stays explicit; unknown stays unknown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFoodView } from './views/food.js';
import { createApi } from './api.js';
import { installFoodDom, flushView, byClass, button, findAll } from './test-support/food-dom.mjs';

const gps = { latitude: 36.30551234, longitude: 59.58181234 };
const CAPTURED = '2026-10-31T10:00:00.000Z';
const vendor = (id, name, over = {}) => ({
  id, provider: id[0] === 's' ? 'snappfood' : 'tapsifood', name, branch: null, category: 'رستوران', address: null, lat: 36.3, lon: 59.58, distanceM: null, rating: 8.4, commentCount: 20,
  minOrderToman: 150000, minOrderState: 'known', openSnapshot: { value: 'open', capturedAt: CAPTURED, note: 'x' }, capturedAt: CAPTURED, orderUrl: `https://tapsi.food/vendor/${id.slice(2)}`, orderCode: id.slice(2),
  matchedCount: 1, cheapestMatchedToman: 180000, matched: [{ name: 'پیتزا مخصوص', variation: null, category: 'پیتزا', priceToman: 250000, finalPriceToman: 180000, discounted: true, priceState: 'known' }], ...over });
const reply = (vendors, over = {}) => ({ total: vendors.length, offset: 0, limit: 10, vendors, unknownPriceExcluded: 0, notes: ['قیمت ها آخرین مشاهدهٔ ثبت شده اند'],
  snapshot: { capturedFrom: CAPTURED, capturedTo: CAPTURED, ageHours: 96, stale: true }, ...over });

function setup(t, options, handler) {
  installFoodDom(t, options);
  const requests = [];
  const api = createApi({ fetch: async (url, init) => {
    requests.push({ url, init });
    const out = handler ? await handler(url) : null;
    if (out) return out;
    if (url.startsWith('api/food/search')) return new Response(JSON.stringify(reply([vendor('t:aaa', 'پیتزا شمال')])));
    if (url.startsWith('api/food/vendor')) return new Response(JSON.stringify({ ...vendor('t:aaa', 'پیتزا شمال'), menu: [{ category: 'پیتزا', items: [{ name: 'پیتزا مخصوص', variation: null, category: 'پیتزا', priceToman: 250000, finalPriceToman: 250000, discounted: false, priceState: 'known' }, { name: 'پیتزا قارچ', variation: null, category: 'پیتزا', priceToman: null, finalPriceToman: null, discounted: false, priceState: 'unknown' }] }], itemCount: 2, truncated: false }));
    if (url.startsWith('api/food-status')) return new Response(JSON.stringify({ status: 'unknown', observedAt: null }));
    throw new Error('unexpected request: ' + url);
  } });
  const view = createFoodView({ api, state: {}, store: options?.prefs ? { prefs: () => options.prefs } : undefined, actions: { go() {} } });
  return { view, requests };
}
const text = view => view.el.textContent;
const search = requests => requests.filter(r => r.url.startsWith('api/food/search'));

test('construction and showing the view never ask for location; the first show runs one search without coordinates', async t => {
  let calls = 0;
  const { view, requests } = setup(t, { browser: ok => { calls++; ok({ coords: gps }); } });
  await flushView();
  assert.equal(requests.length, 0, 'nothing is fetched until the view is shown');
  view.onShow(); view.onShow(); await flushView();
  assert.equal(calls, 0);
  assert.equal(search(requests).length, 1);
  assert.doesNotMatch(search(requests)[0].url, /lat=|lon=/);
  assert.equal(search(requests)[0].init.credentials, 'omit');
  assert.match(text(view), /پیتزا شمال/);
  assert.match(text(view), /سفارش در تپسی فود/);
});

test('an explicit location tap sends the point rounded to about 100 m, only in the search query, and never stores it', async t => {
  let calls = 0;
  const { view, requests } = setup(t, { browser: ok => { calls++; ok({ coords: gps }); } });
  view.onShow(); await flushView();
  await button(view.el, 'نزدیک من').dispatch('click'); await flushView();
  assert.equal(calls, 1);
  const last = search(requests).at(-1).url;
  assert.match(last, /lat=36\.306/); assert.match(last, /lon=59\.582/);
  assert.doesNotMatch(last, /36\.30551234|59\.58181234/);
  assert.match(text(view), /ذخیره نمی شود/);
  for (const r of requests) assert.doesNotMatch(r.url + JSON.stringify(r.init), /36\.30551234|59\.58181234/);
  view.onShow(); await flushView();
  assert.equal(calls, 1, 'showing again does not ask again');
});

test('Telegram native location is explicit as well and works without browser geolocation', async t => {
  let nativeCalls = 0;
  const { view, requests } = setup(t, { native: { initData: 'fixture', isVersionAtLeast: () => true, LocationManager: { isInited: true, isLocationAvailable: true, getLocation(ok) { nativeCalls++; ok(gps); } } } });
  view.onShow(); await flushView();
  assert.equal(nativeCalls, 0);
  await button(view.el, 'نزدیک من').dispatch('click'); await flushView();
  assert.equal(nativeCalls, 1);
  assert.match(search(requests).at(-1).url, /lat=36\.306/);
});

test('denied or unsupported location is optional: the search keeps working and says so', async t => {
  let calls = 0;
  const { view, requests } = setup(t, { browser: (_ok, fail) => { calls++; fail({ code: 1 }); } });
  view.onShow(); await flushView();
  await button(view.el, 'نزدیک من').dispatch('click'); await flushView();
  assert.equal(calls, 1);
  assert.match(text(view), /دسترسی به موقعیت داده نشد/);
  assert.match(text(view), /پیتزا شمال/);
  assert.doesNotMatch(search(requests).at(-1).url, /lat=/);
});

test('without any geolocation support the explicit action fails locally and the search still works', async t => {
  const { view } = setup(t);
  view.onShow(); await flushView();
  await button(view.el, 'نزدیک من').dispatch('click'); await flushView();
  assert.match(text(view), /دسترسی به موقعیت داده نشد/);
  assert.match(text(view), /پیتزا شمال/);
});

test('a budget chip is sent as maxPrice, results show known, discounted and unknown prices distinctly, and unknown never reads as zero', async t => {
  const unknown = vendor('s:bbb', 'کبابی', { orderUrl: 'https://snappfood.ir/restaurant/menu/bbb', minOrderToman: null, minOrderState: 'unknown', openSnapshot: { value: 'unknown', capturedAt: null, note: '' },
    matched: [{ name: 'کباب بدون قیمت', variation: null, category: 'کباب', priceToman: null, finalPriceToman: null, discounted: false, priceState: 'unknown' }] });
  const { view, requests } = setup(t, {}, url => url.startsWith('api/food/search') ? new Response(JSON.stringify(reply([vendor('t:aaa', 'پیتزا شمال'), unknown]))) : null);
  view.onShow(); await flushView();
  await button(view.el, 'تا ۱۵۰ هزار').dispatch('click'); await flushView();
  assert.match(search(requests).at(-1).url, /maxPrice=150000/);
  const out = text(view);
  assert.match(out, /۱۸۰٬۰۰۰ تومان/);
  assert.match(out, /۲۵۰٬۰۰۰ تومان/, 'the struck-through list price is kept');
  assert.match(out, /قیمت نامشخص/);
  assert.match(out, /حداقل سفارش نامشخص/);
  assert.match(out, /وضعیت باز بودن نامشخص/);
  assert.match(out, /باز در زمان ثبت/);
  assert.doesNotMatch(out, /(^|\s)۰ تومان/);
  assert.match(out, /قدیمی/);
  assert.match(out, /لحظه ای نیستند/);
});

test('errors, an unavailable index and empty results each show their own state with a retry', async t => {
  let mode = 'error';
  const { view, requests } = setup(t, {}, url => {
    if (!url.startsWith('api/food/search')) return null;
    if (mode === 'error') return new Response('{}', { status: 500 });
    if (mode === 'down') return new Response(JSON.stringify({ error: 'food_index_unavailable' }), { status: 503 });
    if (mode === 'empty') return new Response(JSON.stringify(reply([], { total: 0, notes: [] })));
    return null;
  });
  view.onShow(); await flushView();
  assert.match(text(view), /جست وجو انجام نشد/);
  mode = 'down'; await button(view.el, 'تلاش دوباره').dispatch('click'); await flushView();
  assert.match(text(view), /فهرست غذا اکنون در دسترس نیست/);
  mode = 'empty'; await button(view.el, 'تلاش دوباره').dispatch('click'); await flushView();
  assert.match(text(view), /فعلاً مورد قابل نمایشی/);
  mode = 'ok'; await button(view.el, 'پیتزا').dispatch('click'); await flushView();
  assert.match(text(view), /پیتزا شمال/);
  assert.match(search(requests).at(-1).url, /q=%D9%BE%DB%8C%D8%AA%D8%B2%D8%A7/);
});

test('the vendor page lists the menu with unknown prices marked, a platform order button, and the on-demand status check stays unknown on failure', async t => {
  const { view, requests } = setup(t, {}, url => url.startsWith('api/food-status') ? new Response(JSON.stringify({ error: 'food_status_unavailable', status: 'unknown', observedAt: null }), { status: 503 }) : null);
  view.onShow(); await flushView();
  await button(view.el, 'منو و جزئیات').dispatch('click'); await flushView();
  assert.match(requests.find(r => r.url.startsWith('api/food/vendor')).url, /id=t%3Aaaa/);
  assert.match(text(view), /پیتزا قارچ/);
  assert.match(text(view), /قیمت نامشخص/);
  assert.match(text(view), /سفارش در تپسی فود/);
  await button(view.el, 'بررسی وضعیت').dispatch('click'); await flushView();
  assert.match(byClass(view.el, 'food-card__status').textContent, /وضعیت ثبت‌شدهٔ این فروشگاه: نامشخص/);
  assert.doesNotMatch(byClass(view.el, 'food-card__status').textContent, /زمان بررسی/);
  assert.deepEqual(requests.filter(r => r.url.startsWith('api/food-status')).map(r => r.url), ['api/food-status?vendor=aaa']);
  await findAll(view.el, n => n.tagName === 'button' && n.getAttribute('aria-label') === 'بازگشت به نتایج')[0].dispatch('click'); await flushView();
  assert.match(text(view), /منو و جزئیات/, 'back returns to the results');
});

test('SnappFood vendors say live status is unavailable instead of offering a check', async t => {
  const snapp = vendor('s:ccc', 'اسنپی', { orderUrl: 'https://snappfood.ir/restaurant/menu/ccc' });
  const { view } = setup(t, {}, url => url.startsWith('api/food/vendor') ? new Response(JSON.stringify({ ...snapp, menu: [], itemCount: 0, truncated: false })) : url.startsWith('api/food/search') ? new Response(JSON.stringify(reply([snapp]))) : null);
  view.onShow(); await flushView();
  await button(view.el, 'منو و جزئیات').dispatch('click'); await flushView();
  assert.match(text(view), /بررسی زندهٔ وضعیت برای اسنپ فود در دسترس نیست/);
  assert.match(text(view), /منو در دادهٔ ثبت شده خالی است/);
  assert.match(text(view), /سفارش در اسنپ فود/);
});

test('a food budget stated in Profile starts the first search and is announced; changing the chip drops the announcement', async t => {
  const { view, requests } = setup(t, { prefs: { foodBudgetToman: 150000 } });
  view.onShow(); await flushView();
  assert.match(search(requests)[0].url, /maxPrice=150000/);
  assert.match(text(view), /این سقف را خودتان در پروفایل گذاشته اید/);
  await button(view.el, 'بدون سقف').dispatch('click'); await flushView();
  assert.doesNotMatch(search(requests).at(-1).url, /maxPrice/); assert.doesNotMatch(text(view), /در پروفایل گذاشته اید/);
});

test('no stated budget means no budget: nothing is inferred', async t => {
  const { view, requests } = setup(t, { prefs: {} });
  view.onShow(); await flushView();
  assert.doesNotMatch(search(requests)[0].url, /maxPrice/);
});
