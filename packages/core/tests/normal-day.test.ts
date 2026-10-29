import { describe, expect, it } from 'vitest';
import { loadNetwork } from '../src/network.js';
import { dayTrains, nextPasses, scheduleFor, vakilabadDepartures } from '../src/engine.js';
import { tehranToEpoch, epochToTehranHms } from '../src/time.js';

const net = loadNetwork();
const day = '2026-10-21'; // Wednesday, normal day
const sched = scheduleFor('normal');
const hm = (e: number) => epochToTehranHms(e).slice(0, 5);

describe('normal day (site headways, phase not measured)', () => {
  it('service A is every 15 min 06:00-15:30 and B is every 30 min 06:30-19:30 (site JSON)', () => {
    const A = vakilabadDepartures(day, sched, 'A').filter(e => hm(e) < '15:30').map(hm);
    const B = vakilabadDepartures(day, sched, 'B').map(hm);
    expect(A.slice(0, 4)).toEqual(['06:00', '06:15', '06:30', '06:45']);
    expect(B.slice(0, 3)).toEqual(['06:30', '07:00', '07:30']);
    expect(B[B.length - 1] < '19:31').toBe(true);
    expect(B.some(x => x > '19:30')).toBe(false);
  });

  it('peak 15:30-19:20 has 8-min combined headway (A ≈ 10.9 min when B is 30 min)', () => {
    const A = vakilabadDepartures(day, sched, 'A').map(e => epochToTehranHms(e));
    const peak = A.filter(h => h >= '15:30:00' && h < '19:20:00');
    const gaps = peak.slice(1).map((h, i) => {
      const [a, b] = [peak[i], h].map(x => x.split(':').map(Number).reduce((s, v) => s * 60 + v, 0));
      return b - a;
    });
    const avg = gaps.reduce((s, v) => s + v, 0) / gaps.length;
    expect(Math.abs(avg / 60 - 10.9)).toBeLessThan(0.2);
  });

  it('produces passes at Vakilabad and Shariati with low-confidence labels', () => {
    const trains = dayTrains(net, tehranToEpoch(day, '00:00:00'));
    const list = nextPasses(net, trains, 'شریعتی', tehranToEpoch(day, '10:00:00'), 4);
    expect(list.length).toBe(4);
    expect(list.every(p => p.confidence === 'site_headway_assumed_phase')).toBe(true);
    console.log('normal day, next at شریعتی after 10:00:', list.map(p => `${p.service}${p.direction} ${epochToTehranHms(p.arrive)}`));
  });
});
