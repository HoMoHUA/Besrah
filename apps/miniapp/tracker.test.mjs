import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, etaText, legendFor, trainKind } from './ui/tracker.js';

test('a dwelling train stays put; a running train advances at its timetable rate and stops at the next station', () => {
  assert.equal(advance({ state: 'dwelling', pos: 4, rate: 0, until_s: 20 }, 15), 4);
  assert.equal(advance({ state: 'running', pos: 3.5, rate: 0.01, until_s: 30 }, 20), 3.7);
  assert.equal(advance({ state: 'running', pos: 3.5, rate: 0.01, until_s: 30 }, 90), 3.8);
  assert.equal(advance({ state: 'running', pos: 3.5, rate: -0.01, until_s: 30 }, 20), 3.3);
  assert.equal(advance({ state: 'running', pos: 3.5, rate: 0.01, until_s: 30 }, -5), 3.5);
});

test('arrival text: arriving up to 60 s, never fewer than 2 minutes shown, no precision below a minute', () => {
  assert.equal(etaText(10), 'در حال ورود');
  assert.equal(etaText(60), 'در حال ورود');
  assert.equal(etaText(-30), 'در حال ورود');
  assert.equal(etaText(61), 'حدود ۲ دقیقه');
  assert.equal(etaText(125), 'حدود ۳ دقیقه');
});

test('train letters: A runs out to the main terminus, B to the airport branch, C is every run back', () => {
  assert.equal(trainKind({ direction: 'out', toward: 'غدیر' }), 'A');
  assert.equal(trainKind({ direction: 'out', toward: 'فرودگاه' }), 'B');
  assert.equal(trainKind({ direction: 'back', toward: 'وکیل\u200cآباد' }), 'C');
  assert.equal(trainKind({ direction: 'back', toward: 'فرودگاه' }), 'C', 'direction decides C before the destination does');
});

test('the legend names only destinations present in the data and keeps A, B, C in order', () => {
  const trains = [{ direction: 'back', toward: 'وکیل\u200cآباد' }, { direction: 'out', toward: 'فرودگاه' }, { direction: 'out', toward: 'غدیر' }];
  assert.deepEqual(legendFor(trains).map(i => i.kind), ['A', 'B', 'C']);
  assert.deepEqual(legendFor(trains).map(i => i.text), ['رفت، به سمت غدیر', 'رفت، به سمت فرودگاه', 'برگشت، به سمت وکیل\u200cآباد']);
  assert.deepEqual(legendFor([{ direction: 'out', toward: 'شهید فکوری' }, { direction: 'back', toward: 'طبرسی' }]).map(i => i.kind), ['A', 'C']);
  assert.deepEqual(legendFor([]), []);
});
