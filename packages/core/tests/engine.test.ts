import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadNetwork } from '../src/network.js';
import { dayTrains, nextPasses } from '../src/engine.js';
import { tehranToEpoch, epochToTehranHms } from '../src/time.js';

const DAY = '2026-10-16';
const net = loadNetwork();
const trains = dayTrains(net, tehranToEpoch(DAY, '00:00:00'));
const sheet = JSON.parse(readFileSync(new URL('../../../data/official/airport_route_sheet_1405-07-22.json', import.meta.url), 'utf8'));
const at = (hms: string) => tehranToEpoch(DAY, hms);
const hmsOf = (e: number) => epochToTehranHms(e).slice(0, 8);
const diffS = (a: number, b: number) => Math.abs(a - b);

function stopAt(tr: { stops: { idx: number; arrive: number; depart: number }[] }, idx: number) {
  return tr.stops.find(s => s.idx === idx);
}

describe('line 1 Friday, golden from field data (2026-10-16)', () => {
  const idxShariati = net.stationsOrder.indexOf('شریعتی');

  it('service A from Vakilabad 13:59:51 passes Shariati ~14:29:44 and reaches Ghadir ~14:40:34', () => {
    const tr = trains.find(t => t.id.startsWith('A-out') && t.start === at('13:59:51'))!;
    expect(tr).toBeTruthy();
    const sh = stopAt(tr, idxShariati)!;
    const gh = stopAt(tr, net.GH)!;
    console.log('A Shariati', hmsOf(sh.arrive), 'Ghadir', hmsOf(gh.arrive));
    expect(diffS(sh.arrive, at('14:29:44'))).toBeLessThanOrEqual(30);
    expect(diffS(gh.arrive, at('14:40:34'))).toBeLessThanOrEqual(30);
  });

  it('service A return leaves Ghadir ~14:47:57 (anchor)', () => {
    const back = trains.find(t => t.id.startsWith('A-back') && t.stops[0].idx === net.GH && diffS(t.start, at('14:47:57')) < 120);
    expect(back).toBeTruthy();
    console.log('A return from Ghadir', hmsOf(back!.start));
    expect(diffS(back!.start, at('14:47:57'))).toBeLessThanOrEqual(30);
  });

  it('service B passes Ghadir matching every sheet "from_ghadir" time (±90 s)', () => {
    const gh = net.GH;
    const bPasses = trains
      .filter(t => t.service === 'B' && t.direction === 'out')
      .map(t => stopAt(t, gh)!.arrive)
      .sort((a, b) => a - b);
    let worst = 0;
    const misses: string[] = [];
    for (const hms of sheet.friday.from_ghadir) {
      const target = at(hms + ':00');
      const near = bPasses.reduce((best, x) => (diffS(x, target) < diffS(best, target) ? x : best), bPasses[0]);
      const d = diffS(near, target);
      worst = Math.max(worst, d);
      if (d > 90) misses.push(`${hms} -> engine ${hmsOf(near)} (${d}s)`);
    }
    console.log('B@Ghadir worst diff (s):', worst, misses);
    expect(misses).toEqual([]);
  });

  it('service B leaves the airport at the sheet "from_airport" times (±90 s)', () => {
    const air = net.AIR;
    const dep = trains
      .filter(t => t.service === 'B' && t.direction === 'back' && t.stops[0].idx === air)
      .map(t => t.start)
      .sort((a, b) => a - b);
    const misses: string[] = [];
    let worst = 0;
    for (const hms of sheet.friday.from_airport) {
      const target = at(hms + ':00');
      const near = dep.reduce((best, x) => (diffS(x, target) < diffS(best, target) ? x : best), dep[0]);
      const d = diffS(near, target);
      worst = Math.max(worst, d);
      if (d > 90) misses.push(`${hms} -> engine ${hmsOf(near)} (${d}s)`);
    }
    console.log('B from airport worst diff (s):', worst, misses);
    expect(misses).toEqual([]);
  });

  it('nextPasses at Shariati after 14:00 returns trains in time order with positive ETA', () => {
    const list = nextPasses(net, trains, 'شریعتی', at('14:00:00'), 5);
    expect(list.length).toBe(5);
    for (let i = 1; i < list.length; i++) expect(list[i].arrive).toBeGreaterThanOrEqual(list[i - 1].arrive);
    expect(list.every(p => p.etaSeconds >= 0)).toBe(true);
    console.log('next at شریعتی after 14:00:', list.map(p => `${p.service}${p.direction} ${hmsOf(p.arrive)} (${Math.round(p.etaSeconds / 60)} min)`));
  });
});
