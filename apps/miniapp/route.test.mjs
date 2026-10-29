import test from 'node:test';
import assert from 'node:assert/strict';
import { spine, neighbours, positionLabel, routeRows } from './route.js';

const order = ['الف', 'ب', 'ج', 'د', 'ه', 'و', 'ز'];

test('spine shows two stations each side with the station highlighted', () => {
  const s = spine(order, 'د');
  assert.deepEqual(s.items.map(i => [i.name, i.offset]), [['ب', -2], ['ج', -1], ['د', 0], ['ه', 1], ['و', 2]]);
  assert.equal(s.index, 3); assert.equal(s.total, 7);
  assert.deepEqual([s.hasBefore, s.hasAfter], [true, true]);
});

test('spine clips at the terminals and says so', () => {
  const first = spine(order, 'الف');
  assert.deepEqual(first.items.map(i => i.name), ['الف', 'ب', 'ج']);
  assert.deepEqual([first.hasBefore, first.hasAfter, first.items[0].terminal], [false, true, 'first']);
  const last = spine(order, 'ز');
  assert.deepEqual(last.items.map(i => i.name), ['ه', 'و', 'ز']);
  assert.deepEqual([last.hasBefore, last.hasAfter, last.items.at(-1).terminal], [true, false, 'last']);
});

test('unknown stations have no spine', () => {
  assert.equal(spine(order, 'x'), null);
  assert.equal(neighbours(order, 'x'), null);
});

test('neighbours and position label', () => {
  assert.deepEqual(neighbours(order, 'د'), { prev: 'ج', next: 'ه' });
  assert.deepEqual(neighbours(order, 'الف'), { prev: null, next: 'ب' });
  assert.equal(positionLabel(order, 'د'), 'ایستگاه ۴ از ۷');
  assert.equal(positionLabel(order, 'x'), '');
});

test('route rows carry order, terminals and interchange flags from real station data', () => {
  const stations = order.map(name => ({ name, lines: name === 'ج' ? [1, 2] : [1] }));
  const rows = routeRows(order, stations);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows[0], { name: 'الف', position: 1, terminal: 'first', interchange: false });
  assert.equal(rows[2].interchange, true);
  assert.equal(rows[6].terminal, 'last');
  assert.deepEqual(routeRows(['الف', 'نامعلوم'], stations).map(r => r.name), ['الف']);
});

test('route rows on line 2 flag interchanges against line 2, not line 1', () => {
  const stations = [{ name: 'الف', lines: [2] }, { name: 'ب', lines: [1, 2] }, { name: 'ج', lines: [2, 3] }];
  const rows = routeRows(['الف', 'ب', 'ج'], stations, 2);
  assert.deepEqual(rows.map(r => r.interchange), [false, true, true]);
  assert.equal(routeRows(['الف', 'ب'], stations).find(r => r.name === 'الف').interchange, true, 'default line is 1');
});
