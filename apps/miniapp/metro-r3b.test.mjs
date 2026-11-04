// R3-B: compact mobile-first Metro. Real views and handlers in the test DOM; no copy of view logic here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flushView } from './test-support/food-dom.mjs';
import { installMetroDom, metroContext, findAll } from './test-support/metro-dom.mjs';
import { createMetroView } from './views/metro.js';
import { createPlannerController } from './ui/planner.js';

const texts = root => findAll(root, n => n.tagName === 'button').map(b => b.textContent);
const buttons = root => findAll(root, n => n.tagName === 'button');
const byLabel = (root, label) => buttons(root).find(b => b.getAttribute('aria-label') === label);
const byText = (root, text) => buttons(root).find(b => b.textContent === text);
async function unified(t) {
  const held = {}; t.after(() => held.view?.onHide()); // registered first: runs before the DOM shim is removed
  const dom = installMetroDom(t), ctx = metroContext(), view = held.view = createMetroView(ctx);
  view.onShow(); await flushView(); view.controller.optIn(); await flushView();
  return { dom, ctx, view, root: view.el };
}

test('head is one compact row: no duplicated subtitle, one model note, no H2 trip heading', async t => {
  const { root, view } = await unified(t);
  const head = root.querySelector('.metro-head');
  assert.deepEqual(findAll(head, n => n.tagName === 'h1').map(n => n.textContent), ['مترو']);
  assert.equal(findAll(head, n => n.tagName === 'p').length, 0, 'no subtitle paragraph in the head row');
  assert.doesNotMatch(root.textContent, /مترو مشهد · خط/);
  assert.doesNotMatch(root.textContent, /سفر، تابلو و مسیر با انتخاب مشترک/);
  assert.equal(root.querySelectorAll('.metro-model-note').length, 1);
  assert.match(root.querySelector('.metro-model-note').textContent, /نه موقعیت زنده/);
  assert.equal(findAll(root.querySelector('.journey'), n => n.tagName === 'h2').length, 0, 'trip card has no visible H2');
  assert.equal(root.querySelector('.journey').getAttribute('aria-label'), 'سفر با مترو');
  assert.equal(head.querySelector('img').getAttribute('width'), '36');
});

test('opt-out is a quiet secondary control in the head row with a full accessible name; opt-in stays equally findable', async t => {
  const { root, view } = await unified(t);
  const out = root.querySelector('.metro-head').querySelector('.metro-optout');
  assert.ok(out, 'opt-out lives in the head row');
  assert.equal(out.textContent, 'خروج از حالت آزمایشی');
  assert.doesNotMatch(out.className, /cm-btn--primary|cm-btn(?!-)/, 'must not look like a primary button');
  assert.doesNotMatch(root.textContent, /خروج از تجربه آزمایشی/);
  await out.dispatch('click'); await flushView();
  assert.equal(view.isUnified(), false);
  const inn = root.querySelector('.metro-head').querySelector('.metro-optout');
  assert.ok(inn, 'opt-in occupies the same place when unified is off');
  assert.equal(inn.textContent, 'ورود اختیاری به سفر آزمایشی');
  assert.match(root.querySelector('.metro-optin-note').textContent, /فقط انتخاب ورود ذخیره می شود/);
});

test('line and ready-time are segmented controls, not selects; custom time fields are revealed only when chosen', async t => {
  const { root, view } = await unified(t);
  const form = root.querySelector('.journey-form');
  assert.equal(findAll(form, n => n.tagName === 'select').length, 0);
  const line = form.querySelector('#journey-line');
  assert.equal(line.getAttribute('role'), 'group');
  const [l1, l2] = buttons(line); assert.deepEqual([l1.textContent, l2.textContent], ['خط ۱', 'خط ۲']);
  assert.equal(l1.getAttribute('aria-pressed'), 'true');
  await l2.dispatch('click');
  assert.equal(view.controller.get().form.line, 2);
  assert.equal(findAll(root.querySelector('.journey-form'), n => n.tagName === 'button' && n.textContent === 'خط ۲')[0].getAttribute('aria-pressed'), 'true');
  const mode = root.querySelector('#journey-mode');
  assert.deepEqual(buttons(mode).map(b => b.textContent), ['همین الان روی سکو', 'انتخاب زمان']);
  assert.match(root.querySelector('.journey-form').textContent, /آماده|روی سکو/);
  assert.equal(root.querySelector('#journey-time'), null); assert.equal(root.querySelector('#journey-date'), null);
  await buttons(mode)[1].dispatch('click');
  assert.equal(view.controller.get().form.mode, 'custom');
  assert.ok(root.querySelector('#journey-time')); assert.ok(root.querySelector('#journey-date'));
  assert.equal(findAll(root.querySelector('#journey-mode'), n => n.tagName === 'button' && n.getAttribute('aria-pressed') === 'true')[0].textContent, 'انتخاب زمان');
  await buttons(root.querySelector('#journey-mode'))[0].dispatch('click');
  assert.equal(root.querySelector('#journey-time'), null);
  assert.match(root.querySelector('.journey-form').textContent, /نه خروج از خانه/, 'ready means on the platform, not leaving home');
});

