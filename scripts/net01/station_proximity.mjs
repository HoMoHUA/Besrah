#!/usr/bin/env node
// Station-level proximity audit: for every station and direction, find A/B pairs whose pass times are within a guard.
// Baseline vs overlay, normal day. Read-only. Usage: node station_proximity.mjs --root=<repo> --out=<file>
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3);
const root = resolve(arg('root') || '.'), out = arg('out');
const load = async n => import(pathToFileURL(`${root}/packages/core/dist/${n}.js`).href);
const [engine, network, time, tt] = await Promise.all(['engine', 'network', 'time', 'timetable-overlay'].map(load));
const net = network.loadNetwork(), DATE = '2026-11-04', mid = time.tehranToEpoch(DATE, '00:00:00');
const model = tt.createTimetableModel({ warn: () => {} });
const analyse = trains => {
  const rows = [];
  const by = new Map();
  for (const t of trains) for (const s of t.stops) {
    const key = `${s.name}|${t.direction}`;
    (by.get(key) ?? by.set(key, []).get(key)).push({ s: s.arrive - mid, service: t.service, id: t.id, conf: t.confidence });
  }
  for (const [key, list] of by) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const d = list[j].s - list[i].s; if (d > 120) break;
      if (list[i].service !== list[j].service) rows.push({ station: key.split('|')[0], direction: key.split('|')[1], a: time.epochToTehranHms(mid + list[i].s), b: time.epochToTehranHms(mid + list[j].s), gapS: d, services: `${list[i].service}/${list[j].service}`, sameMinute: time.epochToTehranHms(mid + list[i].s).slice(0, 5) === time.epochToTehranHms(mid + list[j].s).slice(0, 5) });
    }
  }
  return rows;
};
const mk = sched => engine.dayTrains(network.forDay(net, 'normal'), mid, 'normal', sched);
const base = analyse(mk(undefined)), over = analyse(mk(model.scheduleFor('normal')));
const sum = r => ({ pairsWithin120s: r.length, within90s: r.filter(x => x.gapS <= 90).length, within60s: r.filter(x => x.gapS <= 60).length, sameDisplayedMinute: r.filter(x => x.sameMinute).length, byDirection: Object.fromEntries(['out', 'back'].map(d => [d, r.filter(x => x.direction === d).length])) });
const result = { schema: 'net01-station-proximity/1', date: DATE, definition: 'A and B passes at the same station and direction at most 120 s apart', baseline: sum(base), overlay: sum(over), overlayRows: over.slice(0, 80), baselineRows: base.slice(0, 20) };
if (out) writeFileSync(out, JSON.stringify(result, null, 1) + '\n'); else console.log(JSON.stringify(result, null, 1));
console.error(JSON.stringify({ baseline: result.baseline, overlay: result.overlay }));
