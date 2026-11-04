// Independent oracle for the overlay timetable: expected Vakilabad departures are recomputed here from the printed
// sheet and the overlay JSON with plain arithmetic (no engine, no overlay-loader code), then compared with what the
// engine actually serves. Stops, run times and back-trips must be preserved exactly.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dayTrains } from '../../src/engine.js';
import { forDay, loadNetwork } from '../../src/network.js';
import { tehranToEpoch } from '../../src/time.js';
import { createBaselineTimetable, createTimetableModel, DEFAULT_OVERLAY_PATH, REPO_ROOT } from '../../src/timetable-overlay.js';
import { tripEventId } from '../../src/timetable-registry.js';

const DATE = '2026-11-04', mid = tehranToEpoch(DATE, '00:00:00'), net = loadNetwork();
const model = createTimetableModel({ warn: () => {} });
const baseline = createBaselineTimetable();
const overlay = JSON.parse(readFileSync(DEFAULT_OVERLAY_PATH, 'utf8'));
const sheet = JSON.parse(readFileSync(fileURLToPath(new URL('data/official/kowsar_airport_poster_2026-11-03.json', REPO_ROOT)), 'utf8'));
const trainsOf = (m: typeof model) => dayTrains(forDay(net, 'normal'), mid, 'normal', m.scheduleFor('normal'));
const cand = trainsOf(model), base = trainsOf(baseline);

// ---- oracle: plain arithmetic -------------------------------------------------------------------------------------
const toSec = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 3600 + m * 60; };
const expectedB: number[] = (sheet.sat_to_wed as string[]).map(toSec).map(s => s - 18 * 60);
const guard: number = overlay.guardS;
const expectedA: number[] = [];
for (const w of overlay.A.windows) {
  let phase: number;
  if (typeof w.phase.fixedS === 'number') phase = w.phase.fixedS;
  else { // brute force: the phase whose smallest distance to any B departure is largest (first wins on ties)
    let best = 0, bestSep = -1;
    for (let p = 0; p < w.gridS; p++) {
      let sep = Infinity;
      for (let t = w.fromS + (((p - w.fromS) % w.gridS) + w.gridS) % w.gridS; w.toInclusive ? t <= w.toS : t < w.toS; t += w.gridS) for (const b of expectedB) sep = Math.min(sep, Math.abs(b - t));
      if (sep > bestSep) { bestSep = sep; best = p; }
    }
    phase = best;
  }
  for (let t = w.fromS + (((phase - w.fromS) % w.gridS) + w.gridS) % w.gridS; w.toInclusive ? t <= w.toS : t < w.toS; t += w.gridS) {
    if (t < overlay.serviceDay.startS || t > overlay.serviceDay.endS) continue;
    if (w.absorbIntoDocumentedB && expectedB.some(b => Math.abs(b - t) <= guard)) continue;
    expectedA.push(t);
  }
}
const departures = (ts: typeof cand, service: 'A' | 'B', dir: 'out' | 'back') => ts.filter(t => t.service === service && t.direction === dir).map(t => t.stops[0].depart - mid).sort((a, b) => a - b);

describe('independent oracle vs the served overlay timetable', () => {
  it('Vakilabad departures of A and B equal the independently recomputed sets, to the second', () => {
    expect(departures(cand, 'B', 'out')).toEqual([...expectedB].sort((a, b) => a - b));
    expect(departures(cand, 'A', 'out')).toEqual([...expectedA].sort((a, b) => a - b));
  });
  it('run times and stops are preserved: every overlay trip has the baseline stop template, shifted only', () => {
    for (const service of ['A', 'B'] as const) for (const dir of ['out', 'back'] as const) {
      const tmpl = (ts: typeof cand) => { const t = ts.find(x => x.service === service && x.direction === dir)!; return t.stops.map(s => [s.name, s.arrive - t.stops[0].depart, s.depart - t.stops[0].depart]); };
      expect(tmpl(cand), `${service}-${dir}`).toEqual(tmpl(base));
      for (const t of cand.filter(x => x.service === service && x.direction === dir)) expect(t.stops.map(s => s.name)).toEqual(base.find(x => x.service === service && x.direction === dir)!.stops.map(s => s.name));
    }
  });
  it('every out trip has exactly one back trip, so the day is balanced and nothing was dropped silently', () => {
    for (const service of ['A', 'B'] as const) expect(departures(cand, service, 'back')).toHaveLength(departures(cand, service, 'out').length);
    expect(cand).toHaveLength(2 * (expectedA.length + expectedB.length));
  });
  it('event ids are unique over the whole day (both directions, both services) and bound to the applied model', () => {
    const ids = cand.map(t => tripEventId(model.identityVersion, DATE, 1, t.id));
    expect(new Set(ids).size).toBe(ids.length);
    const other = cand.map(t => tripEventId(baseline.identityVersion, DATE, 1, t.id));
    expect(ids.some((id, i) => id === other[i])).toBe(false);
  });
  it('the 20 baseline exact collisions are exactly the 06:30-multiples-of-30 minute shared grid points (reconstructed independently)', () => {
    const bA = departures(base, 'A', 'out'), bB = departures(base, 'B', 'out');
    const shared = bA.filter(a => bB.includes(a));
    expect(shared).toHaveLength(20);
    expect(shared.every(s => s % 1800 === 0 && s >= toSec('06:30'))).toBe(true);
  });
});
