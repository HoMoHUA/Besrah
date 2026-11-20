// Snapp Pay in the Mini App (F6): the person's own Snapp Pay login (session on this device), account summary, search and
// in-store shops, asked from this device; only login and token refresh go through Besrah's server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, validSnappPaySession } from './store.js';
import { createApi } from './api.js';
import { createSnappPay, parseAccount, parseNearby, parseSearch } from './snapppay.js';
import { createSnappPayLinkCard, snappPayAccountBlock } from './ui/snapppay-link.js';
import { createShopView } from './views/shop.js';
import { installFoodDom, flushView, findAll, button } from './test-support/food-dom.mjs';

const SESSION = { access: 'A'.repeat(50), refresh: 'R'.repeat(40), expAt: null };
const memoryStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const text = n => n.textContent.replace(/\s+/g, ' ');
// Shapes trimmed from Snapp Pay's real answers (2026-11-20); amounts in rials.
const HOME = { successful: true, response: { score: 3540, totalCredit: 200000000, totalDebt: 120572450, currentBalance: 79427550, installmentBalance: 79427550, postpaidBalance: 79427550,
  postpaidLimitedBalance: 27769000, postpaidLimitedUsage: 22231000, settleDeadline: '2026-11-26', contractEndDate: '2026-11-21', settleDateHasPassed: false, contractDateHasPassed: false,
  badDebtUser: false, walletStatus: 'ACTIVE', inStoreFeatureEnabled: true, analyticsId: 'u-analytics-1', universalAnalyticsId: 'f'.repeat(64) } };
const SEARCH = { successful: true, response: { items: [
  { type: 'BANNER', properties: { IMAGE_LINK: 'https://image.searchwise.ir/ads/1.jpg', REFERRAL_LINK: 'https://re.searchwise.ir/?puc=b' } },
  { type: 'PRODUCT', properties: { IMAGE_LINK: 'https://image.searchwise.ir/c/1.jpg', REFERRAL_LINK: 'https://re.searchwise.ir/?puc=p1', DISCOUNT: '17%', MERCHANT_NAME: 'هاکان شاپ', MERCHANT_NAME_EN: 'hakan-shop',
    OLD_PRODUCT_PRICE: '60880000', PRODUCT_PRICE: '50730000', PRODUCT_NAME: 'ساعت مچی الگانس مردانه', CASH_BACK: '10' }, flags: ['INSTALLMENT_PAYMENT_METHOD_TYPE', 'POSTPAID_PAYMENT_METHOD_TYPE'], available: true, ad: false, has_free_shipping: true, merchant_count: 3 }],
  merchant_items: [{ type: 'STORE', name: 'saatica', venture_name: 'saatica', properties: { MERCHANT_NAME: 'ساعتیکا', CASH_BACK: '7', REFERRAL_LINK: 'https://re.searchwise.ir/?puc=s1' }, tags: ['آنلاین,حضوری'], flags: [], categories: [{ display_name: 'مد و پوشاک' }], item_group_type: 'ONLINE' }],
  has_next: true, session_id: 'sid-1', query_correction: { correction_type: 'NONE', searched_query: 'ساعت' } } };
