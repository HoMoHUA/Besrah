import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/intelligence/contracts.js';
import type { Candidate, MetricKey, NumericMetric, Objective, Unit } from '../../src/intelligence/contracts.js';
import { compareCandidates, groupKey, preferredCandidates } from '../../src/intelligence/compare.js';

const at = '2026-11-02T12:00:00.000Z';
const evidence = [{ id: 'measurement', sourceId: 'fixture', kind: 'fixture' as const, dataVersion: '1', live: false }];
const known = (value: number, unit: Unit = 'toman'): NumericMetric => ({ state: 'known', unit, value, evidence });
const interval = (min: number, max: number, unit: Unit = 'toman'): NumericMetric => ({ state: 'estimated', unit, interval: { min, max }, evidence, assumptions: ['bounded estimate'] });
const candidate = (id: string, cost?: NumericMetric, duration?: NumericMetric): Candidate => ({ schemaVersion: 1, id, providerId: 'fixture', domain: 'transit', taskId: 'task', equivalenceKey: 'trip', title: id, availability: 'available', metrics: { ...(cost ? { totalCostToman: cost } : {}), ...(duration ? { durationSeconds: duration } : {}) } });
const cost: Objective[] = [{ metric: 'totalCostToman', direction: 'min' }];
const both: Objective[] = [...cost, { metric: 'durationSeconds', direction: 'min' }];
const ids = (options: Candidate[]) => options.map(option => option.id);
const group = (options: Candidate[], objectives = cost) => compareCandidates(options, objectives, at)[0]!;

