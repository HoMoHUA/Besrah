// Version 1 library contracts. No transport, identity, storage or provider authority is implied.
export const SCHEMA_VERSION = 1 as const;
export const LIMITS = Object.freeze({ candidates: 128, objectives: 6, constraints: 16, preferences: 64, evidencePerMetric: 8, text: 512 });
export type Domain = 'transit' | 'food' | 'shopping';
export const METRIC_UNITS = Object.freeze({ totalCostToman: 'toman', durationSeconds: 'seconds', walkingSeconds: 'seconds', transfers: 'count', quality: 'score_0_100', arrivalEpochSeconds: 'epoch_seconds' } as const);
export type MetricKey = keyof typeof METRIC_UNITS;
export type Unit = typeof METRIC_UNITS[MetricKey];
export interface Evidence {
  id: string;
  sourceId: string;
  kind: 'official' | 'field' | 'provider' | 'osm' | 'derived' | 'user' | 'fixture';
  dataVersion: string;
  live: boolean;
  observedAt?: string;
  retrievedAt?: string;
  validUntil?: string;
  method?: string;
}
export type NumericMetric =
  | { state: 'known'; unit: Unit; value: number; evidence: Evidence[] }
  | { state: 'estimated'; unit: Unit; value?: number; interval?: { min: number; max: number }; evidence: Evidence[]; assumptions: string[] }
  | { state: 'unknown' | 'stale' | 'not_applicable'; unit: Unit; reason: string; evidence?: Evidence[] };
export interface Bounds { min: number; max: number; estimated: boolean }
export interface Candidate {
  schemaVersion: 1;
  id: string;
  providerId: string;
  domain: Domain;
  taskId: string;
  equivalenceKey: string;
  title: string;
  availability: 'available' | 'unavailable' | 'unknown';
  metrics: Partial<Record<MetricKey, NumericMetric>>;
}
export interface Objective { metric: MetricKey; direction: 'min' | 'max' }
export interface HardConstraint { id: string; metric: MetricKey; operator: 'lte' | 'gte'; bound: number; requireKnown?: boolean }
export type ConstraintState = 'satisfied' | 'violated' | 'undetermined';
export interface MetricRef { candidateId: string; metric: MetricKey; evidenceIds: string[] }
export interface ConstraintCheck { candidateId: string; constraintId: string; status: ConstraintState; reason: string; ref: MetricRef }
export interface Preference {
  schemaVersion: 1;
  id: string;
  version: number;
  domain: Domain | 'global';
  scope: 'device' | 'request';
  requestId?: string;
  kind: 'objective_order';
  value: MetricKey[];
  provenance: { kind: 'explicit' | 'inferred'; source: string };
  confirmedByUser: boolean;
  updatedAt: string;
  expiresAt?: string;
  consent: { store: 'granted' | 'denied' | 'revoked'; use: 'granted' | 'denied' | 'revoked' };
}
export interface MemorySnapshot { schemaVersion: 1; revision: number; preferences: Preference[] }
export interface ResolvedPreference {
  order?: MetricKey[];
  selectedIds: string[];
  ignored: Array<{ id: string; reason: string }>;
  conflicts: string[];
}
export interface RequestContext {
  schemaVersion: 1;
  requestId: string;
  taskId: string;
  domain: Domain;
  at: string;
  decisionPermission: 'granted' | 'denied';
  objectives: Objective[];
  constraints: HardConstraint[];
  requestPreferences?: Preference[];
}
export interface DecisionInput { schemaVersion: 1; context: RequestContext; candidates: Candidate[]; memory?: MemorySnapshot }
export interface ComparisonGroup {
  key: string;
  frontierIds: string[];
  dominatedIds: string[];
  incompleteIds: string[];
  comparisonComplete: boolean;
  pairComparisons: number;
}
export type OptionLabel = 'fastest' | 'lowest_cost' | 'preference_match' | 'pareto_option';
export interface Claim { code: string; text: string; refs: MetricRef[] }
export interface Explanation { candidateId: string; claims: Claim[] }
export interface UsefulQuestion {
  id: string;
  prompt: string;
  answers: Array<{ id: string; label: string; objectiveOrder: MetricKey[]; selectedIds: string[] }>;
  refs: MetricRef[];
}
export interface DecisionResult {
  schemaVersion: 1;
  requestId: string;
  status: 'ok' | 'partial' | 'insufficient_data' | 'no_feasible_option';
  reason: string;
  options: Array<{ candidateId: string; groupKey: string; labels: OptionLabel[]; explanation: Explanation }>;
  excluded: Array<{ candidateId: string; reason: string; checks: ConstraintCheck[] }>;
  undetermined: Array<{ candidateId: string; reason: string; checks: ConstraintCheck[] }>;
  groups: ComparisonGroup[];
  preference: ResolvedPreference;
  question?: UsefulQuestion;
  stats: { candidateCount: number; constraintChecks: number; pairComparisons: number };
  scope: 'provided_eligible_equivalent_options';
}
