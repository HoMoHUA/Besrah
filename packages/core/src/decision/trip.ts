// Phase 3: the Intelligence Core decides between the (at most two) trip options the planner produced. The planner owns the
// numbers; this adapter only restates them as Core evidence, runs the pure `evaluateDecision`, and translates the verdict.
// Rules kept: only what the planner measured or modelled is passed (no invented cost, no zero for unknown), the user's stated
// priority is a request preference (never inferred), and the Core's own labels/questions are the only superlatives shown.
import { evaluateDecision } from '../intelligence/index.js';
import type { Candidate, Evidence, HardConstraint, NumericMetric, Objective, OptionLabel, Preference } from '../intelligence/index.js';
import type { Leg, TripOption, TripResult } from '../trip/plan.js';

export type TripPriority = 'time' | 'walk' | 'balanced' | 'cost';
export const TRIP_PRIORITIES: readonly TripPriority[] = ['time', 'walk', 'balanced', 'cost'];

export interface TripDecision {
  schemaVersion: 1; status: 'ok' | 'partial' | 'insufficient_data' | 'no_feasible_option' | 'skipped'; reason: string;
  priority: TripPriority | null; preferred: string | null;
  byOption: Record<string, { labels: string[]; claims: string[]; preferred: boolean }>;
  question: { prompt: string; answers: Array<{ id: string; label: string; priority: 'time' | 'walk' }> } | null;
  notes: string[];
}

const LABEL_FA: Partial<Record<OptionLabel, string>> = { fastest: 'سریع ترین', preference_match: 'هماهنگ با اولویت شما' };
const iso = (sec: number) => new Date(sec * 1000).toISOString();

function evidence(option: TripOption, nowSec: number, kind: 'provider' | 'derived', source: string): Evidence {
  const base = { id: `${option.id}:${source}`, sourceId: source, dataVersion: kind === 'provider' ? 'neshan-v4' : 'timetable-model', live: false, retrievedAt: iso(nowSec), validUntil: iso(nowSec + 600) };
  return kind === 'derived' ? { ...base, kind, method: 'planner_sum_of_legs' } : { ...base, kind };
}

/** Sum of measured walking, or null when any walking leg was not measured (never a partial sum presented as complete). */
export function walkingSeconds(legs: readonly Leg[]): number | null {
  let total = 0;
  for (const leg of legs) if (leg.type === 'walk') { if (leg.durationS === null) return null; total += leg.durationS; }
  return total;
}

export function tripCandidate(option: TripOption, readyEpoch: number, nowSec: number, taskId: string): Candidate {
  const ev = (src: string, kind: 'provider' | 'derived') => [evidence(option, nowSec, kind, src)];
  const usesModel = option.legs.some(l => l.type === 'metro');
  const sourceKind = usesModel ? 'derived' : 'provider';
  const duration: NumericMetric = option.arriveEpoch === null
    ? { state: 'unknown', unit: 'seconds', reason: 'arrival_time_unknown' }
    : { state: 'estimated', unit: 'seconds', value: Math.max(0, option.arriveEpoch - readyEpoch), evidence: ev(usesModel ? 'timetable_model_and_router' : 'router', sourceKind),
        assumptions: usesModel ? ['train times are a timetable model, not live positions', 'station entry and exit are fixed assumptions'] : ['road time comes from the routing provider, not a guarantee'] };
  const walk = walkingSeconds(option.legs);
  const walking: NumericMetric = option.kind === 'car'
    ? { state: 'estimated', unit: 'seconds', value: 0, evidence: ev('router', 'provider'), assumptions: ['walking to and from parking or pickup is not included'] }
    : walk === null ? { state: 'unknown', unit: 'seconds', reason: 'walking_time_not_measured' }
      : { state: 'known', unit: 'seconds', value: walk, evidence: ev('router', 'provider') };
  return { schemaVersion: 1, id: option.id, providerId: option.kind === 'metro' ? 'metro' : option.kind, domain: 'transit', taskId, equivalenceKey: 'trip', title: option.title, availability: 'available',
    // Cost is deliberately absent: no fare source exists, and Core treats a missing metric as unknown.
    metrics: { durationSeconds: duration, walkingSeconds: walking, totalCostToman: { state: 'unknown', unit: 'toman', reason: 'no_fare_source' } } };
}

