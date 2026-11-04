import { METRIC_UNITS } from './contracts.js';
import type { Candidate, ConstraintCheck, HardConstraint } from './contracts.js';
import { metricBounds } from './metrics.js';

export function checkConstraint(candidate: Candidate, constraint: HardConstraint, at: string): ConstraintCheck {
  const metric = candidate.metrics[constraint.metric];
  const ref = {
    candidateId: candidate.id,
    metric: constraint.metric,
    evidenceIds: [...new Set(metric?.evidence?.map(item => item.id) ?? [])].sort(),
  };
  const result = (status: ConstraintCheck['status'], reason: string): ConstraintCheck => ({
    candidateId: candidate.id, constraintId: constraint.id, status, reason, ref,
  });

  if (!Number.isFinite(constraint.bound) || (constraint.operator !== 'lte' && constraint.operator !== 'gte')) {
    return result('undetermined', 'The constraint has no valid finite bound or operator.');
  }
  if (!Object.hasOwn(METRIC_UNITS, constraint.metric) || metric?.unit !== METRIC_UNITS[constraint.metric]) {
    return result('undetermined', 'The metric is missing or its unit does not match the constraint metric.');
  }
  const bounds = metricBounds(metric, at);
  if (!bounds) return result('undetermined', 'Fresh supported metric bounds are unavailable.');
  if (constraint.requireKnown && bounds.estimated) {
    return result('undetermined', 'This constraint requires a known value, not an estimate.');
  }

  const satisfied = constraint.operator === 'lte' ? bounds.max <= constraint.bound : bounds.min >= constraint.bound;
  const violated = constraint.operator === 'lte' ? bounds.min > constraint.bound : bounds.max < constraint.bound;
  if (satisfied) return result('satisfied', 'The entire metric interval satisfies the constraint.');
  if (violated) return result('violated', 'The entire metric interval violates the constraint.');
  return result('undetermined', 'The metric interval spans satisfying and violating values.');
}
