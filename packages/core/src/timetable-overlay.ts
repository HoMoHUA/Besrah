// Versioned, provenance-aware timetable overlay for line 1 normal days (Sat-Wed).
//
// The baseline generator (engine.ts scheduleFor) is untouched and stays the rollback. An overlay is data, never code:
// it names its sources (with SHA-256), declares which evidence class each window rests on, and is validated before
// it can change a single departure. Any problem (missing file, bad JSON, schema, hash mismatch) selects the baseline
// generator and records why; it never produces a partially applied timetable.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scheduleFor, type Confidence, type DaySchedule, type FixedDeparture } from './engine.js';
import type { DayType } from './time.js';
import { loadThursdayModel } from './thursday-field.js';

export const OVERLAY_SCHEMA_VERSION = 1;
export const REPO_ROOT = new URL('../../../', import.meta.url);
export const DEFAULT_OVERLAY_PATH = new URL('data/timetable/normal-day-overlay-v1.json', REPO_ROOT);

export type Coverage = 'field_observed_timed' | 'field_observed_board' | 'extrapolated' | 'site_headway_assumed';
export type PhasePolicy = { fixedS: number } | { policy: 'max_min_separation_from_documented_B' };
export interface OverlayWindow {
  id: string; fromS: number; toS: number; gridS: number; phase: PhasePolicy;
  coverage: Coverage; confidence: Confidence;
  /** Single-sequence slot rule: a grid slot holding a documented B departure is that B train's slot, not a second train. */
  absorbIntoDocumentedB: boolean; toInclusive?: boolean; evidence: string[];
}
/**
 * `runtime` sources decide departures: they are hash-checked on every load and a mismatch rejects the overlay.
 * `provenance` sources document the evidence (field logs, photos); they are hash-pinned and verified by the repository
 * test suite, but a missing evidence file must never take the timetable down in production.
 */
export type SourceRole = 'runtime' | 'provenance';
export interface OverlaySource { id: string; kind: string; role: SourceRole; path: string; sha256: string }
export interface NormalDayOverlay {
  schemaVersion: 1; overlayId: string; appliesTo: 'normal'; line: 1;
  sources: OverlaySource[];
  serviceDay: { startS: number; endS: number };
  /** Tehran service days on which the `measured_phase` windows were actually timed. */
  observedServiceDates: string[];
  guardS: number;
  B: { sourceId: string; column: 'sat_to_wed'; presenceToVakilabadOffsetS: number; offsetQuality: 'derived'; confidence: Confidence };
  A: { windows: OverlayWindow[] };
  notes: string[];
}

export interface AbsorbedSlot { windowId: string; slotS: number; documentedBS: number; deltaS: number }
export interface PhaseDecision { windowId: string; phaseS: number; method: string; minSeparationS: number; candidatesEvaluated: number }
export interface OverlayReport {
  overlayId: string; countA: number; countB: number;
  perWindow: Array<{ windowId: string; coverage: Coverage; confidence: Confidence; count: number }>;
  absorbed: AbsorbedSlot[]; phaseDecisions: PhaseDecision[];
  minAbSeparationS: number | null; exactCollisions: number; collisionsWithinGuard: number;
}

export type TimetableState = 'applied' | 'baseline_no_overlay' | 'baseline_missing' | 'baseline_invalid';

/**
 * Shown on every normal-day line 1 answer while the corrected timetable could not be loaded. The baseline generator
 * is still served (availability), but it is known to place two independent trains at the same minute, so it must say so.
 */
export const TIMETABLE_DEGRADED_NOTICE = 'نسخهٔ اصلاح شدهٔ برنامهٔ روز عادی بارگذاری نشده است؛ برنامهٔ پایه نمایش داده می شود و ممکن است دو قطار را با یک ساعت حرکت نشان دهد. زمان ها تخمینی است.';
export const isTimetableDegraded = (status: { state: TimetableState }): boolean => status.state === 'baseline_missing' || status.state === 'baseline_invalid';
export interface TimetableStatus { state: TimetableState; overlayId: string | null; digest: string | null; reason: string | null }
export interface TimetableModel {
  /** Short, deterministic token mixed into trip event identities; changes whenever the applied overlay changes. */
  readonly identityVersion: string;
  readonly status: TimetableStatus;
  readonly report: OverlayReport | null;
  readonly overlay: NormalDayOverlay | null;
  scheduleFor(dayType: DayType): DaySchedule;
  /** Extra material for the model fingerprint (overlay + source bytes); empty for the baseline. */
  fingerprintParts(): Buffer[];
}

