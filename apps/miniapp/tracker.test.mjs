import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, etaText } from './ui/tracker.js';

test('a dwelling train stays put; a running train advances at its timetable rate and stops at the next station', () => {
  assert.equal(advance({ state: 'dwelling', pos: 4, rate: 0, until_s: 20 }, 15), 4);
  assert.equal(advance({ state: 'running', pos: 3.5, rate: 0.01, until_s: 30 }, 20), 3.7);
  assert.equal(advance({ state: 'running', pos: 3.5, rate: 0.01, until_s: 30 }, 90), 3.8);
  assert.equal(advance({ state: 'running', pos: 3.5, rate: -0.01, until_s: 30 }, 20), 3.3);
  assert.equal(advance({ state: 'running', pos: 3.5, rate: 0.01, until_s: 30 }, -5), 3.5);
});

test('arrival text never claims precision below a minute', () => {
  assert.equal(etaText(10), 'کمتر از یک دقیقه');
  assert.equal(etaText(44), 'کمتر از یک دقیقه');
  assert.equal(etaText(46), 'حدود ۱ دقیقه');
  assert.equal(etaText(125), 'حدود ۳ دقیقه');
});
