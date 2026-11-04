import { describe, expect, it, vi } from 'vitest';
import * as metricHelpers from '../../src/intelligence/metrics.js';
import { evaluateDecision } from '../../src/intelligence/decision.js';
import { candidate, context, input, preference, money } from './helpers.js';

const ids = (result: ReturnType<typeof evaluateDecision>) => result.options.map(o => o.candidateId);
describe('standalone evidence-based decision engine', () => {
  it('gates hard limits, separates unknown, and never lets preferences override constraints', () => {
    const value = input();
    value.context.constraints = [{ id: 'budget', metric: 'totalCostToman', operator: 'lte', bound: 150 }];
    const uncertain = candidate('fixture:unknown'); uncertain.metrics.totalCostToman = { state: 'unknown', unit: 'toman', reason: 'quote missing' };
    value.candidates = [candidate('fixture:cheap', 100, 200), candidate('fixture:fast', 200, 100), uncertain];
    value.memory = { schemaVersion: 1, revision: 1, preferences: [preference('fixture:time', { value: ['durationSeconds', 'totalCostToman'] })] };
    const result = evaluateDecision(value);
    expect(ids(result)).toEqual(['fixture:cheap']);
    expect(result.excluded.map(c => c.candidateId)).toEqual(['fixture:fast']);
    expect(result.undetermined.map(c => c.candidateId)).toEqual(['fixture:unknown']);
    expect(result.status).toBe('partial');
    expect(result.excluded[0].checks[0].status).toBe('violated');
  });
  it('uses explicit local preferences, with a current request override but no persistence mutation', () => {
    const value = input(); value.candidates = [candidate('fixture:cheap', 100, 200), candidate('fixture:fast', 200, 100)];
    value.memory = { schemaVersion: 1, revision: 1, preferences: [preference()] };
    expect(ids(evaluateDecision(value))).toEqual(['fixture:cheap']);
    value.context.requestPreferences = [preference('fixture:request-time', { scope: 'request', requestId: value.context.requestId, value: ['durationSeconds', 'totalCostToman'], consent: { store: 'denied', use: 'granted' } })];
    const before = structuredClone(value);
    expect(ids(evaluateDecision(value))).toEqual(['fixture:fast']);
    expect(value).toEqual(before);
  });
  it('returns a variable number of options, permits multiple labels, and asks only an effective question', () => {
    const value = input(); value.candidates = [candidate('fixture:cheap', 100, 200), candidate('fixture:fast', 200, 100)];
    const result = evaluateDecision(value);
    expect(ids(result)).toEqual(['fixture:cheap', 'fixture:fast']);
    expect(result.question?.answers).toHaveLength(2);
    expect(result.question?.answers.map(a => a.selectedIds)).toContainEqual(['fixture:cheap']);
    expect(result.question?.answers.map(a => a.selectedIds)).toContainEqual(['fixture:fast']);
    value.candidates = [candidate('fixture:best', 10, 20), candidate('fixture:dominated', 30, 40)];
    const single = evaluateDecision(value);
    expect(ids(single)).toEqual(['fixture:best']);
    expect(single.options[0].labels).toEqual(expect.arrayContaining(['fastest', 'lowest_cost']));
    expect(single.question).toBeUndefined();
  });
  it('does not crown unknown or non-equivalent alternatives cheapest', () => {
    const value = input();
    const other = candidate('fixture:different', 1, 1); other.equivalenceKey = 'fixture:other-product';
    const unknown = candidate('fixture:unknown'); unknown.metrics.totalCostToman = { state: 'stale', unit: 'toman', reason: 'expired' };
    value.candidates = [candidate(), other, unknown];
    const result = evaluateDecision(value);
    expect(result.groups).toHaveLength(2);
    expect(result.groups.find(g => g.incompleteIds.includes('fixture:unknown'))?.comparisonComplete).toBe(false);
    expect(result.options.find(o => o.candidateId === 'fixture:a')?.labels).not.toContain('lowest_cost');
    expect(result.question).toBeUndefined();
  });
  it('retains provisional options without categorical Pareto claims when a competitor has unknown cost', () => {
    const value = input();
    const unknown = candidate('fixture:b', 0, 50);
    unknown.metrics.totalCostToman = { state: 'unknown', unit: 'toman', reason: 'quote missing' };
    value.candidates = [candidate('fixture:a', 100, 200), unknown];
    const result = evaluateDecision(value);
    expect(result.status).toBe('partial');
    expect(ids(result)).toEqual(['fixture:a']);
    expect(result.undetermined).toEqual([{ candidateId: 'fixture:b', reason: 'incomplete_objectives', checks: [] }]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ comparisonComplete: false, frontierIds: ['fixture:a'], incompleteIds: ['fixture:b'], dominatedIds: [] });
    const option = result.options[0];
    expect.soft(option.labels).toEqual([]);
    expect.soft(option.explanation.claims.map(claim => claim.code)).not.toContain('label:pareto_option');
    expect.soft(option.explanation.claims.some(claim => claim.text.includes('نامغلوب'))).toBe(false);
    expect(option.explanation.claims).toEqual([
      { code: 'metric:totalCostToman', text: 'هزینه: 100 تومان.', refs: [{ candidateId: 'fixture:a', metric: 'totalCostToman', evidenceIds: ['fixture:e1'] }] },
      { code: 'metric:durationSeconds', text: 'زمان سفر: 200 ثانیه.', refs: [{ candidateId: 'fixture:a', metric: 'durationSeconds', evidenceIds: ['fixture:e1'] }] },
    ]);
    expect(result.question).toBeUndefined();
  });
  it('distinguishes no feasible option, insufficient evidence and denied permission', () => {
    const value = input(); value.context.constraints = [{ id: 'budget', metric: 'totalCostToman', operator: 'lte', bound: 0 }];
    expect(evaluateDecision(value).status).toBe('no_feasible_option');
    value.candidates[0].metrics.totalCostToman = { state: 'unknown', unit: 'toman', reason: 'missing' };
    expect(evaluateDecision(value).status).toBe('insufficient_data');
    value.context.decisionPermission = 'denied'; value.candidates[0].metrics.totalCostToman = money(0);
    expect(evaluateDecision(value).options).toEqual([]);
    expect(evaluateDecision(value).reason).toBe('decision_permission_denied');
    expect(evaluateDecision({ ...input(), candidates: [] }).options).toEqual([]);
  });
  it('runs without network, clock, storage or LLM and exposes bounded work counters', () => {
    const value = input(); value.candidates = Array.from({ length: 128 }, (_, i) => candidate(`fixture:${String(i).padStart(3, '0')}`, i, 128 - i));
    const first = evaluateDecision(value), second = evaluateDecision(value);
    expect(first).toEqual(second);
    expect(first.stats.candidateCount).toBe(128);
    expect(first.stats.pairComparisons).toBeLessThanOrEqual(128 * 127);
    expect(first.options.length).toBeLessThanOrEqual(128);
    expect(() => evaluateDecision({ ...value, candidates: [...value.candidates, candidate('fixture:overflow')] })).toThrow();
  });
  it('does not repeatedly reparse peer evidence for every identical cost label', () => {
    const value = input(); value.context.objectives = [{ metric: 'totalCostToman', direction: 'min' }];
    value.candidates = Array.from({ length: 64 }, (_, i) => candidate(`fixture:equal-${i}`, 10, 20));
    const spy = vi.spyOn(metricHelpers, 'metricBounds');
    try {
      const result = evaluateDecision(value);
      expect(result.options).toHaveLength(64);
      expect(result.options.every(option => option.labels.includes('lowest_cost'))).toBe(true);
      expect(spy.mock.calls.length).toBeGreaterThan(0);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(8 * value.candidates.length);
    } finally { spy.mockRestore(); }
  });
  it('provides numerical explanations referencing only the selected candidate metrics and evidence', () => {
    const value = input(); const result = evaluateDecision(value);
    const claims = result.options[0].explanation.claims;
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) for (const ref of claim.refs) {
      expect(ref.candidateId).toBe(value.candidates[0].id);
      const metric = value.candidates[0].metrics[ref.metric];
      expect(ref.evidenceIds.every(id => metric?.evidence?.some(e => e.id === id))).toBe(true);
    }
  });
});
