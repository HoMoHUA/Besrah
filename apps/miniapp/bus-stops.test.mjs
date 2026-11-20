// Line -> stop: every stop of an opened line is a button; it pushes a stop page with the municipal live arrivals of its
// official station (this line first). Unsure links are never guessed: same-name candidates or a name search instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusView, sameLine } from './views/bus.js';
import { createApi } from './api.js';
import { installFoodDom, flushView, findAll, button } from './test-support/food-dom.mjs';

const guide = { v: 1, meta: { osm_base: '2026-10-29' }, n: ['ایستگاه الف', 'ایستگاه ب', 'ایستگاه پایانه', 'ایستگاه ناشناس'], l: [
  { r: '38/1', v: [{ i: 501, f: 'ایستگاه الف', t: 'ایستگاه ناشناس', d: 0, s: [0, 1, 2, 3] }] },
  { r: '20', v: [{ i: 502, f: 'ایستگاه ب', t: 'ایستگاه الف', d: 0, s: [1, 0] }] },
] };
const MATCHES = { schemaVersion: 1, source: 'mashhad_geoportal', variant: 501, stops: [
  { match: { number: 1001, name: 'الف', method: 'osm_ref' }, candidates: [] },
  { match: { number: 4804, name: 'میدان شهدا', method: 'osm_ref' }, candidates: [] },
  { match: null, candidates: [{ number: 71, name: 'پایانه' }, { number: 72, name: 'پایانه' }] },
  { match: null, candidates: [] },
] };
const ETA = { schemaVersion: 1, status: 'ok', station: 4804, source: 'mashhad_geoportal', retrievedAt: new Date().toISOString(), arrivals: [
  { line: '20', destination: 'پایانه الف', etaMin: 2, state: 'live', bus: { ageS: 30 } },
  { line: '38.1', destination: 'پایانه ناشناس', etaMin: 5, state: 'live', bus: { ageS: 40 } },
  { line: '38.1', destination: 'پایانه ناشناس', etaMin: null, state: 'no_bus', bus: null },
] };

function setup(t, api = {}) {
  installFoodDom(t);
  const calls = [], pages = [];
  let open = false;
  const sheet = {
    get isOpen() { return open; },
    open(content) { open = true; pages.splice(0, pages.length, content); },
    push(content) { pages.push(content); calls.push(['push']); return true; },
    pop() { pages.pop(); calls.push(['pop']); return true; },
    close() { open = false; pages.length = 0; },
  };
  const view = createBusView({ actions: { back() {}, go() {} }, sheet, api: {
    async busGuide() { return guide; },
    async busVariantStops(id) { calls.push(['variant', id]); return { ...MATCHES, variant: id }; },
    async busEta(n) { calls.push(['eta', n]); return { ...ETA, station: n }; },
    async busStops(q) { calls.push(['stops', q]); return { stops: [{ number: 9001, name: 'ناشناس' }] }; },
    ...api(calls) } });
  return { view, calls, pages, top: () => pages[pages.length - 1] };
}
async function openLine(x, ref) {
  x.view.onShow(); await flushView();
  const line = findAll(x.view.el, n => n.tagName === 'button' && n.dataset?.line === ref)[0];
  await line.dispatch('click'); await flushView();
  return x.top();
}
const stopButton = (page, seq) => findAll(page, n => n.tagName === 'button' && n.dataset?.seq === String(seq))[0];
const text = node => node.textContent.replace(/\s+/g, ' ');
const hasClass = (n, c) => String(n.className ?? '').split(/\s+/).includes(c);

test('guide and municipal line numbers are compared fairly; express refs only match themselves', () => {
  assert.equal(sameLine('38.1', '38/1'), true);
  assert.equal(sameLine('۳۸', '38'), true);
  assert.equal(sameLine('2', 'EXP-2'), false);
  assert.equal(sameLine('', ''), false);
});

test('a line lists its stops as buttons and shows the official number once the server links them', async t => {
  const x = setup(t, () => ({}));
  const page = await openLine(x, '38/1');
  assert.deepEqual(x.calls.filter(c => c[0] === 'variant'), [['variant', 501]]);
  assert.equal(findAll(page, n => n.tagName === 'button' && n.dataset?.seq !== undefined).length, 4);
  await flushView();
  assert.match(text(stopButton(page, 1)), /^ایستگاه ب\s*۴۸۰۴$/);
  assert.equal(text(stopButton(page, 3)).trim(), 'ایستگاه ناشناس', 'an unlinked stop shows no number');
  assert.match(text(page), /روی هر ایستگاه بزنید تا زمان رسیدن اتوبوس‌ها را ببینید/);
});

