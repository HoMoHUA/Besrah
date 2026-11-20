// «از بسراه بپرس» in the Mini App: offered for questions in the header search, answers checked, and each answer opens
// an existing page with the person's own words (trip fields, food/shop presets, a metro station, a bus line).
import test from 'node:test';
import assert from 'node:assert/strict';
import { askRoute, looksLikeQuestion, validAskResult } from './ask.js';
import { createApi } from './api.js';
import { createServiceSearch } from './ui/service-search.js';
import { createTripView } from './views/trip.js';
import { createBusView } from './views/bus.js';
import { installFoodDom, flushView, findAll } from './test-support/food-dom.mjs';

const ok = (intent, params, reply = 'باشه') => ({ schemaVersion: 1, intent, params, reply, source: 'rules' });
function richDom(t) {
  installFoodDom(t);
  const proto = Object.getPrototypeOf(globalThis.document.createElement('x'));
  proto.removeAttribute ??= function (k) { delete this.attributes[k]; };
  proto.blur ??= function () {}; proto.focus ??= function () {}; proto.scrollIntoView ??= function () {};
  proto.contains ??= function () { return true; };
  globalThis.document.addEventListener = () => {};
}

test('a sentence, a question mark or Finglish is a question; a single Persian word is not', () => {
  for (const q of ['از کوثر تا حرم', 'قطار کی میاد؟', 'pizza', 'یه پیتزا']) assert.equal(looksLikeQuestion(q), true, q);
  for (const q of ['قهوه', 'مترو', 'ab', '']) assert.equal(looksLikeQuestion(q), false, q);
});

test('answers are checked: known intent, allowed parameters only, sane types', () => {
  assert.equal(validAskResult(ok('food', { q: 'پیتزا', budget: 150000, near: true })), true);
  assert.equal(validAskResult(ok('unknown', {})), true);
  for (const bad of [ok('weather', {}), ok('food', { station: 'کوثر' }), ok('food', { budget: '150000' }), ok('shop', { q: '' }), { ...ok('trip', { to: 'حرم' }), schemaVersion: 2 }, { ...ok('trip', { to: 'حرم' }), reply: '' }])
    assert.equal(validAskResult(bad), false, JSON.stringify(bad));
});

test('each answer opens an existing page with the person’s words', () => {
  assert.deepEqual(askRoute(ok('trip', { from: 'کوثر', to: 'حرم' })), { kind: 'view', view: 'trip', options: { fromText: 'کوثر', toText: 'حرم' } });
  assert.deepEqual(askRoute(ok('food', { q: 'پیتزا', near: true })), { kind: 'view', view: 'food', options: { q: 'پیتزا', near: true } });
  assert.deepEqual(askRoute(ok('shop', { q: 'هدفون سونی', budget: 5000000 })), { kind: 'view', view: 'shop', options: { q: 'هدفون سونی', budget: 5000000 } });
  assert.deepEqual(askRoute(ok('metro_board', { station: 'شریعتی' })), { kind: 'station', name: 'شریعتی' });
  assert.deepEqual(askRoute(ok('metro_board', {})), { kind: 'view', view: 'metro', options: {} });
  assert.deepEqual(askRoute(ok('bus_eta', { line: '38' })), { kind: 'view', view: 'bus', options: { line: '38' } });
  assert.deepEqual(askRoute(ok('unknown', {})), { kind: 'none' });
});

test('api: the question is POSTed (never in the URL) and the answer is validated', async () => {
  const seen = [];
  const api = createApi({ fetch: async (url, init) => { seen.push([url, init.method, init.body]); return { ok: true, status: 200, json: async () => ok('food', { q: 'پیتزا' }) }; } });
  assert.equal((await api.ask('یه پیتزا')).intent, 'food');
  assert.deepEqual(seen, [['api/ask', 'POST', JSON.stringify({ q: 'یه پیتزا' })]]);
  await assert.rejects(createApi({ fetch: async () => ({ ok: true, status: 200, json: async () => ok('food', { evil: 1 }) }) }).ask('x y'), e => e.kind === 'server');
});

test('header search: «از بسراه بپرس» first for a question, last for a service name, alone when nothing matches', async t => {
  richDom(t);
  const mk = tag => globalThis.document.createElement(tag);
  const input = mk('input'), popup = mk('div'), listbox = mk('div'), live = mk('div'), clearButton = mk('button'), host = mk('div');
  input.value = '';
  const asked = [];
  createServiceSearch({ host, input, clearButton, popup, listbox, live, onPick: () => {}, onAsk: q => asked.push(q) });
  const options = () => findAll(listbox, n => n.attributes?.role === 'option');
  const type = async v => { input.value = v; await input.listeners.get('input')({ type: 'input', target: input }); };
  await type('از کوثر تا حرم چطوری برم');
  assert.equal(options()[0].attributes.id, 'ask-opt');
  assert.match(options()[0].textContent, /از بسراه بپرس«از کوثر تا حرم چطوری برم»/);
  await type('مترو');
  assert.ok(options().length > 1 && options().at(-1).attributes.id === 'ask-opt', 'a service name keeps its service first');
  await type('ایرپاد');
  assert.deepEqual(options().map(o => o.attributes.id), ['ask-opt']);
  await options()[0].dispatch('click');
  assert.deepEqual(asked, ['ایرپاد']);
  assert.equal(input.value, '');
});

test('trip: asked place names fill both fields and run the usual place search; a typed origin replaces «my location»', async t => {
  installFoodDom(t);
  const searched = [];
  const view = createTripView({ actions: { back() {}, go() {} }, store: { prefs: () => ({}) }, state: { get: () => ({ stations: [] }) },
    api: { async places(q) { searched.push(q); return { places: [], geocoder: 'ok' }; } } });
  view.onShow({ fromText: 'کوثر', toText: 'حرم' });
  await flushView();
  const inputs = findAll(view.el, n => n.tagName === 'input' && n.attributes?.type !== 'time');
  assert.deepEqual(inputs.map(i => i.value).filter(Boolean), ['کوثر', 'حرم']);
  assert.deepEqual(searched.sort(), ['حرم', 'کوثر']);
  assert.doesNotMatch(view.el.textContent, /موقعیت فعلی من/);
});

test('bus: an asked line opens its stops once the guide is loaded; a line the guide lacks becomes the search text', async t => {
  installFoodDom(t);
  const guide = { v: 1, meta: {}, n: ['الف', 'ب'], l: [{ r: '10', v: [{ i: 1, f: 'الف', t: 'ب', d: 0, s: [0, 1] }] }] };
  let opened = null;
  const view = createBusView({ actions: { back() {}, go() {} }, api: { async busGuide() { return guide; } }, sheet: { isOpen: false, open(c) { opened = c; }, close() {} } });
  view.onShow({ line: '10' });
  await flushView(); await flushView();
  assert.match(opened?.textContent ?? '', /خط ۱۰/);
  view.onShow({ line: '82' });
  const search = findAll(view.el, n => n.tagName === 'input' && n.attributes?.id === 'bus-q')[0];
  assert.equal(search.value, '82');
});
