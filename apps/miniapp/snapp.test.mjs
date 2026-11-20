// Snapp in the Mini App (F4): the person's own Snapp login (session kept on this device only) and live ride prices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, validSnappSession } from './store.js';
import { createApi } from './api.js';
import { createSnappLinkCard, snappPriceBlock } from './ui/snapp-link.js';
import { createTripView } from './views/trip.js';
import { installFoodDom, flushView, findAll, button } from './test-support/food-dom.mjs';

const SESSION = { access: 'a'.repeat(40), refresh: 'r'.repeat(30), deviceId: '11111111-2222-4333-8444-555555555555' };
const PRICE = { schemaVersion: 1, source: 'snapp_live', sessionKind: 'shared', retrievedAt: '2026-11-20T10:00:00Z', ttlS: 300, services: [
  { id: 1, name: 'اسنپ', description: 'به صرفه', priceToman: 193000, etaMin: 13, enabled: true },
  { id: 24, name: 'سفر اشتراکی', description: '', priceToman: null, etaMin: null, enabled: false },
  { id: 2, name: 'اسنپ اکوپلاس', description: 'راحت', priceToman: 257000, etaMin: 9, enabled: true }] };
const memoryStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const text = n => n.textContent.replace(/\s+/g, ' ');

test('the session is kept on this device only after validation, and «قطع اتصال» removes it', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  assert.equal(store.snappLink(), null);
  store.setSnappSession({ access: 'short' }, '4567');
  assert.equal(store.snappSession(), null, 'a malformed session is ignored');
  store.setSnappSession(SESSION, '4567');
  assert.deepEqual(createStore(storage).snappSession(), SESSION, 'survives a reload');
  assert.equal(createStore(storage).snappLink().phoneHint, '4567');
  store.setSnappSession(null);
  assert.equal(createStore(storage).snappLink(), null);
  assert.equal(validSnappSession(SESSION), true);
});

test('api: number, code and session go in POST bodies, never in URLs; answers are checked', async () => {
  const seen = [];
  const reply = { 'api/snapp/otp': { status: 'sent', ttlS: 120 }, 'api/snapp/verify': { status: 'linked', session: SESSION, phoneHint: '4567' }, 'api/snapp/price': PRICE };
  const api = createApi({ fetch: async (url, init) => { seen.push([url, init.method, JSON.parse(init.body)]); return { ok: true, status: 200, json: async () => reply[url] }; } });
  await api.snappOtp('09121234567');
  await api.snappVerify('09121234567', '12345');
  await api.snappPrice({ lat: 36.3, lon: 59.6 }, { lat: 36.31, lon: 59.61 }, SESSION);
  assert.deepEqual(seen.map(s => [s[0], s[1]]), [['api/snapp/otp', 'POST'], ['api/snapp/verify', 'POST'], ['api/snapp/price', 'POST']]);
  assert.deepEqual(seen[2][2].session, SESSION);
  await assert.rejects(createApi({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ status: 'linked', session: { access: 'x' } }) }) }).snappVerify('09121234567', '1'), e => e.kind === 'server');
});

test('Profile card: number -> captcha when Snapp asks -> SMS code -> linked; then «قطع اتصال»', async t => {
  installFoodDom(t);
  const calls = [];
  const api = {
    async snappOtp(phone, captcha) { calls.push(['otp', phone, captcha?.solution ?? null]); return captcha ? { status: 'sent', ttlS: 120 } : { status: 'captcha', captcha: { type: 'numeric', image: 'data:image/png;base64,AA', refId: 'ref-1' } }; },
    async snappVerify(phone, code) { calls.push(['verify', phone, code]); return { status: 'linked', session: SESSION, phoneHint: '4567' }; },
  };
  const store = createStore(memoryStorage());
  const card = createSnappLinkCard({ api, store });
  const inputs = () => findAll(card.el, n => n.tagName === 'input');
  assert.match(text(card.el), /نشست اسنپ فقط روی همین دستگاه می‌ماند/);
  inputs()[0].value = '09121234567';
  await button(card.el, 'دریافت کد پیامک').dispatch('click'); await flushView();
  assert.ok(findAll(card.el, n => n.tagName === 'img').length === 1, 'the captcha image is shown');
  inputs()[0].value = '48213';
  await button(card.el, 'ادامه').dispatch('click'); await flushView();
  assert.match(text(card.el), /کد پیامک اسنپ برای شما فرستاده شد/);
  inputs()[0].value = '12345';
  await button(card.el, 'ورود به اسنپ').dispatch('click'); await flushView();
  assert.deepEqual(calls, [['otp', '09121234567', null], ['otp', '09121234567', '48213'], ['verify', '09121234567', '12345']]);
  assert.deepEqual(store.snappSession(), SESSION);
  assert.match(text(card.el), /وصل است \(شمارهٔ …۴۵۶۷\)/);
  await button(card.el, 'قطع اتصال').dispatch('click');
  assert.equal(store.snappSession(), null);
});

