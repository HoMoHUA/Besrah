import { describe, expect, it } from 'vitest';
import { loadLine2, line2Schedule, line2DayTrains, line2NextPasses } from '../src/line2.js';
import { createService } from '../src/service.js';
import { tehranToEpoch, epochToTehranHms } from '../src/time.js';

const net = loadLine2();
const SAT = '2026-10-31';   // Saturday: normal day
const THU = '2026-10-29';   // Thursday
const FRI = '2026-10-30';   // Friday
const at = (day: string, hms: string) => tehranToEpoch(day, hms);
const hms = (e: number) => epochToTehranHms(e).slice(0, 8);

describe('line 2 network', () => {
  it('has the 13 official stations in order and one run time per segment', () => {
    expect(net.order).toHaveLength(13);
    expect(net.order[0]).toBe('طبرسی');
    expect(net.order[12]).toBe('شهید فکوری');
    expect(net.order).toContain('مفتح');
    expect(net.runF).toHaveLength(12);
    expect(net.runB).toHaveLength(12);
    expect(net.runF.every(x => x > 0)).toBe(true);
  });

  it('uses the measured Shariati..Fakouri run times and tags the rest as legacy estimates', () => {
    const iShariati = net.order.indexOf('شریعتی');
    expect(net.runF[iShariati]).toBe(96);          // Shariati -> Alandasht, measured 2026-10-16
    expect(net.runQuality[iShariati]).toBe('measured_2026-10-16');
    expect(net.runB[11]).toBe(171);                // Fakouri -> Kaveh, measured backward
    expect(net.runQuality[0]).toBe('legacy_estimate');
    expect(net.runB[0]).toBe(net.runF[0]);         // no backward data: symmetric assumption
  });
});

describe('line 2 schedule', () => {
  it('Saturday-Wednesday is 10 minutes from 06:00 to 22:00 (owner decision)', () => {
    const s = line2Schedule(net, 'normal');
    expect([s.headwayS, s.startS, s.endS]).toEqual([600, 6 * 3600, 22 * 3600]);
  });
  it('Thursday keeps the site 12 minutes; Friday is 12 minutes from 07:00', () => {
    expect(line2Schedule(net, 'thursday').headwayS).toBe(720);
    const f = line2Schedule(net, 'friday');
    expect([f.headwayS, f.startS, f.endS]).toEqual([720, 7 * 3600, 22 * 3600]);
  });
});

describe('line 2 trains', () => {
  const trains = line2DayTrains(net, at(SAT, '00:00:00'), 'normal');

  it('departs both terminals every 10 minutes, so no direction has a morning gap', () => {
    const out = trains.filter(t => t.direction === 'out').map(t => t.start);
    const back = trains.filter(t => t.direction === 'back').map(t => t.start);
    expect(hms(out[0])).toBe('06:00:00');
    expect(hms(back[0])).toBe('06:00:00');
    expect(hms(out.at(-1)!)).toBe('22:00:00');
    for (const list of [out, back]) expect(list.slice(1).every((t, i) => t - list[i] === 600)).toBe(true);
  });

  it('out trains accumulate run + dwell exactly along the stops', () => {
    const t = trains.find(x => x.direction === 'out')!;
    expect(t.stops).toHaveLength(13);
    const k = 3; // Nabovat
    const expected = t.stops[k - 1].depart + net.runF[k - 1];
    expect(t.stops[k].arrive).toBe(expected);
    expect(t.stops[k].depart).toBe(expected + net.dwell[k]);
    expect(t.stops[12].depart).toBe(t.stops[12].arrive);   // terminal: the trip ends
  });

  it('back trains run from Fakouri to Tabarsi', () => {
    const t = trains.find(x => x.direction === 'back')!;
    expect(t.stops[0].idx).toBe(12);
    expect(t.stops.at(-1)!.idx).toBe(0);
  });

  it('next passes at a mid station alternate both directions every ~10 minutes', () => {
    const list = line2NextPasses(net, trains, 'سعدی', at(SAT, '10:00:00'), 6);
    expect(list).toHaveLength(6);
    const by = (d: string) => list.filter(p => p.direction === d).map(p => p.arrive);
    for (const d of ['out', 'back']) expect(by(d).slice(1).every((t, i) => t - by(d)[i] === 600)).toBe(true);
    expect(list.every(p => p.etaSeconds >= 0)).toBe(true);
  });

  it('is empty after the last service of the day and before the first', () => {
    expect(line2NextPasses(net, trains, 'سعدی', at(SAT, '23:30:00'), 4)).toEqual([]);
    expect(line2NextPasses(net, trains, 'سعدی', at(SAT, '00:10:00'), 1)[0].arrive).toBeGreaterThanOrEqual(at(SAT, '06:00:00'));
  });

  it('flags terminal arrivals', () => {
    const p = line2NextPasses(net, trains, 'شهید فکوری', at(SAT, '10:00:00'), 4);
    expect(p.some(x => x.terminalArrival && x.direction === 'out')).toBe(true);
    expect(p.some(x => !x.terminalArrival && x.direction === 'back')).toBe(true);
  });
});

