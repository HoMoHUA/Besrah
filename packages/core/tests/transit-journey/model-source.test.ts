import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { setImmediate as onImmediate } from 'node:timers';
import { InputError } from '../../src/intelligence/validation.js';
import { dayTrains } from '../../src/engine.js';
import { forDay, loadNetwork, NETWORK_PATH } from '../../src/network.js';
import { loadLine2, line2DayTrains } from '../../src/line2.js';
import { tehranToEpoch } from '../../src/time.js';
import { createModelSource } from '../../src/transit-journey/model-source.js';

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function networkCopy(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'besrah-r2a-model-'));
  directories.push(directory);
  const path = join(directory, 'network.json'); writeFileSync(path, content); return path;
}
const date = '2026-10-22', midnight = tehranToEpoch(date, '00:00:00');
const thursdayQuality = [
  ...Array(8).fill('forward:thursday_measured_override;backward:thursday_measured_override;baseline:measured_2026-10-16+symmetric_assumed'),
  'forward:scaled_1.073;backward:thursday_measured_override;baseline:measured_2026-10-16+symmetric_assumed',
  ...Array(9).fill('forward:scaled_1.073;backward:scaled_1.073;baseline:measured_2026-10-16+symmetric_assumed'),
  ...Array(3).fill('forward:scaled_1.073;backward:scaled_1.073;baseline:measured_2026-10-16'),
  ...Array(2).fill('forward:scaled_1.073;backward:scaled_1.073;baseline:derived+symmetric_assumed'),
];

