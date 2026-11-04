// Profile (guest / Telegram account / sync consent) and the home suggestions banner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileView } from './views/profile.js';
import { createHomeView } from './views/home.js';
import { createStore, sanitizePrefs } from './store.js';
import { installFoodDom, flushView, findAll, button, byClass } from './test-support/food-dom.mjs';

const click = node => node.listeners.get('click')({ type: 'click', target: node });
const text = v => v.el.textContent;

function profile(t, { session, tg = '', api = {} } = {}) {
  installFoodDom(t, { native: tg ? { initData: tg } : undefined });
  if (tg) globalThis.window.Telegram.WebApp.initData = tg;
  const store = createStore(undefined), calls = [];
  const full = {
    accountSession: async () => session, accountTelegram: async i => { calls.push(['login', i]); if (!api.cookieDropped) session = { authenticated: true, available: true, consents: {} }; return { authenticated: true, available: true, consents: {} }; },
    accountLogout: async () => calls.push(['logout']), accountConsent: async (p, g) => { calls.push(['consent', p, g]); session = { ...session, consents: { sync_preferences: { status: g ? 'granted' : 'revoked' } } }; },
    accountPreferences: async () => ({ version: 0, values: {} }), accountSavePreferences: async (v, vals) => { calls.push(['save', v, vals]); return { version: v + 1 }; },
    accountExport: async () => ({ schemaVersion: 1, identities: [{ provider: 'telegram' }] }), accountDelete: async () => calls.push(['delete']), ...api };
  const view = createProfileView({ api: full, store, actions: { go: v => calls.push(['go', v]) } });
  return { view, store, calls };
}

test('a guest outside Telegram sees no fake login button and a truthful list of what is not built', async t => {
  const { view } = profile(t, { session: { authenticated: false, available: true, loginMethods: { telegram: true } } });
  view.onShow(); await flushView();
  assert.match(text(view), /مهمان هستید/); assert.match(text(view), /فقط داخل برنامهٔ تلگرام ممکن است/); assert.match(text(view), /هنوز ساخته نشده اند/);
  assert.equal(findAll(view.el, n => n.tagName === 'button' && n.textContent === 'ورود با تلگرام').length, 0);
});

test('inside Telegram the login button sends only initData, then shows the account', async t => {
  const { view, calls } = profile(t, { tg: 'auth_date=1&signature=x', session: { authenticated: false, available: true } });
  view.onShow(); await flushView();
  await click(button(view.el, 'ورود با تلگرام')); await flushView();
  assert.deepEqual(calls[0], ['login', 'auth_date=1&signature=x']);
  assert.match(text(view), /وارد شده اید/); assert.match(text(view), /نام، شماره و موقعیت ذخیره نمی شود/);
});

test('accounts unavailable: the page says so and everything else still works', async t => {
  const { view, store } = profile(t, { session: { authenticated: false, available: false } });
  view.onShow(); await flushView();
  assert.match(text(view), /ورود فعلاً در دسترس نیست/);
  await click(button(view.el, 'تا ۱۵۰ هزار')); await flushView();
  assert.equal(store.prefs().foodBudgetToman, 150000);
});

test('device preferences are saved locally, validated like the server, and not sent anywhere while a guest', async t => {
  const { view, store, calls } = profile(t, { session: { authenticated: false, available: true } });
  view.onShow(); await flushView();
  await click(button(view.el, '۱۰ دقیقه')); await click(button(view.el, 'هزینه')); await flushView();
  assert.deepEqual(store.prefs(), { transitMaxWalkMin: 10, transitPriority: 'cost' });
  assert.equal(calls.filter(c => c[0] === 'save').length, 0);
  assert.deepEqual(sanitizePrefs({ transitMaxWalkMin: 2, foodBudgetToman: 1.5, transitPriority: 'x', evil: 1 }), {});
});

test('sync is a separate consent: turning it on pushes the device copy, turning it off asks the server to forget', async t => {
  const { view, store, calls } = profile(t, { session: { authenticated: true, available: true, consents: {} } });
  store.setPrefs({ foodBudgetToman: 250000 });
  view.onShow(); await flushView();
  const on = findAll(view.el, n => n.tagName === 'button' && n.textContent === 'روشن')[1];
  await click(on); await flushView();
  assert.deepEqual(calls.filter(c => c[0] === 'consent' || c[0] === 'save').map(c => c[0]), ['consent', 'save']);
  assert.deepEqual(calls.find(c => c[0] === 'save')[2], { foodBudgetToman: 250000 });
  const off = findAll(view.el, n => n.tagName === 'button' && n.textContent === 'خاموش')[1];
  await click(off); await flushView();
  assert.deepEqual(calls.filter(c => c[0] === 'consent').map(c => c[2]), [true, false]);
});

test('delete needs two taps and export prints exactly what the server returned', async t => {
  const { view, calls } = profile(t, { session: { authenticated: true, available: true, consents: {} } });
  view.onShow(); await flushView();
  await click(button(view.el, 'حذف حساب')); await flushView();
  assert.equal(calls.filter(c => c[0] === 'delete').length, 0); assert.match(text(view), /برای حذف دوباره لمس کنید/);
  await click(button(view.el, 'دریافت داده های حساب')); await flushView();
  assert.match(byClass(view.el, 'pf-export').textContent, /"provider": "telegram"/);
  await click(button(view.el, 'برای حذف دوباره لمس کنید')); await flushView();
  assert.equal(calls.filter(c => c[0] === 'delete').length, 1);
});

