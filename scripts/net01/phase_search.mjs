// Offline phase search for an ASSUMED (never measured) A window of the normal-day overlay.
// Objective, lexicographic: (1) Vakilabad A/B origin separation must exceed the overlay guard; (2) fewest A/B passes within
// 120 s over ALL stations and BOTH directions; (3) largest smallest separation; (4) smallest phase. 5 s resolution.
// Usage: node phase_search.mjs <repo-root> [am|late]. Evidence only: the chosen value is written into the overlay JSON by hand.
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const L = async n => import(pathToFileURL(`${root}/packages/core/dist/${n}.js`).href);
const [engine, network, time, tt] = await Promise.all(['engine', 'network', 'time', 'timetable-overlay'].map(L));
const net = network.loadNetwork(), mid = time.tehranToEpoch('2026-11-04', '00:00:00');
const model = tt.createTimetableModel({ warn: () => {} });
const base = model.scheduleFor('normal');
const sec = hm => { const [h, m] = hm.split(':').map(Number); return h * 3600 + m * 60; };
const win = process.argv[3]==='late' ? { from: sec('20:27')+1, to: sec('22:00') } : { from: sec('06:00'), to: sec('11:55') };
const GRID = process.argv[3]==='late' ? 600 : 900;
const keep = base.fixed.A.filter(a => a.s < win.from || a.s >= win.to);
function minSep(Alist, scope) {
  const originGuard = base.fixed.B.length ? 90 : 0;
  const sched = { ...base, fixed: { A: Alist.map(s => ({ s, confidence: 'site_headway_assumed_phase', window: 'x' })), B: base.fixed.B } };
  const trains = engine.dayTrains(network.forDay(net, 'normal'), mid, 'normal', sched);
  const by = new Map();
  for (const t of trains) for (const s of t.stops) { const k = s.name + '|' + t.direction; (by.get(k) ?? by.set(k, []).get(k)).push({ s: s.arrive - mid, svc: t.service, dep: t.stops[0].depart - mid }); }
  let best = Infinity, count90 = 0, count120 = 0, originMin = Infinity;
  for (const l of by.values()) { l.sort((a, b) => a.s - b.s); for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) { const d = l[j].s - l[i].s; if (d > 600) break; if (l[i].svc === l[j].svc) continue; if (l[i].s === l[j].s && false) continue; const inScope = [l[i], l[j]].some(x => x.svc === 'A' && x.dep >= scope[0] && x.dep < scope[1]); if (!inScope) continue; best = Math.min(best, d); if (d <= 90) count90++; if (d <= 120) count120++; } }
  for (const a of Alist) for (const b of base.fixed.B) originMin = Math.min(originMin, Math.abs(a - b.s));
  return { minSep: best, pairs90: count90, pairs120: count120, originMin };
}
const results = [];
const t0 = Date.now();
for (let p = 0; p < GRID; p += 5) {
  const A = [...keep.map(a => a.s)];
  for (let t = win.from + (((p - win.from) % GRID) + GRID) % GRID; t < win.to; t += GRID) A.push(t);
  results.push({ p, ...minSep(A.sort((a, b) => a - b), [win.from, win.to]) });
}
const feasible = results.filter(r => r.originMin > 90);
feasible.sort((a, b) => a.pairs120 - b.pairs120 || b.minSep - a.minSep || a.p - b.p);
const cur = results.find(r => r.p === (process.argv[3]==='late' ? 420 : 270));
console.log(JSON.stringify({ ms: Date.now() - t0, current_p270: cur, feasibleCount: feasible.length, best5: feasible.slice(0, 5), worstFeasible: feasible.at(-1) }));
