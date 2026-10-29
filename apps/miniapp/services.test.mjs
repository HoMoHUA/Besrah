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

test('the three real services are the large tiles; the planned ones fill the small row', () => {
  const { primary, secondary, moreCount, more } = homeLayout(SERVICES);
  assert.deepEqual(primary.map(s => s.id), ['metro1', 'nearest', 'stations']);
  assert.deepEqual(secondary.map(s => s.id), ['line2', 'bus', 'route']);
  assert.equal(moreCount, SERVICES.filter(s => s.status === 'soon').length - 3);
  assert.equal(more.length, moreCount);
  assert.ok(moreCount > 0);
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