test('form order: from, swap icon, to, ready-time, CTA with nothing between; swap is a small named icon button', async t => {
  const { root, view } = await unified(t);
  const form = root.querySelector('.journey-form');
  const order = findAll(form, n => ['journey-line', 'journey-from', 'journey-to', 'journey-mode'].includes(n.getAttribute('id')) || n.className.includes('journey-swap') || n.getAttribute('type') === 'submit').map(n => n.getAttribute('id') ?? (n.className.includes('journey-swap') ? 'swap' : 'cta'));
  assert.deepEqual(order, ['journey-line', 'journey-from', 'swap', 'journey-to', 'journey-mode', 'cta']);
  const swap = byLabel(form, 'جابه جا کردن مبدأ و مقصد'); assert.ok(swap);
  assert.ok(swap.textContent.length <= 1, 'icon only; accessible name comes from aria-label');
  view.controller.setForm({ from: 'METRO-101', to: 'METRO-117' });
  await byLabel(root, 'جابه جا کردن مبدأ و مقصد').dispatch('click');
  assert.deepEqual([view.controller.get().form.from, view.controller.get().form.to], ['METRO-117', 'METRO-101']);
  const cta = form.querySelector('.journey-cta');
  assert.equal(cta.textContent, 'دیدن برآورد سفر'); assert.match(cta.className, /cm-btn--primary/);
  assert.equal(form.children.at(-1), cta, 'CTA is the last element of the form');
});

test('idle form shows no long repeated notice; model notice appears only beside a result or error', async t => {
  const { root, view } = await unified(t);
  assert.doesNotMatch(root.querySelector('.journey').textContent, /نه موقعیت زنده/);
  assert.doesNotMatch(root.querySelector('.journey').textContent, /کرایه/);
  root.querySelector('.journey-form').listeners.get('submit')({ preventDefault() {} }); await flushView();
  assert.match(root.querySelector('.journey-results').textContent, /ایستگاه مبدأ و مقصد را انتخاب کنید/);
  assert.match(root.querySelector('.journey-results').textContent, /نه موقعیت زنده/);
  assert.equal(root.querySelectorAll('.journey-status').length >= 1, true);
});

test('origin picker holds nearest (tap only), last station, favourites and Favourites link instead of a pill row', async t => {
  const { root, view, ctx } = await unified(t);
  assert.equal(root.querySelectorAll('.metro-quick').length, 0);
  ctx.store.toggleFavourite('ابتدا'); ctx.store.toggleFavourite('طبرسی');
  ctx.state.set({ recent: { station: 'مشترک' }, nearest: { phase: 'ready', station: { name: 'ابتدا' } } });
  assert.equal(ctx.nav.length, 0);
  assert.equal(root.querySelector('.journey-shortcuts').hidden, true, 'closed picker shows no shortcuts');
  await root.querySelector('#journey-from').dispatch('click');
  const sc = root.querySelector('.journey-shortcuts'); assert.equal(sc.hidden, false);
  assert.ok(byText(sc, 'نزدیک ترین: ابتدا'));
  assert.ok(byText(sc, 'آخرین: مشترک'));
  assert.ok(byText(sc, 'ابتدا') && !byText(sc, 'طبرسی'), 'only favourites on the selected line are offered');
  assert.equal(ctx.nav.includes('locate'), false, 'location is never requested without a tap');
  await byText(sc, 'ایستگاه های من').dispatch('click'); assert.deepEqual(ctx.nav, ['favourites']);
  await byText(sc, 'آخرین: مشترک').dispatch('click');
  assert.equal(view.controller.get().form.from, 'METRO-117');
  assert.equal(root.querySelector('.journey-picker').hidden, true);
  await root.querySelector('#journey-to').dispatch('click');
  assert.ok(!findAll(root.querySelector('.journey-shortcuts'), n => n.textContent.startsWith('نزدیک ترین')).length, 'nearest only offered for the origin');
  await byText(root.querySelector('.journey-shortcuts'), 'ابتدا').dispatch('click');
  assert.equal(view.controller.get().form.to, 'METRO-101');
});

