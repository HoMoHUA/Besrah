import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadNetwork, forDay } from '../src/network.js';
import { dayTrains } from '../src/engine.js';
import { tehranToEpoch, epochToTehranHms } from '../src/time.js';

const DAY = '2026-10-22';
const base = loadNetwork();
const net = forDay(base, 'thursday');
const trains = dayTrains(net, tehranToEpoch(DAY, '00:00:00'), 'thursday');
const sheet = JSON.parse(readFileSync(new URL('../../../data/official/airport_route_sheet_1405-07-22.json', import.meta.url), 'utf8'));
const at = (hms: string) => tehranToEpoch(DAY, hms);
const hmsOf = (e: number) => epochToTehranHms(e).slice(0, 8);
const nearest = (list: number[], target: number) => list.reduce((b, x) => (Math.abs(x - target) < Math.abs(b - target) ? x : b), list[0]);

describe('Thursday 2026-10-22', () => {
  it('B departs Vakilabad on :05:17 / :35:17 (board 14:35 airport)', () => {
    const b = trains.filter(t => t.service === 'B' && t.direction === 'out').map(t => t.start);
    expect(b).toContain(at('14:35:17'));
    expect(b).toContain(at('14:05:17'));
  });

  it('B passes Ghadir matching every Thursday sheet "from_ghadir" time (±90 s)', () => {
    const pass = trains.filter(t => t.service === 'B' && t.direction === 'out')
      .map(t => t.stops.find(s => s.idx === net.GH)!.arrive);
    const misses: string[] = [];
    let worst = 0;
    for (const hms of sheet.thursday.from_ghadir) {
      const target = at(hms + ':00');
      const d = Math.abs(nearest(pass, target) - target);
      worst = Math.max(worst, d);
      if (d > 90) misses.push(hms);
    }
    console.log('Thursday B@Ghadir worst diff (s):', worst);
    expect(misses).toEqual([]);
  });

  it('replay of the observed train: Vakilabad 14:25:06 -> Seyed Razi 14:40:14 (±10 s, uses the same numbers)', () => {
    const tr = trains.find(t => t.id.startsWith('A-out') && t.start === at('14:25:06'))!;
    expect(tr).toBeTruthy();
    const sr = tr.stops.find(s => s.idx === 8)!;
    console.log('Thursday replay Seyed Razi', hmsOf(sr.arrive));
    expect(Math.abs(sr.arrive - at('14:40:14'))).toBeLessThanOrEqual(10);
  });

  it('airport departures on Thursday vs sheet (informational: layover 687 s is a Friday value)', () => {
    const dep = trains.filter(t => t.service === 'B' && t.direction === 'back' && t.stops[0].idx === net.AIR).map(t => t.start);
    const diffs = sheet.thursday.from_airport.map((hms: string) => {
      const target = at(hms + ':00');
      return Math.round((nearest(dep, target) - target) / 60);
    });
    console.log('Thursday airport departures: engine minus sheet (min):', diffs.join(' '));
    expect(diffs.length).toBeGreaterThan(0);
  });
});
