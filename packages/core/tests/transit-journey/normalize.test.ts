import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayTrains, type Train } from '../../src/engine.js';
import { InputError } from '../../src/intelligence/validation.js';
import { JOURNEY_LIMITS } from '../../src/transit-journey/contracts.js';
import { loadLine2, line2DayTrains } from '../../src/line2.js';
import { forDay, loadNetwork, NETWORK_PATH } from '../../src/network.js';
import { tehranToEpoch } from '../../src/time.js';
import { createStationCatalog } from '../../src/transit-journey/registry.js';
import { normalizeModelDay } from '../../src/transit-journey/normalize.js';
import type { RawModelDay } from '../../src/transit-journey/contracts.js';

const json = JSON.parse(readFileSync(NETWORK_PATH, 'utf8'));
const net = loadNetwork(), l2 = loadLine2();
const catalog = createStationCatalog(json.stations, net.stationsOrder, l2.order, catalogGhadir());
function catalogGhadir(): string { return json.stations.find((s: { name: string }) => s.name === net.stationsOrder[net.GH]).id; }
const date = '2026-10-22', midnight = tehranToEpoch(date, '00:00:00');
function raw(line: 1 | 2 = 1): RawModelDay {
  return { line, serviceDate: date, dayType: 'thursday', dataVersion: 'fixture-v1',
    trains: line === 1 ? dayTrains(forDay(net, 'thursday'), midnight, 'thursday') : line2DayTrains(l2, midnight, 'thursday'),
    runQuality: line === 1 ? [...net.runQuality] : [...l2.runQuality] };
}

function single(): RawModelDay {
  const input = raw();
  input.trains = [input.trains[0]];
  return input;
}

