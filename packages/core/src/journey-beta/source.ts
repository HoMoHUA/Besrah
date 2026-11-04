// A TypeScript provider type is not runtime evidence. Snapshot and validate each returned day
// before either the planner or feedback matcher may consume its positional trip fields.
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { tehranToEpoch } from '../time.js';
import type { DayType } from '../time.js';
import { JOURNEY_LIMITS, type MetroLine, type ModelDay, type ModelTrip, type StationCatalog, type TimetableSource } from '../transit-journey/contracts.js';
import { dense, integer, invalid, record, text } from '../transit-journey/validation.js';

const layouts = new WeakMap<readonly string[], ReadonlySet<string>>();
const object = (v: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || types.isProxy(v) || Array.isArray(v)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return invalid('Unsupported provider object');
  let allowed = layouts.get(keys);
  if (!allowed) { allowed = new Set(keys); layouts.set(keys, allowed); }
  const own = Reflect.ownKeys(v);
  if (own.length !== keys.length) return invalid('Invalid provider fields');
  for (const key of own) {
    const d = Object.getOwnPropertyDescriptor(v, key)!;
    if (typeof key !== 'string' || !allowed.has(key) || !d.enumerable || !Object.hasOwn(d, 'value')) return invalid('Unsupported provider field');
  }
  return v as Record<string, unknown>;
};
const array = (v: unknown, max: number, min = 0) => {
  if (types.isProxy(v)) return invalid('Unsupported provider array');
  return dense(v, max, min);
};
const epoch = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) return invalid('Invalid provider epoch');
  return v;
};
const tripKeys = ['id', 'sourceTrainId', 'serviceDate', 'line', 'service', 'direction', 'confidence', 'derivedExtension', 'stops'];
const stopKeys = ['sequence', 'stationId', 'lineIndex', 'arrive', 'depart'];
const dayKeys = ['line', 'serviceDate', 'dayType', 'dataVersion', 'trips', 'runQuality', 'complete', 'rejectedTrips', 'issues'];
const confidences = new Set(['measured_phase', 'site_headway_assumed_phase', 'official_sheet_phase', 'generalized_observation_phase', 'sheet_derived_phase']);

function snapshotTrip(value: unknown, catalog: StationCatalog, line: MetroLine, date: string, midnight: number): ModelTrip {
  const t = object(value, tripKeys);
  if (t.line !== line || t.serviceDate !== date || (t.direction !== 'out' && t.direction !== 'back')
    || (line === 1 ? t.service !== 'A' && t.service !== 'B' : t.service !== null)
    || typeof t.derivedExtension !== 'boolean' || typeof t.confidence !== 'string' || !confidences.has(t.confidence)) invalid('Invalid provider trip');
  const sourceTrainId = text(t.sourceTrainId), id = text(t.id), direction = t.direction as 'out' | 'back';
  const digest = createHash('sha256').update(JSON.stringify([date, line, direction, t.service, sourceTrainId])).digest('hex');
  if (id !== `${date}:L${line}:${direction}:${t.service ?? '-'}:${digest}`) invalid('Contradicted provider trip identity');
  const order = catalog.orders[line], last = line === 1 && t.service === 'A' ? order.indexOf(catalog.ghadirId) : order.length - 1;
  const inputs = array(t.stops, JOURNEY_LIMITS.stopsPerTrip, 2);
  if (last < 1 || inputs.length !== last + 1) invalid('Incomplete provider trip');
  let start = 0, previous = 0;
  const stops = inputs.map((value, sequence) => {
    const s = object(value, stopKeys);
    const index = direction === 'out' ? sequence : last - sequence;
    const arrive = epoch(s.arrive), depart = epoch(s.depart);
    if (s.sequence !== sequence || s.lineIndex !== index || s.stationId !== order[index] || arrive > depart) invalid('Invalid provider stop');
    if (sequence === 0) {
      start = arrive;
      if (start < midnight || start >= midnight + 86400 || depart !== arrive) invalid('Invalid provider start');
    } else if (arrive <= previous) invalid('Nonmonotonic provider stops');
    if (depart - start > JOURNEY_LIMITS.tripSpanSeconds) invalid('Provider trip exceeds time bound');
    previous = depart;
    return Object.freeze({ sequence, stationId: order[index], lineIndex: index, arrive, depart });
  });
  return Object.freeze({ id, sourceTrainId, serviceDate: date, line, service: t.service as ModelTrip['service'],
    direction, confidence: t.confidence as string, derivedExtension: t.derivedExtension as boolean, stops: Object.freeze(stops) });
}

