import { describe, expect, it } from 'vitest';
import type { Candidate, ConstraintCheck, MetricKey, NumericMetric, OptionLabel } from '../../src/intelligence/contracts.js';

// Every value and source in this file is synthetic test data, not a travel observation.
const at = '2026-11-02T10:00:00Z';
const evidence = [{ id: 'fixture:explain', sourceId: 'fixture:synthetic', kind: 'fixture' as const, dataVersion: 'test-v1', live: false, validUntil: '2026-11-02T11:00:00Z' }];
const candidate = (metrics: Candidate['metrics']): Candidate => ({ schemaVersion: 1, id: 'fixture:option', providerId: 'fixture:provider', domain: 'transit', taskId: 'fixture:task', equivalenceKey: 'fixture:equivalent', title: 'گزینهٔ آزمایشی', availability: 'available', metrics });
const known = (value: number): NumericMetric => ({ state: 'known', unit: 'toman', value, evidence });
const explain = async (c: Candidate, labels: OptionLabel[] = [], checks: ConstraintCheck[] = []) => (await import('../../src/intelligence/explain.js')).explainCandidate(c, at, labels, checks);

describe('evidence-grounded explanations', () => {
  it('cites the candidate, metric, and exact evidence for a known zero', async () => {
    const result = await explain(candidate({ totalCostToman: known(0) }));
    expect(result.candidateId).toBe('fixture:option');
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].text).toContain('0 تومان');
    expect(result.claims[0].refs).toEqual([{ candidateId: 'fixture:option', metric: 'totalCostToman', evidenceIds: ['fixture:explain'] }]);
  });

  it('preserves the whole interval, units, and estimated status without a midpoint or conversion', async () => {
    const c = candidate({ durationSeconds: { state: 'estimated', unit: 'seconds', value: 555, interval: { min: 100, max: 200 }, assumptions: ['synthetic interval'], evidence } });
    const result = await explain(c);
    const text = result.claims.map(claim => claim.text).join(' ');
    expect(text).toContain('100 تا 200 ثانیه');
    expect(text).toContain('برآورد');
    expect(text).not.toMatch(/150|555|دقیقه/);
    expect(result.claims[0].refs[0]).toEqual({ candidateId: c.id, metric: 'durationSeconds', evidenceIds: ['fixture:explain'] });
  });

  it('keeps an estimated point as an estimated point rather than inventing an interval', async () => {
    const result = await explain(candidate({ totalCostToman: { state: 'estimated', unit: 'toman', value: 12.5, assumptions: ['synthetic estimate'], evidence } }));
    expect(result.claims[0].text).toContain('12.5 تومان');
    expect(result.claims[0].text).toContain('برآورد');
    expect(result.claims[0].text).not.toContain(' تا ');
  });

  it('never prints numbers from unknown, stale, inapplicable, expired, or unsupported evidence', async () => {
    const metrics: Candidate['metrics'] = {
      totalCostToman: { state: 'unknown', unit: 'toman', reason: 'missing 999' },
      durationSeconds: { state: 'stale', unit: 'seconds', reason: 'stale 888', evidence },
      walkingSeconds: { state: 'not_applicable', unit: 'seconds', reason: 'not 777' },
      transfers: { state: 'known', unit: 'count', value: 666, evidence: [{ ...evidence[0], validUntil: at }] },
      quality: { state: 'known', unit: 'score_0_100', value: 55, evidence: [] },
      arrivalEpochSeconds: { state: 'known', unit: 'epoch_seconds', value: 123456, evidence: [{ ...evidence[0], observedAt: '2026-11-02T12:00:00Z' }] },
    };
    const result = await explain(candidate(metrics));
    expect(result.claims.map(claim => claim.text).join(' ')).not.toMatch(/[0-9۰-۹]/);
    expect(result.claims.map(claim => claim.text).join(' ')).not.toContain('صرفه');
  });

  it('scopes every authorized comparison label to the supplied eligible equivalent set', async () => {
    const result = await explain(candidate({ totalCostToman: known(23), durationSeconds: { ...known(61), unit: 'seconds' } }), ['fastest', 'lowest_cost', 'preference_match', 'pareto_option']);
    const labels = result.claims.filter(claim => claim.code.startsWith('label:'));
    expect(labels).toHaveLength(4);
    for (const claim of labels) {
      expect(claim.text).toContain('گزینه های هم ارز و واجد شرایط ارائه شده');
      expect(claim.text).not.toMatch(/[0-9۰-۹]|همهٔ مسیرها|تضمین/);
      expect(claim.refs.length).toBeGreaterThan(0);
    }
  });

  it('ignores foreign checks and never echoes an uncited numeric constraint reason', async () => {
    const c = candidate({ totalCostToman: known(42) });
    const check: ConstraintCheck = { candidateId: c.id, constraintId: 'fixture:budget', status: 'satisfied', reason: 'save 999999', ref: { candidateId: c.id, metric: 'totalCostToman', evidenceIds: ['forged:missing'] } };
    const result = await explain(c, [], [check, { ...check, candidateId: 'fixture:foreign', constraintId: 'fixture:foreign' }]);
    const claims = result.claims.filter(claim => claim.code.startsWith('constraint:'));
    expect(claims).toHaveLength(1);
    expect(claims[0].text).not.toMatch(/[0-9۰-۹]/);
    expect(claims[0].refs).toEqual([{ candidateId: c.id, metric: 'totalCostToman', evidenceIds: ['fixture:explain'] }]);
    for (const claim of result.claims) for (const ref of claim.refs) {
      expect(ref.candidateId).toBe(c.id);
      const metric = c.metrics[ref.metric as MetricKey];
      expect(metric).toBeDefined();
      expect(ref.evidenceIds.every(id => metric?.evidence?.some(item => item.id === id))).toBe(true);
    }
  });

  it('does not mutate candidate, labels, or constraint checks', async () => {
    const c = candidate({ totalCostToman: known(50) });
    const labels: OptionLabel[] = ['lowest_cost'];
    const before = JSON.stringify({ c, labels });
    await explain(c, labels);
    expect(JSON.stringify({ c, labels })).toBe(before);
  });
});