function home(t, { api, suggest = false, geo } = {}) {
  installFoodDom(t, geo ? { browser: geo } : {}); globalThis.fetch = () => Promise.reject(new Error('offline'));
  const calls = [], requests = [];
  const cards = [{ id: 'food.lunch', kind: 'food', title: 'ناهار', why: 'ساعت ۱۲:۰۰ به وقت مشهد است', detail: 'قیمت ها لحظه ای نیستند.', evidence: { kind: 'clock' }, cta: { type: 'food' } }];
  const view = createHomeView({ api: { homeSuggestions: api ?? (async p => { requests.push(p); return { cards: p ? [{ id: 'transit.nearest', kind: 'transit', title: 'ایستگاه شریعتی', why: 'نزدیک ترین', detail: 'فاصلهٔ هوایی', evidence: { kind: 'straight_line' }, cta: { type: 'station', station: 'شریعتی' } }, ...cards] : cards, locationUsed: Boolean(p), note: 'ذخیره نمی شود' }; }) },
    store: { suggestLocation: () => suggest }, actions: { go: (v, o) => calls.push(['go', v, o]), openStation: n => calls.push(['station', n]), serviceAction() {}, heroAction() {} } });
  return { view, calls, requests };
}

test('home asks for suggestions without any position by default, and never touches geolocation on load', async t => {
  let geoCalls = 0;
  const { view, requests } = home(t, { geo: ok => { geoCalls++; ok({ coords: { latitude: 36.3, longitude: 59.6 } }); } });
  view.onShow(); await flushView();
  assert.deepEqual(requests, [null]); assert.equal(geoCalls, 0);
  assert.match(text(view), /پیشنهاد حالا/); assert.match(text(view), /ساعت ۱۲:۰۰ به وقت مشهد/);
  assert.match(text(view), /ایستگاه نزدیک من را هم نشان بده/);
});

test('the position button is the explicit request: one geolocation call, then a station card that opens the station', async t => {
  let geoCalls = 0;
  const { view, requests, calls } = home(t, { geo: ok => { geoCalls++; ok({ coords: { latitude: 36.2912, longitude: 59.5856 } }); } });
  view.onShow(); await flushView();
  await click(button(view.el, 'ایستگاه نزدیک من را هم نشان بده')); await flushView();
  assert.equal(geoCalls, 1); assert.deepEqual(requests.at(-1), { lat: 36.2912, lon: 59.5856 });
  await click(findAll(view.el, n => n.dataset?.id === 'transit.nearest')[0]);
  assert.deepEqual(calls.at(-1), ['station', 'شریعتی']);
  await click(findAll(view.el, n => n.dataset?.id === 'food.lunch')[0]);
  assert.deepEqual(calls.at(-1), ['go', 'food', {}]);
});

test('a denied position keeps the clock-only suggestion; a failing service hides the banner instead of faking cards', async t => {
  const denied = home(t, { geo: (_ok, fail) => fail({ code: 1 }) });
  denied.view.onShow(); await flushView();
  await click(button(denied.view.el, 'ایستگاه نزدیک من را هم نشان بده')); await flushView();
  assert.equal(denied.requests.at(-1), null); assert.match(text(denied.view), /ساعت ۱۲:۰۰/);
  const broken = home(t, { api: async () => { throw new Error('x'); } });
  broken.view.onShow(); await flushView();
  assert.doesNotMatch(text(broken.view), /پیشنهاد حالا/);
});

test('with the profile switch on, home uses the position at load and falls back silently when it is denied', async t => {
  let geoCalls = 0;
  const { view, requests } = home(t, { suggest: true, geo: (_ok, fail) => { geoCalls++; fail({ code: 1 }); } });
  view.onShow(); await flushView(); await flushView();
  assert.equal(geoCalls, 1); assert.equal(requests.at(-1), null);
});

test('if the browser drops the cookie the page admits it instead of pretending to be logged in', async t => {
  const { view } = profile(t, { tg: 'auth_date=1&signature=x', session: { authenticated: false, available: true }, api: { cookieDropped: true } });
  view.onShow(); await flushView();
  await click(button(view.el, 'ورود با تلگرام')); await flushView();
  assert.match(text(view), /کوکی را نگه نمی دارد/); assert.doesNotMatch(text(view), /وارد شده اید/);
});

test('the shopping budget is a device preference like the food one, validated like the server', async t => {
  const { view, store } = profile(t, { session: { authenticated: false, available: true } });
  view.onShow(); await flushView();
  await click(button(view.el, 'تا ۲ میلیون')); await flushView();
  assert.equal(store.prefs().shopBudgetToman, 2000000);
  await click(button(view.el, 'تا ۲ میلیون')); await flushView();
  assert.equal(store.prefs().shopBudgetToman, 2000000);
});
