#!/usr/bin/env node
// Read-only replay of a built Besrah runtime tree (any root with packages/core/dist). Never writes inside <root>.
// Usage: node scripts/net01/replay.mjs --root <dir> --label <name> --out <file.json>
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const arg = name => { const m = process.argv.find(a => a.startsWith(`--${name}=`)); return m ? m.slice(name.length + 3) : null; };
const root = resolve(arg('root') ?? '.'), label = arg('label') ?? 'unlabeled', out = arg('out');
const load = async name => import(pathToFileURL(`${root}/packages/core/dist/${name}.js`));
const [service, time, network] = await Promise.all([load('service'), load('time'), load('network')]);
// --overlay=on builds the validated overlay model exactly like the product wiring (server.ts); off/absent = baseline generator.
let timetable;
if (arg('overlay') === 'on') {
  const mod = await load('timetable-overlay');
  timetable = mod.createTimetableModel({ rootDir: root + '/', overlayPath: pathToFileURL(`${root}/data/timetable/normal-day-overlay-v1.json`) });
  if (timetable.status.state !== 'applied') throw new Error('overlay requested but not applied: ' + timetable.status.reason);
}
const svc = service.createService(undefined, undefined, timetable);
const midnight = d => time.tehranToEpoch(d, '00:00:00');
const hms = (epoch) => time.epochToTehranHms(epoch);
const sec = hm => { const [h, m, s = 0] = hm.split(':').map(Number); return h * 3600 + m * 60 + s; };

function originDepartures(date) {
  const at = midnight(date) + 12 * 3600;
  const { trains, type } = svc.trainsFor(at);
  const rows = trains.filter(t => t.direction === 'out').map(t => ({
    trainId: t.id, service: t.service, depart: hms(t.stops[0].depart), departSec: t.stops[0].depart - midnight(date),
    confidence: t.confidence, eventId: t.eventId ?? null,
  })).sort((a, b) => a.departSec - b.departSec || a.service.localeCompare(b.service));
  return { type, rows };
}
function collisions(rows, guard) {
  const out = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const d = rows[j].departSec - rows[i].departSec;
    if (d > guard) break;
    if (rows[i].service !== rows[j].service) out.push({ a: rows[i].depart, aService: rows[i].service, b: rows[j].depart, bService: rows[j].service, deltaSeconds: d,
      aConfidence: rows[i].confidence, bConfidence: rows[j].confidence });
  }
  return out;
}
const scenarios = [
  { id: 'S01', date: '2026-11-03', note: 'Tuesday normal day; full-day Vakilabad departures' },
  { id: 'S02', date: '2026-11-04', note: 'Wednesday normal day (today in the owner timeline)' },
  { id: 'S03', date: '2026-11-01', note: 'Sunday normal day (field day for the crossing observation)' },
  { id: 'S04', date: '2026-10-22', note: 'Thursday (existing measured B phase)' },
  { id: 'S05', date: '2026-10-16', note: 'Friday (golden-tested)' },
  { id: 'S06', date: '2026-11-07', note: 'Saturday normal day' },
];
const result = { label, root, overlay: timetable ? timetable.status : null, generatedBy: 'scripts/net01/replay.mjs', deterministic: true, departures: [], boards: [], positions: [] };
for (const s of scenarios) {
  const { type, rows } = originDepartures(s.date);
  const A = rows.filter(r => r.service === 'A'), B = rows.filter(r => r.service === 'B');
  result.departures.push({ ...s, dayType: type, countA: A.length, countB: B.length,
    exactCollisions: collisions(rows, 0).length, collisionsLe90: collisions(rows, 90), collisionsLe120: collisions(rows, 120).length,
    morning: rows.filter(r => r.departSec >= sec('05:55') && r.departSec <= sec('07:20')).map(r => `${r.depart} ${r.service} ${r.confidence}`),
    noon: rows.filter(r => r.departSec >= sec('11:30') && r.departSec <= sec('12:50')).map(r => `${r.depart} ${r.service} ${r.confidence}`),
    evening: rows.filter(r => r.departSec >= sec('18:50') && r.departSec <= sec('20:35')).map(r => `${r.depart} ${r.service} ${r.confidence}`),
    digest: createHash('sha256').update(JSON.stringify(rows.map(r => [r.service, r.departSec]))).digest('hex').slice(0, 16),
    all: rows.map(r => [r.depart, r.service]) });
}
const boardSpecs = [
  ['2026-11-03', 'وکیل‌آباد', '05:58:00'], ['2026-11-03', 'وکیل‌آباد', '06:29:30'], ['2026-11-03', 'وکیل‌آباد', '06:59:30'],
  ['2026-11-03', 'هفت‌تیر', '06:12:00'], ['2026-11-03', 'هفت‌تیر', '10:12:00'], ['2026-11-03', 'کوثر', '19:25:00'],
  ['2026-11-03', 'دانش‌آموز', '20:00:00'], ['2026-11-04', 'هفت‌تیر', '09:55:00'], ['2026-10-22', 'کوثر', '14:20:00'], ['2026-10-16', 'غدیر', '14:30:00'],
];
for (const [date, station, hm] of boardSpecs) {
  const at = midnight(date) + sec(hm);
  const r = svc.next(station, at, 10, 1);
  result.boards.push({ date, station, at: hm, dayType: r.day_type, passes: r.passes.map(p => ({ toward: p.toward, service: p.service, dir: p.direction, arrive: p.arrive, etaMin: p.eta_min, confidence: p.confidence, eventId: p.event_id ?? null })) });
}
for (const [date, line, hm] of [['2026-11-03', 1, '06:00:30'], ['2026-11-03', 1, '06:30:00'], ['2026-11-04', 1, '07:00:00'], ['2026-11-03', 1, '19:31:30'], ['2026-11-03', 2, '10:00:00']]) {
  const at = midnight(date) + sec(hm);
  const r = svc.positions(line, at);
  result.positions.push({ date, line, at: hm, trains: r.trains.map(t => ({ id: t.id, service: t.service, toward: t.toward, pos: t.pos, state: t.state, eventId: t.event_id ?? null })) });
}
const text = JSON.stringify(result, null, 1);
if (out) writeFileSync(out, text + '\n'); else process.stdout.write(text + '\n');
console.error(`${label}: ${result.departures.map(d => `${d.id}:${d.countA}A/${d.countB}B exact=${d.exactCollisions}`).join(' ')}`);
