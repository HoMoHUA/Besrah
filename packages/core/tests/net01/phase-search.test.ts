// The only A phase the overlay chooses by itself is the morning one (06:00-11:55), because it was never measured.
// It was chosen by an offline search over EVERY station and BOTH directions, not only at Vakilabad. This test re-runs that
// search against the live model, so a change of run times or of the B sheet fails here instead of silently going stale.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayTrains } from '../../src/engine.js';
import { forDay, loadNetwork } from '../../src/network.js';
import { tehranToEpoch } from '../../src/time.js';
import { createTimetableModel, DEFAULT_OVERLAY_PATH } from '../../src/timetable-overlay.js';

const net = loadNetwork(), mid = tehranToEpoch('2026-11-04', '00:00:00');
const model = createTimetableModel({ warn: () => {} });
const overlay = JSON.parse(readFileSync(DEFAULT_OVERLAY_PATH, 'utf8'));
const base = model.scheduleFor('normal');
const win = overlay.A.windows.find((w: any) => w.id === 'A-am-site-15min-assumed');
const keep = base.fixed!.A.filter(a => a.s < win.fromS || a.s >= win.toS);

function score(phase: number) {
  const A = keep.map(a => a.s);
  for (let t = win.fromS + (((phase - win.fromS) % win.gridS) + win.gridS) % win.gridS; t < win.toS; t += win.gridS) A.push(t);
  A.sort((a, b) => a - b);
  const sched = { ...base, fixed: { A: A.map(s => ({ s, confidence: 'site_headway_assumed_phase' as const, window: 'x' })), B: base.fixed!.B } };
  const trains = dayTrains(forDay(net, 'normal'), mid, 'normal', sched);
  const by = new Map<string, Array<{ s: number; svc: string; dep: number }>>();
  for (const t of trains) for (const s of t.stops) { const k = `${s.name}|${t.direction}`; (by.get(k) ?? by.set(k, []).get(k)!).push({ s: s.arrive - mid, svc: t.service, dep: t.stops[0].depart - mid }); }
  let minSep = Infinity, pairs120 = 0;
  for (const l of by.values()) { l.sort((a, b) => a.s - b.s); for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
    const d = l[j].s - l[i].s; if (d > 600) break; if (l[i].svc === l[j].svc) continue;
    if (![l[i], l[j]].some(x => x.svc === 'A' && x.dep >= win.fromS && x.dep < win.toS)) continue;
    minSep = Math.min(minSep, d); if (d <= 120) pairs120++;
  } }
  const originMin = Math.min(...A.flatMap(a => base.fixed!.B.map(b => Math.abs(a - b.s))));
  return { phase, pairs120, minSep, originMin };
}

describe('assumed morning A phase is the best available over the whole network', () => {
  const chosen = win.phase.fixedS as number;
  const all = Array.from({ length: win.gridS / 5 }, (_, i) => score(i * 5)).filter(r => r.originMin > overlay.guardS);
  all.sort((a, b) => a.pairs120 - b.pairs120 || b.minSep - a.minSep || a.phase - b.phase);
  it('the shipped phase is a fixed value (not recomputed at runtime) and sits on the 5 s search grid', () => {
    expect(typeof chosen).toBe('number');
    expect(chosen % 5).toBe(0);
  });
  it('no other phase has fewer A/B passes within 120 s over all stations and both directions', () => {
    const mine = score(chosen);
    expect(mine.originMin).toBeGreaterThan(overlay.guardS);
    expect(mine.pairs120).toBe(all[0].pairs120);
    expect(mine.minSep).toBeGreaterThanOrEqual(all[0].minSep - 0);
  });
  it('and it improves on the origin-only choice (phase 270): far fewer close pairs, far larger smallest gap', () => {
    const old = score(270), mine = score(chosen);
    expect(mine.pairs120).toBeLessThan(old.pairs120 / 2);
    expect(mine.minSep).toBeGreaterThan(old.minSep * 5);
  });
});
