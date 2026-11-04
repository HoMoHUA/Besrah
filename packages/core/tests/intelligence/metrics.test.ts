import { describe, expect, it } from 'vitest';
import { metricBounds } from '../../src/intelligence/metrics.js';
import type { NumericMetric } from '../../src/intelligence/contracts.js';

const at = '2026-11-02T10:00:00Z';
const evidence = [{ id: 'fixture:e1', sourceId: 'fixture:only', kind: 'fixture' as const, dataVersion: 'test-v1', live: false, observedAt: '2026-11-02T09:00:00Z', validUntil: '2026-11-02T11:00:00Z' }];
describe('evidence-aware metric bounds', () => {
  it('keeps known zero distinct from unknown and never uses stale numeric data', () => {
    expect(metricBounds({ state: 'known', unit: 'toman', value: 0, evidence }, at)).toEqual({ min: 0, max: 0, estimated: false });
    for (const state of ['unknown', 'stale', 'not_applicable'] as const) expect(metricBounds({ state, unit: 'toman', reason: 'fixture missing' }, at)).toBeNull();
    expect(metricBounds({ state: 'known', unit: 'toman', value: 10, evidence: [{ ...evidence[0], validUntil: at }] }, at)).toBeNull();
  });
  it('does not use evidence retrieved after the request clock', () => {
    expect(metricBounds({ state: 'known', unit: 'toman', value: 10, evidence: [{ ...evidence[0], retrievedAt: '2026-11-02T10:01:00Z' }] }, at)).toBeNull();
  });
  it('retains estimated intervals rather than manufacturing a midpoint or precision', () => {
    const metric: NumericMetric = { state: 'estimated', unit: 'seconds', interval: { min: 100, max: 200 }, evidence, assumptions: ['fixture timetable'] };
    expect(metricBounds(metric, at)).toEqual({ min: 100, max: 200, estimated: true });
    expect(metricBounds({ state: 'estimated', unit: 'seconds', value: 180, evidence, assumptions: ['point estimate only'] }, at)).toEqual({ min: 180, max: 180, estimated: true });
  });
});
