import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayTrains, vakilabadDepartures, scheduleFor } from '../src/engine.js';
import { loadNetwork, forDay } from '../src/network.js';
import { buildThursdayModel, loadThursdayModel, THURSDAY_FIELD_URL, KOWSAR_SHEET_URL } from '../src/thursday-field.js';
import { createTimetableModel } from '../src/timetable-overlay.js';
import { tehranToEpoch } from '../src/time.js';

const day = '2026-11-05';
const model = createTimetableModel({ warn: () => {} });
const thu = loadThursdayModel();
const net = forDay(loadNetwork(), 'thursday');
const mid = tehranToEpoch(day, '00:00:00');
const at = (time: string) => tehranToEpoch(day, time);
const toS = (epoch: number) => epoch - mid;

describe('Thursday 2026-11-05 evidence integrated without replacing other day types', () => {
  it('carries EVERY measured run and dwell from the supplied Nov 5 field evidence into the Thursday model', () => {
    const evidence = JSON.parse(readFileSync(THURSDAY_FIELD_URL, 'utf8'));
    const raw = JSON.parse(readFileSync(new URL('../../../data/network.json', import.meta.url), 'utf8'));
    const block = raw.lines['1']['thursday_2026-11-05'];
    expect(Object.keys(block.run_forward_s)).toHaveLength(23);
    expect(Array.from({length: 23}, (_, i) => block.run_forward_s[String(i)])).toEqual(evidence.runs.forward);
    expect(block.run_backward_s).toEqual(evidence.runs.backward);
    expect(block.dwell_s).toEqual(evidence.runs.dwell);
    expect(block.layover_s.airport_arrive_to_depart).toBe(evidence.runs.layover.airport);
    expect(block.layover_s.ghadir_A_arrive_to_depart_s).toBe(evidence.runs.layover.ghadirA);
    expect(block.layover_s.ghadir_pass_B_dwell_mean).toBe(evidence.runs.layover.ghadirPassB);
  });

  it('uses the Nov 5 measured segment and layover overrides only on Thursday', () => {
    const normal = forDay(loadNetwork(), 'normal');
    const fri = forDay(loadNetwork(), 'friday');
    expect(net.runF[net.GH]).toBe(316);
    expect(net.runF[net.BUSTAN]).toBe(179);
    expect(net.runB[net.BUSTAN]).toBe(185);
    expect(net.runB[net.GH]).toBe(371);
    expect(net.layover.airport).toBe(907);
    expect(net.layover.ghadirA).toBe(216);
    expect(net.layover.ghadirPassB).toBe(33);
    expect(normal.runF[normal.GH]).not.toBe(316);
    expect(fri.layover.airport).not.toBe(907);
  });

  it('loads versioned data with one physical train departure sequence', () => {
    const schedule = model.scheduleFor('thursday');
    expect(schedule.fixed?.A.length).toBeGreaterThan(30);
    expect(schedule.fixed?.B.length).toBeGreaterThan(20);
    const depsA = vakilabadDepartures(day, schedule, 'A');
    const depsB = vakilabadDepartures(day, schedule, 'B');
    expect(depsA).toContain(at('16:55:17'));
    expect(depsB).toContain(at('15:35:17'));
    const union = [...depsA, ...depsB].sort((a, b) => a - b);
    expect(new Set(union).size).toBe(union.length);
    expect(union.slice(1).every((s, i) => s - union[i] >= 240)).toBe(true);
    expect(thu.schedule.fixed?.B.map(x => x.confidence).every(v => v === 'sheet_derived_phase')).toBe(true);
  });

  it('keeps true owner observation specific to Nov 5 and generalizes other Thursday departures', () => {
    const trains = dayTrains(net, mid, 'thursday', model.scheduleFor('thursday'));
    const owned = trains.find(x => x.direction === 'out' && x.start === at('16:55:17'));
    const other = trains.find(x => x.direction === 'out' && x.start === at('14:25:17'));
    expect(owned?.confidence).toBe('measured_phase');
    expect(other?.confidence).toBe('generalized_observation_phase');
    const future = dayTrains(net, tehranToEpoch('2026-11-12','00:00:00'), 'thursday', model.scheduleFor('thursday'));
    const futureOwned = future.find(x => x.direction === 'out' && x.start === tehranToEpoch('2026-11-12','16:55:17'));
    expect(futureOwned?.confidence).toBe('generalized_observation_phase');
  });

  it('replays the observed friend airport segment within its evidence tolerance', () => {
    const trains = dayTrains(net, mid, 'thursday', model.scheduleFor('thursday'));
    const b = trains.find(t => t.direction === 'out' && t.service === 'B' && t.start === at('15:35:17'));
    expect(b).toBeTruthy();
    const gh = b!.stops.find(x => x.idx === net.GH)!;
    const air = b!.stops.find(x => x.idx === net.AIR)!;
    expect(Math.abs(gh.arrive - at('16:15:41'))).toBeLessThanOrEqual(60);
    expect(Math.abs(air.arrive - at('16:24:53'))).toBeLessThanOrEqual(60);
  });

  it('rejects invalid overlapping/unknown evidence rather than inventing schedules', () => {
    const evidence = JSON.parse(readFileSync(THURSDAY_FIELD_URL, 'utf8'));
    const sheet = JSON.parse(readFileSync(KOWSAR_SHEET_URL, 'utf8'));
    const bad = structuredClone(evidence);
    bad.schedule.gridSeconds = 60;
    expect(() => buildThursdayModel(bad, sheet)).toThrow();
    const badSheet = structuredClone(sheet);
    badSheet.thursday = ['25:50'];
    expect(() => buildThursdayModel(evidence, badSheet)).toThrow();
  });

  it('retains existing normal-day overlay and the Friday schedule unchanged', () => {
    expect(model.scheduleFor('normal').fixed?.A.length).toBeGreaterThan(30);
    const friday = model.scheduleFor('friday'), expected = scheduleFor('friday');
    expect(friday).toEqual(expected);
  });
});
