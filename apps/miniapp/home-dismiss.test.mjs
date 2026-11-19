import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, DISMISS_TTL_MS, KEYS } from './store.js';
import { createHomeView } from './views/home.js';
import { installFoodDom, flushView, button, findAll } from './test-support/food-dom.mjs';

const memory = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: k => { data.delete(k); }, data };
};

test('dismissing a suggestion is remembered on this device, expires after a week and keeps no place or query', () => {
  const storage = memory(), t0 = 1_800_000_000_000;
  const store = createStore(storage);
  assert.equal(store.dismissSuggestion('food.lunch', t0), true);
  assert.deepEqual(store.dismissedSuggestions(t0 + 1000), ['food.lunch']);
  // a new store (app restart) still hides it, and the stored value is only the id and an expiry
  const saved = JSON.parse(storage.data.get(KEYS.dismissed));
  assert.deepEqual(Object.keys(saved), ['food.lunch']);
  assert.equal(saved['food.lunch'], t0 + DISMISS_TTL_MS);
  assert.deepEqual(store.dismissedSuggestions(t0 + DISMISS_TTL_MS - 1), ['food.lunch']);
  assert.deepEqual(store.dismissedSuggestions(t0 + DISMISS_TTL_MS + 1), [], 'a hidden suggestion comes back after seven days');
});

test('only well-formed suggestion ids can be stored: no text, coordinates or other keys', () => {
  const store = createStore(memory());
  for (const bad of ['', 'x', 'food', 'home.lunch', 'food.Lunch', 'food.lunch.a.b', '36.29,59.60', 'food.' + 'a'.repeat(30), null, undefined, 42, {}]) {
    assert.equal(store.dismissSuggestion(bad), false, String(bad));
  }
  assert.deepEqual(store.dismissedSuggestions(), []);
  assert.equal(store.dismissSuggestion('food.intent.gift'), true);
  assert.equal(store.dismissSuggestion('transit.nearest'), true);
});

test('corrupt, expired or over-long stored values are ignored on load; the list is capped', () => {
  const now = Date.now();
  const raw = { 'food.lunch': now - 5, 'food.dinner': now + DISMISS_TTL_MS * 5, 'evil key': now + 1000, 'food.snack': now + 1000 };
  assert.deepEqual(createStore(memory({ [KEYS.dismissed]: JSON.stringify(raw) })).dismissedSuggestions(), ['food.snack']);
  assert.deepEqual(createStore(memory({ [KEYS.dismissed]: '{not json' })).dismissedSuggestions(), []);
  assert.deepEqual(createStore(memory({ [KEYS.dismissed]: '["food.lunch"]' })).dismissedSuggestions(), []);
  const store = createStore(memory());
  for (let i = 0; i < 40; i++) store.dismissSuggestion('food.item_' + String.fromCharCode(97 + (i % 26)) + (i >= 26 ? 'z' : ''), now + i);
  assert.ok(store.dismissedSuggestions(now).length <= 16);
});

test('clearDismissed forgets everything and is safe to call twice', () => {
  const storage = memory(), store = createStore(storage);
  store.dismissSuggestion('food.lunch'); store.clearDismissed(); store.clearDismissed();
  assert.deepEqual(store.dismissedSuggestions(), []);
  assert.deepEqual(JSON.parse(storage.data.get(KEYS.dismissed)), {});
});

function homeWith(store, t) {
  installFoodDom(t);
  globalThis.fetch = () => Promise.reject(new Error('offline artwork'));
  const cards = [
    { id: 'transit.nearest', kind: 'transit', title: 'ایستگاه کوثر', why: 'نزدیک ترین ایستگاه', detail: 'حدود ۳۰۰ متر', evidence: { source: 'network', kind: 'straight_line' }, cta: { type: 'station', station: 'کوثر' } },
    { id: 'food.lunch', kind: 'food', title: 'غذاهای رستورانی', why: 'ساعت ناهار است', detail: 'جست وجو', evidence: { source: 'clock', kind: 'clock' }, cta: { type: 'food', vertical: 'restaurant' } },
  ];
  const api = { homeSuggestions: async () => ({ cards, locationUsed: false, note: 'موقعیت ذخیره نمی شود' }) };
  return createHomeView({ api, store, actions: { go() {}, openStation() {}, serviceAction() {}, heroAction() {} } });
}

test('home: "not useful" hides one card, keeps the other, and "show again" restores it', async t => {
  const store = createStore(memory());
  const view = homeWith({ ...store, suggestLocation: () => false, prefs: () => ({}) }, t);
  view.onShow(); await flushView();
  const ids = () => findAll(view.el, n => n.dataset?.id).map(n => n.dataset.id);
  assert.deepEqual(ids(), ['transit.nearest', 'food.lunch']);
  await findAll(view.el, n => n.dataset?.dismiss === 'food.lunch')[0].dispatch('click'); await flushView();
  assert.deepEqual(ids(), ['transit.nearest']);
  assert.match(view.el.textContent, /پنهان کرده اید/);
  assert.deepEqual(store.dismissedSuggestions(), ['food.lunch']);
  await button(view.el, 'نمایش دوباره').dispatch('click'); await flushView();
  assert.deepEqual(ids(), ['transit.nearest', 'food.lunch']);
  assert.deepEqual(store.dismissedSuggestions(), []);
});

test('home: hiding every card says so honestly and never leaves an empty gap without a way back', async t => {
  const store = createStore(memory());
  const view = homeWith({ ...store, suggestLocation: () => false, prefs: () => ({}) }, t);
  view.onShow(); await flushView();
  for (const id of ['transit.nearest', 'food.lunch']) { await findAll(view.el, n => n.dataset?.dismiss === id)[0].dispatch('click'); await flushView(); }
  assert.equal(findAll(view.el, n => n.dataset?.id).length, 0);
  assert.match(view.el.textContent, /پیشنهادهای این زمان را پنهان کرده اید/);
  assert.ok(button(view.el, 'نمایش دوباره'));
});

test('home: a store without dismissal support keeps plain cards and no dismiss control', async t => {
  const view = homeWith({ suggestLocation: () => false, prefs: () => ({}) }, t);
  view.onShow(); await flushView();
  assert.equal(findAll(view.el, n => n.dataset?.dismiss).length, 0);
  assert.equal(findAll(view.el, n => n.dataset?.id).length, 2);
});