const CONFIDENCES = new Set<Confidence>(['measured_phase', 'official_sheet_phase', 'site_headway_assumed_phase']);
const COVERAGES = new Set<Coverage>(['field_observed_timed', 'field_observed_board', 'extrapolated', 'site_headway_assumed']);
export class OverlayError extends Error {}
const fail = (message: string): never => { throw new OverlayError(message); };
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSeconds = (v: unknown, min = 0, max = 86_400): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

export function validateOverlay(raw: unknown): NormalDayOverlay {
  if (!isRecord(raw)) return fail('overlay is not an object');
  if (raw.schemaVersion !== OVERLAY_SCHEMA_VERSION) return fail(`unsupported schemaVersion ${String(raw.schemaVersion)}`);
  if (typeof raw.overlayId !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(raw.overlayId)) return fail('invalid overlayId');
  if (raw.appliesTo !== 'normal' || raw.line !== 1) return fail('overlay applies only to line 1 normal days');
  if (!Array.isArray(raw.sources) || raw.sources.length === 0 || raw.sources.length > 16) return fail('invalid sources');
  const sources = raw.sources.map(s => {
    if (!isRecord(s) || typeof s.id !== 'string' || typeof s.kind !== 'string' || typeof s.path !== 'string' || (s.role !== 'runtime' && s.role !== 'provenance')
      || !/^[0-9a-f]{64}$/.test(String(s.sha256)) || s.path.startsWith('/') || s.path.includes('..')) return fail('invalid source entry');
    return { id: s.id, kind: s.kind, role: s.role as SourceRole, path: s.path, sha256: String(s.sha256) };
  });
  const day = raw.serviceDay;
  if (!isRecord(day) || !isSeconds(day.startS) || !isSeconds(day.endS) || (day.startS as number) >= (day.endS as number)) return fail('invalid serviceDay');
  if (!isSeconds(raw.guardS, 0, 600)) return fail('invalid guardS');
  if (!Array.isArray(raw.observedServiceDates) || raw.observedServiceDates.length > 8 || !raw.observedServiceDates.every(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))) return fail('invalid observedServiceDates');
  const b = raw.B;
  if (!isRecord(b) || typeof b.sourceId !== 'string' || !sources.some(s => s.id === b.sourceId && s.role === 'runtime') || b.column !== 'sat_to_wed'
    || !isSeconds(b.presenceToVakilabadOffsetS, 0, 3600) || b.offsetQuality !== 'derived' || !CONFIDENCES.has(b.confidence as Confidence)) return fail('invalid B definition');
  const a = raw.A;
  if (!isRecord(a) || !Array.isArray(a.windows) || a.windows.length === 0 || a.windows.length > 12) return fail('invalid A windows');
  const ids = new Set<string>();
  let previousTo = -1;
  const windows = a.windows.map((w): OverlayWindow => {
    if (!isRecord(w) || typeof w.id !== 'string' || ids.has(w.id) || !isSeconds(w.fromS) || !isSeconds(w.toS) || !isSeconds(w.gridS, 60, 7200)
      || (w.fromS as number) >= (w.toS as number) || (w.fromS as number) < previousTo
      || !COVERAGES.has(w.coverage as Coverage) || !CONFIDENCES.has(w.confidence as Confidence)
      || typeof w.absorbIntoDocumentedB !== 'boolean' || !Array.isArray(w.evidence) || !w.evidence.every(e => typeof e === 'string')) return fail('invalid A window');
    const phase = w.phase;
    if (!isRecord(phase) || !(isSeconds(phase.fixedS, 0, 7199) || phase.policy === 'max_min_separation_from_documented_B')) return fail('invalid window phase');
    // The measured/observed class must never be claimed for an assumed or extrapolated window.
    if (w.confidence === 'measured_phase' && !String(w.coverage).startsWith('field_observed')) return fail('measured confidence requires field-observed coverage');
    if (String(w.coverage).startsWith('field_observed') && w.confidence !== 'measured_phase') return fail('observed coverage must carry measured confidence');
    ids.add(w.id); previousTo = w.toS as number;
    return { id: w.id, fromS: w.fromS as number, toS: w.toS as number, gridS: w.gridS as number, phase: (phase.policy ? { policy: 'max_min_separation_from_documented_B' } : { fixedS: phase.fixedS as number }) as PhasePolicy,
      coverage: w.coverage as Coverage, confidence: w.confidence as Confidence, absorbIntoDocumentedB: w.absorbIntoDocumentedB as boolean,
      ...(w.toInclusive === true ? { toInclusive: true } : {}), evidence: w.evidence as string[] };
  });
  const notes = Array.isArray(raw.notes) && raw.notes.every(n => typeof n === 'string') ? raw.notes as string[] : [];
  return { schemaVersion: 1, overlayId: raw.overlayId, appliesTo: 'normal', line: 1, sources, serviceDay: { startS: day.startS as number, endS: day.endS as number }, observedServiceDates: [...raw.observedServiceDates as string[]],
    guardS: raw.guardS as number, B: { sourceId: b.sourceId as string, column: 'sat_to_wed', presenceToVakilabadOffsetS: b.presenceToVakilabadOffsetS as number, offsetQuality: 'derived', confidence: b.confidence as Confidence },
    A: { windows }, notes };
}

