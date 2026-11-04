#!/usr/bin/env node
// Deterministic lineage extract: baseline vs overlay for a normal day. Read-only. Usage: node lineage.mjs --root=<repo> --out=<file>
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3);
const root = resolve(arg('root') || '.'), out = arg('out');
const load = async n => import(pathToFileURL(`${root}/packages/core/dist/${n}.js`).href);
const [engine, network, time, tt, reg] = await Promise.all(['engine', 'network', 'time', 'timetable-overlay', 'timetable-registry'].map(load));
const net = network.loadNetwork();
const DATE = '2026-11-04'; // a Wednesday; every Sat-Wed gives the same normal-day schedule
const mid = time.tehranToEpoch(DATE, '00:00:00');
const hm = s => time.epochToTehranHms(mid + s);
const model = tt.createTimetableModel({ warn: () => {} });
if (model.status.state !== 'applied') throw new Error('overlay not applied: ' + model.status.reason);
const trainsOf = sched => engine.dayTrains(network.forDay(net, 'normal'), mid, 'normal', sched);
const base = trainsOf(undefined), over = trainsOf(model.scheduleFor('normal'));
const outs = ts => ts.filter(t => t.direction === 'out').map(t => ({ id: t.id, service: t.service, s: t.stops[0].depart - mid, confidence: t.confidence })).sort((a, b) => a.s - b.s || a.service.localeCompare(b.service));
const bo = outs(base), oo = outs(over);
const exact = [];
for (let i = 0; i < bo.length; i++) for (let j = i + 1; j < bo.length; j++) { if (bo[j].s !== bo[i].s) break; exact.push({ time: hm(bo[i].s), A: bo[i].service === 'A' ? bo[i].id : bo[j].id, B: bo[i].service === 'B' ? bo[i].id : bo[j].id, confidences: [bo[i].confidence, bo[j].confidence] }); }
const perHour = list => { const o = {}; for (const t of list) { const h = String(Math.floor(t.s / 3600)).padStart(2, '0'); (o[h] ??= { A: 0, B: 0 })[t.service]++; } return o; };
const sheet = model.overlay.sources.find(s => s.id === model.overlay.B.sourceId);
const grid8 = model.report.absorbed.map(a => ({ window: a.windowId, gridSlot: hm(a.slotS), documentedB: hm(a.documentedBS), deltaSeconds: a.deltaS }));
const bTimes = oo.filter(t => t.service === 'B');
const result = {
  schema: 'net01-model-lineage/1', serviceDate: DATE, overlayId: model.status.overlayId, overlayDigest: model.status.digest, identityVersion: model.identityVersion,
  trainCounts: { baseline: { outTrips: bo.length, A: bo.filter(t => t.service === 'A').length, B: bo.filter(t => t.service === 'B').length, allTrips: base.length },
                 overlay: { outTrips: oo.length, A: oo.filter(t => t.service === 'A').length, B: bTimes.length, allTrips: over.length } },
  baselineExactCollisions: { count: exact.length, rows: exact },
  overlayExactCollisions: tt.createTimetableModel && reg.findDepartureAnomalies(over, mid, 0).length,
  overlayAnomaliesWithin90s: reg.findDepartureAnomalies(over, mid, 90).length,
  minAbSeparationSeconds: model.report.minAbSeparationS,
  absorbedSlots: { count: grid8.length, rule: 'single 8-minute slot sequence: a grid slot within the guard of a documented B departure is that B train, not a second train', rows: grid8 },
  phaseDecisions: model.report.phaseDecisions,
  windows: model.report.perWindow,
  perHour: { baseline: perHour(bo), overlay: perHour(oo) },
  firstLast: { baseline: { first: hm(bo[0].s), last: hm(bo.at(-1).s) }, overlay: { first: hm(oo[0].s), last: hm(oo.at(-1).s) } },
  bFromSheet: { runtimeSource: sheet.path, sha256: sheet.sha256, offsetSecondsDerived: model.overlay.B.presenceToVakilabadOffsetS, rows: bTimes.map(t => hm(t.s)) },
};
if (out) writeFileSync(out, JSON.stringify(result, null, 1) + '\n'); else console.log(JSON.stringify(result, null, 1));
console.error(`baseline exact=${exact.length} overlay exact=${result.overlayExactCollisions} absorbed=${grid8.length} A ${result.trainCounts.baseline.A}->${result.trainCounts.overlay.A} B ${result.trainCounts.baseline.B}->${result.trainCounts.overlay.B}`);
