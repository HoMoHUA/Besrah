// Serpentine line geometry: stations, continuity of the ride path, and that drawn pieces match the path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSerpentine, perRowFor, PITCH, TOP, SIDE, TURN_R, STATION_INSET } from './ui/tracker.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('rows alternate direction; the first row starts at the right edge, as Persian reads', () => {
  const g = buildSerpentine({ count: 24, width: 358 });
  assert.equal(g.perRow, 4);
  assert.equal(g.rowsCount, 6);
  assert.equal(buildSerpentine({ count: 24, width: 326 }).perRow, 4, 'a 390 px phone: 4 stations per row');
  const xs = i => g.stations[i].x;
  assert.ok(xs(0) > xs(1) && xs(1) > xs(2) && xs(2) > xs(3), 'row 0 runs right to left');
  assert.ok(xs(4) < xs(5) && xs(5) < xs(6) && xs(6) < xs(7), 'row 1 runs left to right');
  assert.equal(g.stations[0].y, TOP);
  assert.equal(g.stations[4].y, TOP + PITCH);
  assert.ok(near(xs(0), 358 - STATION_INSET) && near(xs(3), STATION_INSET));
  assert.ok(near(xs(4), STATION_INSET), 'a row starts under the station where the previous one ended');
});

test('the ride path passes through every station, is continuous and increases with the station number', () => {
  const g = buildSerpentine({ count: 24, width: 358 });
  g.stations.forEach(s => {
    const p = g.pointAt(g.lengthAt(s.i));
    assert.ok(near(p.x, s.x, 1e-6) && near(p.y, s.y, 1e-6), `station ${s.i}`);
  });
  for (let i = 1; i < g.S.length; i++) assert.ok(g.S[i] > g.S[i - 1]);
  let prev = g.pointAt(0);
  for (let s = 1; s <= g.total; s += 1) {
    const p = g.pointAt(s);
    const step = Math.hypot(p.x - prev.x, p.y - prev.y);
    assert.ok(step <= 1.0001, `jump of ${step.toFixed(3)} px at s=${s}`);
    prev = p;
  }
});

test('a U-turn is a quarter circle, a vertical run and a quarter circle', () => {
  const g = buildSerpentine({ count: 8, width: 358 });
  const a = g.stations[3], b = g.stations[4];
  const through = g.S[4] - g.S[3];
  const expected = (a.x - (SIDE + TURN_R)) + Math.PI * TURN_R + (PITCH - 2 * TURN_R) + (b.x - (SIDE + TURN_R));
  assert.ok(near(through, expected, 1e-6), `${through} vs ${expected}`);
  // halfway through the turn the train is on the vertical run, at the left edge, between the two rows
  const mid = g.pointAt((g.S[3] + g.S[4]) / 2);
  assert.ok(near(mid.x, SIDE, 1e-6));
  assert.ok(mid.y > a.y && mid.y < b.y);
  // heading: left along row 0, down on the turn, right along row 1
  assert.ok(near(Math.abs(g.pointAt(g.S[3] - 20).ang), Math.PI), 'moving left');
  assert.ok(near(mid.ang, Math.PI / 2), 'moving down');
  assert.ok(near(g.pointAt(g.S[4] + 20).ang, 0), 'moving right');
});

test('drawn pieces cover the path: one segment per row, one U-turn per row change, on the same centre lines', () => {
  const g = buildSerpentine({ count: 13, width: 358 });
  assert.equal(g.rows.length, g.rowsCount);
  assert.equal(g.turns.length, g.rowsCount - 1);
  assert.deepEqual(g.turns.map(t => t.side), ['left', 'right', 'left']);
  g.rows.forEach((r, k) => assert.equal(r.y, TOP + k * PITCH));
  // every station lies inside its row segment
  g.stations.forEach(s => assert.ok(s.x >= g.rows[s.row].x1 - 1e-6 && s.x <= g.rows[s.row].x2 + 1e-6, `station ${s.i}`));
  // a turn box starts where the row segment ends
  assert.ok(near(g.turns[0].x, SIDE - 4) && near(g.turns[0].w, TURN_R + 4), 'left turn: outer edge 4 px outside the centre line of its vertical run');
  assert.ok(near(g.turns[1].x + g.turns[1].w, 358 - SIDE + 4), 'right turn mirrors it');
  assert.equal(g.turns[0].h, PITCH);
  assert.equal(g.height > g.stations.at(-1).y, true);
});

test('the number of stations per row follows the width, never fewer than 3 or more than 6', () => {
  assert.equal(perRowFor(300), 4, 'a 360 px phone keeps 4 per row (spacing 62)');
  assert.equal(perRowFor(326), 4);
  assert.equal(perRowFor(358), 4);
  assert.equal(perRowFor(430), 5);
  assert.equal(perRowFor(260), 3, 'a 320 px phone: spacing would drop under 60');
  const g = buildSerpentine({ count: 24, width: 300 });
  assert.ok(g.labelW >= 46 && g.labelW <= g.spacing - 6 + 1e-9, 'labels never touch their neighbours');
  assert.equal(perRowFor(900), 6);
  assert.equal(perRowFor(100), 3);
});

test('degenerate lines do not throw', () => {
  for (const count of [0, 1, 2]) {
    const g = buildSerpentine({ count, width: 340 });
    assert.equal(g.stations.length, count);
    assert.ok(Number.isFinite(g.pointAt(0).x));
    assert.equal(g.lengthAt(5) >= 0, true);
  }
});
