import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutLane, sideStep } from './ui/tracker.js';

test('same-lane collisions are separated around their estimated positions, within the map', () => {
  const placed = layoutLane([{ id: 'a', y: 120 }, { id: 'b', y: 120 }], 300);
  assert.deepEqual(placed.map(p => p.y), [95, 145]);
  assert.deepEqual(layoutLane([{ id: 'a', y: 4 }, { id: 'b', y: 4 }], 300, 50).map(p => p.y), [0, 50]);
  assert.deepEqual(layoutLane([{ id: 'a', y: 50 }, { id: 'b', y: 150 }], 300, 50).map(p => p.y), [50, 150]);
  assert.deepEqual(layoutLane([{ id: 'a', y: 255 }, { id: 'b', y: 255 }], 300, 50).map(p => p.y), [206, 256]);
  const crowded = layoutLane(Array.from({ length: 6 }, (_, i) => ({ id: String(i), y: 160 })), 294);
  assert.deepEqual(crowded.map(p => p.y), [0, 50, 100, 150, 200, 250]);
});


test('the line view is a serpentine: pins, stems, labels, turn boxes, rotating arrows, a sticky info card and a filtering legend', async () => {
  const { readFile } = await import('node:fs/promises');
  const js = await readFile(new URL('./ui/tracker.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('./app.css', import.meta.url), 'utf8');
  assert.match(js, /buildSerpentine/);
  assert.doesNotMatch(js, /trk-rail|trk-spine/);
  assert.doesNotMatch(css, /trk-rail|trk-spine|data-lane|--trk-lane|--trk-rail-x/);
  assert.match(css, /\.trk-map \{[^}]*direction: ltr/, 'geometry is LTR pixels; labels set their own RTL');
  assert.match(css, /\.trk-label \{[^}]*direction: rtl/);
  assert.match(css, /\.trk-turn\[data-side="left"\] \{ border-right: 0/);
  assert.match(css, /\.trk-turn\[data-side="right"\] \{ border-left: 0/);
  assert.match(css, /\.trk-pin \{[^}]*border-radius: 50% 50% 50% 0/);
  assert.match(css, /\.trk-train__arrow \{[^}]*rotate\(var\(--a/);
  assert.match(css, /\.trk-train \{[^}]*will-change: transform/);
  assert.match(css, /\.trk-info \{[^}]*position: sticky/);
  assert.match(css, /\.trk-st\.is-target/);
  assert.match(css, /\.trk-eta__chip\[data-state="arriving"\]/);
  assert.match(css, /\.trk-legend__item\[aria-pressed="false"\]/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{[^}]*trk-train__dot/);
});

test('trains of opposite directions step aside only where they cross, by an eased amount', () => {
  const side = sideStep([{ id: 'o', dir: 'out', y: 100 }, { id: 'b', dir: 'back', y: 110 }, { id: 'far', dir: 'out', y: 400 }, { id: 'same', dir: 'out', y: 105 }, { id: 'edge', dir: 'back', y: 400 + 35 }]);
  assert.equal(side.get('o'), 1);
  assert.equal(side.get('b'), -1);
  assert.equal(side.get('same'), 1, 'a same-direction neighbour also steps aside when an opposing train is near');
  assert.ok(side.get('far') > 0 && side.get('far') < 1, 'just inside the crossing distance: a small step');
  assert.equal(sideStep([{ id: 'a', dir: 'out', y: 0 }, { id: 'b', dir: 'back', y: 200 }]).get('a'), 0, 'clear of every opposing train: stays on the line');
});

test('two badges that step apart never touch: the step plus the distance always clears the badge size', () => {
  const BADGE = 30, STEP = 17;
  for (let dy = 0; dy < 60; dy++) {
    const side = sideStep([{ id: 'o', dir: 'out', y: 0 }, { id: 'b', dir: 'back', y: dy }]);
    const dx = (side.get('o') - side.get('b')) * STEP;
    assert.ok(dx >= BADGE || dy >= BADGE, `dy=${dy} dx=${dx}`);
  }
});
