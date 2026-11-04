// Rahyab view: real view + real API client + test DOM. Unknown stays unknown, location only on an explicit tap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTripView, durationLabel } from './views/trip.js';
import { createApi } from './api.js';
import { installFoodDom, flushView, button, findAll, byClass } from './test-support/food-dom.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));
const gps = { latitude: 36.30791234, longitude: 59.59711234 };
const metroOption = (over = {}) => ({ id: 'm', kind: 'metro', title: 'مترو از شریعتی به غدیر', leaveAt: '16:54', leaveEpoch: 1, arriveAt: '17:41', arriveEpoch: 2, totalS: 2829,
  legs: [
    { type: 'walk', from: 'مبدأ', to: 'ایستگاه شریعتی', durationS: 1914, distanceM: 2400, basis: 'routed', straightLineM: 1900 },
    { type: 'station_access', durationS: 180, basis: 'assumption' },
    { type: 'metro', line: 1, service: 'A', toward: 'غدیر', from: 'شریعتی', to: 'غدیر', departAt: '17:30', arriveAt: '17:40', durationS: 608, basis: 'model', confidence: 'official_sheet_phase', eventId: 'ev1_x' },
    { type: 'station_egress', durationS: 120, basis: 'assumption' },
    { type: 'walk', from: 'ایستگاه غدیر', to: 'مقصد', durationS: 7, distanceM: 9, basis: 'routed', straightLineM: 8 }],
  ifMissed: { departAt: '17:37', arriveAt: '17:49' }, notes: [], ...over });
const reply = (over = {}) => ({ schemaVersion: 1, status: 'ok', reason: 'ok', readyAt: 'x', readyEpoch: 1, options: [metroOption()], assumptions: {}, routing: { provider: 'neshan', trafficLabel: 'ترافیک را مسیریاب برای خودرو لحاظ می کند.' }, disclaimers: ['زمان مترو از مدل برنامهٔ قطار می آید، نه موقعیت زنده.'], ...over });

function setup(t, options, handler) {
  installFoodDom(t, options);
  const requests = [];
  const api = createApi({ fetch: async (url, init) => {
    requests.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    const out = handler ? await handler(url, init) : null;
    if (out) return out;
    if (url === 'api/places') return new Response(JSON.stringify({ schemaVersion: 1, geocoder: 'ok', places: [{ kind: 'address', name: 'دانشگاه فردوسی', lat: 36.29421, lon: 59.59678, precision: 'geocoded', source: 'neshan_geocoding' }, { kind: 'station', name: 'ایستگاه غدیر', lat: 36.25683, lon: 59.6202, precision: 'station', source: 'network' }] }));
    if (url === 'api/trip') return new Response(JSON.stringify(reply()));
    throw new Error('unexpected request ' + url);
  } });
  const view = createTripView({ api, state: {}, actions: { go() {} } });
  return { view, requests };
}
const text = v => v.el.textContent;
const pickInput = (view, label) => findAll(view.el, n => n.tagName === 'input' && n.getAttribute('aria-label') === label)[0];
async function choose(view, label, query, placeName) {
  await pickInput(view, label).dispatch('input', query); await wait(450); await flushView();
  const place = findAll(view.el, n => n.tagName === 'button' && n.getAttribute('role') === 'option' && n.textContent.includes(placeName))[0];
  await place.dispatch('click'); await flushView();
}

test('durationLabel never turns unknown into a number', () => {
  assert.equal(durationLabel(null), 'نامعلوم'); assert.equal(durationLabel(NaN), 'نامعلوم');
  assert.equal(durationLabel(7), '۱ دقیقه'); assert.equal(durationLabel(3600), '۱ ساعت'); assert.equal(durationLabel(5400), '۱ ساعت و ۳۰ دقیقه');
});

test('building the view and showing it never read location or call the network', async t => {
  let calls = 0;
  const { view, requests } = setup(t, { browser: ok => { calls++; ok({ coords: gps }); } });
  await flushView(); view.onHide?.();
  assert.equal(calls, 0); assert.equal(requests.length, 0);
  assert.equal(button(view.el, 'مسیر را پیدا کن').disabled, true);
});

test('searching a place posts the text in a JSON body (never a URL) and picking sets the point', async t => {
  const { view, requests } = setup(t);
  await choose(view, 'مبدأ', 'فردوسی', 'دانشگاه فردوسی');
  const req = requests[0];
  assert.equal(req.url, 'api/places'); assert.equal(req.init.method, 'POST'); assert.deepEqual(req.body, { q: 'فردوسی' });
  assert.match(text(view), /نقطه تقریبی/);
  assert.equal(button(view.el, 'مسیر را پیدا کن').disabled, true, 'a destination is still missing');
});

