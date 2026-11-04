import { createHash } from 'node:crypto';
import { InputError } from '../intelligence/validation.js';
import { normName } from '../network.js';
import { tehranToEpoch } from '../time.js';
import { JOURNEY_LIMITS, type RawModelDay, type ModelDay, type ModelTrip, type ModelIssue, type ModelStop, type StationCatalog } from './contracts.js';

function dataObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length <= 16 && keys.every(key => typeof key === 'string' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'));
}
function dense(value: unknown, max: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}
function time(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}
function midnightOf(date: unknown): number {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new InputError('Invalid service date');
  const [year, month, day] = date.split('-').map(Number);
  const check = new Date(0);
  check.setUTCFullYear(year, month - 1, day);
  // time.ts uses Date.UTC: years below 100 would silently become 1900..1999.
  if (year < 100 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new InputError('Invalid service date');
  return tehranToEpoch(date, '00:00:00');
}
function sourceId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'id');
  return descriptor && Object.hasOwn(descriptor, 'value') && text(descriptor.value) ? descriptor.value : undefined;
}

function normalizeTrip(value: unknown, raw: RawModelDay, catalog: StationCatalog, midnight: number): ModelTrip | undefined {
  if (!dataObject(value) || !text(value.id) || (value.direction !== 'out' && value.direction !== 'back') || !time(value.start)
    || value.start < midnight || value.start >= midnight + 86400 || !dense(value.stops, JOURNEY_LIMITS.stopsPerTrip)) return undefined;
  if (raw.line === 1 && ((value.service !== 'A' && value.service !== 'B') || !text(value.confidence) || typeof value.beyondGhadirIsDerived !== 'boolean')) return undefined;
  const service = raw.line === 1 ? value.service as 'A' | 'B' : null;
  const order = catalog.orders[raw.line];
  const lastIndex = raw.line === 1 && service === 'A' ? order.indexOf(catalog.ghadirId) : order.length - 1;
  if (lastIndex < 1 || value.stops.length !== lastIndex + 1) return undefined;
  const names = new Map(catalog.stations.map(station => [station.id, normName(station.name)]));
  const stops: ModelStop[] = [];
  let previousDeparture = value.start;
  for (let sequence = 0; sequence < value.stops.length; sequence++) {
    const stop = value.stops[sequence];
    const expectedIndex = value.direction === 'out' ? sequence : lastIndex - sequence;
    if (!dataObject(stop) || stop.idx !== expectedIndex || typeof stop.name !== 'string' || stop.name.length > 128
      || normName(stop.name) !== names.get(order[expectedIndex]) || !time(stop.arrive) || !time(stop.depart)
      || stop.arrive > stop.depart || stop.arrive < previousDeparture || (sequence > 0 && stop.arrive === previousDeparture) || stop.depart - value.start > JOURNEY_LIMITS.tripSpanSeconds
      || (sequence === 0 && (stop.arrive !== value.start || stop.depart !== value.start))) return undefined;
    stops.push(Object.freeze({ sequence, stationId: order[expectedIndex], lineIndex: expectedIndex, arrive: stop.arrive, depart: stop.depart }));
    previousDeparture = stop.depart;
  }
  // Hash the complete tuple rather than truncate or rewrite the original source ID.
  const digest = createHash('sha256').update(JSON.stringify([raw.serviceDate, raw.line, value.direction, service, value.id])).digest('hex');
  return Object.freeze({ id: `${raw.serviceDate}:L${raw.line}:${value.direction}:${service ?? '-'}:${digest}`,
    sourceTrainId: value.id, serviceDate: raw.serviceDate, line: raw.line, service, direction: value.direction,
    confidence: raw.line === 1 ? value.confidence as string : 'site_headway_assumed_phase',
    derivedExtension: raw.line === 1 ? value.beyondGhadirIsDerived as boolean : false, stops: Object.freeze(stops) });
}

/** Validate bounded full trips; reject entire records, never repair model data. */
export function normalizeModelDay(raw: RawModelDay, catalog: StationCatalog): ModelDay {
  if (!dataObject(raw) || (raw.line !== 1 && raw.line !== 2) || !['normal', 'thursday', 'friday'].includes(raw.dayType)
    || !text(raw.dataVersion) || !dense(raw.trains, JOURNEY_LIMITS.tripsPerDay) || !dense(raw.runQuality, JOURNEY_LIMITS.stopsPerTrip)
    || !raw.runQuality.every(text)) throw new InputError('Invalid bounded model day');
  const midnight = midnightOf(raw.serviceDate);
  const counts = new Map<string, number>();
  for (const value of raw.trains) {
    const id = sourceId(value);
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const trips: ModelTrip[] = [], issues: ModelIssue[] = [];
  let rejectedTrips = 0;
  for (const value of raw.trains) {
    const id = sourceId(value);
    const duplicate = id !== undefined && counts.get(id)! > 1;
    const trip = duplicate ? undefined : normalizeTrip(value, raw, catalog, midnight);
    if (trip) trips.push(trip);
    else {
      rejectedTrips++;
      if (issues.length < JOURNEY_LIMITS.issues) issues.push(Object.freeze({ code: duplicate ? 'duplicate_train_id' : 'invalid_trip', ...(id === undefined ? {} : { trainId: id }) }));
    }
  }
  return Object.freeze({ line: raw.line, serviceDate: raw.serviceDate, dayType: raw.dayType, dataVersion: raw.dataVersion,
    trips: Object.freeze(trips), runQuality: Object.freeze([...raw.runQuality]), complete: rejectedTrips === 0, rejectedTrips, issues: Object.freeze(issues) });
}