const STORES = { successful: true, response: { has_next: false, stores: [
  { type: 'STORE', name: 'b-in store', properties: { MERCHANT_NAME: 'شعبه دور' }, tags: ['خرید حضوری'], flags: ['INSTALLMENT_PAYMENT_METHOD_TYPE'], categories: [{ display_name: 'مد و پوشاک', map_icon_color: '#F39277' }], item_group_type: 'IN_STORE',
    branches: [{ display_name: 'شعبه دو', city: 'مشهد', work_time: 'هر روز ۱۰ تا ۲۲', location: { latitude: 36.31, longitude: 59.61 }, address: 'نشانی دو', distance: 1500 }] },
  { type: 'STORE', name: 'a-in store', properties: { MERCHANT_NAME: 'ساعت رضا' }, tags: ['خرید حضوری'], flags: ['FINANCING_PAYMENT_METHOD_TYPE'], categories: [{ display_name: 'مد و پوشاک' }], item_group_type: 'IN_STORE',
    branches: [{ display_name: 'شعبه خیابان شیرازی - مشهد', city: 'مشهد', work_time: 'هر روز هفته 10 تا 22', location: { latitude: 36.2967834, longitude: 59.606694 }, address: 'مشهد، سراب، میدان شهدا', distance: 106 }] }] } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Snapp Pay as the device sees it, plus Besrah's own two helpers (refresh and H3 cells). */
function setup({ session = SESSION, expireFirst = false, refreshFails = false } = {}) {
  const store = createStore(memoryStorage());
  if (session) store.setSnappPaySession(session, '4567');
  const calls = [], besrah = [];
  let expired = expireFirst;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    if (expired && init.headers?.Authorization === `Bearer ${'A'.repeat(50)}`) return json({ successful: false }, 401);
    if (url.endsWith('/wallet/credit/homepage')) return json(HOME);
    if (url.endsWith('/content/search')) return json(SEARCH);
    if (url.includes('/map/store/list?')) return json(STORES);
    return json({ successful: false }, 404);
  };
  const api = {
    async snappPayRefresh(refresh) { besrah.push(['refresh', refresh]); if (refreshFails) throw Object.assign(new Error('x'), { status: 401 }); expired = false; return { access: 'B'.repeat(50), refresh: 'Q'.repeat(40), expAt: null }; },
    async geoCells(lat, lon, resolution, ring) { besrah.push(['cells', lat, lon, resolution, ring]); return { resolution: 7, cells: ['8743608e9ffffff', '8743608e8ffffff'] }; },
  };
  return { store, calls, besrah, sp: createSnappPay({ api, store, fetchImpl }) };
}

test('the Snapp Pay session is kept on this device only after validation, and «قطع اتصال» removes it', () => {
  const storage = memoryStorage(), store = createStore(storage);
  store.setSnappPaySession({ access: 'x', refresh: 'y' }, '4567');
  assert.equal(store.snappPaySession(), null, 'a malformed session is ignored');
  store.setSnappPaySession(SESSION, '4567');
  assert.deepEqual(createStore(storage).snappPaySession(), SESSION, 'survives a restart on this device');
  assert.equal(createStore(storage).snappPayLink().phoneHint, '4567');
  store.setSnappPaySession(null);
  assert.equal(storage.getItem('besrah:snapppay-session:v1'), null);
  assert.equal(validSnappPaySession(SESSION), true);
});

test('api: login, code, resend and refresh go to Besrah’s relay in POST bodies; Snapp Pay’s own message is kept', async () => {
  const sent = [];
  const api = createApi({ fetch: async (url, init) => {
    sent.push([url, init.method, JSON.parse(init.body)]);
    if (url === 'api/snapppay/login') return json({ status: 'sent', loginId: '11111111-2222-4333-8444-555555555555', expiresInS: 120, resendAfterS: 60, masked: '0912***4567' });
    if (url === 'api/snapppay/verify') return json({ error: 'wrong_code', message: 'کد وارد شده اشتباه است. ۲ تلاش باقی مانده.', remaining: 2 }, 422);
    return json({ error: 'rate_limited', retryAfterS: 55 }, 429);
  } });
  assert.equal((await api.snappPayLogin('09121234567')).masked, '0912***4567');
  await assert.rejects(api.snappPayVerify('11111111-2222-4333-8444-555555555555', '000000'), e => e.reason === 'wrong_code' && e.remaining === 2 && /۲ تلاش/.test(e.providerMessage));
  await assert.rejects(api.snappPayResend('11111111-2222-4333-8444-555555555555'), e => e.reason === 'rate_limited' && e.retryAfterS === 55);
  assert.ok(sent.every(([url, method]) => method === 'POST' && !url.includes('?')));
  assert.deepEqual(sent[0][2], { phone: '09121234567' });
});

