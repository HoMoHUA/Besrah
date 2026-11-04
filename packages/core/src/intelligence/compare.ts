import { LIMITS, METRIC_UNITS } from './contracts.js';
import type { Bounds, Candidate, ComparisonGroup, MetricKey, Objective } from './contracts.js';
import { metricBounds } from './metrics.js';

const lexical = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
interface Comparable { candidate: Candidate; bounds: Bounds[] }
interface PreparedGroup { complete: Comparable[]; incompleteIds: string[] }

// JSON encodes the tuple, including escaped separators, without conflating providers.
export function groupKey(candidate: Candidate): string {
  return JSON.stringify([candidate.domain, candidate.taskId, candidate.equivalenceKey]);
}

function assertLimits(candidates: Candidate[], objectives: Objective[]): void {
  if (candidates.length > LIMITS.candidates) throw new RangeError(`At most ${LIMITS.candidates} candidates may be compared.`);
  if (objectives.length > LIMITS.objectives) throw new RangeError(`At most ${LIMITS.objectives} objectives may be compared.`);
}

function prepare(candidates: Candidate[], objectives: Objective[], at: string): Map<string, PreparedGroup> {
  const groups = new Map<string, PreparedGroup>();
  const validObjectives = objectives.length > 0 && objectives.every(objective =>
    Object.hasOwn(METRIC_UNITS, objective.metric) && (objective.direction === 'min' || objective.direction === 'max'));
  for (const candidate of candidates) {
    const key = groupKey(candidate);
    let group = groups.get(key);
    if (!group) { group = { complete: [], incompleteIds: [] }; groups.set(key, group); }
    const bounds: Bounds[] = [];
    if (validObjectives) {
      for (const objective of objectives) {
        const metric = candidate.metrics[objective.metric];
        if (!metric || metric.unit !== METRIC_UNITS[objective.metric]) break;
        const value = metricBounds(metric, at);
        if (!value) break;
        bounds.push(value);
      }
    }
    if (validObjectives && bounds.length === objectives.length) group.complete.push({ candidate, bounds });
    else group.incompleteIds.push(candidate.id);
  }
  return groups;
}

const equalBounds = (a: Bounds, b: Bounds): boolean => a.min === b.min && a.max === b.max;

function dominates(a: Bounds[], b: Bounds[], objectives: Objective[]): boolean {
  let strict = false;
  for (let index = 0; index < objectives.length; index++) {
    const left = a[index]!;
    const right = b[index]!;
    // Equal uncertainty is equality, not evidence that either option is worse.
    if (equalBounds(left, right)) continue;
    if (objectives[index]!.direction === 'min') {
      if (left.max > right.min) return false;
      if (left.max < right.min) strict = true;
    } else {
      if (left.min < right.max) return false;
      if (left.min > right.max) strict = true;
    }
  }
  return strict;
}

export function compareCandidates(candidates: Candidate[], objectives: Objective[], at: string): ComparisonGroup[] {
  assertLimits(candidates, objectives);
  const groups = prepare(candidates, objectives, at);
  return [...groups.entries()].sort(([a], [b]) => lexical(a, b)).map(([key, group]) => {
    const dominated = new Set<number>();
    let pairComparisons = 0;
    // Visit each complete unordered pair exactly once; no order-dependent pruning.
    for (let left = 0; left < group.complete.length; left++) {
      for (let right = left + 1; right < group.complete.length; right++) {
        pairComparisons++;
        const a = group.complete[left]!.bounds;
        const b = group.complete[right]!.bounds;
        if (dominates(a, b, objectives)) dominated.add(right);
        else if (dominates(b, a, objectives)) dominated.add(left);
      }
    }
    return {
      key,
      frontierIds: group.complete.filter((_, index) => !dominated.has(index)).map(item => item.candidate.id).sort(lexical),
      dominatedIds: group.complete.filter((_, index) => dominated.has(index)).map(item => item.candidate.id).sort(lexical),
      incompleteIds: group.incompleteIds.sort(lexical),
      comparisonComplete: group.incompleteIds.length === 0,
      pairComparisons,
    };
  });
}

// -1 means a wins, +1 means b wins, 0 means tied or incomparable.
function lexicographic(a: Bounds[], b: Bounds[], objectives: Objective[], orderedIndexes: number[]): number {
  for (const index of orderedIndexes) {
    // An order key with no declared objective cannot acquire an inferred direction.
    if (index < 0) return 0;
    const left = a[index]!;
    const right = b[index]!;
    if (equalBounds(left, right)) continue;
    if (objectives[index]!.direction === 'min') {
      if (left.max < right.min) return -1;
      if (right.max < left.min) return 1;
    } else {
      if (left.min > right.max) return -1;
      if (right.min > left.max) return 1;
    }
    // Overlap (including touching) blocks all lower-priority objectives.
    return 0;
  }
  return 0;
}

export function preferredCandidates(candidates: Candidate[], objectives: Objective[], order: MetricKey[], at: string): Candidate[] {
  assertLimits(candidates, objectives);
  if (order.length > LIMITS.objectives) throw new RangeError(`At most ${LIMITS.objectives} preference objectives may be compared.`);
  const orderedIndexes = order.map(metric => objectives.findIndex(objective => objective.metric === metric));
  const selected: Candidate[] = [];
  for (const group of prepare(candidates, objectives, at).values()) {
    const beaten = new Set<number>();
    for (let left = 0; left < group.complete.length; left++) {
      for (let right = left + 1; right < group.complete.length; right++) {
        const relation = lexicographic(group.complete[left]!.bounds, group.complete[right]!.bounds, objectives, orderedIndexes);
        if (relation < 0) beaten.add(right);
        else if (relation > 0) beaten.add(left);
      }
    }
    selected.push(...group.complete.filter((_, index) => !beaten.has(index)).map(item => item.candidate));
  }
  // IDs stabilize presentation only; they never break a metric tie.
  return selected.sort((a, b) => lexical(a.id, b.id));
}
