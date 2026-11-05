import type { Candidate, ConstraintCheck, DecisionInput, DecisionResult, OptionLabel } from './contracts.js';
import { assertDecisionInput } from './validation.js';
import { metricBounds } from './metrics.js';
import { checkConstraint } from './constraints.js';
import { compareCandidates, groupKey, preferredCandidates } from './compare.js';
import { resolvePreferences } from './preferences.js';
import { explainCandidate } from './explain.js';
import { suggestQuestion } from './questions.js';

// One pure request. The input clock, dataset and explicit policies completely determine output.
export function evaluateDecision(value: unknown): DecisionResult {
  assertDecisionInput(value);
  const input: DecisionInput = value;
  const { context, candidates } = input;
  const result: DecisionResult = {
    schemaVersion: 1, requestId: context.requestId, status: 'no_feasible_option', reason: 'no_eligible_candidate',
    options: [], excluded: [], undetermined: [], groups: [], preference: { selectedIds: [], ignored: [], conflicts: [] },
    stats: { candidateCount: candidates.length, constraintChecks: 0, pairComparisons: 0 }, scope: 'provided_eligible_equivalent_options',
  };
  const ordered = candidates.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (context.decisionPermission === 'denied') {
    result.reason = 'decision_permission_denied';
    result.excluded = ordered.map(c => ({ candidateId: c.id, reason: 'decision_permission_denied', checks: [] }));
    return result;
  }
  result.preference = resolvePreferences(context, input.memory);
  const eligible: Candidate[] = [], checksById = new Map<string, ConstraintCheck[]>();
  for (const candidate of ordered) {
    if (candidate.domain !== context.domain || candidate.taskId !== context.taskId) {
      result.excluded.push({ candidateId: candidate.id, reason: 'context_mismatch', checks: [] }); continue;
    }
    const checks = context.constraints.map(constraint => checkConstraint(candidate, constraint, context.at));
    result.stats.constraintChecks += checks.length;
    checksById.set(candidate.id, checks);
    if (candidate.availability === 'unavailable' || checks.some(check => check.status === 'violated')) {
      result.excluded.push({ candidateId: candidate.id, reason: candidate.availability === 'unavailable' ? 'unavailable' : 'hard_constraint_violated', checks });
    } else if (candidate.availability === 'unknown' || checks.some(check => check.status === 'undetermined')) {
      result.undetermined.push({ candidateId: candidate.id, reason: candidate.availability === 'unknown' ? 'availability_unknown' : 'hard_constraint_undetermined', checks });
    } else eligible.push(candidate);
  }
  result.groups = compareCandidates(eligible, context.objectives, context.at);
  result.stats.pairComparisons = result.groups.reduce((sum, group) => sum + group.pairComparisons, 0);
  for (const group of result.groups) {
    for (const id of group.incompleteIds) result.undetermined.push({ candidateId: id, reason: 'incomplete_objectives', checks: checksById.get(id)! });
    const peers = eligible.filter(c => groupKey(c) === group.key);
    const frontier = peers.filter(c => group.frontierIds.includes(c.id));
    const chosen = result.preference.order ? preferredCandidates(frontier, context.objectives, result.preference.order, context.at) : frontier;
    // Reuse request-local bounds for labels; never reparse evidence per option/peer pair.
    const labelBounds = new Map(peers.map(peer => [peer.id, {
      totalCostToman: metricBounds(peer.metrics.totalCostToman, context.at),
      listedItemPriceToman: metricBounds(peer.metrics.listedItemPriceToman, context.at),
      durationSeconds: metricBounds(peer.metrics.durationSeconds, context.at),
    }]));
    for (const candidate of chosen) {
      const labels: OptionLabel[] = group.comparisonComplete ? ['pareto_option'] : [];
      if (result.preference.order) labels.push('preference_match');
      if (group.comparisonComplete) for (const [metric, label] of [['totalCostToman', 'lowest_cost'], ['listedItemPriceToman', 'lowest_listed_item_price'], ['durationSeconds', 'fastest']] as const) {
        if (!context.objectives.some(o => o.metric === metric && o.direction === 'min')) continue;
        const bound = labelBounds.get(candidate.id)![metric];
        if (bound && peers.every(other => {
          const otherBound = labelBounds.get(other.id)![metric];
          return other.id === candidate.id || !!otherBound && bound.max <= otherBound.min;
        })) labels.push(label);
      }
      result.options.push({ candidateId: candidate.id, groupKey: group.key, labels,
        explanation: explainCandidate(candidate, context.at, labels, checksById.get(candidate.id)!) });
    }
  }
  // Do not ask preference questions to disguise incomplete evidence or unresolved eligibility.
  if (result.undetermined.length === 0 && result.groups.length === 1) {
    const frontier = eligible.filter(c => result.groups[0].frontierIds.includes(c.id));
    const question = suggestQuestion(frontier, context.objectives, context.at, result.preference);
    if (question) result.question = question;
  }
  result.options.sort((a, b) => a.groupKey < b.groupKey ? -1 : a.groupKey > b.groupKey ? 1 : a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0);
  result.undetermined.sort((a, b) => a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0);
  if (result.options.length) {
    result.status = result.undetermined.length || result.preference.conflicts.length ? 'partial' : 'ok';
    result.reason = result.status === 'ok' ? 'evaluated_supplied_evidence' : 'incomplete_evidence_or_preference_conflict';
  } else if (result.undetermined.length) {
    result.status = 'insufficient_data'; result.reason = 'insufficient_evidence';
  }
  return result;
}