describe('bounded immutable source and cache', () => {
  it('exposes frozen model evidence with the actual fingerprint and no invented observation timestamps', () => {
    const source = createModelSource();
    expect(source.evidence).toEqual([{
      id: 'model:source',
      sourceId: 'besrah:metro-schedule-model',
      kind: 'derived',
      dataVersion: source.dataVersion,
      live: false,
      method: 'engine.dayTrains with network.forDay; line2.line2DayTrains',
    }]);
    expect(Object.isFrozen(source.evidence)).toBe(true);
    expect(Object.isFrozen(source.evidence[0])).toBe(true);
    expect(() => { (source.evidence as unknown[]).push({}); }).toThrow();
    expect(() => { source.evidence[0].dataVersion = 'invented'; }).toThrow();
    expect(source.stats()).toEqual({ entries: 0, maxEntries: 2, hits: 0, misses: 0, evictions: 0 });
  });

  it('uses a two-entry LRU keyed by line/date/type and refreshes hit recency', async () => {
    const source = createModelSource();
    expect(source.stats()).toEqual({ entries: 0, maxEntries: 2, hits: 0, misses: 0, evictions: 0 });
    const a = await source.getDay(1, date, 'thursday');
    const b = await source.getDay(2, date, 'thursday');
    expect(await source.getDay(1, date, 'thursday')).toBe(a);
    const c = await source.getDay(1, date, 'normal');
    expect(c).not.toBe(a);
    expect(source.stats()).toEqual({ entries: 2, maxEntries: 2, hits: 1, misses: 3, evictions: 1 });
    expect(await source.getDay(1, date, 'thursday')).toBe(a);
    expect(await source.getDay(2, date, 'thursday')).not.toBe(b);
    expect(source.stats()).toEqual({ entries: 2, maxEntries: 2, hits: 2, misses: 4, evictions: 2 });
    await source.getDay(1, '2026-10-23', 'thursday');
    expect(source.stats().entries).toBe(2);
    expect(source.stats().evictions).toBe(3);
  });

  it('keeps per-instance caches and counters, returns detached stats, and clear resets both', async () => {
    const first = createModelSource(), second = createModelSource();
    const day = await first.getDay(2, date, 'thursday');
    expect(second.stats().entries).toBe(0);
    expect(await second.getDay(2, date, 'thursday')).not.toBe(day);
    const stats = first.stats(); stats.hits = 999;
    expect(first.stats().hits).toBe(0);
    first.clear();
    expect(first.stats()).toEqual({ entries: 0, maxEntries: 2, hits: 0, misses: 0, evictions: 0 });
    expect(await first.getDay(2, date, 'thursday')).not.toBe(day);
    expect(second.stats().entries).toBe(1);
  });

  it('handles concurrent duplicate requests without unbounded entries or duplicate model builds', async () => {
    const source = createModelSource();
    const days = await Promise.all(Array.from({ length: 12 }, () => source.getDay(2, date, 'thursday')));
    expect(days.every(day => day === days[0])).toBe(true);
    expect(source.stats()).toEqual({ entries: 1, maxEntries: 2, hits: 11, misses: 1, evictions: 0 });
  });

  it('freezes catalog and cached snapshots so callers cannot corrupt later requests', async () => {
    const source = createModelSource(), day = await source.getDay(1, date, 'thursday');
    const original = day.trips[0].stops[0].arrive;
    for (const value of [source, source.catalog, source.catalog.stations, source.catalog.stations[0], source.catalog.stations[0].lines, source.catalog.orders, source.catalog.orders[1]]) expect(Object.isFrozen(value)).toBe(true);
    expect(() => { (source.catalog.orders[1] as string[])[0] = 'corrupted'; }).toThrow();
    expect(() => { day.trips[0].stops[0].arrive = 0; }).toThrow();
    expect(() => { (day.runQuality as string[]).push('corrupted'); }).toThrow();
    expect((await source.getDay(1, date, 'thursday')).trips[0].stops[0].arrive).toBe(original);
  });

  it('yields an event-loop turn around generation and cache hits', async () => {
    const source = createModelSource();
    for (let attempt = 0; attempt < 2; attempt++) {
      let immediateSeen = false, resolved = false;
      const pending = source.getDay(2, date, 'thursday').then(day => { resolved = true; return day; });
      onImmediate(() => { immediateSeen = true; });
      await Promise.resolve();
      expect(resolved).toBe(false);
      await pending;
      expect(immediateSeen).toBe(true);
    }
  });

  it.each([
    [1, '2026-02-30', 'normal'], [1, '2026-02-29', 'normal'], [1, '2026-10-22junk', 'normal'],
    [3, date, 'normal'], [2, date, 'holiday'],
  ])('rejects bad day input before generation: %s/%s/%s', async (line, serviceDate, dayType) => {
    const source = createModelSource();
    await expect(source.getDay(line as 1, serviceDate as string, dayType as 'normal')).rejects.toBeInstanceOf(InputError);
    expect(source.stats()).toEqual({ entries: 0, maxEntries: 2, hits: 0, misses: 0, evictions: 0 });
  });

  it.each([0, -1, 0.001, 'Infinity'])('rejects unbounded line 2 model work from headway %s', headway => {
    const changed = JSON.parse(readFileSync(NETWORK_PATH, 'utf8'));
    changed.lines['2'].headway_conflict.owner_decision.headway_min = headway;
    expect(() => createModelSource(networkCopy(JSON.stringify(changed)))).toThrow(InputError);
  });

  it.each(['swapped segments', 'wrong from', 'wrong to'])('rejects line 1 positional run data with %s', corruption => {
    const changed = JSON.parse(readFileSync(NETWORK_PATH, 'utf8'));
    const segments = changed.lines['1'].segments;
    if (corruption === 'swapped segments') [segments[0], segments[1]] = [segments[1], segments[0]];
    else segments[0][corruption === 'wrong from' ? 'from' : 'to'] = changed.lines['1'].order_vakilabad_to_airport[2];
    expect(() => createModelSource(networkCopy(JSON.stringify(changed)))).toThrow(InputError);
  });

  it('accepts normalized line 1 segment endpoint spellings without changing positional runs', async () => {
    const changed = JSON.parse(readFileSync(NETWORK_PATH, 'utf8'));
    for (const segment of changed.lines['1'].segments) {
      for (const endpoint of ['from', 'to']) segment[endpoint] = ` ${segment[endpoint].replace(/ی/g, 'ي').replace(/ک/g, 'ك').replace(/\u200c/g, ' ')} `;
    }
    const source = createModelSource(networkCopy(JSON.stringify(changed)));
    const day = await source.getDay(1, date, 'normal');
    expect(day.complete).toBe(true);
    const original = dayTrains(loadNetwork(), midnight, 'normal');
    expect(day.trips[0].stops.map(stop => [stop.arrive, stop.depart])).toEqual(original[0].stops.map(stop => [stop.arrive, stop.depart]));
  });

  it('rejects malformed JSON and impossible hours rather than using fallback timetables', () => {
    expect(() => createModelSource(networkCopy('{'))).toThrow(InputError);
    const changed = JSON.parse(readFileSync(NETWORK_PATH, 'utf8'));
    changed.lines['2'].official_site.schedules.weekdays.slots[0].from = '25:00';
    expect(() => createModelSource(networkCopy(JSON.stringify(changed)))).toThrow(InputError);
  });
});