// These assertions detect midpoint scoring, delimiter collisions and favorable missing values.
describe('groupKey and compareCandidates', () => {
  it('encodes the domain/task/equivalence tuple without delimiter collisions', () => {
    const a = { ...candidate('a', known(1)), taskId: 'a|b', equivalenceKey: 'c' };
    const b = { ...candidate('b', known(2)), taskId: 'a', equivalenceKey: 'b|c' };
    expect(groupKey(a)).not.toBe(groupKey(b));
    expect(groupKey(a)).toBe(groupKey({ ...a, id: 'other', providerId: 'other' }));
    expect(compareCandidates([a, b], cost, at)).toHaveLength(2);
  });

  it('does not compare domains, tasks or equivalence classes against one another', () => {
    const base = candidate('a', known(0));
    const options = [base, { ...candidate('b', known(100)), domain: 'food' as const }, { ...candidate('c', known(100)), taskId: 'other' }, { ...candidate('d', known(100)), equivalenceKey: 'other' }];
    const groups = compareCandidates(options, cost, at);
    expect(groups).toHaveLength(4);
    expect(groups.every(item => item.frontierIds.length === 1 && item.dominatedIds.length === 0 && item.pairComparisons === 0)).toBe(true);
  });

  it('builds a Pareto frontier without a hidden weighted score', () => {
    const options = [candidate('slow-cheap', known(10), known(100, 'seconds')), candidate('fast-costly', known(100), known(10, 'seconds')), candidate('dominated', known(200), known(200, 'seconds'))];
    expect(group(options, both)).toMatchObject({ frontierIds: ['fast-costly', 'slow-cheap'], dominatedIds: ['dominated'], incompleteIds: [], comparisonComplete: true, pairComparisons: 3 });
  });

  it('preserves zero as a real minimum', () => {
    expect(group([candidate('paid', known(1)), candidate('free', known(0))])).toMatchObject({ frontierIds: ['free'], dominatedIds: ['paid'] });
  });

  it('keeps overlapping, identical and merely touching uncertain intervals on the frontier', () => {
    for (const [a, b] of [[interval(0, 10), interval(5, 15)], [interval(0, 10), interval(0, 10)], [interval(0, 10), interval(10, 20)]]) {
      expect(group([candidate('b', b), candidate('a', a)])).toMatchObject({ frontierIds: ['a', 'b'], dominatedIds: [] });
    }
  });

  it('allows identical uncertain bounds on one objective and strict improvement on another', () => {
    expect(group([candidate('a', interval(0, 10), known(10, 'seconds')), candidate('b', interval(0, 10), known(20, 'seconds'))], both)).toMatchObject({ frontierIds: ['a'], dominatedIds: ['b'] });
  });

  it('maximizes objectives conservatively, including equality', () => {
    const objectives: Objective[] = [{ metric: 'quality', direction: 'max' }];
    const options = [candidate('a'), candidate('b'), candidate('c')];
    options[0]!.metrics.quality = interval(90, 100, 'score_0_100');
    options[1]!.metrics.quality = interval(50, 80, 'score_0_100');
    options[2]!.metrics.quality = interval(90, 100, 'score_0_100');
    expect(group(options, objectives)).toMatchObject({ frontierIds: ['a', 'c'], dominatedIds: ['b'] });
  });

  it('separates missing, unknown, stale, nonapplicable, expired and wrong-unit objectives', () => {
    const options = [candidate('valid', known(5)), candidate('missing'), ...(['unknown', 'stale', 'not_applicable'] as const).map(state => candidate(state, { state, unit: 'toman', reason: state })), candidate('expired', { state: 'known', unit: 'toman', value: 0, evidence: [{ ...evidence[0]!, validUntil: at }] }), candidate('wrong-unit', known(0, 'seconds'))];
    expect(group(options)).toMatchObject({ frontierIds: ['valid'], dominatedIds: [], incompleteIds: ['expired', 'missing', 'not_applicable', 'stale', 'unknown', 'wrong-unit'], comparisonComplete: false, pairComparisons: 0 });
  });

  it('does not call an empty or unrecognized objective set a complete comparison', () => {
    const options = [candidate('a', known(0))];
    for (const objectives of [[], [{ metric: 'unrecognized' as MetricKey, direction: 'min' as const }]]) {
      expect(group(options, objectives)).toMatchObject({ frontierIds: [], incompleteIds: ['a'], comparisonComplete: false, pairComparisons: 0 });
    }
  });

  it('counts every complete within-group unordered pair, including dominated candidates', () => {
    expect(group([candidate('d', known(4)), candidate('c', known(3)), candidate('b', known(2)), candidate('a', known(1)), candidate('missing')])).toMatchObject({ frontierIds: ['a'], dominatedIds: ['b', 'c', 'd'], incompleteIds: ['missing'], pairComparisons: 6 });
  });

  it('is deterministic under input order and leaves candidates/objectives unchanged', () => {
    const options = [candidate('z', interval(0, 10)), candidate('a', interval(0, 10)), { ...candidate('other', known(5)), taskId: 'elsewhere' }];
    const before = structuredClone({ options, cost });
    expect(compareCandidates(options, cost, at)).toEqual(compareCandidates([...options].reverse(), [...cost], at));
    expect({ options, cost }).toEqual(before);
    expect(compareCandidates(options, cost, at).find(item => item.key === groupKey(options[0]!))?.frontierIds).toEqual(['a', 'z']);
  });

  it('enforces hard caps before quadratic work, with bounded pair counts at the limit', () => {
    const options = Array.from({ length: LIMITS.candidates }, (_, index) => candidate(String(index), known(index)));
    expect(group(options).pairComparisons).toBe(LIMITS.candidates * (LIMITS.candidates - 1) / 2);
    expect(() => compareCandidates([...options, candidate('overflow', known(0))], cost, at)).toThrow(RangeError);
    expect(() => compareCandidates([], Array.from({ length: LIMITS.objectives + 1 }, () => cost[0]!), at)).toThrow(RangeError);
  });
});