async function snapshotDay(value: unknown, catalog: StationCatalog, version: string, line: MetroLine, date: string, dayType: DayType): Promise<ModelDay> {
  const d = object(value, dayKeys);
  if (d.line !== line || d.serviceDate !== date || d.dayType !== dayType || d.dataVersion !== version || typeof d.complete !== 'boolean') invalid('Invalid provider day identity');
  const completeHint = d.complete as boolean;
  const inheritedRejections = integer(d.rejectedTrips, 0, JOURNEY_LIMITS.tripsPerDay);
  const inputs = array(d.trips, JOURNEY_LIMITS.tripsPerDay).slice();
  if (inputs.length + inheritedRejections > JOURNEY_LIMITS.tripsPerDay) invalid('Provider day exceeds capacity');
  const runQuality = array(d.runQuality, JOURNEY_LIMITS.stopsPerTrip).map(x => text(x));
  // Diagnostic details/source train IDs are private. Only these fixed aggregate codes cross this boundary.
  const issueCodes = new Set<string>();
  for (const issue of array(d.issues, JOURNEY_LIMITS.issues)) {
    if (types.isProxy(issue)) invalid('Unsupported provider issue');
    const i = record(issue, ['code'], ['trainId', 'detail']);
    issueCodes.add(i.code === 'invalid_trip' || i.code === 'duplicate_train_id' ? i.code : 'source_incomplete');
  }
  const scanned: ModelTrip[] = [], counts = new Map<string, number>();
  const midnight = tehranToEpoch(date, '00:00:00'); let visited = 0;
  for (const input of inputs) {
    if (++visited % 64 === 0) await yieldTurn();
    try {
      const trip = snapshotTrip(input, catalog, line, date, midnight);
      scanned.push(trip); counts.set(trip.id, (counts.get(trip.id) ?? 0) + 1);
    } catch { issueCodes.add('invalid_trip'); }
  }
  const trips = scanned.filter(trip => counts.get(trip.id) === 1);
  if (trips.length !== scanned.length) issueCodes.add('duplicate_train_id');
  const rejectedTrips = inheritedRejections + inputs.length - trips.length;
  const complete = completeHint && rejectedTrips === 0 && issueCodes.size === 0;
  if (!complete && issueCodes.size === 0) issueCodes.add('source_incomplete');
  return Object.freeze({ line, serviceDate: date, dayType, dataVersion: version, trips: Object.freeze(trips),
    runQuality: Object.freeze(runQuality), complete, rejectedTrips,
    issues: Object.freeze([...issueCodes].map(code => Object.freeze({ code }))) });
}

/**
 * `reuseFrozenSnapshots` is set ONLY for the in-repo model source, whose days are produced by normalizeModelDay and are
 * deeply frozen and cached by identity. An already-validated frozen object can never change, so re-validating the same
 * object on every request is pure CPU cost on the single event loop. Any injected/external provider keeps the full
 * per-call snapshot: its objects may be mutable, proxied or swapped between calls.
 */
export function boundedSource(source: TimetableSource, options: { reuseFrozenSnapshots?: boolean } = {}): TimetableSource {
  const memo = options.reuseFrozenSnapshots ? new WeakMap<object, ModelDay>() : null;
  return Object.freeze({ catalog: source.catalog, dataVersion: source.dataVersion, ...(source.identityVersion === undefined ? {} : { identityVersion: source.identityVersion }), evidence: source.evidence,
    async getDay(line: MetroLine, date: string, dayType: DayType) {
      const raw = await source.getDay(line, date, dayType);
      const reusable = memo !== null && typeof raw === 'object' && raw !== null && Object.isFrozen(raw);
      const hit = reusable ? memo.get(raw) : undefined;
      if (hit && hit.line === line && hit.serviceDate === date && hit.dayType === dayType) return hit;
      const snap = await snapshotDay(raw, source.catalog, source.dataVersion, line, date, dayType);
      if (reusable) memo.set(raw, snap);
      return snap;
    }, stats: () => source.stats(), clear: () => source.clear() });
}