test('price block: bookable services only, in tomans, with where the price came from', t => {
  installFoodDom(t);
  const shared = snappPriceBlock(PRICE);
  assert.match(text(shared), /اسنپ\s*۱۹۳٬۰۰۰ تومان/);
  assert.doesNotMatch(text(shared), /سفر اشتراکی/);
  assert.match(text(shared), /استعلام عمومی/);
  assert.match(text(snappPriceBlock({ ...PRICE, sessionKind: 'user' })), /با حساب اسنپ شما/);
  assert.equal(snappPriceBlock({ ...PRICE, services: [] }), null);
});

test('trip: the same trip asks Snapp too; a rotated session replaces the stored one; an expired link is removed and said so', async t => {
  installFoodDom(t);
  const storage = memoryStorage(), store = createStore(storage);
  store.setSnappSession(SESSION, '4567');
  const rotated = { ...SESSION, access: 'n'.repeat(40) };
  let mode = 'ok';
  const api = {
    async places() { return { places: [], geocoder: 'ok' }; },
    async trip() { return { status: 'ok', options: [], decision: null, disclaimers: [] }; },
    async snappPrice(from, to, session) {
      assert.deepEqual(session, store.snappSession());
      if (mode === 'expired') throw Object.assign(new Error('x'), { kind: 'unauthenticated', status: 401 });
      return { ...PRICE, sessionKind: 'user', session: rotated };
    },
  };
  const view = createTripView({ actions: { back() {}, go() {} }, store, state: { get: () => ({ stations: [{ name: 'کوثر', lat: 36.3, lon: 59.6, lines: [1] }, { name: 'شریعتی', lat: 36.29, lon: 59.61, lines: [1, 2] }], order: ['کوثر', 'شریعتی'] }) }, api });
  view.onShow({});
  const selects = findAll(view.el, n => n.tagName === 'select');
  await selects[0].dispatch('change', '1:کوثر'); await selects[1].dispatch('change', '1:شریعتی');
  const search = findAll(view.el, n => n.tagName === 'button' && /مسیر/.test(n.textContent) && !/جابه/.test(n.textContent)).at(-1);
  await search.dispatch('click'); await flushView(); await flushView();
  assert.match(text(view.el), /قیمت لحظه‌ای اسنپ/);
  assert.match(text(view.el), /با حساب اسنپ شما/);
  assert.deepEqual(store.snappSession(), rotated);
  mode = 'expired';
  await search.dispatch('click'); await flushView(); await flushView();
  assert.equal(store.snappSession(), null);
  assert.match(text(view.el), /اتصال حساب اسنپ منقضی شد/);
});

test('cheapest search: the asked trip, then pickups with the destination fixed, then drop-offs with the best pickup', async () => {
  const { cheapestSnapp } = await import('./snapp-search.js');
  const from = { lat: 36.30, lon: 59.60 }, to = { lat: 36.33, lon: 59.55 };
  const origins = [{ lat: 36.3001, lon: 59.6, walkM: 40, street: 'الف' }, { lat: 36.3003, lon: 59.6, walkM: 70, street: 'ب' }];
  const destinations = [{ lat: 36.3301, lon: 59.55, walkM: 30, street: 'ج' }, { lat: 36.3304, lon: 59.55, walkM: 90, street: 'د' }];
  const table = new Map([['36.3>36.33', 200000], ['36.3001>36.33', 195000], ['36.3003>36.33', 188000], ['36.3003>36.3301', 191000], ['36.3003>36.3304', 181000]]);
  const asked = [];
  const ask = async (a, b) => { asked.push(`${a.lat}>${b.lat}`); const p = table.get(`${a.lat}>${b.lat}`); return { services: [{ id: 1, enabled: true, priceToman: p }] }; };
  const r = await cheapestSnapp({ from, to, origins, destinations, ask, sleep: async () => {} });
  assert.deepEqual(asked, ['36.3>36.33', '36.3001>36.33', '36.3003>36.33', '36.3003>36.3301', '36.3003>36.3304']);
  assert.equal(r.base.price, 200000);
  assert.deepEqual({ price: r.best.price, saving: r.best.saving, pickup: r.best.pickup.street, dropoff: r.best.dropoff.street }, { price: 181000, saving: 19000, pickup: 'ب', dropoff: 'د' });
  // A rate limit stops the sweep (no hammering); what was found so far stands.
  let n = 0;
  const limited = await cheapestSnapp({ from, to, origins, destinations, sleep: async () => {}, ask: async () => { if (++n > 1) throw Object.assign(new Error('x'), { kind: 'rate_limited', status: 429 }); return { services: [{ id: 1, enabled: true, priceToman: 200000 }] }; } });
  assert.equal(limited.tried.length, 1);
  assert.equal(limited.best.saving, 0);
});

