import { LIMITS, METRIC_UNITS } from './contracts.js';
import type { Candidate, MetricKey, MetricRef, Objective, ResolvedPreference, UsefulQuestion } from './contracts.js';
import { groupKey, preferredCandidates } from './compare.js';
import { metricBounds } from './metrics.js';

const names: Record<MetricKey, string> = {
  totalCostToman: 'هزینه', durationSeconds: 'زمان سفر', walkingSeconds: 'زمان پیاده روی',
  transfers: 'تعداد تعویض', quality: 'کیفیت', arrivalEpochSeconds: 'زمان رسیدن',
};

// Promote each declared objective once, keeping the remaining declared order.
// This bounded policy may abstain rather than exhaust every possible preference.
export function priorityOrders(metrics: MetricKey[]): MetricKey[][] {
  if (metrics.length > LIMITS.objectives) throw new RangeError('Too many question objectives');
  return metrics.map(metric => [metric, ...metrics.filter(other => other !== metric)]);
}

export function suggestQuestion(candidates: Candidate[], objectives: Objective[], at: string, preference?: ResolvedPreference): UsefulQuestion | undefined {
  // Resolution is the authority for active explicit preferences; raw memory is not used here.
  if (preference?.order?.length || candidates.length < 2 || objectives.length < 2 || objectives.length > LIMITS.objectives) return undefined;
  const metrics = objectives.map(objective => objective.metric);
  if (new Set(metrics).size !== metrics.length || new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) return undefined;
  const key = groupKey(candidates[0]);
  if (candidates.some(candidate => candidate.availability !== 'available' || groupKey(candidate) !== key
    || metrics.some(metric => candidate.metrics[metric]?.unit !== METRIC_UNITS[metric] || !metricBounds(candidate.metrics[metric], at)))) return undefined;

  let first: UsefulQuestion['answers'][number] | undefined;
  let firstSet: string | undefined;
  // Compare actual counterfactual choice sets, not the order candidates happen to be emitted in.
  // At most six complete priority orders are evaluated, not a factorial search.
  for (const order of priorityOrders(metrics)) {
    const selectedIds = [...new Set(preferredCandidates(candidates, objectives, order, at).map(candidate => candidate.id))].sort();
    if (!selectedIds.length) continue;
    const choiceSet = JSON.stringify(selectedIds);
    if (firstSet === choiceSet) continue;
    const answer = {
      id: `objective-order:${order.join(':')}`,
      label: order.map(metric => `${names[metric]} ${objectives.find(objective => objective.metric === metric)?.direction === 'max' ? 'بیشتر' : 'کمتر'}`).join('، سپس '),
      objectiveOrder: order,
      selectedIds,
    };
    if (!first) {
      first = answer;
      firstSet = choiceSet;
      continue;
    }
    const refs: MetricRef[] = candidates.flatMap(candidate => metrics.map(metric => ({
      candidateId: candidate.id, metric,
      evidenceIds: [...new Set(candidate.metrics[metric]?.evidence?.map(evidence => evidence.id) ?? [])],
    })));
    return { id: 'objective-priority', prompt: 'کدام ترتیب اولویت را ترجیح می دهید؟', answers: [first, answer], refs };
  }
  return undefined;
}