test('nearest shortcut asks for location only after an explicit tap', async t => {
  const { root, view, ctx } = await unified(t);
  await root.querySelector('#journey-from').dispatch('click');
  await byText(root.querySelector('.journey-shortcuts'), 'نزدیک ترین ایستگاه').dispatch('click');
  assert.deepEqual(ctx.nav, ['locate']);
});

test('opening a picker scrolls it above the fixed nav and bounds the listbox', async t => {
  const { root, view, dom } = await unified(t);
  await root.querySelector('#journey-from').dispatch('click');
  const hit = dom.scrolls.find(s => s.node === root.querySelector('.journey-picker') || s.node === root.querySelector('#journey-station-query'));
  assert.ok(hit, 'picker is scrolled into view when opened');
  assert.equal(hit.options.block, 'center');
  const input = root.querySelector('#journey-station-query'); const before = dom.scrolls.length;
  await input.listeners.get('focus')?.({ target: input });
  assert.ok(dom.scrolls.length > before, 'focus re-centres the input (keyboard)');
});

test('context switcher: visible tabs, board default and labelled as now; tracker lazy; stations panel; no details for them', async t => {
  const { root, view, ctx } = await unified(t);
  const sw = root.querySelector('.metro-context'); assert.equal(sw.getAttribute('role'), 'tablist');
  const tabs = buttons(sw); assert.deepEqual(tabs.map(b => b.textContent), ['حرکت های ایستگاه', 'نمای خط', 'ایستگاه ها']);
  assert.ok(tabs.every(b => b.getAttribute('role') === 'tab'));
  assert.deepEqual(tabs.map(b => b.getAttribute('aria-selected')), ['true', 'false', 'false']);
  assert.equal(findAll(root.querySelector('.metro-unified'), n => n.tagName === 'details').filter(n => /metro-(tracker|station)-detail/.test(n.className)).length, 0);
  const panel = id => root.querySelector(`#metro-panel-${id}`);
  assert.equal(panel('board').hidden, false); assert.equal(panel('tracker').hidden, true); assert.equal(panel('stations').hidden, true);
  assert.match(panel('board').textContent, /اکنون/); assert.match(panel('board').textContent, /نه زمان/);
  const base = ctx.trains.length;
  view.controller.setForm({ from: 'METRO-101' }); await flushView();
  assert.equal(ctx.calls.length, 1); assert.equal(ctx.trains.length, base, 'closed tracker fetches nothing');
  ctx.api.trains = (line, signal) => { ctx.trains.push({ line, signal }); return new Promise(() => {}); };
  await tabs[1].dispatch('click'); await flushView();
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true'); assert.equal(panel('tracker').hidden, false); assert.equal(panel('board').hidden, true);
  assert.equal(ctx.trains.at(-1).line, 1);
  assert.match(panel('tracker').textContent, /GPS/); assert.match(panel('tracker').textContent, /نه موقعیت زنده|زنده نیست/);
  const boardCalls = ctx.calls.length;
  view.controller.setForm({ line: 2 }); await flushView(); assert.equal(ctx.trains.at(-1).line, 2);
  assert.equal(ctx.calls.length, boardCalls, 'hidden board panel does not refetch');
  await tabs[0].dispatch('click'); await flushView();
  assert.equal(ctx.trains.at(-1).signal.aborted, true, 'leaving tracker panel aborts its request');
  await tabs[2].dispatch('click'); await flushView();
  assert.equal(panel('stations').hidden, false); assert.ok(panel('stations').querySelector('.route-list'));
  assert.equal(ctx.trains.at(-1).signal.aborted, true);
});

test('hiding the view stops the tracker panel; returning restores the chosen panel', async t => {
  const { root, view, ctx } = await unified(t);
  ctx.api.trains = (line, signal) => { ctx.trains.push({ line, signal }); return new Promise(() => {}); };
  await buttons(root.querySelector('.metro-context'))[1].dispatch('click'); await flushView();
  view.onHide(); assert.equal(ctx.trains.at(-1).signal.aborted, true);
  const n = ctx.trains.length; view.onShow(); await flushView();
  assert.equal(ctx.trains.length, n + 1);
});

