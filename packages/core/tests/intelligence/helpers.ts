import type { Candidate, DecisionInput, NumericMetric, Preference, RequestContext } from '../../src/intelligence/contracts.js';
export const AT = '2026-11-02T10:00:00Z';
export const evidence = () => [{ id: 'fixture:e1', sourceId: 'fixture:synthetic', kind: 'fixture' as const, dataVersion: 'test-v1', live: false, observedAt: '2026-11-02T09:00:00Z', validUntil: '2026-11-02T11:00:00Z' }];
export const money = (value: number): NumericMetric => ({ state: 'known', unit: 'toman', value, evidence: evidence() });
export const seconds = (value: number): NumericMetric => ({ state: 'known', unit: 'seconds', value, evidence: evidence() });
export function candidate(id = 'fixture:a', cost = 100, time = 200): Candidate {
  return { schemaVersion: 1, id, providerId: 'fixture', domain: 'transit', taskId: 'fixture:journey', equivalenceKey: 'fixture:same-task', title: 'SYNTHETIC TEST OPTION', availability: 'available', metrics: { totalCostToman: money(cost), durationSeconds: seconds(time) } };
}
export function context(): RequestContext {
  return { schemaVersion: 1, requestId: 'fixture:request', taskId: 'fixture:journey', domain: 'transit', at: AT, decisionPermission: 'granted', objectives: [{ metric: 'totalCostToman', direction: 'min' }, { metric: 'durationSeconds', direction: 'min' }], constraints: [] };
}
export const input = (): DecisionInput => ({ schemaVersion: 1, context: context(), candidates: [candidate()] });
export function preference(id = 'fixture:p', overrides: Partial<Preference> = {}): Preference {
  return { schemaVersion: 1, id, version: 1, domain: 'transit', scope: 'device', kind: 'objective_order', value: ['totalCostToman', 'durationSeconds'], provenance: { kind: 'explicit', source: 'synthetic_user_statement' }, confirmedByUser: true, updatedAt: '2026-11-02T09:00:00Z', consent: { store: 'granted', use: 'granted' }, ...overrides };
}
