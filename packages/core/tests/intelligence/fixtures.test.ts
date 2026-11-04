import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { evaluateDecision } from '../../src/intelligence/decision.js';
import { input } from './helpers.js';
const fixtures = JSON.parse(readFileSync(new URL('../../fixtures/intelligence/scenarios.json', import.meta.url), 'utf8'));

describe('explicitly synthetic executable fixtures and side-effect boundary', () => {
  it('keeps fixture data outside the public app and assigns no live provider provenance', () => {
    expect(fixtures.synthetic).toBe(true);
    expect(fixtures.scenarios).toHaveLength(10);
    const serving = readFileSync(new URL('../../src/miniapp.ts', import.meta.url), 'utf8');
    expect(serving).not.toMatch(/fixtures\/intelligence|intelligence\/index/);
    for (const scenario of fixtures.scenarios) {
      expect(scenario.notice).toMatch(/SYNTHETIC/);
      const result = evaluateDecision(scenario.input);
      expect(result.schemaVersion).toBe(1);
      expect(result.scope).toBe('provided_eligible_equivalent_options');
      for (const option of scenario.input.candidates) for (const metric of Object.values(option.metrics) as any[]) for (const evidence of metric.evidence ?? []) {
        expect(evidence.kind).toBe('fixture'); expect(evidence.live).toBe(false);
      }
    }
  });
  it('executes representative fixture outcomes, including a request-only preference override', () => {
    const results = new Map<string, ReturnType<typeof evaluateDecision>>(fixtures.scenarios.map((s: any) => [s.id, evaluateDecision(s.input)]));
    expect(results.get('local-preference')?.options.map(o => o.candidateId)).toEqual(['fixture:economical']);
    expect(results.get('request-override')?.options.map(o => o.candidateId)).toEqual(['fixture:quick']);
    expect(results.get('anonymous-question')?.question?.answers).toHaveLength(2);
    expect(results.get('hard-gates')?.excluded.map(o => o.candidateId)).toContain('fixture:over-budget');
    expect(results.get('stale-evidence')?.status).toBe('insufficient_data');
    expect(results.get('no-feasible')?.options).toEqual([]);
    expect(results.get('non-equivalent')?.groups).toHaveLength(2);
    expect(results.get('preference-conflict')?.preference.conflicts).toHaveLength(2);
  });
  it('does not access ambient time, network, localStorage or randomness', () => {
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw Error('ambient clock forbidden'); });
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw Error('randomness forbidden'); });
    vi.stubGlobal('fetch', () => { throw Error('network forbidden'); });
    vi.stubGlobal('localStorage', new Proxy({}, { get() { throw Error('storage forbidden'); } }));
    try { expect(evaluateDecision(input()).options).toHaveLength(1); }
    finally { clock.mockRestore(); random.mockRestore(); vi.unstubAllGlobals(); }
  });
});
