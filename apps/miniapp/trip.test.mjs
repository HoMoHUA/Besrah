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
  const view = createTripView({ api, state: {}, store: options?.prefs ? { prefs: () => options.prefs, setPrefs: v => { options.prefs = v; options.saved?.push(v); } } : undefined, actions: { go() {} } });
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

test('default origin is the current position: nothing is read on load, one tap on search reads it once and plans', async t => {
  let calls = 0;
  const { view, requests } = setup(t, { browser: ok => { calls++; ok({ coords: gps }); } });
  await flushView();
  assert.match(text(view), /موقعیت فعلی من/); assert.match(text(view), /هنگام جست وجو دریافت می شود/);
  assert.equal(button(view.el, 'مسیر را پیدا کن').disabled, true, 'a destination is still missing');
  await choose(view, 'مقصد', 'غدیر', 'ایستگاه غدیر');
  assert.equal(calls, 0, 'choosing the destination does not read the position');
  assert.equal(button(view.el, 'مسیر را پیدا کن').disabled, false, 'destination alone is enough');
  await button(view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
  assert.equal(calls, 1);
  const trip = requests.find(r => r.url === 'api/trip');
  assert.deepEqual(trip.body, { from: { lat: 36.30791, lon: 59.59711 }, to: { lat: 36.25683, lon: 59.6202 } });
  for (const r of requests) assert.doesNotMatch(r.url, /36\.3|59\./);
});

test('a denied position never blocks the user: no request is made, the origin search appears with a clear message', async t => {
  const { view, requests } = setup(t, { browser: (_ok, fail) => fail({ code: 1 }) });
  await choose(view, 'مقصد', 'غدیر', 'ایستگاه غدیر');
  await button(view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
  assert.equal(requests.filter(r => r.url === 'api/trip').length, 0);
  assert.match(text(view), /موقعیت شما در دسترس نبود/); assert.match(text(view), /دسترسی به موقعیت داده نشد/);
  assert.doesNotMatch(text(view), /هنگام جست وجو دریافت می شود/);
  await choose(view, 'مبدأ', 'فردوسی', 'دانشگاه فردوسی');
  await button(view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
  assert.equal(requests.filter(r => r.url === 'api/trip').length, 1);
});

test('"another origin" switches to search without reading the position, and clearing it returns to the default', async t => {
  let calls = 0;
  const { view } = setup(t, { browser: ok => { calls++; ok({ coords: gps }); } });
  await button(view.el, 'مبدأ دیگر').dispatch('click'); await flushView();
  assert.match(text(view), /انتخاب نشده/); assert.equal(calls, 0);
  await choose(view, 'مبدأ', 'فردوسی', 'دانشگاه فردوسی');
  await findAll(view.el, n => n.tagName === 'button' && n.getAttribute('aria-label') === 'پاک کردن')[0].dispatch('click'); await flushView();
  assert.match(text(view), /موقعیت فعلی من/);
});

test('opening from the home card focuses the destination field', t => {
  const { view } = setup(t);
  let focused = 0;
  findAll(view.el, n => n.tagName === 'input' && n.getAttribute('aria-label') === 'مقصد')[0].focus = () => { focused++; };
  view.onShow({ focus: 'to' }); view.onShow({});
  assert.equal(focused, 1);
});

test('a stated walking limit from the profile is sent with the trip request, and nothing else is inferred', async t => {
  const { view, requests } = setup(t, { prefs: { transitMaxWalkMin: 10, foodBudgetToman: 100000 } });
  await choose(view, 'مبدأ', 'فردوسی', 'دانشگاه فردوسی'); await choose(view, 'مقصد', 'غدیر', 'ایستگاه غدیر');
  await button(view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
  assert.equal(requests.find(r => r.url === 'api/trip').body.maxWalkMin, 10);
  assert.deepEqual(Object.keys(requests.find(r => r.url === 'api/trip').body).sort(), ['from', 'maxWalkMin', 'to']);
});

test('the Core verdict is shown with its own words, one question appears for a real trade-off, and answering stores a stated priority and re-plans', async t => {
  const saved = [];
  const decision = { schemaVersion: 1, status: 'ok', reason: 'x', priority: null, preferred: null, notes: ['برای بعضی گزینه ها داده کافی نبود.'],
    byOption: { m: { labels: ['سریع ترین'], claims: ['در میان گزینه های هم ارز و واجد شرایط ارائه شده، سریع ترین است.'], preferred: false } },
    question: { prompt: 'کدام برایتان مهم تر است؟', answers: [{ id: 'a', label: 'زمان سفر کمتر، سپس زمان پیاده روی کمتر', priority: 'time' }, { id: 'b', label: 'زمان پیاده روی کمتر، سپس زمان سفر کمتر', priority: 'walk' }] } };
  const { view, requests } = setup(t, { prefs: {}, saved }, url => (url === 'api/trip' ? new Response(JSON.stringify(reply({ decision }))) : null));
  await choose(view, 'مبدأ', 'فردوسی', 'دانشگاه فردوسی'); await choose(view, 'مقصد', 'غدیر', 'ایستگاه غدیر');
  await button(view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
  const out = text(view);
  assert.match(out, /سریع ترین/); assert.match(out, /هم ارز و واجد شرایط/); assert.match(out, /کدام برایتان مهم تر است/); assert.match(out, /داده کافی نبود/);
  await button(view.el, 'زمان پیاده روی کمتر، سپس زمان سفر کمتر').dispatch('click'); await flushView();
  assert.deepEqual(saved, [{ transitPriority: 'walk' }]);
  const trips = requests.filter(r => r.url === 'api/trip');
  assert.equal(trips.length, 2); assert.equal(trips[1].body.priority, 'walk');
});

test('without a decision block (older server) the cards render exactly as before', async t => {
  const { view } = setup(t, { prefs: {} });
  await choose(view, 'مبدأ', 'فردوسی', 'دانشگاه فردوسی'); await choose(view, 'مقصد', 'غدیر', 'ایستگاه غدیر');
  await button(view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
  assert.doesNotMatch(text(view), /کدام برایتان مهم تر است/); assert.match(text(view), /۱۶:۵۴/);
});

// --- place input without multi-result search, and the A→B result presentation ---
const stationsState = { get: () => ({ stations: [
  { id: 'METRO-101', name: 'وکیل‌آباد', lat: 36.3461444, lon: 59.4422694, lines: [1] },
  { id: 'METRO-110', name: 'غدیر', lat: 36.25683, lon: 59.6202, lines: [1] },
  { id: 'METRO-201', name: 'طبرسی', lat: 36.33, lon: 59.65, lines: [2] },
  { id: 'BAD', name: 'بی مختصات', lat: null, lon: null, lines: [1] },
], order: ['وکیل‌آباد', 'غدیر'], order2: ['طبرسی'] }) };
function setupWithStations(t, handler) {
  installFoodDom(t, {});
  const requests = [];
  const api = createApi({ fetch: async (url, init) => {
    requests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    const out = handler ? await handler(url) : null;
    if (out) return out;
    if (url === 'api/trip') return new Response(JSON.stringify(reply()));
    throw new Error('unexpected request ' + url);
  } });
  const view = createTripView({ api, state: stationsState, actions: { go() {} } });
  return { view, requests };
}
const select = (view, label) => findAll(view.el, n => n.tagName === 'select' && n.getAttribute('aria-label') === `${label}: انتخاب ایستگاه از فهرست`)[0];

test('stations can be chosen from a list grouped by line, with no search request at all', async t => {
  const { view, requests } = setupWithStations(t);
  view.onShow();
  const from = select(view, 'مبدأ');
  const groups = from.children.filter(n => n.tagName === 'optgroup');
  assert.deepEqual(groups.map(g => g.getAttribute('label')), ['خط ۱', 'خط ۲']);
  assert.equal(findAll(from, n => n.tagName === 'option').some(o => o.textContent === 'بی مختصات'), false);
  await from.dispatch('change', '1:وکیل‌آباد'); await flushView();
  await select(view, 'مقصد').dispatch('change', '1:غدیر'); await flushView();
  assert.equal(requests.length, 0);
  assert.match(text(view), /ایستگاه وکیل‌آباد/);
  await button(view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
  assert.deepEqual(requests[0].body, { from: { lat: 36.3461444, lon: 59.4422694 }, to: { lat: 36.25683, lon: 59.6202 } });
});

test('a pasted coordinate is shown as an exact entered point; invalid coordinates and a disabled geocoder are explained', async t => {
  const answers = [
    { schemaVersion: 1, geocoder: 'skipped', coordinates: 'ok', places: [{ kind: 'coordinates', name: 'نقطهٔ واردشده', lat: 36.29421, lon: 59.59678, precision: 'coordinates', source: 'user_input', nearStation: { name: 'غدیر', distanceM: 4400 } }] },
    { schemaVersion: 1, geocoder: 'skipped', coordinates: 'invalid', places: [] },
    { schemaVersion: 1, geocoder: 'not_enabled', coordinates: 'none', places: [] },
  ];
  const { view } = setupWithStations(t, url => (url === 'api/places' ? new Response(JSON.stringify(answers.shift())) : null));
  await pickInput(view, 'مبدأ').dispatch('input', '36.29421, 59.59678'); await wait(450); await flushView();
  assert.match(text(view), /مختصات واردشده \(دقیق\)؛ نزدیک ترین ایستگاه: غدیر/);
  await pickInput(view, 'مبدأ').dispatch('input', '36.3, 59.6'); await wait(450); await flushView();
  assert.match(text(view), /مختصات معتبری نیستند/);
  await pickInput(view, 'مبدأ').dispatch('input', 'کوچه'); await wait(450); await flushView();
  assert.match(text(view), /برای کلید فعلی فعال نیست/);
});

test('cards say why each option is shown, the order of steps, how much is assumed and how much later the second arrives', async t => {
  const car = { id: 'car', kind: 'car', title: 'با خودرو', choice: 'other_mode', leaveAt: '16:54', leaveEpoch: 1, arriveAt: '17:50', arriveEpoch: 2 + 540, totalS: 3360,
    legs: [{ type: 'car', durationS: 3360, distanceM: 11000, basis: 'routed', traffic: 'provider_traffic' }], ifMissed: null, notes: [] };
  const { view } = setupWithStations(t, url => (url === 'api/trip' ? new Response(JSON.stringify(reply({ options: [metroOption({ choice: 'earliest' }), car] }))) : null));
  view.onShow();
  await select(view, 'مبدأ').dispatch('change', '1:وکیل‌آباد'); await select(view, 'مقصد').dispatch('change', '1:غدیر'); await flushView();
  await button(view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
  const out = text(view);
  assert.match(out, /زودترین رسیدن/); assert.match(out, /گزینهٔ دیگر: روش دیگر/);
  assert.match(out, /پیاده ۳۲ دقیقه ← مترو خط ۱ ۱۰ دقیقه ← پیاده ۱ دقیقه/);
  assert.match(out, /منشأ زمان کل: .*اندازه گیری مسیریاب، .*مدل برنامهٔ قطار، ۵ دقیقه فرض/);
  assert.match(out, /۹ دقیقه دیرتر از گزینهٔ اول می رسد/);
});

test('every metro option offers its boarding station board; a car option says it is not a taxi time or fare', async t => {
  const opened = [];
  installFoodDom(t, {});
  const car = { id: 'car', kind: 'car', title: 'با خودرو', choice: 'other_mode', leaveAt: '16:54', leaveEpoch: 1, arriveAt: '17:50', arriveEpoch: 542, totalS: 3360,
    legs: [{ type: 'car', durationS: 3360, distanceM: 11000, basis: 'routed', traffic: 'provider_traffic' }], ifMissed: null, notes: [] };
  const api = createApi({ fetch: async url => (url === 'api/trip' ? new Response(JSON.stringify(reply({ options: [metroOption({ choice: 'earliest' }), car] }))) : new Response('{}', { status: 500 })) });
  const view = createTripView({ api, state: stationsState, actions: { go() {}, openStation: name => opened.push(name) } });
  view.onShow();
  await select(view, 'مبدأ').dispatch('change', '1:وکیل‌آباد'); await select(view, 'مقصد').dispatch('change', '1:غدیر'); await flushView();
  await button(view.el, 'مسیر را پیدا کن').dispatch('click'); await flushView();
  await button(view.el, 'تابلوی حرکت ایستگاه شریعتی').dispatch('click');
  assert.deepEqual(opened, ['شریعتی']);
  assert.match(text(view), /زمان رسیدن تاکسی اینترنتی و کرایه نامعلوم است/);
  assert.equal(findAll(view.el, n => n.tagName === 'button' && /تابلوی حرکت/.test(n.textContent)).length, 1);
});
