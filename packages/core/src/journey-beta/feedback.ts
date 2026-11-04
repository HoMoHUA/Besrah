// Beta feedback: a separate, strictly validated write boundary. Anonymous, minimal, append-only.
// Feedback NEVER changes the timetable model: it is stored as evidence to be reviewed offline.
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { epochToTehranHms, tehranDay, tehranToEpoch } from '../time.js';
import type { MetroLine, StationCatalog } from '../transit-journey/contracts.js';

export const FEEDBACK_SCHEMA_VERSION = 1;
export const FEEDBACK_KINDS = ['timing_quality', 'train_observation', 'boarding_outcome', 'problem'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
const KIND_CLASS: Record<FeedbackKind, string> = { timing_quality: 'qualitative', train_observation: 'claimed_observation', boarding_outcome: 'journey_outcome', problem: 'problem_report' };

const REPORT_ID = /^[A-Za-z0-9-]{16,64}$/;
const MODEL_VERSION = /^sha256:[0-9a-f]{64}$/;
const STATION_ID = /^METRO-\d{3}$/;
const TRIP_ID = /^\d{4}-\d{2}-\d{2}:L[12]:(out|back):(A|B|-):[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Wire timestamps accept Tehran +03:30 or UTC Z (normalized to Tehran); arbitrary offsets are rejected.
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,3})?(Z|\+03:30)$/;
const BAD_NOTE = /(https?:|www\.|\bt\.me\b|\b[a-z0-9-]+\.(com|ir|org|net|me|io|app)\b|[<>`$\\{}|^~]|[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200b\u200d\u200e\u200f\ufeff])/i;
const LONG_DIGITS = /[0-9\u06f0-\u06f9\u0660-\u0669](?:[\s-]*[0-9\u06f0-\u06f9\u0660-\u0669]){6,}/;
const MAX_TEXT = 200;
const MAX_AGE_SECONDS = 36 * 3600;
const MAX_FUTURE_SECONDS = 120;

export type FeedbackIssue = string;
export interface FeedbackContext { nowSec: number; catalog: StationCatalog; modelVersion: string; horizonDays: number }
export interface NormalizedFeedback {
  v: 1; reportId: string; kind: FeedbackKind; modelVersion: string;
  context: { line: MetroLine; originId: string; destinationId: string; serviceDate: string; tripId: string | null; readyAt: string | null; calendarState: 'known' | 'estimated' | 'unknown' | null };
  timingQuality: 'close' | 'earlier' | 'later' | 'unknown' | null;
  observation: { event: 'train_arrival' | 'train_departure'; stationId: string; direction: 'out' | 'back' | 'unknown'; observedAtEpoch: number; observedAt: string; precision: 'minute' | 'approximate'; timePrecision: 'minute' | 'second' | 'unknown' } | null;
  outcome: { result: 'made_it' | 'missed' | 'unknown'; platformReadyAtEpoch: number | null } | null;
  problem: { category: 'cancelled' | 'different_schedule' | 'wrong_station' | 'wrong_direction' | 'other' | 'unknown' } | null;
  note: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !types.isProxy(v) && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

function exact(value: unknown, path: string, required: readonly string[], optional: readonly string[], issues: FeedbackIssue[]): Obj | null {
  if (!isObj(value)) { issues.push(`${path}:object_required`); return null; }
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  // Never invoke accessors; never echo unknown keys (which could themselves contain PII).
  if (keys.length > allowed.size) issues.push(`${path}:unknown_field`);
  const safe: Obj = {};
  for (const key of keys.slice(0, 32)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== 'string' || !allowed.has(key)) { issues.push(`${path}:unknown_field`); continue; }
    if (!descriptor.enumerable || !('value' in descriptor)) { issues.push(`${path}.${key}:unsupported_property`); continue; }
    safe[key] = descriptor.value;
  }
  for (const key of required) if (safe[key] === undefined) issues.push(`${path}.${key}:required`);
  return safe;
}
const oneOf = <T extends string>(value: unknown, list: readonly T[]): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value) || value.slice(0, 4) < '2000') return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
function epochOf(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 29 || !ISO_OFFSET.test(value) || !validDate(value.slice(0, 10))) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function normalizeNote(value: unknown, path: string, issues: FeedbackIssue[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') { issues.push(`${path}:string_required`); return null; }
  if (value.length > MAX_TEXT * 4) { issues.push(`${path}:too_long`); return null; }
  // Conservative filters are not a complete PII detector. The UI must also ask users not to enter personal data.
  const ascii = value.replace(/[\u06f0-\u06f9]/g, d => String(d.charCodeAt(0) - 0x06f0)).replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/\u066b/g, '.');
  if (BAD_NOTE.test(value) || /[a-z][a-z0-9+.-]*:\/\/|\bgeo:|[^\s@]+@[^\s@]+|\[[^\]]*\]\s*\(/i.test(value) || /[+-]?\d{1,3}\.\d{3,}\s*[,،;\s]\s*[+-]?\d{1,3}\.\d{3,}/.test(ascii)) { issues.push(`${path}:disallowed_content`); return null; }
  const text = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if ([...text].length > MAX_TEXT) { issues.push(`${path}:too_long`); return null; }
  if (BAD_NOTE.test(text) || /^[=+\-@]/.test(text)) { issues.push(`${path}:disallowed_content`); return null; }
  if (LONG_DIGITS.test(text)) { issues.push(`${path}:looks_like_personal_number`); return null; }
  return text;
}

export function validateFeedback(body: unknown, ctx: FeedbackContext): { ok: true; value: NormalizedFeedback } | { ok: false; issues: FeedbackIssue[] } {
  const issues: FeedbackIssue[] = [];
  const top = exact(body, '$', ['v', 'reportId', 'kind', 'consent', 'modelVersion', 'context'], ['timingQuality', 'observation', 'outcome', 'problem', 'note'], issues);
  if (!top) return { ok: false, issues };
  if (top.v !== FEEDBACK_SCHEMA_VERSION) issues.push('$.v:unsupported_version');
  if (typeof top.reportId !== 'string' || !REPORT_ID.test(top.reportId)) issues.push('$.reportId:invalid');
  if (!oneOf(top.kind, FEEDBACK_KINDS)) issues.push('$.kind:invalid');
  const consent = exact(top.consent, '$.consent', ['storeForModelImprovement'], [], issues);
  if (consent && consent.storeForModelImprovement !== true) issues.push('$.consent.storeForModelImprovement:must_be_true');
  if (typeof top.modelVersion !== 'string' || !MODEL_VERSION.test(top.modelVersion)) issues.push('$.modelVersion:invalid');

  const today = tehranDay(ctx.nowSec);
  const todayStart = tehranToEpoch(today, '00:00:00');
  const c = exact(top.context, '$.context', ['line', 'originId', 'destinationId', 'serviceDate'], ['tripId', 'readyAt', 'calendarState'], issues);
  let line: MetroLine | null = null;
  if (c) {
    if (c.line === 1 || c.line === 2) line = c.line; else issues.push('$.context.line:invalid');
    if (line) {
      const order = ctx.catalog.orders[line];
      for (const key of ['originId', 'destinationId'] as const) if (typeof c[key] !== 'string' || !STATION_ID.test(c[key] as string) || !order.includes(c[key] as string)) issues.push(`$.context.${key}:unknown_station`);
      if (c.originId === c.destinationId) issues.push('$.context.destinationId:same_as_origin');
    }
    if (!validDate(c.serviceDate)) issues.push('$.context.serviceDate:invalid');
    else {
      const days = Math.round((tehranToEpoch(c.serviceDate, '00:00:00') - todayStart) / 86400);
      const maxAhead = top.kind === 'problem' ? ctx.horizonDays : 0;
      if (days < -2 || days > maxAhead) issues.push('$.context.serviceDate:out_of_range');
    }
    if (c.tripId !== undefined && (typeof c.tripId !== 'string' || !TRIP_ID.test(c.tripId))) issues.push('$.context.tripId:invalid');
    if (typeof c.tripId === 'string' && typeof c.serviceDate === 'string' && !c.tripId.startsWith(`${c.serviceDate}:L${line}:`)) issues.push('$.context.tripId:contradicts_context');
    if (c.readyAt !== undefined) {
      const ready = epochOf(c.readyAt);
      if (ready === null) issues.push('$.context.readyAt:invalid');
      else {
        if (tehranDay(ready) !== c.serviceDate) issues.push('$.context.readyAt:contradicts_service_date');
        const maxReady = top.kind === 'problem' ? ctx.nowSec + Math.min(7, ctx.horizonDays) * 86400 : ctx.nowSec + MAX_FUTURE_SECONDS;
        if (ready < ctx.nowSec - MAX_AGE_SECONDS || ready > maxReady) issues.push('$.context.readyAt:out_of_range');
      }
    }
    if (c.calendarState !== undefined && !oneOf(c.calendarState, ['known', 'estimated', 'unknown'] as const)) issues.push('$.context.calendarState:invalid');
  }

  const blocks = { timing_quality: 'timingQuality', train_observation: 'observation', boarding_outcome: 'outcome', problem: 'problem' } as const;
  if (oneOf(top.kind, FEEDBACK_KINDS)) {
    for (const [kind, key] of Object.entries(blocks)) {
      if (kind === top.kind && top[key] === undefined) issues.push(`$.${key}:required_for_kind`);
      if (kind !== top.kind && top[key] !== undefined) issues.push(`$.${key}:not_allowed_for_kind`);
    }
  }
  let timingQuality: NormalizedFeedback['timingQuality'] = null;
  if (top.timingQuality !== undefined) { if (oneOf(top.timingQuality, ['close', 'earlier', 'later', 'unknown'] as const)) timingQuality = top.timingQuality; else issues.push('$.timingQuality:invalid'); }

  let observation: NormalizedFeedback['observation'] = null;
  if (top.observation !== undefined) {
    const o = exact(top.observation, '$.observation', ['event', 'stationId', 'direction', 'observedAt'], ['precision', 'timePrecision'], issues);
    if (o) {
      const at = epochOf(o.observedAt);
      if (!oneOf(o.event, ['train_arrival', 'train_departure'] as const)) issues.push('$.observation.event:invalid');
      if (typeof o.stationId !== 'string' || !STATION_ID.test(o.stationId) || !ctx.catalog.stations.some(s => s.id === o.stationId && (line === null || s.lines.includes(line)))) issues.push('$.observation.stationId:unknown_station');
      if (!oneOf(o.direction, ['out', 'back', 'unknown'] as const)) issues.push('$.observation.direction:invalid');
      if (o.precision !== undefined && !oneOf(o.precision, ['minute', 'approximate'] as const)) issues.push('$.observation.precision:invalid');
      if (o.timePrecision !== undefined && !oneOf(o.timePrecision, ['minute', 'second', 'unknown'] as const)) issues.push('$.observation.timePrecision:invalid');
      if (at === null) issues.push('$.observation.observedAt:invalid_or_missing_offset');
      else if (at > ctx.nowSec + MAX_FUTURE_SECONDS) issues.push('$.observation.observedAt:in_future');
      else if (at < ctx.nowSec - MAX_AGE_SECONDS) issues.push('$.observation.observedAt:too_old');
      if (at !== null && typeof c?.serviceDate === 'string' && Math.abs(tehranToEpoch(tehranDay(at), '00:00:00') - tehranToEpoch(c.serviceDate, '00:00:00')) > 86400) issues.push('$.observation.observedAt:contradicts_service_date');
      if (!issues.some(i => i.startsWith('$.observation'))) {
        observation = { event: o.event as 'train_arrival', stationId: o.stationId as string, direction: o.direction as 'out', observedAtEpoch: at as number, observedAt: `${tehranDay(at as number)}T${epochToTehranHms(at as number)}+03:30`, precision: (o.precision as 'minute' | undefined) ?? 'approximate', timePrecision: (o.timePrecision as 'minute' | 'second' | 'unknown' | undefined) ?? (o.precision === 'minute' ? 'minute' : 'unknown') };
      }
    }
  }

  let outcome: NormalizedFeedback['outcome'] = null;
  if (top.outcome !== undefined) {
    const o = exact(top.outcome, '$.outcome', ['result'], ['platformReadyAt'], issues);
    if (o) {
      if (!oneOf(o.result, ['made_it', 'missed', 'unknown'] as const)) issues.push('$.outcome.result:invalid');
      let ready: number | null = null;
      if (o.platformReadyAt !== undefined) {
        ready = epochOf(o.platformReadyAt);
        if (ready === null) issues.push('$.outcome.platformReadyAt:invalid_or_missing_offset');
        else {
          if (ready > ctx.nowSec + MAX_FUTURE_SECONDS || ready < ctx.nowSec - MAX_AGE_SECONDS) issues.push('$.outcome.platformReadyAt:out_of_range');
          if (tehranDay(ready) !== c?.serviceDate) issues.push('$.outcome.platformReadyAt:contradicts_service_date');
        }
      }
      if (!issues.some(i => i.startsWith('$.outcome'))) outcome = { result: o.result as 'made_it', platformReadyAtEpoch: ready };
    }
  }

  let problem: NormalizedFeedback['problem'] = null;
  if (top.problem !== undefined) {
    const p = exact(top.problem, '$.problem', ['category'], [], issues);
    if (p) { if (oneOf(p.category, ['cancelled', 'different_schedule', 'wrong_station', 'wrong_direction', 'other', 'unknown'] as const)) problem = { category: p.category }; else issues.push('$.problem.category:invalid'); }
  }
  const note = normalizeNote(top.note, '$.note', issues);

  if (issues.length) return { ok: false, issues: issues.slice(0, 20) };
  const cc = c as Obj;
  return { ok: true, value: {
    v: 1, reportId: top.reportId as string, kind: top.kind as FeedbackKind, modelVersion: top.modelVersion as string,
    context: { line: line as MetroLine, originId: cc.originId as string, destinationId: cc.destinationId as string, serviceDate: cc.serviceDate as string,
      tripId: (cc.tripId as string | undefined) ?? null, readyAt: cc.readyAt ? (cc.readyAt as string) : null, calendarState: (cc.calendarState as 'known' | undefined) ?? null },
    timingQuality, observation, outcome, problem, note,
  } };
}

export interface StoredFeedback extends Omit<NormalizedFeedback, 'v'> {
  schema: 1; receivedAt: string; reportedAt: string; sourceId: string;
  consent: { granted: true; version: 'r2a-pb-feedback-v1'; purpose: 'model_improvement'; provenance: 'explicit_client_opt_in' };
  provenance: { source: 'anonymous_public_report'; independentlyVerified: false; modelTimetableUpdated: false };
  class: string; identity: 'anonymous_unverified'; review: 'unreviewed';
  modelVersionMatches: boolean;
  comparison: { tripMatch: 'matched' | 'unmatched' | 'not_provided' | 'model_version_mismatch'; modelEventAt: string | null; deltaSeconds: number | null };
}

export function toStored(value: NormalizedFeedback, extra: { receivedAtEpoch: number; modelVersionMatches: boolean; comparison: StoredFeedback['comparison'] }): StoredFeedback {
  const { v: _v, ...rest } = value;
  const reportedAt = new Date(extra.receivedAtEpoch * 1000).toISOString();
  return { schema: 1, ...rest, receivedAt: reportedAt, reportedAt, sourceId: `anonymous_feedback:${value.reportId}`,
    consent: { granted: true, version: 'r2a-pb-feedback-v1', purpose: 'model_improvement', provenance: 'explicit_client_opt_in' },
    provenance: { source: 'anonymous_public_report', independentlyVerified: false, modelTimetableUpdated: false },
    class: KIND_CLASS[value.kind], identity: 'anonymous_unverified', review: 'unreviewed', modelVersionMatches: extra.modelVersionMatches, comparison: { ...extra.comparison } };
}

export type AppendResult = 'stored' | 'duplicate' | 'full' | 'unavailable';
export interface FeedbackStoreOptions {
  dir: string; maxFileBytes: number; maxPerDay: number; clock?: () => number;
  /** Total logical bytes INCLUDING metadata, lock and in-flight maintenance temp files. Default: maxFileBytes. */
  maxTotalBytes?: number; maxPending?: number; maxSeenIds?: number; retentionDays?: number;
}
export const FEEDBACK_REJECTION_CODES = ['malformed_request', 'forbidden_origin', 'rate_limited', 'invalid_payload', 'storage_full', 'storage_unavailable', 'busy', 'model_unavailable', 'feedback_timeout', 'disabled', 'other'] as const;
const MAX_LINE_BYTES = 8192;
const MAX_METADATA_BYTES = 16384;
const MAX_DIRECTORY_ENTRIES = 256;
const RAW_FILE = /^feedback-(\d{4}-(?:0[1-9]|1[0-2]))\.jsonl$/;
const REJECTION_FILE = /^rejections-(\d{4}-(?:0[1-9]|1[0-2]))\.json$/;
const LOCK_FILE = '.feedback.lock';
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const PROVENANCE_KEYS = ['reportedAt', 'sourceId', 'consent', 'provenance'];
// Internal schema layouts are fixed; reuse their allowlists during bounded JSONL recovery.
const storageShapes = new Map<string, ReadonlySet<string>>();
const signature = (s: Stats) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';
const storageError = (code: string) => new Error(`feedback_${code}`);
const positiveInt = (n: number, max: number) => Number.isSafeInteger(n) && n > 0 && n <= max;
function canonicalUtc(value: unknown): value is string {
  return typeof value === 'string' && UTC_ISO.test(value) && validDate(value.slice(0, 10)) && new Date(value).toISOString() === value;
}
function strictShape(value: unknown, required: readonly string[], optional: readonly string[] = []): Obj {
  if (!isObj(value)) throw storageError('corrupt');
  const schema = required.join(',') + '|' + optional.join(',');
  let allowed = storageShapes.get(schema);
  if (!allowed) { allowed = new Set([...required, ...optional]); storageShapes.set(schema, allowed); }
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.size) throw storageError('corrupt');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== 'string' || !allowed.has(key) || !descriptor.enumerable || !('value' in descriptor)) throw storageError('corrupt');
  }
  if (required.some(key => !Object.hasOwn(value, key) || value[key] === undefined)) throw storageError('corrupt');
  return value;
}

/** Validate disk records too: corruption is never skipped and never repaired implicitly.
 * Legacy schema-1 records lacking the four additive provenance fields remain readable, unchanged. */
function assertStored(value: unknown, legacy = false): asserts value is StoredFeedback {
  const provenanceKeys = PROVENANCE_KEYS;
  const r = strictShape(value, ['schema', 'reportId', 'kind', 'modelVersion', 'context', 'timingQuality', 'observation', 'outcome', 'problem', 'note', 'receivedAt', 'class', 'identity', 'review', 'modelVersionMatches', 'comparison', ...(legacy ? [] : provenanceKeys)], legacy ? provenanceKeys : []);
  if (r.schema !== 1 || typeof r.reportId !== 'string' || !REPORT_ID.test(r.reportId) || !oneOf(r.kind, FEEDBACK_KINDS) || typeof r.modelVersion !== 'string' || !MODEL_VERSION.test(r.modelVersion) || !canonicalUtc(r.receivedAt) || r.identity !== 'anonymous_unverified' || r.review !== 'unreviewed' || r.class !== KIND_CLASS[r.kind] || typeof r.modelVersionMatches !== 'boolean') throw storageError('corrupt');
  const c = strictShape(r.context, ['line', 'originId', 'destinationId', 'serviceDate', 'tripId', 'readyAt', 'calendarState']);
  if ((c.line !== 1 && c.line !== 2) || typeof c.originId !== 'string' || !STATION_ID.test(c.originId) || typeof c.destinationId !== 'string' || !STATION_ID.test(c.destinationId) || c.originId === c.destinationId || !validDate(c.serviceDate) || (c.tripId !== null && (typeof c.tripId !== 'string' || !TRIP_ID.test(c.tripId) || !c.tripId.startsWith(`${c.serviceDate}:L${c.line}:`))) || (c.readyAt !== null && (epochOf(c.readyAt) === null || tehranDay(epochOf(c.readyAt)!) !== c.serviceDate)) || (c.calendarState !== null && !oneOf(c.calendarState, ['known', 'estimated', 'unknown']))) throw storageError('corrupt');
  for (const [kind, block] of Object.entries({ timing_quality: 'timingQuality', train_observation: 'observation', boarding_outcome: 'outcome', problem: 'problem' })) if ((kind === r.kind) === (r[block] === null)) throw storageError('corrupt');
  if (r.timingQuality !== null && !oneOf(r.timingQuality, ['close', 'earlier', 'later', 'unknown'])) throw storageError('corrupt');
  if (r.observation !== null) {
    const o = strictShape(r.observation, ['event', 'stationId', 'direction', 'observedAtEpoch', 'observedAt', 'precision'], ['timePrecision']);
    if (o.timePrecision !== undefined && !oneOf(o.timePrecision, ['minute', 'second', 'unknown'])) throw storageError('corrupt');
    if (!oneOf(o.event, ['train_arrival', 'train_departure']) || typeof o.stationId !== 'string' || !STATION_ID.test(o.stationId) || !oneOf(o.direction, ['out', 'back', 'unknown']) || !oneOf(o.precision, ['minute', 'approximate']) || epochOf(o.observedAt) === null || o.observedAtEpoch !== epochOf(o.observedAt)) throw storageError('corrupt');
  }
  if (r.outcome !== null) {
    const o = strictShape(r.outcome, ['result', 'platformReadyAtEpoch']);
    if (!oneOf(o.result, ['made_it', 'missed', 'unknown']) || (o.platformReadyAtEpoch !== null && (typeof o.platformReadyAtEpoch !== 'number' || !Number.isSafeInteger(o.platformReadyAtEpoch) || o.platformReadyAtEpoch < 0))) throw storageError('corrupt');
  }
  if (r.problem !== null && !oneOf(strictShape(r.problem, ['category']).category, ['cancelled', 'different_schedule', 'wrong_station', 'wrong_direction', 'other', 'unknown'])) throw storageError('corrupt');
  const noteIssues: string[] = [];
  if (normalizeNote(r.note, '$.note', noteIssues) !== r.note || noteIssues.length) throw storageError('corrupt');
  const comparison = strictShape(r.comparison, ['tripMatch', 'modelEventAt', 'deltaSeconds']);
  if (!oneOf(comparison.tripMatch, ['matched', 'unmatched', 'not_provided', 'model_version_mismatch']) || (comparison.modelEventAt !== null && epochOf(comparison.modelEventAt) === null) || (comparison.deltaSeconds !== null && (typeof comparison.deltaSeconds !== 'number' || !Number.isSafeInteger(comparison.deltaSeconds)))) throw storageError('corrupt');
  if ((c.tripId === null) !== (comparison.tripMatch === 'not_provided')
    || (c.tripId !== null && !r.modelVersionMatches && comparison.tripMatch !== 'model_version_mismatch')
    || (r.modelVersionMatches && comparison.tripMatch === 'model_version_mismatch')) throw storageError('corrupt');
  if (r.observation !== null && comparison.tripMatch === 'matched') {
    const o = r.observation as Obj;
    if (o.direction === 'unknown' || comparison.modelEventAt === null || comparison.deltaSeconds === null
      || (o.observedAtEpoch as number) - epochOf(comparison.modelEventAt)! !== comparison.deltaSeconds) throw storageError('corrupt');
  } else if (comparison.modelEventAt !== null || comparison.deltaSeconds !== null) throw storageError('corrupt');
  if (provenanceKeys.some(k => r[k] !== undefined)) {
    if (r.reportedAt !== r.receivedAt || r.sourceId !== `anonymous_feedback:${r.reportId}`) throw storageError('corrupt');
    const consent = strictShape(r.consent, ['granted', 'version', 'purpose', 'provenance']);
    const provenance = strictShape(r.provenance, ['source', 'independentlyVerified', 'modelTimetableUpdated']);
    if (consent.granted !== true || consent.version !== 'r2a-pb-feedback-v1' || consent.purpose !== 'model_improvement' || consent.provenance !== 'explicit_client_opt_in' || provenance.source !== 'anonymous_public_report' || provenance.independentlyVerified !== false || provenance.modelTimetableUpdated !== false) throw storageError('corrupt');
  }
}

/** One cooperating writer per directory. O_EXCL lock deliberately fails closed after a crash:
 * stop ALL writers, inspect any torn records/temp files, then explicitly remove the stale lock.
 * No automatic repair, TTL lock stealing, retention timer, or timetable mutation occurs here.
 * flush() is a terminal drain+close (idempotent), not a periodic checkpoint.
 * Explicit maintenance hooks use the same lock. Back up/export before privacy deletion.
 */
export function createFeedbackStore(options: FeedbackStoreOptions) {
  const clock = options.clock ?? Date.now;
  const maxTotal = options.maxTotalBytes ?? options.maxFileBytes;
  const maxPending = options.maxPending ?? 64, maxSeen = options.maxSeenIds ?? 20000, retentionDays = options.retentionDays ?? 30;
  const seen = new Set<string>(), daily = new Map<string, number>();
  const rejections = new Map<string, Map<string, number>>();
  let files = new Map<string, Stats>(), directoryIdentity = '', lockIdentity = '';
  let ready: Promise<void> | undefined, chain: Promise<unknown> = Promise.resolve(), closing: Promise<void> | undefined;
  let pending = 0, closed = false, accepting = true, failed = false;
  let flushTimer: NodeJS.Timeout | undefined;
  const pathFor = (name: string) => join(options.dir, name);
  const nowIso = () => new Date(clock()).toISOString();
  const total = () => [...files.values()].reduce((sum, s) => sum + s.size, 0);
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const task = chain.then(run); chain = task.catch(() => undefined); return task;
  };
  const fileSafe = (s: Stats) => s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && (s.mode & 0o7777) === 0o600 && s.uid === process.getuid!();

  async function verifyDirectory(create = false): Promise<void> {
    if (!isAbsolute(options.dir) || resolve(options.dir) !== options.dir || options.dir === '/') throw storageError('unsafe_path');
    // Check every component BEFORE creating descendants: recursive mkdir must not follow symlinks.
    let part = '/';
    for (const segment of options.dir.slice(1).split('/')) {
      part = join(part, segment);
      let s: Stats;
      try { s = await lstat(part); } catch (e) {
        if (!create || !missing(e)) throw e;
        await mkdir(part, { mode: 0o700 }); s = await lstat(part);
        const parent = await open(await realpath(dirname(part)), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { await parent.sync(); } finally { await parent.close(); }
      }
      if (s.isSymbolicLink()) {
        // systemd DynamicUser StateDirectory may expose /var/lib/<name> via a root-managed
        // /var/lib/private alias. Allow trusted ancestors only, never the final feedback directory.
        if (part === options.dir || s.uid !== 0) throw storageError('unsafe_path');
        const canonical = await realpath(part); let physical = '/';
        for (const component of canonical.slice(1).split('/')) {
          physical = join(physical, component); const ancestor = await lstat(physical);
          if (!ancestor.isDirectory() || ancestor.isSymbolicLink() || (ancestor.mode & 0o022) !== 0 || (ancestor.uid !== 0 && ancestor.uid !== process.getuid!())) throw storageError('unsafe_path');
        }
        s = await lstat(canonical);
      }
      if (!s.isDirectory() || (s.mode & 0o022) !== 0 || (s.uid !== 0 && s.uid !== process.getuid!())) throw storageError('unsafe_path');
      if (part === options.dir) {
        if ((s.mode & 0o7777) !== 0o700 || s.uid !== process.getuid!()) throw storageError('unsafe_permissions');
        const identity = `${s.dev}:${s.ino}`;
        if (directoryIdentity && directoryIdentity !== identity) throw storageError('directory_changed');
        directoryIdentity = identity;
      }
    }
  }
  async function syncDirectory(): Promise<void> {
    const handle = await open(options.dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async function inventory(): Promise<Map<string, Stats>> {
    await verifyDirectory();
    const found = new Map<string, Stats>();
    const entries = await opendir(options.dir);
    for await (const entry of entries) {
      if (found.size >= MAX_DIRECTORY_ENTRIES || (!RAW_FILE.test(entry.name) && !REJECTION_FILE.test(entry.name) && ![LOCK_FILE, 'quota.json', 'reviews.jsonl'].includes(entry.name))) throw storageError('unexpected_file');
      const s = await lstat(pathFor(entry.name));
      if (!fileSafe(s)) throw storageError('unsafe_file');
      if (s.size > maxTotal || (RAW_FILE.test(entry.name) && s.size > options.maxFileBytes) || ((REJECTION_FILE.test(entry.name) || entry.name === 'quota.json' || entry.name === LOCK_FILE) && s.size > MAX_METADATA_BYTES)) throw storageError('quota_exceeded');
      found.set(entry.name, s);
    }
    if ([...found.values()].reduce((n, s) => n + s.size, 0) > maxTotal) throw storageError('quota_exceeded');
    return found;
  }
  async function audit(): Promise<void> {
    const found = await inventory();
    if (found.size !== files.size || [...files].some(([name, s]) => !found.has(name) || signature(found.get(name)!) !== signature(s))) throw storageError('external_change');
  }
  async function secureOpen(name: string, flags: number, expected = files.get(name)): Promise<FileHandle> {
    const handle = await open(pathFor(name), flags | constants.O_NOFOLLOW, 0o600);
    try {
      const s = await handle.stat();
      if (!fileSafe(s) || (expected && signature(s) !== signature(expected))) throw storageError('file_changed');
      return handle;
    } catch (e) { await handle.close(); throw e; }
  }
  async function readMetadata(name: string): Promise<Obj> {
    const handle = await secureOpen(name, constants.O_RDONLY);
    try {
      const expected = files.get(name)!;
      if (expected.size > MAX_METADATA_BYTES) throw storageError('metadata_too_large');
      const bytes = Buffer.alloc(expected.size); let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw storageError('short_read'); offset += bytesRead;
      }
      if (signature(await handle.stat()) !== signature(expected)) throw storageError('file_changed');
      return JSON.parse(UTF8.decode(bytes)) as Obj;
    } finally { await handle.close(); }
  }
  async function* records(name: string): AsyncGenerator<StoredFeedback> {
    const handle = await secureOpen(name, constants.O_RDONLY);
    const chunk = Buffer.alloc(131072); let tail = Buffer.alloc(0), offset = 0;
    try {
      while (true) {
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset); if (!bytesRead) break;
        offset += bytesRead; const buffer = Buffer.concat([tail, chunk.subarray(0, bytesRead)]); let start = 0;
        for (let end = buffer.indexOf(10, start); end !== -1; end = buffer.indexOf(10, start)) {
          if (end === start || end - start > MAX_LINE_BYTES) throw storageError('corrupt');
          const record: unknown = JSON.parse(UTF8.decode(buffer.subarray(start, end)));
          assertStored(record, true);
          if (record.receivedAt.slice(0, 7) !== RAW_FILE.exec(name)![1]) throw storageError('corrupt');
          yield record; start = end + 1;
        }
        tail = Buffer.from(buffer.subarray(start)); if (tail.length > MAX_LINE_BYTES) throw storageError('line_too_large');
      }
      if (tail.length || offset !== files.get(name)!.size) throw storageError('torn_line');
      if (signature(await handle.stat()) !== signature(files.get(name)!)) throw storageError('file_changed');
    } finally { await handle.close(); }
  }
  function rejectionCounts(value: unknown, month: string): Obj {
    const r = strictShape(value, ['month', 'counts', 'updatedAt']);
    if (r.month !== month || !canonicalUtc(r.updatedAt)) throw storageError('corrupt');
    const counts = strictShape(r.counts, [], FEEDBACK_REJECTION_CODES);
    for (const n of Object.values(counts)) if (typeof n !== 'number' || !positiveInt(n, Number.MAX_SAFE_INTEGER)) throw storageError('corrupt');
    return counts;
  }
  async function rebuildIndex(): Promise<void> {
    seen.clear(); daily.clear();
    for (const name of [...files.keys()].sort()) {
      if (RAW_FILE.test(name)) {
        for await (const r of records(name)) {
          if (seen.has(r.reportId) || seen.size >= maxSeen) throw storageError('duplicate_or_index_full');
          seen.add(r.reportId); const day = r.receivedAt.slice(0, 10); daily.set(day, (daily.get(day) ?? 0) + 1);
        }
        // A previous process may have died after a complete write but before fsync/ACK.
        // Certify recovered bytes before any duplicate response can acknowledge them.
        const handle = await secureOpen(name, constants.O_RDONLY);
        try { await handle.sync(); } finally { await handle.close(); }
      }
      if (REJECTION_FILE.test(name)) rejectionCounts(await readMetadata(name), REJECTION_FILE.exec(name)![1]);
    }
    if (files.has('quota.json')) {
      const ledger = strictShape(await readMetadata('quota.json'), ['schema', 'semantics', 'counts']);
      if (ledger.schema !== 1 || ledger.semantics !== 'deleted_intake_offsets' || !isObj(ledger.counts) || Object.keys(ledger.counts).length > 366) throw storageError('corrupt');
      for (const [day, n] of Object.entries(ledger.counts)) {
        if (!validDate(day) || typeof n !== 'number' || !positiveInt(n, Number.MAX_SAFE_INTEGER)) throw storageError('corrupt');
        const sum = (daily.get(day) ?? 0) + n;
        if (!Number.isSafeInteger(sum)) throw storageError('counter_overflow');
        daily.set(day, sum);
      }
    }
  }
  async function init(): Promise<void> {
    if (!positiveInt(options.maxFileBytes, 64 * 1024 * 1024) || !positiveInt(maxTotal, 64 * 1024 * 1024) || !positiveInt(options.maxPerDay, 1000000) || !positiveInt(maxPending, 256) || !positiveInt(maxSeen, 50000) || !positiveInt(retentionDays, 365)) throw storageError('invalid_options');
    await verifyDirectory(true);
    const handle = await open(pathFor(LOCK_FILE), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(`${process.pid}:${randomUUID()}\n`); await handle.sync(); lockIdentity = signature(await handle.stat()); } finally { await handle.close(); }
    await syncDirectory(); files = await inventory(); await rebuildIndex();
  }
  async function ensureReady(): Promise<void> {
    if (failed) throw storageError('unavailable');
    ready ??= init(); await ready; await audit();
  }
  async function refresh(name: string): Promise<void> { files.set(name, await lstat(pathFor(name))); }
  async function writeAll(handle: FileHandle, bytes: Buffer): Promise<void> {
    let offset = 0;
    while (offset < bytes.length) { const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset); if (!bytesWritten) throw storageError('short_write'); offset += bytesWritten; }
  }
  async function atomicMetadata(name: string, value: unknown): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    // Account for the old target AND temporary file until rename; never exceed the configured physical-content budget.
    if (bytes.length > MAX_METADATA_BYTES || total() + bytes.length > maxTotal) throw storageError('full');
    const temp = `.feedback-${randomUUID()}.tmp`;
    const handle = await secureOpen(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    try { await writeAll(handle, bytes); await handle.sync(); } finally { await handle.close(); }
    await rename(pathFor(temp), pathFor(name)); await syncDirectory(); await refresh(name);
  }
  async function persistRejections(): Promise<void> {
    if (!rejections.size) return;
    await ensureReady();
    for (const [month, active] of rejections) {
      const snapshot = new Map(active), name = `rejections-${month}.json`;
      const counts: Obj = files.has(name) ? rejectionCounts(await readMetadata(name), month) : {};
      for (const [reason, n] of snapshot) {
        const next = Number(counts[reason] ?? 0) + n;
        if (!Number.isSafeInteger(next)) throw storageError('counter_overflow'); counts[reason] = next;
      }
      await atomicMetadata(name, { month, counts, updatedAt: nowIso() });
      // Increments that arrived during awaited I/O remain in memory for the next drain.
      for (const [reason, n] of snapshot) { const left = active.get(reason)! - n; if (left) active.set(reason, left); else active.delete(reason); }
      if (!active.size) rejections.delete(month);
    }
  }
  function append(record: StoredFeedback): Promise<AppendResult> {
    if (!accepting || failed) return Promise.resolve('unavailable');
    if (pending >= maxPending) return Promise.resolve('full');
    let bytes: Buffer;
    try { assertStored(record); bytes = Buffer.from(JSON.stringify(record) + '\n'); if (bytes.length > MAX_LINE_BYTES) return Promise.resolve('full'); } catch { return Promise.resolve('unavailable'); }
    // Snapshot before enqueue: caller mutation cannot alter the accepted record or its size.
    const snapshot = JSON.parse(bytes.toString('utf8')) as StoredFeedback;
    pending++;
    return enqueue(async (): Promise<AppendResult> => {
      try {
        await ensureReady();
        if (seen.has(snapshot.reportId)) return 'duplicate';
        const iso = nowIso(), day = iso.slice(0, 10), name = `feedback-${iso.slice(0, 7)}.jsonl`;
        if (snapshot.receivedAt.slice(0, 10) !== day || Math.abs(Date.parse(snapshot.receivedAt) - clock()) > MAX_FUTURE_SECONDS * 1000) return 'unavailable';
        if (seen.size >= maxSeen || (daily.get(day) ?? 0) >= options.maxPerDay || (files.get(name)?.size ?? 0) + bytes.length > options.maxFileBytes || total() + bytes.length > maxTotal) return 'full';
        const exists = files.has(name);
        const handle = await secureOpen(name, constants.O_WRONLY | constants.O_APPEND | (exists ? 0 : constants.O_CREAT | constants.O_EXCL));
        try { await writeAll(handle, bytes); await handle.sync(); } finally { await handle.close(); }
        if (!exists) await syncDirectory(); await refresh(name);
        seen.add(snapshot.reportId); daily.set(day, (daily.get(day) ?? 0) + 1); return 'stored';
      } catch { failed = true; return 'unavailable'; }
      finally { pending--; }
    });
  }
  async function maintenance(keep: (record: StoredFeedback) => boolean): Promise<number> {
    await ensureReady();
    // Persist deleted-intake OFFSETS before removing raw records: retained + deleted counts
    // survive later appends/restarts. Interrupted maintenance may overcount, never reset quota.
    const cutoff = clock() - 365 * 86400000;
    const dedupeCutoff = clock() - retentionDays * 86400000;
    const previous = files.has('quota.json') ? (await readMetadata('quota.json')).counts as Record<string, number> : {};
    const counts: Record<string, number> = Object.fromEntries(Object.entries(previous).filter(([day]) => Date.parse(`${day}T00:00:00Z`) >= cutoff));
    // Expired days are outside the configured raw/ID window; no ledger write is needed
    // to unlink a wholly expired month at the byte cap. Privacy deletion inside the window preserves intake.
    for (const name of [...files.keys()].filter(name => RAW_FILE.test(name))) for await (const record of records(name)) if (!keep(record) && Date.parse(record.receivedAt) >= dedupeCutoff) {
      const day = record.receivedAt.slice(0, 10); const sum = (counts[day] ?? 0) + 1;
      if (!Number.isSafeInteger(sum)) throw storageError('counter_overflow'); counts[day] = sum;
    }
    if (Object.keys(counts).length > 366) throw storageError('index_full');
    if (JSON.stringify(counts) !== JSON.stringify(previous)) await atomicMetadata('quota.json', { schema: 1, semantics: 'deleted_intake_offsets', counts });
    let removed = 0;
    for (const name of [...files.keys()].filter(name => RAW_FILE.test(name)).sort()) {
      let kept = 0, discarded = 0;
      for await (const record of records(name)) { if (keep(record)) kept++; else discarded++; }
      if (!discarded) continue;
      if (!kept) { await unlink(pathFor(name)); await syncDirectory(); files.delete(name); removed += discarded; continue; }
      // Explicit privacy rewrite is atomic per month, bounded and never touches reviews/calibration/held-out files.
      const temp = `.feedback-${randomUUID()}.tmp`;
      const handle = await secureOpen(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL); let written = 0;
      try {
        for await (const record of records(name)) if (keep(record)) {
          const bytes = Buffer.from(JSON.stringify(record) + '\n');
          if (total() + written + bytes.length > maxTotal) throw storageError('full');
          await writeAll(handle, bytes); written += bytes.length;
        }
        await handle.sync();
      } catch (e) { await handle.close(); await unlink(pathFor(temp)); throw e; }
      await handle.close(); await rename(pathFor(temp), pathFor(name)); await syncDirectory(); await refresh(name); removed += discarded;
    }
    await rebuildIndex(); return removed;
  }
  function explicit<T>(run: () => Promise<T>): Promise<T> {
    if (!accepting || failed) return Promise.reject(storageError('unavailable'));
    if (pending >= maxPending) return Promise.reject(storageError('busy'));
    pending++;
    return enqueue(async () => { try { return await run(); } catch (e) { failed = true; throw e; } finally { pending--; } });
  }
  function flush(): Promise<void> {
    if (closing) return closing;
    accepting = false;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = undefined; }
    closing = enqueue(async () => {
      try {
        // Existing queued appends run before this closure. Finish any initialization await
        // BEFORE the final counter drain: no await may separate an empty map from closed=true.
        if (ready) await ready;
        while (rejections.size) await persistRejections();
        if (failed) throw storageError('unavailable');
      } catch (e) { failed = true; throw e; }
      finally {
        closed = true;
        if (lockIdentity) {
          const s = await lstat(pathFor(LOCK_FILE));
          if (!fileSafe(s) || signature(s) !== lockIdentity) { failed = true; throw storageError('lock_changed'); }
          await unlink(pathFor(LOCK_FILE)); await syncDirectory(); files.delete(LOCK_FILE); lockIdentity = '';
        }
      }
    });
    return closing;
  }
  return {
    append,
    /** Fixed aggregate codes only; arbitrary strings are folded to "other", never persisted. */
    reject(reason: string): void {
      if (closed || failed) return;
      const month = nowIso().slice(0, 7);
      if (!rejections.has(month) && rejections.size >= 2) { failed = true; return; }
      const counts = rejections.get(month) ?? new Map<string, number>(); rejections.set(month, counts);
      const code = oneOf(reason, FEEDBACK_REJECTION_CODES) ? reason : 'other';
      const next = (counts.get(code) ?? 0) + 1; if (!Number.isSafeInteger(next)) { failed = true; return; } counts.set(code, next);
      if (!flushTimer && accepting) { flushTimer = setTimeout(() => { flushTimer = undefined; void enqueue(persistRejections).catch(() => { failed = true; }); }, 30000); flushTimer.unref(); }
    },
    flush,
    get failed() { return failed; },
    /** Total logical content bytes, all months + metadata. Throws on unsafe/unreadable storage (never a false zero). */
    diskBytes(): Promise<number> { return explicit(async () => { await ensureReady(); return total(); }); },
    /** Streaming export, callback must not await methods on this same store. */
    exportRecords(visitor: (record: StoredFeedback) => void | Promise<void>): Promise<number> {
      return explicit(async () => { await ensureReady(); let count = 0; for (const name of [...files.keys()].filter(name => RAW_FILE.test(name)).sort()) for await (const record of records(name)) { await visitor(record); count++; } return count; });
    },
    /** Explicit offline/operator action; default 30 days by server receivedAt. No scheduled pruning. */
    applyRetention(): Promise<number> { const cutoff = clock() - retentionDays * 86400000; return explicit(() => maintenance(record => Date.parse(record.receivedAt) >= cutoff)); },
    /** Explicit privacy deletion only; IDs are not users. No API route is installed. */
    deleteReports(reportIds: readonly string[]): Promise<number> {
      if (!Array.isArray(reportIds) || reportIds.length > 500 || reportIds.some(id => typeof id !== 'string' || !REPORT_ID.test(id))) return Promise.reject(storageError('invalid_ids'));
      const ids = new Set(reportIds); return explicit(() => maintenance(record => !ids.has(record.reportId)));
    },
  };
}
