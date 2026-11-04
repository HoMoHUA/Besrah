// R3-C: evidence labels of the extended NET01 model must not claim more than is known.
// [modeled] overlay output on fixed fixture dates; [field_observed] only the timed Tuesday 2026-11-03.
import { describe, expect, it } from 'vitest';
import { dayTrains, publicConfidence, scheduleFor, type DaySchedule } from '../../src/engine.js';
import { forDay, loadNetwork } from '../../src/network.js';
import { epochToTehranHms, tehranToEpoch } from '../../src/time.js';
import { createBaselineTimetable, createTimetableModel } from '../../src/timetable-overlay.js';

const net = loadNetwork();
const OBSERVED = '2026-11-03', LATER_TUESDAY = '2026-11-10', SUNDAY = '2026-11-08';
const quiet = { warn: () => undefined };
const overlay = createTimetableModel(quiet);
const trainsOn = (date: string, model = overlay) => dayTrains(forDay(net, 'normal'), tehranToEpoch(date, '00:00:00'), 'normal', model.scheduleFor('normal'));
const outA = (date: string) => trainsOn(date).filter(t => t.direction === 'out' && t.service === 'A').map(t => ({ t: epochToTehranHms(t.stops[0].depart), c: t.confidence }));

describe('[modeled] evidence labels carried on other service days', () => {
  it('the overlay is applied and names the one timed day', () => {
    expect(overlay.status.state).toBe('applied');
    expect(overlay.scheduleFor('normal').observedServiceDates).toEqual([OBSERVED]);
  });
  it('on the timed Tuesday the 19:15-20:03 A departures are measured; on any other day the same times are generalised', () => {
    const observed = outA(OBSERVED), later = outA(LATER_TUESDAY), sunday = outA(SUNDAY);
    expect(later.map(x => x.t)).toEqual(observed.map(x => x.t));
    expect(sunday.map(x => x.t)).toEqual(observed.map(x => x.t));
    const timed = observed.filter(x => x.c === 'measured_phase');
    expect(timed.length).toBe(6);
    expect(timed.every(x => x.t >= '19:15:00' && x.t <= '20:03:59')).toBe(true);
    for (const day of [later, sunday]) {
      expect(day.some(x => x.c === 'measured_phase')).toBe(false);
      expect(day.filter(x => x.c === 'generalized_observation_phase').map(x => x.t)).toEqual(timed.map(x => x.t));
    }
  });
  it('printed-sheet B departures are never labelled as the official sheet itself, on any day (offset is derived)', () => {
    for (const date of [OBSERVED, LATER_TUESDAY]) {
      const b = trainsOn(date).filter(t => t.service === 'B');
      expect(b.length).toBeGreaterThan(0);
      expect(b.every(t => t.confidence === 'sheet_derived_phase')).toBe(true);
    }
  });
  it('assumed windows keep their weaker label and nothing claims measurement elsewhere', () => {
    const labels = new Set(outA(LATER_TUESDAY).map(x => x.c));
    expect([...labels].sort()).toEqual(['generalized_observation_phase', 'site_headway_assumed_phase']);
  });
});

describe('[modeled] scope: no label change outside the overlay', () => {
  it('Thursday, Friday and the baseline fallback keep the original classes byte for byte', () => {
    const baseline = createBaselineTimetable();
    for (const [type, date] of [['thursday', '2026-10-22'], ['friday', '2026-10-16'], ['normal', LATER_TUESDAY]] as const) {
      const a = dayTrains(forDay(net, type), tehranToEpoch(date, '00:00:00'), type, overlay.scheduleFor(type));
      const b = dayTrains(forDay(net, type), tehranToEpoch(date, '00:00:00'), type, baseline.scheduleFor(type));
      if (type !== 'normal') expect(a.map(t => [t.id, t.start, t.confidence])).toEqual(b.map(t => [t.id, t.start, t.confidence]));
      else expect(new Set(b.map(t => t.confidence))).toEqual(new Set(['site_headway_assumed_phase']));
    }
  });
  it('publicConfidence is the identity for schedules without explicit departures', () => {
    const plain: DaySchedule = scheduleFor('friday');
    for (const c of ['measured_phase', 'official_sheet_phase', 'site_headway_assumed_phase'] as const) expect(publicConfidence(c, LATER_TUESDAY, plain)).toBe(c);
  });
});
