import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { dayTrains } from '../engine.js';
import type { Evidence } from '../intelligence/contracts.js';
import { InputError } from '../intelligence/validation.js';
import { loadLine2, line2DayTrains, line2Schedule, type Line2Network } from '../line2.js';
import { forDay, loadNetwork, NETWORK_PATH, normName, THURSDAY_RUN_FACTOR } from '../network.js';
import { tehranToEpoch, type DayType } from '../time.js';
import { createBaselineTimetable, type TimetableModel } from '../timetable-overlay.js';
import { JOURNEY_LIMITS, type MetroLine, type ModelDay, type TimetableSource } from './contracts.js';
import { normalizeModelDay } from './normalize.js';
import { createStationCatalog } from './registry.js';

/** Use the same sibling module variant loaded in source or compiled builds. */
function modelFingerprint(bytes: Buffer, timetable: TimetableModel): string {
  const hash = createHash('sha256').update('network.json\0').update(bytes);
  for (const name of ['engine', 'network', 'line2', 'time']) {
    const javascript = new URL(`../${name}.js`, import.meta.url);
    const module = existsSync(javascript) ? javascript : new URL(`../${name}.ts`, import.meta.url);
    hash.update(`\0${name}\0`).update(readFileSync(module));
  }
  // The applied overlay and every byte it rests on are part of the model identity: a different timetable is a different model version.
  for (const part of timetable.fingerprintParts()) hash.update('\0overlay\0').update(part);
  hash.update(`\0timetable:${timetable.identityVersion}`);
  return `sha256:${hash.digest('hex')}`;
}

function validateGenerationBounds(net: Line2Network): void {
  for (const hours of [net.hours.weekdays, net.hours.friday]) {
    for (const value of [hours.from, hours.to]) {
      if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) throw new InputError('Invalid line 2 operating hours');
    }
  }
  for (const type of ['normal', 'thursday', 'friday'] as const) {
    const headway = net.headwayMin[type];
    if (typeof headway !== 'number' || !Number.isFinite(headway) || headway <= 0) throw new InputError('Invalid line 2 headway');
    const schedule = line2Schedule(net, type);
    const count = 2 * (Math.floor((schedule.endS - schedule.startS) / schedule.headwayS) + 1);
    if (schedule.endS < schedule.startS || !Number.isFinite(count) || count < 2 || count > JOURNEY_LIMITS.tripsPerDay) throw new InputError('Line 2 model exceeds bounded day');
  }
}

function loadModels(path: URL | string, bytes: Buffer) {
  try {
    const raw = JSON.parse(bytes.toString('utf8'));
    const order1 = raw.lines?.['1']?.order_vakilabad_to_airport;
    const order2 = raw.lines?.['2']?.order_tabarsi_to_fakouri;
    const ghadir = raw.stations?.find((station: { name?: unknown }) => typeof station?.name === 'string' && normName(station.name) === normName('غدیر'));
    const catalog = createStationCatalog(raw.stations, order1, order2, ghadir?.id);
    for (const line of [1, 2] as const) {
      const segments = raw.lines[line].segments;
      if (!Array.isArray(segments) || segments.length !== catalog.orders[line].length - 1) throw new InputError('Invalid bounded line segments');
    }
    // Line 1's loader assigns run data by position without checking endpoints.
    // Validate the original ordered names before it can consume those values.
    raw.lines['1'].segments.forEach((segment: { from?: unknown; to?: unknown } | null, index: number) => {
      if (typeof segment?.from !== 'string' || typeof segment?.to !== 'string'
        || normName(segment.from) !== normName(order1[index]) || normName(segment.to) !== normName(order1[index + 1])) {
        throw new InputError('Line 1 segment does not follow station order');
      }
    });
    const net = loadNetwork(path), line2 = loadLine2(path);
    if (net.AIR !== net.stationsOrder.length - 1) throw new InputError('Airport must terminate line 1');
    validateGenerationBounds(line2);
    // The unchanged loaders read the path themselves. Do not fingerprint one
    // file revision while executing another if the input changed mid-load.
    if (!readFileSync(path).equals(bytes)) throw new InputError('Network changed while loading models');
    return { net, line2, catalog };
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('Invalid model network JSON');
  }
}

const increment = (count: number): number => Math.min(Number.MAX_SAFE_INTEGER, count + 1);

/** Internal, model-only source; never invokes service or next-pass wrappers. */
export function createModelSource(path: URL | string = NETWORK_PATH, options: { timetable?: TimetableModel } = {}): TimetableSource {
  const timetable = options.timetable ?? createBaselineTimetable();
  const bytes = readFileSync(path);
  const { net, line2, catalog } = loadModels(path, bytes);
  const dataVersion = modelFingerprint(bytes, timetable);
  const evidence: readonly Evidence[] = Object.freeze([Object.freeze({
    id: 'model:source',
    sourceId: 'besrah:metro-schedule-model',
    kind: 'derived' as const,
    dataVersion,
    live: false,
    method: timetable.status.state === 'applied' ? `engine.dayTrains with network.forDay and timetable overlay ${timetable.status.overlayId}; line2.line2DayTrains` : 'engine.dayTrains with network.forDay; line2.line2DayTrains',
  })]);
  const cache = new Map<string, ModelDay>();
  let hits = 0, misses = 0, evictions = 0;
  return Object.freeze({
    catalog, dataVersion, identityVersion: timetable.identityVersion, evidence,
    async getDay(line: MetroLine, date: string, dayType: DayType): Promise<ModelDay> {
      await setImmediate();
      // Validate metadata before converting dates or invoking either model.
      normalizeModelDay({ line, serviceDate: date, dayType, dataVersion, trains: [], runQuality: [] }, catalog);
      const key = JSON.stringify([line, date, dayType]);
      let day = cache.get(key);
      if (day) {
        hits = increment(hits);
        cache.delete(key);
        cache.set(key, day);
      } else {
        misses = increment(misses);
        const dayEpoch = tehranToEpoch(date, '00:00:00');
        const trains = line === 1 ? dayTrains(forDay(net, dayType), dayEpoch, dayType, timetable.scheduleFor(dayType)) : line2DayTrains(line2, dayEpoch, dayType);
        // forDay changes run values but retains baseline runQuality. Qualify that
        // baseline and describe the actual nullish override/scaling choice per direction.
        const runQuality = line === 2 ? line2.runQuality : dayType === 'thursday' && net.thursday
          ? net.runQuality.map((baseline, index) => {
            const forward = net.thursday!.runF[index] != null ? 'thursday_measured_override' : `scaled_${THURSDAY_RUN_FACTOR}`;
            const backward = net.thursday!.runB[index] != null ? 'thursday_measured_override' : `scaled_${THURSDAY_RUN_FACTOR}`;
            return `forward:${forward};backward:${backward};baseline:${baseline}`;
          }) : net.runQuality;
        day = normalizeModelDay({ line, serviceDate: date, dayType, dataVersion, trains, runQuality }, catalog);
        if (cache.size >= JOURNEY_LIMITS.cacheEntries) {
          cache.delete(cache.keys().next().value!);
          evictions = increment(evictions);
        }
        cache.set(key, day);
      }
      await setImmediate();
      return day;
    },
    stats() { return { entries: cache.size, maxEntries: JOURNEY_LIMITS.cacheEntries, hits, misses, evictions }; },
    clear() { cache.clear(); hits = 0; misses = 0; evictions = 0; },
  });
}
