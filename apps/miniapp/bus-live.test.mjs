// Live arrivals panel: minutes only for a live, provider-backed estimate; every other state says it is unknown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusView, arrivalText } from './views/bus.js';
import { installFoodDom, flushView, findAll } from './test-support/food-dom.mjs';

const guide = { v: 1, meta: { osm_base: '2026-10-29' }, n: ['الف', 'ب'], l: [{ r: '10', v: [{ i: 1, f: 'الف', t: 'ب', s: [0, 1], d: 0 }] }] };
const ETA = { schemaVersion: 1, status: 'ok', station: 4804, source: 'mashhad_geoportal', retrievedAt: '2026-11-19T10:00:00Z', arrivals: [
  { line: '37', destination: 'پايانه غدير', etaMin: 0, state: 'live', bus: { ageS: 42 } },
  { line: '38', destination: 'پايانه زكريا', etaMin: 20, state: 'live', bus: { ageS: 88 } },
  { line: '2', destination: 'پایانه انقلاب', etaMin: null, state: 'no_bus', bus: null },
  { line: '5', destination: null, etaMin: null, state: 'stale', bus: { ageS: 900 } },
] };

test('arrival text: minutes only when live; "arriving" for 0; honest words for everything else', () => {
  assert.equal(arrivalText(ETA.arrivals[0]), 'خط ۳۷ به پايانه غدير: در حال رسیدن');
  assert.equal(arrivalText(ETA.arrivals[1]), 'خط ۳۸ به پايانه زكريا: ۲۰ دقیقه');
  assert.equal(arrivalText(ETA.arrivals[2]), 'خط ۲ به پایانه انقلاب: اتوبوسی در راه نیست');
  assert.equal(arrivalText(ETA.arrivals[3]), 'خط ۵: زمان نامعلوم (موقعیت اتوبوس قدیمی است)');
  assert.equal(arrivalText({ line: '9', state: 'unknown', etaMin: 7 }), 'خط ۹: زمان نامعلوم');
  assert.equal(arrivalText({ line: '9', state: 'live', etaMin: null }), 'خط ۹: زمان نامعلوم');
});

function setup(t, api) {
  installFoodDom(t);
  const calls = [];
  const view = createBusView({ actions: { back() {}, go() {} }, sheet: { isOpen: false, open() {}, close() {} },
    api: { async busGuide() { return guide; }, ...api(calls) } });
  return { view, calls };
}
const typeIn = async (view, value) => {
  const input = findAll(view.el, n => n.tagName === 'input' && n.getAttribute('id') === 'bus-live-q')[0];
  input.value = value; input.listeners.get('input')({ type: 'input', target: input });
  await new Promise(r => setTimeout(r, 350)); await flushView();
};

test('search by name, pick an official stop, see live arrivals with source and age; the text goes only to the stop search', async t => {
  const { view, calls } = setup(t, calls => ({
    async busStops(q) { calls.push(['stops', q]); return { stops: [{ number: 4804, name: 'میدان شهدا' }] }; },
    async busEta(n) { calls.push(['eta', n]); return ETA; },
  }));
  view.onShow(); await flushView();
  await typeIn(view, 'شهدا');
  assert.deepEqual(calls[0], ['stops', 'شهدا']);
  const stop = findAll(view.el, n => n.tagName === 'button' && /میدان شهدا/.test(n.textContent))[0];
  assert.ok(stop); await stop.listeners.get('click')({ type: 'click', target: stop }); await flushView();
  assert.deepEqual(calls[1], ['eta', 4804]);
  const text = view.el.textContent;
  assert.match(text, /خط ۳۸ به پايانه زكريا: ۲۰ دقیقه/);
  assert.match(text, /اتوبوسی در راه نیست/);
  assert.match(text, /منبع: سامانهٔ شهرداری مشهد/);
  assert.match(text, /موقعیت چند ثانیه پیش/);
});

test('if stop search is unavailable, a typed number still works; a provider failure says the time is unknown', async t => {
  const { view, calls } = setup(t, calls => ({
    async busStops() { const e = new Error('x'); e.kind = 'server'; throw e; },
    async busEta(n) { calls.push(['eta', n]); const e = new Error('x'); e.kind = 'server'; throw e; },
  }));
  view.onShow(); await flushView();
  await typeIn(view, '4804');
  const btn = findAll(view.el, n => n.tagName === 'button' && /زمان رسیدن ایستگاه/.test(n.textContent))[0];
  assert.ok(btn); await btn.listeners.get('click')({ type: 'click', target: btn }); await flushView();
  assert.deepEqual(calls[0], ['eta', 4804]);
  assert.match(view.el.textContent, /سامانهٔ شهرداری الان جواب نداد؛ زمان رسیدن نامعلوم است/);
  assert.doesNotMatch(view.el.textContent, /\d+ دقیقه|[۰-۹]+ دقیقه/);
});