describe('normalizeModelDay validation', () => {
  const badDays: [string, (day: RawModelDay) => unknown][] = [
    ['missing object', () => null],
    ['line', d => ({ ...d, line: 3 })],
    ['date rollover', d => ({ ...d, serviceDate: '2026-02-30' })],
    ['non leap day', d => ({ ...d, serviceDate: '2026-02-29' })],
    ['bad date format', d => ({ ...d, serviceDate: '2026-1-01' })],
    ['date month', d => ({ ...d, serviceDate: '2026-13-01' })],
    ['unknown day type', d => ({ ...d, dayType: 'holiday' })],
    ['empty version', d => ({ ...d, dataVersion: '' })],
    ['unbounded version', d => ({ ...d, dataVersion: 'x'.repeat(129) })],
    ['too many trips', d => ({ ...d, trains: Array(513).fill(d.trains[0]) })],
    ['sparse trips', d => ({ ...d, trains: new Array(2) })],
    ['quality bound', d => ({ ...d, runQuality: Array(33).fill('measured') })],
    ['invalid quality', d => ({ ...d, runQuality: [null] })],
  ];
  it.each(badDays)('rejects bad top-level day: %s', (_, change) => {
    expect(() => normalizeModelDay(change(single()) as RawModelDay, catalog)).toThrow(InputError);
  });

  const badTrips: [string, (train: Train) => void][] = [
    ['missing id', t => { t.id = ''; }],
    ['unbounded id', t => { t.id = 'x'.repeat(129); }],
    ['bad direction', t => { (t as any).direction = 'sideways'; }],
    ['bad service', t => { (t as any).service = 'C'; }],
    ['missing confidence', t => { delete (t as any).confidence; }],
    ['bad extension flag', t => { (t as any).beyondGhadirIsDerived = 'true'; }],
    ['start before service midnight', t => { t.start = midnight - 1; }],
    ['start at next midnight', t => { t.start = midnight + 86400; }],
    ['nonfinite start', t => { t.start = Infinity; }],
    ['wrong first departure', t => { t.start += 1; }],
    ['negative stop', t => { t.stops[1].arrive = -1; }],
    ['NaN arrival', t => { t.stops[1].arrive = NaN; }],
    ['infinite departure', t => { t.stops[1].depart = Infinity; }],
    ['arrival after departure', t => { t.stops[1].arrive = t.stops[1].depart + 1; }],
    ['arrival before previous departure', t => { t.stops[1].arrive = t.start - 1; }],
    ['zero run between different physical stations', t => { t.stops[1].arrive = t.stops[0].depart; }],
    ['missing station', t => { t.stops.splice(1, 1); }],
    ['duplicate station index', t => { t.stops[1].idx = t.stops[0].idx; }],
    ['fractional index', t => { t.stops[1].idx = 1.5; }],
    ['wrong name for station index', t => { t.stops[1].name = t.stops[0].name; }],
    ['missing terminal', t => { t.stops.pop(); }],
    ['truncated first stop', t => { t.stops.shift(); t.start = t.stops[0].depart; }],
    ['too many stops', t => { t.stops = Array(33).fill(t.stops[0]); }],
    ['sparse stops', t => { t.stops = new Array(3); }],
    ['trip duration includes terminal layover', t => { t.stops.at(-1)!.depart = t.start + 14401; }],
    ['null stop', t => { (t.stops as unknown[])[1] = null; }],
  ];
  it.each(badTrips)('rejects a whole malformed trip without fabricating stops: %s', (_, change) => {
    const input = single();
    change(input.trains[0] as Train);
    const day = normalizeModelDay(input, catalog);
    expect(day.trips).toEqual([]);
    expect(day.rejectedTrips).toBe(1);
    expect(day.complete).toBe(false);
    expect(day.issues).toHaveLength(1);
    expect(Object.isFrozen(day.issues[0])).toBe(true);
  });

  it('invalidates ALL duplicate source IDs, even across service/direction or a malformed record', () => {
    const input = raw(), original = input.trains[0] as Train, other = input.trains[1] as Train;
    other.id = original.id;
    other.stops = [];
    input.trains = [original, other, { id: original.id }, input.trains[2]];
    const day = normalizeModelDay(input, catalog);
    expect(day.rejectedTrips).toBe(3);
    expect(day.trips).toHaveLength(1);
    expect(day.trips.some(t => t.sourceTrainId === original.id)).toBe(false);
    expect(day.issues.map(i => i.code)).toEqual(Array(3).fill('duplicate_train_id'));
  });

  it('bounds issue reporting while counting all rejected records', () => {
    const input = single();
    input.trains = Array.from({ length: JOURNEY_LIMITS.tripsPerDay }, () => null);
    const day = normalizeModelDay(input, catalog);
    expect(day.rejectedTrips).toBe(512);
    expect(day.issues).toHaveLength(JOURNEY_LIMITS.issues);
    expect(day.complete).toBe(false);
  });

  it.each([1, 2] as const)('requires full endpoint patterns for both directions of line %s', line => {
    const input = raw(line);
    input.trains = input.trains.slice(0, 4).map(value => {
      const train = value as Train;
      train.stops.pop();
      return train;
    });
    const day = normalizeModelDay(input, catalog);
    expect(day.rejectedTrips).toBe(4);
    expect(day.trips).toEqual([]);
  });

  it('rejects both service A reaching Airport and service B stopping at Ghadir', () => {
    const input = raw();
    const trains = input.trains as Train[];
    const a = trains.find(t => t.service === 'A' && t.direction === 'out')!;
    const b = trains.find(t => t.service === 'B' && t.direction === 'back')!;
    a.service = 'B'; b.service = 'A';
    input.trains = [a, b];
    expect(normalizeModelDay(input, catalog).rejectedTrips).toBe(2);
  });

  it('accepts starts within the service date and bounded finishes after midnight', () => {
    const input = single(), train = input.trains[0] as Train;
    const offset = midnight + 86399 - train.start;
    train.start += offset;
    train.stops.forEach(s => { s.arrive += offset; s.depart += offset; });
    train.stops.at(-1)!.depart = train.start + JOURNEY_LIMITS.tripSpanSeconds;
    const day = normalizeModelDay(input, catalog);
    expect(day.complete).toBe(true);
    expect(day.trips[0].stops.at(-1)!.depart).toBe(train.start + 14400);
  });

  it('preserves long source IDs exactly but bounds namespaced IDs and separates dates/services', () => {
    const input = single(), train = input.trains[0] as Train;
    train.id = 'ی:'.repeat(64);
    const first = normalizeModelDay(input, catalog).trips[0];
    expect(first.sourceTrainId).toBe(train.id);
    expect(first.id.length).toBeLessThanOrEqual(128);
    const offset = 86400;
    input.serviceDate = '2026-10-23'; train.start += offset;
    train.stops.forEach(s => { s.arrive += offset; s.depart += offset; });
    expect(normalizeModelDay(input, catalog).trips[0].id).not.toBe(first.id);
  });

  it('does not read train/stop accessors or sparse accessor entries as model data', () => {
    const input = single(); let reads = 0;
    Object.defineProperty(input.trains[0], 'stops', { get: () => { reads++; return []; }, enumerable: true });
    expect(normalizeModelDay(input, catalog).rejectedTrips).toBe(1);
    expect(reads).toBe(0);
    const accessorArray = [input.trains[0]];
    Object.defineProperty(accessorArray, '0', { get: () => { reads++; return null; } });
    input.trains = accessorArray;
    expect(() => normalizeModelDay(input, catalog)).toThrow(InputError);
    expect(reads).toBe(0);
  });
});

