import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, searchLines, searchStops, loopVariant } from './bus-data.js';

const data = { v: 1, meta: {}, n: ['ایستگاه الف', 'ایستگاه ب', 'ایستگاه پیروزی ۲۴'], l: [
  { r: '4', v: [{ i: 1, f: 'پایانه الهیه', t: 'پایانه امام رضا', d: 0, s: [0, 1] }] },
  { r: '50', v: [{ i: 2, f: 'حرم مطهر', t: 'پایانه شهدا', d: 0, s: [1, 2] }, { i: 3, f: 'پایانه شهدا', t: 'حرم مطهر', d: 1, s: [2, 1] }] },
  { r: 'EXP-9', v: [{ i: 4, f: 'پایانه انقلاب', t: 'پایانه انقلاب', d: 0, s: [0, 1, 0] }] },
] };

test('index keeps raw line refs, variants and repeated stop visits', () => {
  const index = buildIndex(data);
  assert.deepEqual(index.lines.map(l => l.ref), ['4', '50', 'EXP-9']);
  assert.deepEqual(index.lines[2].variants[0].stops, ['ایستگاه الف', 'ایستگاه ب', 'ایستگاه الف']);
  assert.equal(loopVariant(index.lines[2].variants[0]), true);
  assert.equal(loopVariant(index.lines[1].variants[0]), false);
  assert.equal(index.lines[1].variants[1].derived, true);
});

test('line search ranks exact ref first, accepts Persian digits and matches endpoints, never merging refs', () => {
  const index = buildIndex(data);
  assert.deepEqual(searchLines(index, '').map(l => l.ref), ['4', '50', 'EXP-9']);
  assert.deepEqual(searchLines(index, '۵۰').map(l => l.ref), ['50']);
  assert.deepEqual(searchLines(index, '4').map(l => l.ref), ['4']);
  assert.deepEqual(searchLines(index, 'حرم').map(l => l.ref), ['50']);
  assert.deepEqual(searchLines(index, 'exp-4').map(l => l.ref), []);
});

test('stop search needs two characters and lists each exact line ref once', () => {
  const index = buildIndex(data);
  assert.deepEqual(searchStops(index, 'ا'), []);
  assert.deepEqual(searchStops(index, 'پیروزی 24').map(s => [s.name, s.refs]), [['ایستگاه پیروزی ۲۴', ['50']]]);
  assert.deepEqual(searchStops(index, 'ایستگاه ب').map(s => [s.name, s.refs]), [['ایستگاه ب', ['4', '50', 'EXP-9']]]);
});