test('explicit location tap fills the origin with exact coordinates, only sent in the trip POST body', async t => {
  let calls = 0;
  const { view, requests } = setup(t, { browser: ok => { calls++; ok({ coords: gps }); } });
  await button(view.el, 'موقعیت من').dispatch('click'); await flushView();
  assert.equal(calls, 1); assert.match(text(view), /موقعیت دقیق شما/);
  await choose(view, 'مقصد', 'غدیر', 'ایستگاه غدیر');
  await button(view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
  const trip = requests.find(r => r.url === 'api/trip');
  assert.deepEqual(trip.body, { from: { lat: 36.30791, lon: 59.59711 }, to: { lat: 36.25683, lon: 59.6202 } });
  for (const r of requests) assert.doesNotMatch(r.url, /36\.3|59\./, 'no coordinate in any URL');
});

test('a denied location is optional and says so', async t => {
  const { view } = setup(t, { browser: (_ok, fail) => fail({ code: 1 }) });
  await button(view.el, 'موقعیت من').dispatch('click'); await flushView();
  assert.match(text(view), /دسترسی به موقعیت داده نشد/);
});

test('a metro result shows times, every leg with its basis, assumptions as assumptions, and the missed-train fallback', async t => {
  const { view } = setup(t);
  await choose(view, 'مبدأ', 'فردوسی', 'دانشگاه فردوسی'); await choose(view, 'مقصد', 'غدیر', 'ایستگاه غدیر');
  await button(view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
  const out = text(view);
  assert.match(out, /۱۶:۵۴/); assert.match(out, /۱۷:۴۱/); assert.match(out, /۴۷ دقیقه/);
  assert.match(out, /اندازه گیری مسیریاب/); assert.match(out, /مدل برنامهٔ قطار/);
  assert.match(out, /ورود به ایستگاه تا سکو[\s\S]*فرض/);
  assert.match(out, /اگر این قطار را از دست بدهید: قطار بعدی ۱۷:۳۷/);
  assert.match(out, /نه موقعیت زنده/);
  assert.equal(findAll(view.el, n => n.className?.includes?.('tp-leg--assumption')).length, 2);
});

test('without a router the card shows no arrival time and no walking duration, only platform times', async t => {
  const partial = reply({ status: 'partial', reason: 'router_not_configured', routing: { provider: null, trafficLabel: '' }, options: [metroOption({ leaveAt: null, arriveAt: null, totalS: null, ifMissed: null,
    legs: [{ type: 'walk', from: 'مبدأ', to: 'ایستگاه شریعتی', durationS: null, distanceM: null, basis: 'unknown', straightLineM: 1900 }, { type: 'metro', line: 1, service: null, toward: 'غدیر', from: 'شریعتی', to: 'غدیر', departAt: '17:30', arriveAt: '17:40', durationS: 600, basis: 'model', confidence: 'x', eventId: null }],
    platformDepartures: [{ departAt: '17:30', arriveAtStation: '17:40' }, { departAt: '17:45', arriveAtStation: '17:55' }] })] });
  const { view } = setup(t, {}, url => (url === 'api/trip' ? new Response(JSON.stringify(partial)) : null));
  await choose(view, 'مبدأ', 'فردوسی', 'دانشگاه فردوسی'); await choose(view, 'مقصد', 'غدیر', 'ایستگاه غدیر');
  await button(view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
  const out = text(view);
  assert.match(out, /زمان رسیدن به مقصد نامعلوم است/);
  assert.match(out, /مدت اندازه گیری نشده/); assert.match(out, /\(زمان نیست\)/);
  assert.match(out, /سرویس مسیریابی پیاده و خودرو فعال نیست/);
  assert.match(out, /قطارهای بعدی روی سکوی مبدأ: ۱۷:۳۰، ۱۷:۴۵/);
  assert.doesNotMatch(out, /تا\s*۱۷:/);
});

test('outside coverage, rate limit, server error and an unavailable result each have their own state', async t => {
  const modes = { outside: 422, busy: 429, error: 500 };
  for (const [mode, status] of Object.entries(modes)) {
    const { view } = setup(t, {}, url => (url === 'api/trip' ? new Response('{}', { status }) : null));
    await choose(view, 'مبدأ', 'فردوسی', 'دانشگاه فردوسی'); await choose(view, 'مقصد', 'غدیر', 'ایستگاه غدیر');
    await button(view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
    assert.match(text(view), mode === 'outside' ? /فقط برای محدودهٔ مشهد/ : mode === 'busy' ? /درخواست ها زیاد است/ : /مسیر محاسبه نشد/, mode);
  }
  const none = setup(t, {}, url => (url === 'api/trip' ? new Response(JSON.stringify(reply({ status: 'unavailable', reason: 'no_candidate', options: [] }))) : null));
  await choose(none.view, 'مبدأ', 'فردوسی', 'دانشگاه فردوسی'); await choose(none.view, 'مقصد', 'غدیر', 'ایستگاه غدیر');
  await button(none.view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
  assert.match(text(none.view), /گزینهٔ قابل اتکایی نداریم/);
});

test('the map picker is honestly absent', async t => {
  const { view } = setup(t);
  assert.match(text(view), /انتخاب نقطه روی نقشه هنوز در دسترس نیست/);
});