export function decideTrip(trip: TripResult, opts: { priority?: TripPriority | null; maxWalkS?: number | null; nowSec: number; requestId: string }): TripDecision {
  const priority = opts.priority ?? null;
  const empty = (status: TripDecision['status'], reason: string, notes: string[] = []): TripDecision => ({ schemaVersion: 1, status, reason, priority, preferred: null, byOption: {}, question: null, notes });
  if (trip.options.length === 0) return empty('skipped', 'no_options');
  // A superlative needs something to be compared with: a lone option gets no label, no preference badge and no question.
  if (trip.options.length === 1) return { ...empty('ok', 'single_option'), byOption: { [trip.options[0]!.id]: { labels: [], claims: [], preferred: false } },
    notes: priority === 'cost' ? ['هزینهٔ مسیرها در دسترس نیست (نرخ مترو و تاکسی از منبع معتبر نداریم).'] : [] };
  const notes: string[] = [];
  if (priority === 'cost') notes.push('هزینهٔ مسیرها در دسترس نیست (نرخ مترو و تاکسی از منبع معتبر نداریم)؛ بر اساس زمان رسیدن مقایسه شد.');
  const taskId = `trip:${opts.requestId}`, at = iso(opts.nowSec);
  const candidates = trip.options.map(o => tripCandidate(o, trip.readyEpoch, opts.nowSec, taskId));
  const objectives: Objective[] = [{ metric: 'durationSeconds', direction: 'min' }, { metric: 'walkingSeconds', direction: 'min' }];
  const constraints: HardConstraint[] = [];
  // The user's own stated limit becomes a hard constraint on measured walking (unknown walking stays undetermined, never "satisfied").
  if (opts.maxWalkS) constraints.push({ id: 'max-walk', metric: 'walkingSeconds', operator: 'lte', bound: opts.maxWalkS });
  const requestPreferences: Preference[] = [];
  if (priority === 'time' || priority === 'walk') {
    requestPreferences.push({ schemaVersion: 1, id: 'priority', version: 1, domain: 'transit', scope: 'request', requestId: opts.requestId, kind: 'objective_order',
      value: priority === 'time' ? ['durationSeconds', 'walkingSeconds'] : ['walkingSeconds', 'durationSeconds'], provenance: { kind: 'explicit', source: 'profile_or_question' },
      confirmedByUser: true, updatedAt: at, consent: { store: 'denied', use: 'granted' } });
  }
  let result;
  try {
    result = evaluateDecision({ schemaVersion: 1, context: { schemaVersion: 1, requestId: opts.requestId, taskId, domain: 'transit', at, decisionPermission: 'granted', objectives, constraints, ...(requestPreferences.length ? { requestPreferences } : {}) }, candidates });
  } catch { return empty('skipped', 'decision_input_rejected', ['ارزیابی هوشمند برای این نتیجه انجام نشد؛ گزینه ها همان است که دیدید.']); }

  const byOption: TripDecision['byOption'] = {};
  const preferredIds = new Set(result.preference.order ? result.options.map(o => o.candidateId) : []);
  for (const option of trip.options) byOption[option.id] = { labels: [], claims: [], preferred: false };
  for (const o of result.options) {
    const entry = byOption[o.candidateId]; if (!entry) continue;
    entry.labels = [...new Set(o.labels.map(l => LABEL_FA[l]).filter((x): x is string => Boolean(x)))];
    entry.claims = o.explanation.claims.filter(c => c.code.startsWith('label:') && c.code !== 'label:pareto_option' || c.code.startsWith('constraint:')).map(c => c.text);
    entry.preferred = preferredIds.has(o.candidateId);
  }
  if (result.status === 'partial' || result.status === 'insufficient_data') notes.push('برای بعضی گزینه ها داده کافی نبود و در مقایسه کنار گذاشته شدند.');
  for (const u of result.undetermined) if (u.reason === 'hard_constraint_undetermined') notes.push('پیاده روی یکی از گزینه ها اندازه گیری نشده و با سقف شما سنجیده نشد.');
  let question: TripDecision['question'] = null;
  if (result.question && priority !== 'balanced') {
    const answers = result.question.answers.map(a => ({ id: a.id, label: a.label, priority: (a.objectiveOrder[0] === 'walkingSeconds' ? 'walk' : 'time') as 'time' | 'walk' }));
    question = { prompt: 'کدام برایتان مهم تر است؟', answers };
  }
  const preferred = [...preferredIds][0] ?? null;
  return { schemaVersion: 1, status: result.status, reason: result.reason, priority, preferred, byOption, question, notes: [...new Set(notes)] };
}