describe('real model timetable source', () => {
  it.each([
    [1, 'normal'], [1, 'thursday'], [1, 'friday'],
    [2, 'normal'], [2, 'thursday'], [2, 'friday'],
  ] as const)('reads unchanged full line %s %s model results with effective segment provenance', async (line, dayType) => {
    const source = createModelSource();
    const day = await source.getDay(line, date, dayType);
    const net = loadNetwork(), l2 = loadLine2();
    const trains = line === 1 ? dayTrains(forDay(net, dayType), midnight, dayType) : line2DayTrains(l2, midnight, dayType);
    expect(day.complete).toBe(true);
    expect(day.rejectedTrips).toBe(0);
    expect(day.trips).toHaveLength(trains.length);
    expect(day.runQuality).toEqual(line === 2 ? l2.runQuality : dayType === 'thursday' ? thursdayQuality : net.runQuality);
    expect(day.runQuality).toHaveLength(source.catalog.orders[line].length - 1);
    expect(day.runQuality.every(quality => quality.length <= 128)).toBe(true);
    expect(day.dataVersion).toBe(source.dataVersion);
    expect(source.catalog.stations.some(s => s.id === 'METRO-117' && s.lines.includes(1) && s.lines.includes(2))).toBe(true);
    expect(source.catalog.stations.filter(s => s.id === 'METRO-117')).toHaveLength(1);
    for (let i = 0; i < trains.length; i++) {
      expect(day.trips[i].sourceTrainId).toBe(trains[i].id);
      expect(day.trips[i].stops.map(s => [s.lineIndex, s.arrive, s.depart])).toEqual(trains[i].stops.map(s => [s.idx, s.arrive, s.depart]));
    }
  });

  it('attributes Thursday provenance to applied directional overrides, not matching run values', async () => {
    const changed = JSON.parse(readFileSync(NETWORK_PATH, 'utf8'));
    const line = changed.lines['1'], thursday = line['thursday_2026-10-22'];
    thursday.run_forward_s['0'] = null;
    thursday.run_backward_s['9'] = line.segments[9].run_s_forward;
    const source = createModelSource(networkCopy(JSON.stringify(changed)));
    const day = await source.getDay(1, date, 'thursday');
    const expected = [...thursdayQuality];
    expected[0] = 'forward:scaled_1.073;backward:thursday_measured_override;baseline:measured_2026-10-16+symmetric_assumed';
    expected[9] = 'forward:scaled_1.073;backward:thursday_measured_override;baseline:measured_2026-10-16+symmetric_assumed';
    expect(day.runQuality).toEqual(expected);
    expect(day.complete).toBe(true);
  });

  it('retains baseline provenance on Thursday when no Thursday model overrides exist', async () => {
    const changed = JSON.parse(readFileSync(NETWORK_PATH, 'utf8'));
    delete changed.lines['1']['thursday_2026-10-22'];
    const path = networkCopy(JSON.stringify(changed)), source = createModelSource(path);
    const day = await source.getDay(1, date, 'thursday');
    expect(day.runQuality).toEqual(loadNetwork(path).runQuality);
    expect(day.complete).toBe(true);
  });

  it('applies Thursday network overrides rather than only Thursday departure phases', async () => {
    const source = createModelSource();
    const day = await source.getDay(1, date, 'thursday');
    const observed = day.trips.find(t => t.service === 'A' && t.direction === 'out' && t.stops[0].depart === tehranToEpoch(date, '14:25:06'))!;
    expect(observed).toBeDefined();
    expect(Math.abs(observed.stops[8].arrive - tehranToEpoch(date, '14:40:14'))).toBeLessThanOrEqual(10);
    const baseline = dayTrains(loadNetwork(), midnight, 'thursday').find(t => t.id === observed.sourceTrainId)!;
    expect(observed.stops[8].arrive).not.toBe(baseline.stops[8].arrive);
  });

  it('fingerprints exact network bytes and the executed engine/network/line2/time module bytes', () => {
    const bytes = readFileSync(NETWORK_PATH), hash = createHash('sha256');
    hash.update('network.json\0').update(bytes);
    for (const name of ['engine', 'network', 'line2', 'time']) {
      const javascript = new URL(`../../src/${name}.js`, import.meta.url);
      const module = existsSync(javascript) ? javascript : new URL(`../../src/${name}.ts`, import.meta.url);
      hash.update(`\0${name}\0`).update(readFileSync(module));
    }
    // R3-NET01: the timetable model is part of the identity. The baseline generator contributes no bytes, only its tag.
    hash.update('\0timetable:baseline');
    const source = createModelSource();
    expect(source.dataVersion).toBe(`sha256:${hash.digest('hex')}`);
    expect(source.dataVersion.length).toBeLessThanOrEqual(128);
    const path = networkCopy(bytes.toString());
    expect(createModelSource(path).dataVersion).toBe(source.dataVersion);
    expect(createModelSource(pathToFileURL(path)).dataVersion).toBe(source.dataVersion);
    writeFileSync(path, bytes.toString() + '\n');
    expect(createModelSource(path).dataVersion).not.toBe(source.dataVersion);
  });

  it('loads custom real JSON data instead of silently ignoring the supplied path', async () => {
    const changed = JSON.parse(readFileSync(NETWORK_PATH, 'utf8'));
    changed.lines['2'].headway_conflict.owner_decision.headway_min = 20;
    const source = createModelSource(networkCopy(JSON.stringify(changed)));
    const normal = await source.getDay(2, '2026-10-21', 'normal');
    expect(normal.trips[2].stops[0].depart - normal.trips[0].stops[0].depart).toBe(1200);
  });
});
