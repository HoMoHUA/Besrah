// Board ETA: on-device countdown between refreshes, "در حال ورود" up to one minute, and a hold for late trains.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installMetroDom, findAll } from './test-support/metro-dom.mjs';
import { createBoard, etaSecondsAt, GRACE_S } from './ui/board.js';

const nums = board => findAll(board.el, n => (n.className ?? '').split(' ').includes('train__num')).map(n => n.textContent);
const units = board => findAll(board.el, n => (n.className ?? '').split(' ').includes('train__unit')).map(n => n.textContent);
const pass = (arrive, extra = {}) => ({ line: 1, toward: 'غدیر', service: 'A', direction: 'out', eta_min: 9, arrive, confidence: 'site_headway_assumed_phase', event_id: `ev-${arrive}`, ...extra });

function clock(t, start = Date.parse('2026-11-04T12:00:00Z')) {
  let now = start; t.mock.method(Date, 'now', () => now);
  return { advance: s => { now += s * 1000; } };
}

test('seconds to arrival come from the server stamp and the printed time, across midnight too', () => {
  assert.equal(etaSecondsAt({ arrive: '12:02:00' }, '12:00:00', 0), 120);
  assert.equal(etaSecondsAt({ arrive: '12:02:00' }, '12:00:00', 30), 90);
  assert.equal(etaSecondsAt({ arrive: '00:01:00' }, '23:59:30', 0), 90, 'next day');
  assert.equal(etaSecondsAt({ arrive: '23:59:00' }, '00:00:30', 0), -90, 'just before midnight, board stamped after it');
  assert.equal(etaSecondsAt({ arrive: 'x' }, '12:00:00', 0), null);
});

test('2 minutes is the smallest countdown shown; up to one minute reads "در حال ورود"', t => {
  installMetroDom(t); clock(t);
  const board = createBoard();
  board.render([pass('12:00:50'), pass('12:01:55'), pass('12:03:30', { toward: 'فرودگاه', service: 'B' })], { asOf: '12:00:00' });
  assert.deepEqual(nums(board), ['در حال ورود', '۲', '۴']);
  assert.deepEqual(units(board), ['دقیقه', 'دقیقه']);
  board.clear();
});

test('the countdown runs on the device between refreshes', t => {
  installMetroDom(t); const c = clock(t);
  const board = createBoard();
  board.render([pass('12:03:30')], { asOf: '12:00:00' });
  assert.deepEqual(nums(board), ['۴']);
  c.advance(60); board.tick();
  assert.deepEqual(nums(board), ['۳']);
  c.advance(60); board.tick();
  assert.deepEqual(nums(board), ['۲']);
  c.advance(81); board.tick();
  assert.deepEqual(nums(board), ['در حال ورود'], 'never counts down to 1 or 0');
  board.clear();
});

test('a train that was about to arrive stays "در حال ورود" after it leaves the response, then goes after the grace', t => {
  installMetroDom(t); const c = clock(t);
  const board = createBoard();
  board.render([pass('12:00:50'), pass('12:09:00', { event_id: 'later' })], { asOf: '12:00:00' });
  c.advance(60); // due 10 s ago; the next response no longer lists it
  board.render([pass('12:09:00', { event_id: 'later' })], { asOf: '12:01:00' });
  assert.deepEqual(nums(board), ['در حال ورود', '۸'], 'held while late');
  c.advance(GRACE_S + 5); board.tick();
  assert.deepEqual(nums(board), ['۷'], 'dropped once the grace is over (385 s left on the other train)');
  board.clear();
});

test('a train that was far away is not held when it disappears', t => {
  installMetroDom(t); const c = clock(t);
  const board = createBoard();
  board.render([pass('12:08:00', { event_id: 'far' })], { asOf: '12:00:00' });
  c.advance(10);
  board.render([], { asOf: '12:00:10' });
  assert.deepEqual(nums(board), []);
  board.clear();
});

test('without a server clock stamp the board still follows the old whole-minute rule and starts no timer', t => {
  installMetroDom(t);
  const board = createBoard();
  board.render([pass('12:00:50', { eta_min: 1 }), pass('12:03:00', { eta_min: 3 })]);
  assert.deepEqual(nums(board), ['در حال ورود', '۳']);
  board.clear();
});