test('a linked stop pushes its page: this line first with minutes, other lines after, source and official number', async t => {
  const x = setup(t, () => ({}));
  const line = await openLine(x, '38/1');
  await flushView();
  await stopButton(line, 1).dispatch('click'); await flushView(); await flushView();
  const page = x.top();
  assert.notEqual(page, line, 'the stop page was pushed over the line');
  assert.deepEqual(x.calls.filter(c => c[0] === 'eta'), [['eta', 4804]]);
  const body = text(page);
  assert.match(body, /ایستگاه رسمی ۴۸۰۴ · در سامانهٔ شهرداری: میدان شهدا/);
  assert.match(body, /خط ۳۸\/۱ · به سمت ایستگاه ناشناس/);
  assert.doesNotMatch(body, /[0-9]/, 'every number on the page is in Persian digits');
  const rows = findAll(page, n => hasClass(n, 'bus-eta-row'));
  assert.equal(rows.length, 3);
  assert.ok(hasClass(rows[0], 'is-current') && /۵ دقیقه/.test(text(rows[0])), 'this line comes first');
  assert.ok(hasClass(rows[1], 'is-current') && /اتوبوسی در راه نیست/.test(text(rows[1])));
  assert.ok(!hasClass(rows[2], 'is-current') && /۲ دقیقه/.test(text(rows[2])));
  assert.match(body, /خط‌های دیگر در این ایستگاه/);
  assert.match(body, /منبع: سامانهٔ شهرداری مشهد/);
  assert.match(body, /ایستگاه قبلی\s*ایستگاه الف/);
  assert.match(body, /ایستگاه بعدی\s*ایستگاه پایانه/);
  await button(page, 'خط ۲۰').dispatch('click'); await flushView();
  assert.match(text(x.top()), /ایستگاه ب/, 'another line through this stop opens on top');
  await findAll(page, n => n.tagName === 'button' && n.getAttribute?.('aria-label') === 'بازگشت به صفحهٔ قبل')[0].dispatch('click');
  assert.deepEqual(x.calls.filter(c => c[0] === 'pop'), [['pop']]);
});

test('several same-name official stops: the person chooses; nothing is guessed', async t => {
  const x = setup(t, () => ({}));
  const line = await openLine(x, '38/1');
  await stopButton(line, 2).dispatch('click'); await flushView(); await flushView();
  const page = x.top();
  assert.equal(x.calls.filter(c => c[0] === 'eta').length, 0);
  assert.match(text(page), /ایستگاه خودتان را انتخاب کنید/);
  await button(page, 'پایانه · ۷۲').dispatch('click'); await flushView();
  assert.deepEqual(x.calls.filter(c => c[0] === 'eta'), [['eta', 72]]);
  assert.match(text(page), /ایستگاه رسمی ۷۲ \(انتخاب شما\)/);
});

test('no linked station: say so, and search the municipal list by the stop name only on request', async t => {
  const x = setup(t, () => ({}));
  const line = await openLine(x, '38/1');
  await stopButton(line, 3).dispatch('click'); await flushView(); await flushView();
  const page = x.top();
  assert.match(text(page), /شمارهٔ رسمی این ایستگاه با اطمینان پیدا نشد/);
  assert.equal(x.calls.filter(c => c[0] === 'stops').length, 0);
  await button(page, 'جست‌وجو در فهرست شهرداری').dispatch('click'); await flushView();
  assert.deepEqual(x.calls.filter(c => c[0] === 'stops'), [['stops', 'ناشناس']]);
  await button(page, 'ناشناس · ۹۰۰۱').dispatch('click'); await flushView();
  assert.deepEqual(x.calls.filter(c => c[0] === 'eta'), [['eta', 9001]]);
});

test('link service down or municipal system silent: honest notes, never minutes', async t => {
  const x = setup(t, () => ({
    async busVariantStops() { throw Object.assign(new Error('x'), { kind: 'server' }); },
    async busEta() { throw Object.assign(new Error('x'), { kind: 'server' }); },
  }));
  const line = await openLine(x, '38/1');
  await stopButton(line, 1).dispatch('click'); await flushView(); await flushView();
  assert.match(text(x.top()), /پیوند این ایستگاه با سامانهٔ شهرداری الان در دسترس نیست/);
  await button(x.top(), 'جست‌وجو در فهرست شهرداری').dispatch('click'); await flushView();
  await button(x.top(), 'ناشناس · ۹۰۰۱').dispatch('click'); await flushView();
  assert.match(text(x.top()), /سامانهٔ شهرداری الان جواب نداد؛ زمان رسیدن نامعلوم است/);
  assert.doesNotMatch(text(x.top()), /دقیقه/);
});

test('api: variant stops are validated (variant echo, shapes) and use a relative GET', async () => {
  const json = body => ({ ok: true, status: 200, json: async () => body });
  const seen = [];
  const api = createApi({ fetch: async url => { seen.push(url); return json(MATCHES); } });
  assert.equal((await api.busVariantStops(501)).stops.length, 4);
  assert.deepEqual(seen, ['api/bus/variant-stops?variant=501']);
  await assert.rejects(api.busVariantStops(502), e => e.kind === 'server');
  for (const bad of [{ ...MATCHES, stops: [{ match: { number: '1', name: 'x' }, candidates: [] }] }, { ...MATCHES, stops: [{ match: null }] }, { ...MATCHES, schemaVersion: 2 }])
    await assert.rejects(createApi({ fetch: async () => json(bad) }).busVariantStops(501), e => e.kind === 'server');
});