test('price block: «کمترین قیمت ممکن» button, progress, and the cheaper points with streets and walking distance', t => {
  installFoodDom(t);
  const user = { ...PRICE, sessionKind: 'user' };
  let clicked = 0;
  const idle = snappPriceBlock(user, { onFind: () => clicked++, search: { status: 'idle' } });
  button(idle, 'کمترین قیمت ممکن را پیدا کن').listeners.get('click')();
  assert.equal(clicked, 1);
  assert.match(text(snappPriceBlock(user, { onFind() {}, search: { status: 'running', step: 3, total: 13 } })), /۳ از ۱۳/);
  const done = snappPriceBlock(user, { onFind() {}, search: { status: 'done', result: { tried: new Array(13), best: { price: 181000, saving: 19000, pickup: { street: 'ب', walkM: 72 }, dropoff: null } } } });
  assert.match(text(done), /ارزان‌ترین: ۱۸۱٬۰۰۰ تومان، ۱۹٬۰۰۰ تومان کمتر/);
  assert.match(text(done), /سوار شدن: «ب»، حدود ۷۰ متر پیاده از مبدأ/);
  const none = snappPriceBlock(user, { onFind() {}, search: { status: 'done', result: { tried: new Array(13), best: { price: 200000, saving: 0, pickup: null, dropoff: null } } } });
  assert.match(text(none), /ارزان‌تر از همین نقطه پیدا نشد/);
});

test('in the Android app the phone talks to Snapp itself: captcha, code, session refresh and price, never via the server', async t => {
  installFoodDom(t);
  const { withDeviceSnapp } = await import('./snapp-device.js');
  const CFG = { schemaVersion: 1, clientId: 'client-id-x', clientSecret: 'client-secret-x', captchaClient: '00000000-0000-4000-8000-000000000000' };
  const sent = [];
  const answer = (key, body, bearer, extra) => {
    if (key === 'otp') return body.captcha ? [200, { method: 'sms', ttl: 120 }] : [403, { status: 2001 }];
    if (key === 'captcha') return [200, { data: { image: 'data:image/png;base64,AA', ref_id: 'ref-9' } }];
    if (key === 'verify') return [200, { access_token: 'x'.repeat(40), refresh_token: 'y'.repeat(30) }];
    if (key === 'refresh') return [200, { access_token: 'n'.repeat(40), refresh_token: 'm'.repeat(30) }];
    if (key === 'price') return bearer === 'n'.repeat(40) ? [200, { data: { ttl: 300, services: [{ id: 1, enabled: true, price: { final: 1810000 }, info: { name: 'اسنپ' }, estimation: { eta: [7] } }] } }] : [401, null];
    return [0, null];
  };
  const native = { snappRequest(id, key, body, bearer, extra) { const b = body ? JSON.parse(body) : null; sent.push({ key, body: b, bearer, extra }); const [status, res] = answer(key, b, bearer, extra); setImmediate(() => globalThis.window.__besrahSnappDone(id, status, res ? JSON.stringify(res) : '')); } };
  let serverCalls = 0;
  const api = withDeviceSnapp({ async snappConfig() { return CFG; }, async snappOtp() { serverCalls++; }, async snappVerify() { serverCalls++; }, async snappPrice() { serverCalls++; } }, native);
  const c = await api.snappOtp('09121234567');
  assert.deepEqual(c, { status: 'captcha', wrong: false, captcha: { type: 'numeric', image: 'data:image/png;base64,AA', refId: 'ref-9' } });
  assert.equal(sent.find(s => s.key === 'captcha').extra, 'numeric/00000000-0000-4000-8000-000000000000');
  assert.deepEqual(await api.snappOtp('09121234567', { type: 'numeric', refId: 'ref-9', solution: '4821' }), { status: 'sent', ttlS: 120 });
  const linked = await api.snappVerify('09121234567', '12345');
  assert.equal(linked.status, 'linked');
  assert.match(linked.session.deviceId, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...sent.find(s => s.key === 'verify').body, device_id: 'x' }, { attestation: { method: 'skip', platform: 'skip' }, grant_type: 'sms', client_id: 'client-id-x', client_secret: 'client-secret-x', cellphone: '+989121234567', token: '12345', referrer: 'pwa', device_id: 'x' });
  const price = await api.snappPrice({ lat: 36.3, lon: 59.6 }, { lat: 36.31, lon: 59.61 }, linked.session);
  assert.equal(price.viaDevice, true);
  assert.equal(price.services[0].priceToman, 181000);
  assert.equal(price.session.access, 'n'.repeat(40), 'the refreshed session goes back to the device');
  await assert.rejects(api.snappPrice({ lat: 36.3, lon: 59.6 }, { lat: 36.31, lon: 59.61 }, null), e => e.reason === 'no_shared_session');
  assert.equal(serverCalls, 0, 'nothing went through Besrah’s server');
});
