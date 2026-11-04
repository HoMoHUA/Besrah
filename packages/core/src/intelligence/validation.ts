import { LIMITS, METRIC_UNITS } from './contracts.js';
import type { DecisionInput, MemorySnapshot, MetricKey, Preference } from './contracts.js';

export class InputError extends Error {
  readonly code = 'invalid_input';
  constructor(message: string) { super(message); this.name = 'InputError'; }
}
const fail = (message: string): never => { throw new InputError(message); };
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('expected plain object');
  const result = value as Record<string, unknown>;
  const keys = Object.keys(result);
  if (Reflect.ownKeys(result).length !== keys.length) fail('fields must be enumerable strings');
  if (keys.some(k => !required.includes(k) && !optional.includes(k)) || required.some(k => !Object.hasOwn(result, k))) fail('unexpected or missing fields');
  if (Object.values(Object.getOwnPropertyDescriptors(result)).some(d => d.get || d.set)) fail('accessors are not data');
  return result;
}
function list(value: unknown, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail('array bound exceeded');
  const array = value as unknown[];
  if (Object.keys(array).length !== array.length || Reflect.ownKeys(array).length !== array.length + 1) fail('arrays must contain only dense indexed data');
  for (let i = 0; i < array.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(array, i);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('array entries must be data');
  }
  return array;
}
function text(value: unknown, max: number = LIMITS.text): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('invalid bounded text');
  return value as string;
}
function choice(value: unknown, choices: readonly unknown[]): void { if (!choices.includes(value)) fail('unsupported enum value'); }
function bool(value: unknown): void { if (typeof value !== 'boolean') fail('expected boolean'); }
function number(value: unknown, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(value))) fail('invalid finite nonnegative number');
  return value as number;
}
function version(value: unknown): void { if (value !== 1) fail('unsupported schema version'); }
export function timestamp(value: unknown): number {
  const raw = text(value, 40);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(raw);
  if (!match) return fail('timestamp must include ISO offset');
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const check = new Date(0); check.setUTCFullYear(year, month - 1, day);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return fail('invalid calendar timestamp');
  if (match[7] !== 'Z') {
    const [h, m] = match[7].slice(1).split(':').map(Number);
    if (h > 14 || m > 59 || (h === 14 && m !== 0)) return fail('invalid timestamp offset');
  }
  const result = Date.parse(raw);
  if (!Number.isFinite(result)) return fail('invalid timestamp');
  return result;
}
function unique(values: string[], message = 'duplicate identifiers'): void { if (new Set(values).size !== values.length) fail(message); }
function metricKey(value: unknown): MetricKey { choice(value, Object.keys(METRIC_UNITS)); return value as MetricKey; }
function metricNumber(value: unknown, key: MetricKey): void {
  const n = number(value, key === 'totalCostToman' || key === 'transfers');
  if (key === 'quality' && n > 100) fail('quality unit is score_0_100');
}
function evidence(value: unknown): void {
  const e = object(value, ['id', 'sourceId', 'kind', 'dataVersion', 'live'], ['observedAt', 'retrievedAt', 'validUntil', 'method']);
  text(e.id, 128); text(e.sourceId); text(e.dataVersion, 128); bool(e.live);
  choice(e.kind, ['official', 'field', 'provider', 'osm', 'derived', 'user', 'fixture']);
  for (const k of ['observedAt', 'retrievedAt', 'validUntil']) if (e[k] !== undefined) timestamp(e[k]);
  if (e.method !== undefined) text(e.method);
  if (e.kind === 'derived' && e.method === undefined) fail('derived evidence requires method');
  if (e.kind === 'fixture' && e.live !== false) fail('fixtures cannot be live');
  if (e.validUntil !== undefined && e.observedAt !== undefined && timestamp(e.validUntil) < timestamp(e.observedAt)) fail('validity precedes observation');
}
function evidenceList(value: unknown, min: number): void {
  const entries = list(value, LIMITS.evidencePerMetric, min);
  entries.forEach(evidence);
  unique(entries.map(e => (e as { id: string }).id), 'duplicate evidence IDs');
}
function metric(value: unknown, key: MetricKey): void {
  const head = object(value, ['state', 'unit'], ['value', 'evidence', 'interval', 'assumptions', 'reason']);
  if (head.state === 'known') {
    const m = object(value, ['state', 'unit', 'value', 'evidence']);
    choice(m.unit, [METRIC_UNITS[key]]); metricNumber(m.value, key); evidenceList(m.evidence, 1);
  } else if (head?.state === 'estimated') {
    const m = object(value, ['state', 'unit', 'evidence', 'assumptions'], ['value', 'interval']);
    choice(m.unit, [METRIC_UNITS[key]]); evidenceList(m.evidence, 1);
    list(m.assumptions, 8, 1).forEach(v => text(v));
    if (m.value === undefined && m.interval === undefined) fail('estimate needs value or interval');
    if (m.value !== undefined) metricNumber(m.value, key);
    if (m.interval !== undefined) {
      const bounds = object(m.interval, ['min', 'max']);
      metricNumber(bounds.min, key); metricNumber(bounds.max, key);
      if ((bounds.min as number) > (bounds.max as number)) fail('inverted interval');
      if (m.value !== undefined && ((m.value as number) < (bounds.min as number) || (m.value as number) > (bounds.max as number))) fail('point estimate outside interval');
    }
  } else {
    const m = object(value, ['state', 'unit', 'reason'], ['evidence']);
    choice(m.state, ['unknown', 'stale', 'not_applicable']); choice(m.unit, [METRIC_UNITS[key]]); text(m.reason);
    if (m.evidence !== undefined) evidenceList(m.evidence, 0);
  }
}
function candidate(value: unknown): void {
  const c = object(value, ['schemaVersion', 'id', 'providerId', 'domain', 'taskId', 'equivalenceKey', 'title', 'availability', 'metrics']);
  version(c.schemaVersion); for (const k of ['id', 'providerId', 'taskId', 'equivalenceKey']) text(c[k], 128);
  text(c.title); choice(c.domain, ['transit', 'food', 'shopping']); choice(c.availability, ['available', 'unavailable', 'unknown']);
  const metrics = object(c.metrics, [], Object.keys(METRIC_UNITS));
  for (const [key, value] of Object.entries(metrics)) metric(value, metricKey(key));
}
export function assertPreference(value: unknown): asserts value is Preference {
  const p = object(value, ['schemaVersion', 'id', 'version', 'domain', 'scope', 'kind', 'value', 'provenance', 'confirmedByUser', 'updatedAt', 'consent'], ['requestId', 'expiresAt']);
  version(p.schemaVersion); text(p.id, 128); if (number(p.version, true) < 1) fail('preference version must be positive');
  choice(p.domain, ['global', 'transit', 'food', 'shopping']); choice(p.scope, ['device', 'request']); choice(p.kind, ['objective_order']);
  if (p.scope === 'request') text(p.requestId, 128); else if (p.requestId !== undefined) fail('device preference cannot claim request scope');
  const order = list(p.value, LIMITS.objectives, 1).map(metricKey); unique(order, 'duplicate preference objective');
  const provenance = object(p.provenance, ['kind', 'source']); choice(provenance.kind, ['explicit', 'inferred']); text(provenance.source);
  bool(p.confirmedByUser); const updated = timestamp(p.updatedAt);
  if (p.expiresAt !== undefined && timestamp(p.expiresAt) <= updated) fail('preference expiry must follow update');
  const consent = object(p.consent, ['store', 'use']);
  choice(consent.store, ['granted', 'denied', 'revoked']); choice(consent.use, ['granted', 'denied', 'revoked']);
}
export function assertMemory(value: unknown): asserts value is MemorySnapshot {
  const memory = object(value, ['schemaVersion', 'revision', 'preferences']); version(memory.schemaVersion); number(memory.revision, true);
  const prefs = list(memory.preferences, LIMITS.preferences); prefs.forEach(assertPreference);
  unique(prefs.map(p => (p as Preference).id));
}
export function assertDecisionInput(value: unknown): asserts value is DecisionInput {
  const input = object(value, ['schemaVersion', 'context', 'candidates'], ['memory']); version(input.schemaVersion);
  const c = object(input.context, ['schemaVersion', 'requestId', 'taskId', 'domain', 'at', 'decisionPermission', 'objectives', 'constraints'], ['requestPreferences']);
  version(c.schemaVersion); text(c.requestId, 128); text(c.taskId, 128); choice(c.domain, ['transit', 'food', 'shopping']); timestamp(c.at); choice(c.decisionPermission, ['granted', 'denied']);
  const objectives = list(c.objectives, LIMITS.objectives, 1);
  for (const item of objectives) { const o = object(item, ['metric', 'direction']); metricKey(o.metric); choice(o.direction, ['min', 'max']); }
  unique(objectives.map(o => (o as { metric: string }).metric));
  const constraints = list(c.constraints, LIMITS.constraints);
  for (const item of constraints) { const h = object(item, ['id', 'metric', 'operator', 'bound'], ['requireKnown']); text(h.id, 128); const k = metricKey(h.metric); choice(h.operator, ['lte', 'gte']); metricNumber(h.bound, k); if (h.requireKnown !== undefined) bool(h.requireKnown); }
  unique(constraints.map(h => (h as { id: string }).id));
  if (c.requestPreferences !== undefined) {
    const prefs = list(c.requestPreferences, LIMITS.preferences); prefs.forEach(assertPreference); unique(prefs.map(p => (p as Preference).id));
    if (prefs.some(p => (p as Preference).scope !== 'request')) fail('request overrides must use request scope');
  }
  const candidates = list(input.candidates, LIMITS.candidates); candidates.forEach(candidate); unique(candidates.map(c => (c as { id: string }).id));
  if (input.memory !== undefined) assertMemory(input.memory);
}