test('account, search and in-store map are asked from this device with the person’s token; amounts become tomans', async () => {
  const { sp, calls, besrah } = setup();
  const a = await sp.account();
  assert.deepEqual({ score: a.score, balance: a.balanceToman, installment: a.installmentToman, postpaid: a.postpaidToman, snappOnly: a.snappOnlyToman, total: a.totalCreditToman, settle: a.settleDeadline },
    { score: 3540, balance: 7942755, installment: 7942755, postpaid: 7942755, snappOnly: 2776900, total: 20000000, settle: '2026-11-26' });
  assert.equal(calls[0].url, 'https://app.snapppay.ir/api/credit/api/v1/web/wallet/credit/homepage');
  assert.equal(calls[0].headers.Authorization, `Bearer ${'A'.repeat(50)}`);
  assert.equal(calls[0].headers['X-Parent-App'], 'snappPayPWA');
  assert.equal(calls[0].headers.locale, 'fa', 'the account summary refuses requests without it');
  const r = await sp.search('ساعت', { maxToman: 6000000 });
  const body = calls.find(c => c.url.endsWith('/content/search')).body;
  assert.deepEqual({ user: body.user_id, universal: body.universal_id, source: body.source, max: body.filters.price.max }, { user: 'u-analytics-1', universal: 'f'.repeat(64), source: 'SNAPP_PAY', max: 60000000 });
  assert.equal(r.products.length, 1, 'banners are not results');
  assert.deepEqual({ name: r.products[0].name, price: r.products[0].priceToman, old: r.products[0].oldPriceToman, cashback: r.products[0].cashback, ways: r.products[0].payWays }, { name: 'ساعت مچی الگانس مردانه', price: 5073000, old: 6088000, cashback: 10, ways: ['چهار قسط', 'پرداخت آخر ماه'] });
  assert.equal(r.stores[0].name, 'ساعتیکا');
  const near = await sp.nearby({ lat: 36.2975, lon: 59.6059 });
  assert.deepEqual(besrah.at(-1), ['cells', 36.2975, 59.6059, 7, 1]);
  assert.match(calls.at(-1).url, /hexagon_ids=8743608e9ffffff,8743608e8ffffff&latitude=36.2975&longitude=59.6059/);
  assert.deepEqual(near.branches.map(b => [b.name, b.distanceM]), [['ساعت رضا', 106], ['شعبه دور', 1500]], 'nearest first');
  assert.ok(calls.every(c => c.url.startsWith('https://app.snapppay.ir/')), 'nothing but Snapp Pay itself');
});

test('an expired token is refreshed once through Besrah and the new one replaces the stored one; a dead refresh unlinks', async () => {
  const ok = setup({ expireFirst: true });
  assert.equal((await ok.sp.account()).score, 3540);
  assert.deepEqual(ok.besrah[0], ['refresh', 'R'.repeat(40)]);
  assert.equal(ok.store.snappPaySession().access, 'B'.repeat(50));
  const dead = setup({ expireFirst: true, refreshFails: true });
  await assert.rejects(dead.sp.account(), e => e.kind === 'unauthenticated');
  assert.equal(dead.store.snappPaySession(), null);
});

test('parsers: unknown or broken fields stay unknown, never zero', () => {
  assert.equal(parseAccount({ score: 'x' }).score, null);
  assert.equal(parseAccount({}).balanceToman, null);
  assert.deepEqual(parseSearch({}).products, []);
  assert.deepEqual(parseNearby({ stores: [{ type: 'STORE', properties: { MERCHANT_NAME: 'x' }, branches: [{ location: {} }] }] }), []);
});

test('Profile card: number -> 6-digit code -> linked; Snapp Pay’s wording on a wrong code; «قطع اتصال»', async t => {
  installFoodDom(t);
  const calls = [];
  const api = {
    async snappPayLogin(phone) { calls.push(['login', phone]); return { status: 'sent', loginId: 'id-1', resendAfterS: 60, masked: '0912***4567' }; },
    async snappPayVerify(id, code) { calls.push(['verify', id, code]); if (code !== '123456') throw Object.assign(new Error('x'), { reason: 'wrong_code', providerMessage: 'کد وارد شده اشتباه است. ۲ تلاش باقی مانده.' }); return { status: 'linked', session: SESSION, phoneHint: '4567' }; },
  };
  const store = createStore(memoryStorage());
  const card = createSnappPayLinkCard({ api, store });
  const inputs = () => findAll(card.el, n => n.tagName === 'input');
  assert.match(text(card.el), /نشست اسنپ‌پی فقط روی همین دستگاه می‌ماند/);
  inputs()[0].value = '09121234567';
  await button(card.el, 'دریافت کد اسنپ‌پی').dispatch('click'); await flushView();
  assert.match(text(card.el), /کد اسنپ‌پی به ۰۹۱۲\*\*\*۴۵۶۷ فرستاده شد/);
  inputs()[0].value = '000000';
  await button(card.el, 'ورود به اسنپ‌پی').dispatch('click'); await flushView();
  assert.match(text(card.el), /۲ تلاش باقی مانده/);
  inputs()[0].value = '123456';
  await button(card.el, 'ورود به اسنپ‌پی').dispatch('click'); await flushView();
  assert.deepEqual(calls, [['login', '09121234567'], ['verify', 'id-1', '000000'], ['verify', 'id-1', '123456']]);
  assert.deepEqual(store.snappPaySession(), SESSION);
  assert.match(text(card.el), /وصل است \(شمارهٔ …۴۵۶۷\)/);
  await button(card.el, 'قطع اتصال').dispatch('click');
  assert.equal(store.snappPaySession(), null);
});

