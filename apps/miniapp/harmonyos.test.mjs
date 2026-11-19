// HarmonyOS-aligned behaviours: location refusal guidance (privacy guide) and the "trip in progress" card (Live View pattern).
import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpenLocationSettings, locationAdvice, openLocationSettings, requestPosition } from './logic.js';
import { createStore, sanitizeActiveTrip, ACTIVE_TRIP_MAX_S } from './store.js';
import { createHomeView, activeTripLines } from './views/home.js';
import { installFoodDom, flushView, findAll, button } from './test-support/food-dom.mjs';

test('location failures carry a kind: denied, timeout or unavailable', async () => {
  const fail = code => ({ getCurrentPosition: (_ok, err) => err({ code }) });
  await assert.rejects(requestPosition(undefined, fail(1)), e => e.kind === 'denied' && /location_unavailable/.test(e.message));
  await assert.rejects(requestPosition(undefined, fail(3)), e => e.kind === 'timeout');
  await assert.rejects(requestPosition(undefined, fail(2)), e => e.kind === 'unavailable');
  await assert.rejects(requestPosition(undefined, undefined), e => e.kind === 'unavailable');
  const tgDenied = { initData: 'x', isVersionAtLeast: () => true, LocationManager: { isInited: true, isLocationAvailable: true, isAccessRequested: true, isAccessGranted: false, getLocation: cb => cb(null) } };
  await assert.rejects(requestPosition(tgDenied, undefined), e => e.kind === 'denied');
});

test('first refusal: no nagging; a repeated refusal says where to turn it on, and Telegram settings open only from a tap', () => {
  assert.match(locationAdvice('denied'), /بدون آن هم می‌توانید ادامه دهید/);
  assert.match(locationAdvice('denied', { repeated: true, inTelegram: true }), /تنظیمات همین برنامه در تلگرام/);
  assert.match(locationAdvice('denied', { repeated: true }), /تنظیمات مرورگر/);
  assert.match(locationAdvice('timeout'), /به‌موقع پیدا نشد/);
  assert.match(locationAdvice('unavailable'), /مکان‌یاب دستگاه را روشن کنید/);
  let opened = 0;
  const tg = { isVersionAtLeast: () => true, LocationManager: { openSettings() { opened++; } } };
  assert.equal(canOpenLocationSettings(tg), true); assert.equal(openLocationSettings(tg), true); assert.equal(opened, 1);
  assert.equal(canOpenLocationSettings({ isVersionAtLeast: () => false, LocationManager: { openSettings() {} } }), false);
  assert.equal(openLocationSettings(undefined), false);
});

const memory = () => { const d = new Map(); return { getItem: k => d.get(k) ?? null, setItem: (k, v) => d.set(k, String(v)), removeItem: k => d.delete(k), d }; };
const T0 = 1_795_100_000;
const TRIP = { kind: 'metro', title: 'مترو از ایستگاه کوثر', leaveEpoch: T0 + 300, arriveEpoch: T0 + 2400,
  ride: { line: 1, from: 'کوثر', to: 'شریعتی', toward: 'غدیر', departAt: '12:45', arriveAt: '13:05' } };

test('active trip: only names and times are kept; it ends 15 minutes after arrival, after 8 hours, or when ended', () => {
  const storage = memory(), store = createStore(storage);
  assert.equal(store.startActiveTrip({ ...TRIP, from: { lat: 36.3, lon: 59.5 }, address: 'خیابان ...' }, T0), true);
  const saved = JSON.parse(storage.d.get('besrah:active-trip:v1'));
  assert.deepEqual(Object.keys(saved).sort(), ['arriveEpoch', 'endsAt', 'kind', 'leaveEpoch', 'ride', 'startedAt', 'title']);
  assert.doesNotMatch(JSON.stringify(saved), /lat|lon|خیابان/);
  assert.equal(saved.endsAt, T0 + 2400 + 900);
  assert.ok(store.activeTrip(T0 + 3000));
  assert.equal(store.activeTrip(T0 + 3301), null, 'gone 15 minutes after the planned arrival');
  assert.equal(store.startActiveTrip({ ...TRIP, arriveEpoch: T0 + ACTIVE_TRIP_MAX_S + 60 }, T0), false, 'longer than 8 hours is refused');
  assert.equal(sanitizeActiveTrip({ ...TRIP, startedAt: T0, kind: 'rocket' }), null);
  store.startActiveTrip(TRIP, T0); store.endActiveTrip();
  assert.equal(store.activeTrip(T0), null);
});

test('active trip lines: next step and arrival from the plan, said as estimates', () => {
  const lines = activeTripLines({ ...TRIP, startedAt: T0, endsAt: T0 + 3300 }, T0);
  assert.match(lines[0], /حرکت از مبدأ: ساعت .* \(۵ دقیقه دیگر\)/);
  assert.match(lines[1], /مترو خط ۱ به سمت غدیر: سوار شدن ساعت ۱۲:۴۵ از ایستگاه کوثر، پیاده شدن شریعتی/);
  assert.match(lines[2], /رسیدن حدود ساعت .* \(۴۰ دقیقه دیگر\)/);
  assert.match(activeTripLines({ ...TRIP, startedAt: T0, endsAt: T0 + 3300 }, T0 + 2500).at(-1), /گذشته است/);
});

test('home shows the trip card only while a trip is active, and "end trip" removes it', async t => {
  installFoodDom(t);
  globalThis.fetch = () => Promise.reject(new Error('offline artwork'));
  const store = createStore(memory());
  store.startActiveTrip(TRIP, Math.floor(Date.now() / 1000) - 10);
  const opened = [];
  const view = createHomeView({ api: { homeSuggestions: async () => ({ cards: [], locationUsed: false, note: '' }) },
    store: { ...store, suggestLocation: () => false, prefs: () => ({}) }, actions: { go() {}, openStation: s => opened.push(s), serviceAction() {}, heroAction() {} } });
  view.onShow(); await flushView();
  assert.match(view.el.textContent, /سفر در جریان/);
  assert.match(view.el.textContent, /نه موقعیت زندهٔ قطار یا خودرو/);
  await button(view.el, 'تابلوی ایستگاه کوثر').dispatch('click');
  assert.deepEqual(opened, ['کوثر']);
  await button(view.el, 'پایان سفر').dispatch('click'); await flushView();
  assert.doesNotMatch(view.el.textContent, /سفر در جریان/);
  view.onHide();
});
