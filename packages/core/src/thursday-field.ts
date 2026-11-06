// Versioned Thursday evidence adapter. Only the observed 2026-11-05 A departure is
// individually measured; the remaining 10-minute slots are extrapolated, not live trains.
// A/B are alternative destinations of ONE physical departure sequence.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { DaySchedule, FixedDeparture } from './engine.js';

export const THURSDAY_FIELD_URL = new URL('../../../data/timetable/thursday-2026-11-05-field-v1.json', import.meta.url);
export const KOWSAR_SHEET_URL = new URL('../../../data/official/kowsar_airport_poster_2026-11-03.json', import.meta.url);
export const THURSDAY_MODEL_TAG = 'thursday-2026-11-05-field-v1';

const sec = (time: string) => {
  const m = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(time);
  if (!m) throw new Error('invalid Thursday time');
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
  if (s >= 86400) throw new Error('Thursday time out of bounds');
  return s;
};
const assert = (ok: unknown, text: string): asserts ok => { if (!ok) throw new Error('Thursday evidence: ' + text); };
export interface ThursdayModel { schedule: DaySchedule; fingerprint: string; sourceBytes: Buffer[]; }

export function buildThursdayModel(evidence: unknown, sheet: unknown, sourceBytes: Buffer[] = []): ThursdayModel {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('Thursday evidence missing');
  const e = evidence as Record<string, any>;
  assert(e.schemaVersion === 1 && e.overlayId === 'metro-line1-thursday-field-2026-11-05-v1'
    && e.line === 1 && e.dayType === 'thursday', 'wrong model or schema');
  const s = e.schedule;
  assert(s && s.mode === 'single_physical_departure_sequence', 'not a single physical sequence');
  assert(s.latticeStart === '06:15:17' && s.latticeStopExclusive === '22:00:00'
    && s.gridSeconds === 600 && s.phaseSeconds === 17, 'unexpected schedule coefficients');
  assert(s.B && s.B.column === 'thursday' && s.B.presenceToVakilabadOffsetSeconds === 1080
    && s.B.phaseCorrectionSeconds === 17 && s.B.absorbWithinSeconds === 60,
    'unsupported B sheet conversion');
  assert(Array.isArray(e.observedServiceDates) && e.observedServiceDates.length === 1
    && e.observedServiceDates[0] === '2026-11-05', 'wrong observed dates');
  const col = (sheet as Record<string, unknown> | null)?.thursday;
  assert(Array.isArray(col) && col.length >= 20 && col.length <= 40
    && col.every(x => typeof x === 'string'), 'invalid printed sheet');
  const Bseconds = col.map((v: string) => sec(v) - 1080 + 17);
  assert(Bseconds.every((v: number, i: number) => v >= 0 && v < 86400 && (i === 0 || v > Bseconds[i - 1])), 'unsorted B departures');
  const latticeStart = sec(s.latticeStart), stop = sec(s.latticeStopExclusive);
  const all = new Set<number>();
  const B: FixedDeparture[] = Bseconds.map((v: number) => {
    assert(!all.has(v), 'duplicate B departure');
    all.add(v);
    return { s: v, confidence: 'sheet_derived_phase', window: 'thursday-kowsar-sheet-derived' };
  });
  const A: FixedDeparture[] = [];
  for (let t = latticeStart; t < stop; t += s.gridSeconds) {
    const nearB = Bseconds.some((b: number) => Math.abs(b - t) <= s.B.absorbWithinSeconds);
    if (nearB) continue;
    assert(!all.has(t), 'duplicate A/B departure');
    all.add(t);
    A.push({ s: t,
      confidence: t === sec('16:55:17') ? 'measured_phase' : 'generalized_observation_phase',
      window: t === sec('16:55:17') ? 'owner-observed-2026-11-05' : 'thursday-extrapolated-10min' });
  }
  assert(A.length > 30 && B.length > 20, 'incomplete model');
  // A/B at Vakilabad or at Ghadir must never be represented by coincident departures.
  const ordered = [...all].sort((a, b) => a - b);
  assert(ordered.every((v, i) => i === 0 || v - ordered[i - 1] >= 240), 'near-duplicate trains');
  const schedule: DaySchedule = {
    dayType: 'thursday', startA: A[0].s, startB: B[0].s,
    phaseA: A[0].s, phaseB: B[0].s,
    slots: [{ fromS: sec('06:00:00'), toS: stop, headwayA: 600, headwayB: 1800 }],
    confidenceA: 'generalized_observation_phase', confidenceB: 'sheet_derived_phase',
    fixed: { A, B }, observedServiceDates: e.observedServiceDates,
  };
  const fingerprint = createHash('sha256').update(JSON.stringify([evidence, col])).digest('hex');
  return { schedule, fingerprint, sourceBytes };
}

export function loadThursdayModel(): ThursdayModel {
  const e = readFileSync(THURSDAY_FIELD_URL), sheet = readFileSync(KOWSAR_SHEET_URL);
  return buildThursdayModel(JSON.parse(e.toString('utf8')), JSON.parse(sheet.toString('utf8')), [e, sheet]);
}