test('result cards: modeled destination, times, wait; earliest label only on flagged option; no fare/walk/transfer/live', async t => {
  const held = {}; t.after(() => held.view?.onHide()); installMetroDom(t); const ctx = metroContext();
  const response = { status: 'ok', request: { line: 1, originName: 'ابتدا', destinationName: 'مشترک', readyAt: '2026-11-03T10:00:00+03:30', source: 'now', windowMinutes: 120 }, calendar: { state: 'known' },
    options: [{ id: 'a', toward: 'غدیر', departAt: '10:05', arriveAt: '10:20', waitSeconds: 300, inVehicleSeconds: 900, earliestArrival: true }, { id: 'b', toward: 'فرودگاه', departAt: '10:12', arriveAt: '10:30', waitSeconds: 720, inVehicleSeconds: 1080 }], validUntil: new Date(Date.now() + 600000).toISOString() };
  ctx.api.journey = async () => response;
  const view = held.view = createMetroView(ctx); view.onShow(); await flushView(); view.controller.optIn(); await flushView();
 
  view.controller.setForm({ from: 'METRO-101', to: 'METRO-117' });
  await view.controller.plan(); await flushView();
  const cards = view.el.querySelectorAll('.journey-option'); assert.equal(cards.length, 2);
  assert.match(cards[0].textContent, /به سمت غدیر/); assert.match(cards[1].textContent, /به سمت فرودگاه/);
  assert.match(cards[0].textContent, /زودترین رسیدن/); assert.doesNotMatch(cards[1].textContent, /زودترین/);
  const all = view.el.querySelector('.journey-results').textContent;
  assert.doesNotMatch(all, /تومان|ریال|پیاده روی \d|زنده است/);
  assert.match(all, /نه موقعیت زنده/); assert.match(all, /کرایه نامعلوم/); assert.match(all, /انتظار/); assert.match(all, /داخل قطار/);
  // Owner/PB rule: the fixed model-only notice stays near the decision. Summary first, then the notice, then the first card.
  const iSummary = all.indexOf('از ابتدا به مشترک'), iNotice = all.indexOf('نه موقعیت زنده'), iCard = all.indexOf('به سمت غدیر');
  assert.ok(iSummary >= 0 && iSummary < iNotice && iNotice < iCard, 'summary, then the fixed model notice, then the first option card');
  assert.equal(all.split('نه موقعیت زنده').length - 1, 1, 'the fixed notice is shown once, not repeated below the cards');
  assert.ok(findAll(view.el.querySelector('.journey-results'), n => n.getAttribute('role') === 'status').length);
  // Changing any input drops the old result instead of keeping it under a changed title.
  view.controller.setForm({ to: 'METRO-101', from: 'METRO-117' }); await flushView();
  assert.equal(view.el.querySelectorAll('.journey-option').length, 0);
});

test('visible first-screen vocabulary stays Persian with explicit spaces (no glued compounds)', async t => {
  const { root, view } = await unified(t);
  const all = root.textContent;
  for (const bad of ['میشود', 'میکند', 'جابهجا', 'نمیشود', 'آزمایشیست']) assert.ok(!all.includes(bad), bad);
});

test('controller still rejects planning while not opted in (OFF stays inert)', async t => {
  installMetroDom(t); const ctx = metroContext();
  const c = createPlannerController({ state: ctx.state, api: ctx.api }); await c.load();
  assert.equal(c.get().active, false);
});

test('a response without options never claims it is a valid result; it asks for another day or time', async t => {
  const held = {}; t.after(() => held.view?.onHide()); installMetroDom(t); const ctx = metroContext();
  // Explicit edge fixture: the real engine reports insufficient_data for an uncovered day; no card may be invented.
  ctx.api.journey = async () => ({ status: 'insufficient_data', request: { line: 1, originName: 'ابتدا', destinationName: 'مشترک', readyAt: '2026-11-04T10:00:00+03:30', source: 'user_selected', windowMinutes: 120 },
    calendar: { state: 'unknown', warning: true }, options: [], validUntil: new Date(Date.now() + 600000).toISOString() });
  const view = held.view = createMetroView(ctx); view.onShow(); await flushView(); view.controller.optIn(); await flushView();
  view.controller.setForm({ from: 'METRO-101', to: 'METRO-117' }); await view.controller.plan(); await flushView();
  const text = view.el.querySelector('.journey-results').textContent;
  assert.equal(view.el.querySelectorAll('.journey-option').length, 0);
  assert.doesNotMatch(text, /نتیجه کوتاه مدت معتبر است/, 'no validity claim without a result');
  assert.match(text, /روز یا ساعت دیگر/);
  assert.match(text, /نه موقعیت زنده/, 'the fixed model notice is still shown once');
  assert.ok(findAll(view.el, n => n.tagName === 'button').some(b => b.textContent === 'محاسبه دوباره'));
});