/** Parse the printed sheet column "H:MM" -> seconds; fail on anything unexpected rather than guess. */
export function parseSheetColumn(poster: unknown, column: string): number[] {
  if (!isRecord(poster) || !Array.isArray(poster[column])) return fail(`sheet column ${column} missing`);
  const out = (poster[column] as unknown[]).map(v => {
    const m = typeof v === 'string' ? /^(\d{1,2}):([0-5]\d)$/.exec(v) : null;
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : fail(`unparseable sheet time ${String(v)}`);
  });
  if (out.length < 8 || out.length > 96) return fail('unexpected sheet size');
  if (!out.every((v, i) => i === 0 || v > out[i - 1])) return fail('sheet times are not strictly increasing');
  return out;
}

function gridTimes(w: OverlayWindow, phaseS: number): number[] {
  const out: number[] = [];
  const first = w.fromS + ((((phaseS - w.fromS) % w.gridS) + w.gridS) % w.gridS);
  for (let t = first; w.toInclusive ? t <= w.toS : t < w.toS; t += w.gridS) out.push(t);
  return out;
}
const minDistance = (t: number, list: readonly number[]): number => list.reduce((m, x) => Math.min(m, Math.abs(x - t)), Infinity);

/** Deterministic: maximise the smallest distance from any slot of this grid to a documented B departure. */
export function chooseSeparatingPhase(w: OverlayWindow, documentedB: readonly number[]): PhaseDecision {
  let best = 0, bestSeparation = -1;
  for (let phase = 0; phase < w.gridS; phase++) {
    const slots = gridTimes(w, phase);
    const separation = slots.length ? Math.min(...slots.map(t => minDistance(t, documentedB))) : Infinity;
    if (separation > bestSeparation) { bestSeparation = separation; best = phase; }
  }
  return { windowId: w.id, phaseS: best, method: 'max_min_separation_from_documented_B (1 s resolution, smallest phase wins ties)', minSeparationS: bestSeparation, candidatesEvaluated: w.gridS };
}

export function buildNormalDay(overlay: NormalDayOverlay, sheetPresenceS: readonly number[]): { schedule: DaySchedule; report: OverlayReport } {
  const bTimes = sheetPresenceS.map(s => s - overlay.B.presenceToVakilabadOffsetS);
  if (bTimes.some(t => t < overlay.serviceDay.startS || t > overlay.serviceDay.endS)) fail('derived B departure outside the service day');
  const B: FixedDeparture[] = bTimes.map(s => ({ s, confidence: overlay.B.confidence, window: 'B-kowsar-sheet-minus-offset' }));
  const A: FixedDeparture[] = [], absorbed: AbsorbedSlot[] = [], phases: PhaseDecision[] = [];
  const perWindow: OverlayReport['perWindow'] = [];
  for (const w of overlay.A.windows) {
    let phaseS: number;
    if ('fixedS' in w.phase) phaseS = w.phase.fixedS;
    else { const decision = chooseSeparatingPhase(w, bTimes); phases.push(decision); phaseS = decision.phaseS; }
    let count = 0;
    for (const t of gridTimes(w, phaseS)) {
      if (t < overlay.serviceDay.startS || t > overlay.serviceDay.endS) continue;
      const nearest = bTimes.reduce<number | null>((m, b) => (m === null || Math.abs(b - t) < Math.abs(m - t) ? b : m), null);
      if (w.absorbIntoDocumentedB && nearest !== null && Math.abs(nearest - t) <= overlay.guardS) {
        absorbed.push({ windowId: w.id, slotS: t, documentedBS: nearest, deltaS: nearest - t });
        continue;
      }
      A.push({ s: t, confidence: w.confidence, window: w.id }); count++;
    }
    perWindow.push({ windowId: w.id, coverage: w.coverage, confidence: w.confidence, count });
  }
  A.sort((x, y) => x.s - y.s);
  // Self-check: the result must be collision-free against its own guard, otherwise the overlay is not safe to apply.
  let minSep: number | null = null, exact = 0, within = 0;
  for (const a of A) for (const b of B) {
    const d = Math.abs(a.s - b.s);
    minSep = minSep === null ? d : Math.min(minSep, d);
    if (d === 0) exact++;
    if (d <= overlay.guardS) within++;
  }
  if (within > 0) fail(`overlay still contains ${within} A/B departures within ${overlay.guardS}s`);
  const base = scheduleFor('normal');
  const schedule: DaySchedule = { ...base, startA: A[0]?.s ?? base.startA, startB: B[0]?.s ?? base.startB, phaseA: A[0]?.s ?? base.phaseA, phaseB: B[0]?.s ?? base.phaseB,
    confidenceA: 'site_headway_assumed_phase', confidenceB: overlay.B.confidence, fixed: { A, B }, observedServiceDates: overlay.observedServiceDates };
  delete (schedule as { extra?: unknown }).extra;
  return { schedule, report: { overlayId: overlay.overlayId, countA: A.length, countB: B.length, perWindow, absorbed, phaseDecisions: phases, minAbSeparationS: minSep, exactCollisions: exact, collisionsWithinGuard: within } };
}

