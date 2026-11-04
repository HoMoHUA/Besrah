import { describe, expect, it } from 'vitest';
import type { Candidate, HardConstraint, NumericMetric } from '../../src/intelligence/contracts.js';
import { checkConstraint } from '../../src/intelligence/constraints.js';

const at = '2026-11-02T12:00:00.000Z';
const evidence = [{ id: 'fare-evidence', sourceId: 'fixture', kind: 'fixture' as const, dataVersion: '1', live: false }];
const known = (value: number): NumericMetric => ({ state: 'known', unit: 'toman', value, evidence });
const interval = (min: number, max: number): NumericMetric => ({ state: 'estimated', unit: 'toman', interval: { min, max }, assumptions: ['fare range'], evidence });
const candidate = (metric?: NumericMetric): Candidate => ({ schemaVersion: 1, id: 'option', providerId: 'fixture', domain: 'transit', taskId: 'task', equivalenceKey: 'trip', title: 'Option', availability: 'available', metrics: metric ? { totalCostToman: metric } : {} });
const constraint = (operator: 'lte' | 'gte', bound: number, requireKnown = false): HardConstraint => ({ id: 'budget', metric: 'totalCostToman', operator, bound, requireKnown });

// These assertions catch point-value fallbacks, unsafe interval optimism and lost provenance.
describe('checkConstraint', () => {
  it('preserves a known zero and the constraint/metric evidence reference', () => {
    expect(checkConstraint(candidate(known(0)), constraint('lte', 0), at)).toMatchObject({ candidateId: 'option', constraintId: 'budget', status: 'satisfied', ref: { candidateId: 'option', metric: 'totalCostToman', evidenceIds: ['fare-evidence'] } });
  });

  it.each([
    ['lte', 20, 'satisfied'], ['lte', 9, 'violated'], ['lte', 15, 'undetermined'], ['lte', 10, 'undetermined'],
    ['gte', 10, 'satisfied'], ['gte', 21, 'violated'], ['gte', 15, 'undetermined'], ['gte', 20, 'undetermined'],
  ] as const)('checks the entire interval for %s %s', (operator, bound, status) => {
    expect(checkConstraint(candidate(interval(10, 20)), constraint(operator, bound), at).status).toBe(status);
  });

  it('requires known values when requested, even for a singleton estimate', () => {
    expect(checkConstraint(candidate(interval(0, 0)), constraint('lte', 100, true), at).status).toBe('undetermined');
    expect(checkConstraint(candidate(known(0)), constraint('lte', 100, true), at).status).toBe('satisfied');
  });

  it.each(['unknown', 'stale', 'not_applicable'] as const)('does not treat %s as a free fare', state => {
    const result = checkConstraint(candidate({ state, unit: 'toman', reason: state }), constraint('lte', 100), at);
    expect(result.status).toBe('undetermined');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('returns undetermined for missing, expired and future-observed metrics or an invalid clock', () => {
    const expired: NumericMetric = { state: 'known', unit: 'toman', value: 0, evidence: [{ ...evidence[0]!, validUntil: at }] };
    const future: NumericMetric = { state: 'known', unit: 'toman', value: 0, evidence: [{ ...evidence[0]!, observedAt: '2026-11-03T00:00:00Z' }] };
    for (const metric of [undefined, expired, future]) expect(checkConstraint(candidate(metric), constraint('lte', 100), at).status).toBe('undetermined');
    expect(checkConstraint(candidate(known(0)), constraint('lte', 100), 'invalid').status).toBe('undetermined');
  });

  it('does not compare mismatched units or invalid finite bounds', () => {
    expect(checkConstraint(candidate({ ...known(0), unit: 'seconds' }), constraint('lte', 100), at).status).toBe('undetermined');
    expect(checkConstraint(candidate(known(0)), constraint('lte', Number.NaN), at).status).toBe('undetermined');
  });

  it('handles time bounds with the same conservative semantics as cost', () => {
    const option = candidate();
    option.metrics.durationSeconds = { state: 'estimated', unit: 'seconds', interval: { min: 600, max: 900 }, evidence, assumptions: ['traffic'] };
    expect(checkConstraint(option, { id: 'deadline', metric: 'durationSeconds', operator: 'lte', bound: 900 }, at).status).toBe('satisfied');
    expect(checkConstraint(option, { id: 'deadline', metric: 'durationSeconds', operator: 'lte', bound: 700 }, at).status).toBe('undetermined');
  });

  it('leaves all inputs untouched and returns independent evidence arrays', () => {
    const option = candidate(interval(10, 20));
    const cap = constraint('lte', 20);
    const before = structuredClone({ option, cap });
    const result = checkConstraint(option, cap, at);
    result.ref.evidenceIds.push('new');
    expect({ option, cap }).toEqual(before);
  });
});