describe('preferredCandidates', () => {
  it('changes the selected option only with the explicit lexicographic objective order', () => {
    const options = [candidate('cheap', known(10), known(100, 'seconds')), candidate('fast', known(100), known(10, 'seconds'))];
    expect(ids(preferredCandidates(options, both, ['totalCostToman', 'durationSeconds'], at))).toEqual(['cheap']);
    expect(ids(preferredCandidates(options, both, ['durationSeconds', 'totalCostToman'], at))).toEqual(['fast']);
  });

  it('does not resolve a primary interval overlap using a secondary objective', () => {
    const options = [candidate('a', interval(0, 10), known(100, 'seconds')), candidate('b', interval(5, 15), known(1, 'seconds'))];
    expect(ids(preferredCandidates(options, both, ['totalCostToman', 'durationSeconds'], at))).toEqual(['a', 'b']);
    expect(ids(preferredCandidates([candidate('a', interval(0, 10)), candidate('b', interval(10, 20))], cost, ['totalCostToman'], at))).toEqual(['a', 'b']);
  });

  it('continues to a secondary objective only after exactly equal primary bounds', () => {
    const options = [candidate('a', interval(0, 10), known(100, 'seconds')), candidate('b', interval(0, 10), known(1, 'seconds'))];
    expect(ids(preferredCandidates(options, both, ['totalCostToman', 'durationSeconds'], at))).toEqual(['b']);
  });

  it('does not invent a secondary order or rank ties by candidate ID', () => {
    const options = [candidate('z', known(10), known(1, 'seconds')), candidate('a', known(10), known(100, 'seconds'))];
    expect(ids(preferredCandidates(options, both, ['totalCostToman'], at))).toEqual(['a', 'z']);
    expect(ids(preferredCandidates(options, both, [], at))).toEqual(['a', 'z']);
  });

  it('honors maximize directions without letting wrong units or missing metrics win', () => {
    const options = [candidate('better', known(10)), candidate('worse', known(1)), candidate('wrong', known(100, 'seconds')), candidate('missing')];
    expect(ids(preferredCandidates(options, [{ metric: 'totalCostToman', direction: 'max' }], ['totalCostToman'], at))).toEqual(['better']);
  });

  it('does not let unknown or expired values win explicit preferences', () => {
    const options = [candidate('valid', known(10)), candidate('unknown', { state: 'unknown', unit: 'toman', reason: 'missing' }), candidate('stale', { state: 'known', unit: 'toman', value: 0, evidence: [{ ...evidence[0]!, validUntil: at }] })];
    expect(ids(preferredCandidates(options, cost, ['totalCostToman'], at))).toEqual(['valid']);
    expect(preferredCandidates(options, cost, ['totalCostToman'], 'invalid')).toEqual([]);
  });

  it('never chooses between nonequivalent options', () => {
    const options = [candidate('a', known(0)), { ...candidate('b', known(100)), equivalenceKey: 'other' }];
    expect(ids(preferredCandidates(options, cost, ['totalCostToman'], at))).toEqual(['a', 'b']);
  });

  it('does not infer a direction for an order key absent from objectives', () => {
    const options = [candidate('b', known(1)), candidate('a', known(10))];
    expect(ids(preferredCandidates(options, cost, ['quality'], at))).toEqual(['a', 'b']);
  });

  it('leaves input arrays and nested metrics untouched', () => {
    const options = [candidate('z', known(20)), candidate('a', known(10))];
    const order: MetricKey[] = ['totalCostToman'];
    const before = structuredClone({ options, cost, order });
    preferredCandidates(options, cost, order, at);
    expect({ options, cost, order }).toEqual(before);
  });

  it('enforces candidate, objective and order hard caps before comparison', () => {
    expect(() => preferredCandidates(Array.from({ length: LIMITS.candidates + 1 }, (_, index) => candidate(String(index))), cost, [], at)).toThrow(RangeError);
    expect(() => preferredCandidates([], Array.from({ length: LIMITS.objectives + 1 }, () => cost[0]!), [], at)).toThrow(RangeError);
    expect(() => preferredCandidates([], cost, Array.from({ length: LIMITS.objectives + 1 }, () => 'totalCostToman' as const), at)).toThrow(RangeError);
  });
});