function resolve(root: URL | string, relative: string): string {
  return fileURLToPath(new URL(relative, typeof root === 'string' ? new URL(root.endsWith('/') ? root : root + '/', 'file:///') : root));
}

export function createBaselineTimetable(reason: string | null = null, state: TimetableState = 'baseline_no_overlay'): TimetableModel {
  return Object.freeze({
    // A rejected overlay gets its own identity, so its events and feedback can never be mistaken for the intentional baseline or the corrected model.
    identityVersion: state === 'baseline_no_overlay' ? 'baseline' : `baseline-fallback:${state}`,
    status: Object.freeze({ state, overlayId: null, digest: null, reason }), report: null, overlay: null,
    scheduleFor: (dayType: DayType) => scheduleFor(dayType), fingerprintParts: () => [],
  });
}

export interface TimetableOptions { overlayPath?: URL | string | null; rootDir?: URL | string; warn?: (message: string) => void }

/** Load and fully validate the overlay; on ANY problem return the baseline generator with the reason recorded. */
export function createTimetableModel(options: TimetableOptions = {}): TimetableModel {
  const warn = options.warn ?? ((message: string) => process.emitWarning(message, { code: 'BESRAH_TIMETABLE_OVERLAY' }));
  if (options.overlayPath === null) return createBaselineTimetable('overlay disabled by caller');
  const overlayPath = options.overlayPath ?? DEFAULT_OVERLAY_PATH, root = options.rootDir ?? REPO_ROOT;
  const file = typeof overlayPath === 'string' ? overlayPath : fileURLToPath(overlayPath);
  if (!existsSync(file)) { const m = 'timetable overlay file not found; baseline generator in use'; warn(m); return createBaselineTimetable(m, 'baseline_missing'); }
  try {
    const bytes = readFileSync(file);
    const overlay = validateOverlay(JSON.parse(bytes.toString('utf8')));
    const parts: Buffer[] = [bytes];
    const sourceBytes = new Map<string, Buffer>();
    for (const source of overlay.sources.filter(s => s.role === 'runtime')) {
      const path = resolve(root, source.path);
      if (!existsSync(path)) return fail(`source ${source.id} not found`);
      const data = readFileSync(path);
      if (sha256(data) !== source.sha256) return fail(`source ${source.id} hash mismatch`);
      sourceBytes.set(source.id, data); parts.push(data);
    }
    const sheet = JSON.parse(sourceBytes.get(overlay.B.sourceId)!.toString('utf8'));
    const { schedule, report } = buildNormalDay(overlay, parseSheetColumn(sheet, overlay.B.column));
    // Thursday is independently validated. A failed/missing Thursday evidence file
    // must not break the correctly measured normal-day timetable or Friday.
    let thursdaySchedule: DaySchedule | null = null;
    try {
      const thu = loadThursdayModel();
      thursdaySchedule = thu.schedule;
      parts.push(...thu.sourceBytes);
    } catch {
      warn('Thursday Nov 5 evidence missing or invalid; retaining prior Thursday model');
    }
    const digest = sha256(Buffer.concat(parts.map(p => Buffer.from(sha256(p)))));
    const status: TimetableStatus = Object.freeze({ state: 'applied', overlayId: overlay.overlayId, digest, reason: null });
    return Object.freeze({
      identityVersion: `${overlay.overlayId}:${digest.slice(0, 12)}`, status, report: Object.freeze(report), overlay,
      scheduleFor: (dayType: DayType) => (dayType === 'normal' ? schedule : dayType === 'thursday' && thursdaySchedule ? thursdaySchedule : scheduleFor(dayType)),
      fingerprintParts: () => parts,
    });
  } catch (error) {
    const reason = error instanceof OverlayError ? error.message : 'overlay could not be read or parsed';
    warn(`timetable overlay rejected (${reason}); baseline generator in use`);
    return createBaselineTimetable(reason, 'baseline_invalid');
  }
}
