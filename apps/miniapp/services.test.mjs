import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES, homeLayout, isLive } from './services.js';

test('only built services have an action; unbuilt ones can never open a screen', () => {
  for (const s of SERVICES) {
    if (s.status === 'live') assert.ok(s.action && s.action.type, s.id);
    else { assert.equal(s.status, 'soon', s.id); assert.equal(s.action, undefined, s.id); assert.equal(isLive(s), false); }
  }
  assert.equal(new Set(SERVICES.map(s => s.id)).size, SERVICES.length);
});

test('both metro lines and the locator are the large tiles; the rest fills the small row', () => {
  const { primary, secondary, moreCount, more } = homeLayout(SERVICES);
  assert.deepEqual(primary.map(s => s.id), ['metro1', 'metro2', 'nearest']);
  assert.deepEqual(secondary.map(s => s.id), ['stations', 'bus', 'route']);
  assert.equal(moreCount, SERVICES.length - 6);
  assert.equal(more.length, moreCount);
  assert.ok(moreCount > 0);
  assert.equal([...primary, ...secondary, ...more].length, SERVICES.length, 'every service is reachable from the home layout');
});

test('line 2 is a live service that opens the line 2 route list', () => {
  const line2 = SERVICES.find(s => s.id === 'metro2');
  assert.equal(line2.status, 'live');
  assert.deepEqual(line2.action, { type: 'view', view: 'stations', mode: 'line2' });
  assert.equal(SERVICES.some(s => s.id === 'line2'), false, 'the old «soon» tile is gone');
  assert.match(line2.blurb, /فاز/, 'the blurb says plainly that the phase is not measured');
});

test('every planned item states plainly that it is not built and gives no date', () => {
  for (const s of SERVICES.filter(x => x.status === 'soon')) {
    assert.match(s.blurb, /هنوز ساخته نشده/);
    assert.equal(/\d|[۰-۹]/.test(s.blurb.replace('خط ۲', '')), false, 'no invented dates or numbers: ' + s.id);
  }
});

test('nothing resembling a payment, discount or account feature is offered', () => {
  const text = JSON.stringify(SERVICES);
  for (const word of ['تخفیف', 'پرداخت', 'قیمت', 'حساب کاربری', 'ورود']) assert.equal(text.includes(word), false, word);
});
