import { describe, expect, it } from 'vitest';
import { assertDecisionInput, assertMemory, assertPreference } from '../../src/intelligence/validation.js';
import { input, preference } from './helpers.js';

describe('versioned bounded runtime validation', () => {
  it('accepts anonymous decision inputs and distinguishes zero from missing', () => {
    const value = input();
    expect(() => assertDecisionInput(value)).not.toThrow();
    value.candidates[0].metrics.totalCostToman = { state: 'unknown', unit: 'toman', reason: 'not quoted' };
    expect(() => assertDecisionInput(value)).not.toThrow();
  });
  it.each([
    (v: any) => { v.schemaVersion = true; },
    (v: any) => { v.context.at = '2026-02-30T10:00:00Z'; },
    (v: any) => { v.context.at = '2026-11-02T10:00:00'; },
    (v: any) => { v.context.userId = 'forged'; },
    (v: any) => { v.candidates.push(structuredClone(v.candidates[0])); },
    (v: any) => { v.candidates = Array.from({ length: 129 }, (_, i) => ({ ...v.candidates[0], id: 'fixture:' + i })); },
    (v: any) => { v.candidates[0].metrics.totalCostToman.value = NaN; },
    (v: any) => { v.candidates[0].metrics.totalCostToman.value = 1.1; },
    (v: any) => { v.candidates[0].metrics.totalCostToman.unit = 'seconds'; },
    (v: any) => { v.candidates[0].metrics.totalCostToman.evidence = []; },
    (v: any) => { v.candidates[0].metrics.totalCostToman.evidence[0].kind = 'derived'; },
    (v: any) => { v.candidates[0].metrics.totalCostToman = { state: 'unknown', unit: 'toman', reason: 'missing', value: 0 }; },
    (v: any) => { v.candidates[0].metrics.durationSeconds = { state: 'estimated', unit: 'seconds', evidence: v.candidates[0].metrics.totalCostToman.evidence, assumptions: ['fixture'] }; },
    (v: any) => { v.context.objectives.push(v.context.objectives[0]); },
    (v: any) => { v.context.constraints = [{ id: 'limit', metric: 'totalCostToman', operator: 'lte', bound: Infinity }]; },
  ])('rejects malformed, ambiguous or unbounded input %#', mutate => {
    const value = input(); mutate(value); expect(() => assertDecisionInput(value)).toThrow();
  });
  it('rejects sparse arrays and accessors without executing them', () => {
    const sparse = input(); sparse.candidates = Array(1);
    expect(() => assertDecisionInput(sparse)).toThrow();
    const guarded = input(); let invoked = false;
    const metric = { unit: 'toman', value: 1, evidence: guarded.candidates[0].metrics.totalCostToman?.evidence };
    Object.defineProperty(metric, 'state', { enumerable: true, get() { invoked = true; return 'known'; } });
    guarded.candidates[0].metrics.totalCostToman = metric as any;
    expect(() => assertDecisionInput(guarded)).toThrow();
    expect(invoked).toBe(false);
  });
  it('rejects hidden cost fields that bypass integer and evidence bounds', () => {
    const value = input();
    const cost = { state: 'known', unit: 'toman', value: 0.5,
      evidence: Array.from({ length: 9 }, (_, i) => ({ ...value.candidates[0].metrics.totalCostToman!.evidence![0], id: `fixture:hidden-${i}` })) };
    Object.defineProperty(value.candidates[0].metrics, 'totalCostToman', { value: cost, enumerable: false });
    expect(() => assertDecisionInput(value)).toThrow();
  });
  it.each(['schemaVersion', 'unexpected'])('rejects non-enumerable own fields: %s', key => {
    const value = input();
    Object.defineProperty(value, key, { value: 1, enumerable: false });
    expect(() => assertDecisionInput(value)).toThrow();
  });
  it.each([true, false])('rejects symbol fields without invoking accessors (enumerable=%s)', enumerable => {
    const value = input(); let invoked = false;
    Object.defineProperty(value.candidates[0].metrics, Symbol('hidden metric'), {
      enumerable, get() { invoked = true; return { state: 'known', unit: 'toman', value: 0.5 }; },
    });
    expect(() => assertDecisionInput(value)).toThrow();
    expect(invoked).toBe(false);
  });
  it.each(['candidates', 'objectives', 'evidence'])('rejects dense array accessors without executing them: %s', field => {
    const value = input(); let invoked = false;
    const array = field === 'candidates' ? value.candidates
      : field === 'objectives' ? value.context.objectives : value.candidates[0].metrics.totalCostToman!.evidence!;
    const first = array[0];
    Object.defineProperty(array, '0', { enumerable: true, get() { invoked = true; return first; } });
    expect(() => assertDecisionInput(value)).toThrow();
    expect(invoked).toBe(false);
  });
  it.each(['hidden', 'symbol'])('rejects non-JSON extra array fields: %s', kind => {
    const value = input();
    Object.defineProperty(value.candidates, kind === 'symbol' ? Symbol('extra') : 'extra', { value: 'not contract data', enumerable: false });
    expect(() => assertDecisionInput(value)).toThrow();
  });
  it('validates memory provenance, consent, version and scope without inventing account identity', () => {
    const pref = preference();
    expect(() => assertPreference(pref)).not.toThrow();
    expect(() => assertMemory({ schemaVersion: 1, revision: 0, preferences: [pref] })).not.toThrow();
    for (const bad of [{ ...pref, version: 0 }, { ...pref, scope: 'request' }, { ...pref, consent: { store: true, use: true } }, { ...pref, expiresAt: 'yesterday' }]) expect(() => assertPreference(bad)).toThrow();
    expect(() => assertMemory({ schemaVersion: 1, revision: 0, preferences: [pref, pref] })).toThrow();
  });
});