describe('normalizeModelDay full model snapshots', () => {
  it.each([1, 2] as const)('preserves all real line %s trips without inventing stops or returns', line => {
    const input = raw(line), day = normalizeModelDay(input, catalog);
    expect(day.complete).toBe(true);
    expect(day.rejectedTrips).toBe(0);
    expect(day.issues).toEqual([]);
    expect(day.trips).toHaveLength(input.trains.length);
    expect(day.runQuality).toEqual(input.runQuality);
    for (let i = 0; i < day.trips.length; i++) {
      const trip = day.trips[i], original = input.trains[i] as ReturnType<typeof dayTrains>[number];
      expect(trip.sourceTrainId).toBe(original.id);
      expect(trip.id).toContain(date);
      expect(trip.id).toContain(String(line));
      expect(trip.id).toContain(original.direction);
      expect(trip.service).toBe(line === 1 ? original.service : null);
      expect(trip.confidence).toBe(line === 1 ? original.confidence : 'site_headway_assumed_phase');
      expect(trip.derivedExtension).toBe(line === 1 ? original.beyondGhadirIsDerived : false);
      expect(trip.stops.map(s => ({ idx: s.lineIndex, arrive: s.arrive, depart: s.depart })))
        .toEqual(original.stops.map(({ idx, arrive, depart }) => ({ idx, arrive, depart })));
      expect(trip.stops.map(s => s.stationId)).toEqual(original.stops.map(s => catalog.orders[line][s.idx]));
      expect(trip.stops.map(s => s.sequence)).toEqual(original.stops.map((_, index) => index));
    }
    expect(new Set(day.trips.map(t => t.id)).size).toBe(day.trips.length);
  });

  it('copies and deeply freezes snapshots, including terminal layover and quality', () => {
    const input = raw(), original = (input.trains as ReturnType<typeof dayTrains>)[0];
    input.trains = [original];
    const day = normalizeModelDay(input, catalog), terminal = day.trips[0].stops.at(-1)!;
    expect(terminal.depart).toBeGreaterThan(terminal.arrive);
    expect(day.trips).toHaveLength(1);
    original.stops[0].arrive = 0;
    (input.runQuality as string[])[0] = 'mutated';
    expect(day.trips[0].stops[0].arrive).not.toBe(0);
    expect(day.runQuality[0]).not.toBe('mutated');
    for (const value of [day, day.trips, day.trips[0], day.trips[0].stops, terminal, day.runQuality, day.issues]) expect(Object.isFrozen(value)).toBe(true);
    expect(() => { (day.trips[0].stops as unknown[]).push({}); }).toThrow();
  });
});