test('account block: the three balances, score and the dates; a passed settlement date is said so', t => {
  installFoodDom(t);
  const a = parseAccount({ ...HOME.response, settleDateHasPassed: true });
  const out = text(snappPayAccountBlock(a));
  assert.match(out, /امتیاز ۳٬?۵۴۰/);
  assert.match(out, /۷٬۹۴۲٬۷۵۵ تومان/);
  assert.match(out, /چهار قسط/); assert.match(out, /پرداخت آخر ماه/); assert.match(out, /فقط در خدمات اسنپ/); assert.match(out, /۲٬۷۷۶٬۹۰۰ تومان/);
  assert.match(out, /مهلت تسویه: .+\(گذشته است\)/);
});

test('بسپی: not linked shows the Snapp Pay login and the curated catalog; linked shows credit, online results and in-store branches with «مسیر»', async t => {
  installFoodDom(t);
  const catalog = createApi({ fetch: async () => json({ total: 0, offset: 0, limit: 10, products: [], snapshot: null, notes: [] }) });
  const { sp, store } = setup({ session: null });
  const goes = [];
  const view = createShopView({ api: { ...catalog, snappPayLogin: async () => ({}) }, store, state: {}, snappPay: sp, actions: { go: (v, o) => goes.push([v, o]), back() {} } });
  view.onShow(); await flushView();
  assert.match(text(view.el), /دریافت کد اسنپ‌پی/);
  assert.equal(findAll(view.el, n => n.getAttribute?.('aria-pressed') === 'true').map(n => n.textContent).includes('کالاهای منتخب'), true);

  store.setSnappPaySession(SESSION, '4567'); await flushView(); await flushView();
  assert.match(text(view.el), /اعتبار اسنپ‌پی/);
  assert.match(text(view.el), /۷٬۹۴۲٬۷۵۵ تومان/);
  const input = findAll(view.el, n => n.tagName === 'input' && n.getAttribute?.('aria-label') === 'جست وجوی کالا')[0];
  input.value = 'ساعت'; input.dispatch('input');
  await new Promise(r => setTimeout(r, 650)); await flushView(); await flushView();
  assert.match(text(view.el), /ساعت مچی الگانس مردانه/);
  assert.match(text(view.el), /۵٬۰۷۳٬۰۰۰ تومان/);
  assert.match(text(view.el), /قسط اول خرید آنلاین در درگاه همان فروشگاه/);

  globalThis.navigator.geolocation = { getCurrentPosition: ok => ok({ coords: { latitude: 36.2975, longitude: 59.6059 } }) };
  input.value = ''; input.dispatch('input');
  await button(view.el, 'حضوری نزدیک من').dispatch('click'); await flushView();
  await button(view.el, 'فروشگاه‌های حضوری نزدیک من').dispatch('click'); await flushView(); await flushView(); await flushView();
  assert.match(text(view.el), /ساعت رضا/);
  assert.match(text(view.el), /۱۱۰ متر/);
  assert.match(text(view.el), /هر روز هفته ۱۰ تا ۲۲/);
  await button(view.el, 'مسیر').dispatch('click');
  assert.deepEqual(goes.at(-1), ['trip', { to: { lat: 36.2967834, lon: 59.606694, name: 'ساعت رضا، شعبه خیابان شیرازی - مشهد' } }]);
});
