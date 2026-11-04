// Live refresh: board and line view update quietly in the background every 3 s; the line view has its own line chips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flushView } from './test-support/food-dom.mjs';
import { installMetroDom, metroContext, findAll } from './test-support/metro-dom.mjs';
import { createMetroView } from './views/metro.js';

const buttons = root => findAll(root, n => n.tagName === 'button');
async function unified(t) {
  const held = {}; t.after(() => held.view?.onHide());
  installMetroDom(t); const ctx = metroContext(), view = held.view = createMetroView(ctx);
  view.onShow(); await flushView(); view.controller.optIn(); await flushView();
  return { ctx, view, root: view.el };
}

test('the line view shows its own خط ۱ / خط ۲ chips and they switch the shared form line', async t => {
  const { ctx, view, root } = await unified(t);
  const tabs = buttons(root.querySelector('.metro-context'));
  await tabs[1].dispatch('click'); await flushView();
  const chips = root.querySelector('.trk-chips');
  assert.ok(chips, 'tracker chips exist');
  assert.equal(chips.hidden, false, 'visible in the line view (they used to be hidden, so line 2 looked missing)');
  const line2 = buttons(chips).find(b => b.textContent === 'خط ۲');
  await line2.dispatch('click'); await flushView();
  assert.equal(view.controller.get().form.line, 2, 'the form follows the chip');
  assert.equal(ctx.trains.at(-1).line, 2, 'trains for line 2 were requested');
  assert.equal(buttons(chips).find(b => b.textContent === 'خط ۲').getAttribute('aria-pressed'), 'true');
  view.controller.setForm({ line: 1 }); await flushView();
  assert.equal(buttons(chips).find(b => b.textContent === 'خط ۱').getAttribute('aria-pressed'), 'true', 'and the chips follow the form');
  assert.equal(ctx.trains.at(-1).line, 1);
});

test('the station board re-fetches every 3 s without a spinner or status text; a hand-pressed refresh shows progress', async t => {
  const { ctx, view, root } = await unified(t);
  const timers = [];
  const real = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...rest) => { if (ms === 3000) { timers.push({ fn, ms }); return timers.length; } return real(fn, ms, ...rest); });
  view.controller.setForm({ from: 'METRO-101' }); await flushView(); await flushView();
  const first = ctx.calls.length;
  assert.ok(first >= 1);
  assert.ok(timers.length >= 1, 'a 3000 ms refresh is scheduled after the first board');
  const status = root.querySelector('.metro-board-status');
  const board = root.querySelector('.board-host');
  timers.at(-1).fn(); // background refresh
  assert.equal(status.textContent, '', 'no progress text during a background refresh');
  assert.equal(board.getAttribute('aria-busy'), 'false', 'board never goes busy for a background refresh');
  await flushView();
  assert.equal(ctx.calls.length, first + 1);
  assert.ok(timers.length >= 2, 'and the next one is scheduled');
  const manual = buttons(root.querySelector('.metro-board-actions')).find(b => b.textContent === 'تازه سازی تابلو');
  manual.dispatch('click');
  assert.match(status.textContent, /در حال دریافت/, 'a manual refresh does show progress');
  await flushView();
});