describe('service with line 2', () => {
  const svc = createService();
  const sat10 = at(SAT, '10:00:00');

  it('answers a line-2-only station (previously unknown_station)', () => {
    const r = svc.next('شهید فکوری', sat10, 4);
    expect(r.station).toBe('شهید فکوری');
    expect(r.line).toBe(2);
    expect(r.passes.length).toBeGreaterThan(0);
    expect(r.passes.every(p => p.line === 2 && p.service === null)).toBe(true);
    expect(r.text).toContain('🚉 *شهید فکوری* (خط ۲)');
    expect(r.passes[0].confidence).toBe('site_headway_assumed_phase');
  });

  it('labels directions as a rider sees them', () => {
    const r = svc.next('سعدی', sat10, 6);
    expect(new Set(r.passes.map(p => p.toward))).toEqual(new Set(['شهید فکوری', 'طبرسی']));
    const end = svc.next('طبرسی', sat10, 6);
    expect(end.passes.some(p => p.toward === 'ورودی از شهید فکوری')).toBe(true);
    expect(end.passes.some(p => p.toward === 'شهید فکوری')).toBe(true);
  });

  it('explains how exact line 2 is: phase unmeasured, Tabarsi..Shariati legacy, 10 minutes by decision', () => {
    const r = svc.next('سعدی', sat10, 4);
    expect(r.notes.join(' ')).toContain('فاز');
    expect(r.notes.join(' ')).toContain('طبرسی');
  });

  it('Shariati is on both lines: default returns both, line= selects one', () => {
    const both = svc.next('شریعتی', sat10, 3);
    expect(new Set(both.passes.map(p => p.line))).toEqual(new Set([1, 2]));
    expect(both.text).toContain('🚉 *شریعتی* (خط ۱)');
    expect(both.text).toContain('🚉 *شریعتی* (خط ۲)');
    expect(both.lines).toEqual([1, 2]);
    const one = svc.next('شریعتی', sat10, 3, 1);
    expect(one.passes.every(p => p.line === 1)).toBe(true);
    expect(one.line).toBe(1);
    const two = svc.next('شریعتی', sat10, 3, 2);
    expect(two.passes.every(p => p.line === 2)).toBe(true);
    expect(two.line).toBe(2);
  });

  it('line 1 results are unchanged for line-1-only stations', () => {
    const r = svc.next('غدیر', at(FRI, '14:00:00'), 4);
    expect(r.line).toBe(1);
    expect(r.passes.every(p => p.line === 1 && (p.service === 'A' || p.service === 'B'))).toBe(true);
    expect(r.text).toContain('🚉 *غدیر* (خط ۱)');
  });

  it('rejects a station that is not on the requested line', () => {
    expect(() => svc.next('غدیر', sat10, 4, 2)).toThrow(/unknown station/);
    expect(() => svc.next('شهید فکوری', sat10, 4, 1)).toThrow(/unknown station/);
    expect(() => svc.next('نامعلوم', sat10, 4)).toThrow(/unknown station/);
  });

  it('works on Thursday and Friday for line 2', () => {
    expect(svc.next('سعدی', at(THU, '10:00:00'), 2).passes).toHaveLength(2);
    const fri = svc.next('سعدی', at(FRI, '06:30:00'), 2);   // before the 07:00 Friday start
    expect(fri.passes.every(p => p.arrive >= '07:00:00')).toBe(true);
  });
});
