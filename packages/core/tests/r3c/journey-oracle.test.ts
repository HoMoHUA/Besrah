// R3-C: independent oracle for the served journey answers (stop order, wait time, service-day crossing) on the extended NET01 model.
// The expected values are recomputed straight from engine trains; the planner and the DTO layer are not reused.
import { describe, expect, it } from 'vitest';
import { dayTrains } from '../../src/engine.js';
import { forDay, loadNetwork } from '../../src/network.js';
import { buildServer } from '../../src/server.js';
import { tehranDay, tehranToEpoch } from '../../src/time.js';
import { createTimetableModel } from '../../src/timetable-overlay.js';
import { tripEventId } from '../../src/timetable-registry.js';
import { createModelSource } from '../../src/transit-journey/index.js';
import { at, betaOn, DA, H7, q } from '../journey-beta/helpers.js';

const net = loadNetwork();
const model = createTimetableModel({ warn: () => undefined });
const source = createModelSource(undefined, { timetable: model });
const nameOf = (id: string) => source.catalog.stations.find(s => s.id === id)!.name;
const DAY = '2026-11-04'; // a Wednesday: a normal day
const nextDay = (d: string) => tehranDay(tehranToEpoch(d, '12:00:00') + 86_400);
const trainsOf = (d: string) => dayTrains(forDay(net, 'normal'), tehranToEpoch(d, '00:00:00'), 'normal', model.scheduleFor('normal')).map(t => ({ ...t, day: d }));
const allTrains = [...trainsOf(DAY), ...trainsOf(nextDay(DAY))];

function expected(from: string, to: string, readyEpoch: number) {
  const out: Array<{ dep: number; arr: number; day: string; id: string }> = [];
  for (const t of allTrains) {
    const i = t.stops.findIndex(s => s.name === nameOf(from)), j = t.stops.findIndex(s => s.name === nameOf(to));
    if (i < 0 || j < 0 || i >= j) continue;
    if (t.stops[i].depart < readyEpoch) continue;
    out.push({ dep: Math.floor(t.stops[i].depart), arr: Math.floor(t.stops[j].arrive), day: t.day, id: t.id });
  }
  return out.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
}

const READY = ['05:50', '06:00', '08:30', '12:00', '15:45', '19:31', '20:10', '21:30', '21:58', '22:10', '23:40'];
describe('[modeled] served journey answers equal an independent recomputation', () => {
  const NOW = at(DAY, '05:00:00');
  const app = buildServer({ now: () => NOW, journeyBeta: betaOn({ calendarMode: 'weekday_baseline' }), limiterClock: (() => { let tick = 0; return () => (tick += 120_000); })(), timetable: model, journeySource: source });
  for (const [from, to, label] of [[H7, DA, 'toward Ghadir/Airport'], [DA, H7, 'toward Vakilabad']] as const) {
    it(`${label}: departures, arrivals, waits and event ids match for ${READY.length} ready times`, async () => {
      let compared = 0;
      for (const hm of READY) {
        const ready = tehranToEpoch(DAY, `${hm}:00`);
        const res = await app.inject({ method: 'GET', url: q({ line: '1', from, to, date: DAY, time: hm }) });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        const want = expected(from, to, ready);
        const got = body.options as Array<{ departEpoch: number; arriveEpoch: number; waitSeconds: number; departDate: string; eventId: string }>;
        if (!got.length) { expect(want.filter(w => w.dep - ready <= 3 * 3600).length, `no option at ${hm} but oracle found trains`).toBe(0); continue; }
        // The first served option is the earliest departure the oracle finds; later ones are in the oracle's order.
        expect(got[0].departEpoch, hm).toBe(want[0].dep);
        expect(got[0].arriveEpoch, hm).toBe(want[0].arr);
        expect(got[0].waitSeconds, hm).toBe(Math.max(0, Math.round(want[0].dep - ready)));
        expect(got.map(g => g.departEpoch), hm).toEqual(want.slice(0, got.length).map(w => w.dep).filter((_, i) => i < got.length));
        for (let k = 0; k < got.length; k++) {
          expect(got[k].departDate).toBe(tehranDay(got[k].departEpoch));
          expect(got[k].arriveEpoch).toBeGreaterThan(got[k].departEpoch); // stop order: destination is reached after boarding
          expect(got[k].eventId).toBe(tripEventId(model.identityVersion, want[k].day, 1, want[k].id));
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(20);
    });
  }
  it('a ready time after the last train rolls to the next Tehran service day without inventing a same-day train', async () => {
    const res = await app.inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA, date: DAY, time: '23:40' }) });
    const options = res.json().options as Array<{ departDate: string; departEpoch: number }>;
    if (options.length) {
      expect(options.every(o => o.departDate === nextDay(DAY))).toBe(true);
      expect(options[0].departEpoch).toBeGreaterThanOrEqual(tehranToEpoch(nextDay(DAY), '06:00:00'));
    } else {
      expect(res.json().status).not.toBe('ok');
    }
  });
});
