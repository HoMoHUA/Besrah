import { describe, expect, it } from 'vitest';
import type { Candidate, MetricKey, NumericMetric, Objective, ResolvedPreference, UsefulQuestion } from '../../src/intelligence/contracts.js';

// Synthetic test scenarios only; none of these values describe a real provider or trip.
const at = '2026-11-02T10:00:00Z';
const objectives: Objective[] = [{ metric: 'durationSeconds', direction: 'min' }, { metric: 'totalCostToman', direction: 'min' }];
const known = (value: number, unit: NumericMetric['unit'], id = 'fixture:metric'): NumericMetric => ({ state: 'known', unit, value, evidence: [{ id, sourceId: 'fixture:synthetic', kind: 'fixture', dataVersion: 'test-v1', live: false, validUntil: '2026-11-02T11:00:00Z' }] });
const option = (id: string, seconds: number, cost: number): Candidate => ({ schemaVersion: 1, id, providerId: `fixture:provider:${id}`, domain: 'transit', taskId: 'fixture:task', equivalenceKey: 'fixture:equivalent', title: 'گزینهٔ آزمایشی', availability: 'available', metrics: { durationSeconds: known(seconds, 'seconds', `fixture:${id}:time`), totalCostToman: known(cost, 'toman', `fixture:${id}:cost`) } });
const tradeoff = () => [option('fixture:cheap', 120, 20), option('fixture:fast', 60, 40)];
const suggest = async (candidates: Candidate[], goals: Objective[] = objectives, preference?: ResolvedPreference, clock = at) => (await import('../../src/intelligence/questions.js')).suggestQuestion(candidates, goals, clock, preference);

function verifyRefs(question: UsefulQuestion, candidates: Candidate[]) {
  expect(question.refs.length).toBeGreaterThan(0);
  for (const ref of question.refs) {
    const c = candidates.find(candidate => candidate.id === ref.candidateId);
    const metric = c?.metrics[ref.metric];
    expect(metric).toBeDefined();
    expect(ref.evidenceIds.length).toBeGreaterThan(0);
    expect(ref.evidenceIds.every(id => metric?.evidence?.some(evidence => evidence.id === id))).toBe(true);
  }
}

describe('counterfactual useful questions', () => {
  it('bounds counterfactual search to one promotion per objective instead of factorial enumeration', async () => {
    const module = await import('../../src/intelligence/questions.js') as typeof import('../../src/intelligence/questions.js') & { priorityOrders: (keys: MetricKey[]) => MetricKey[][] };
    const keys: MetricKey[] = ['totalCostToman', 'durationSeconds', 'walkingSeconds', 'transfers', 'quality', 'arrivalEpochSeconds'];
    const orders = module.priorityOrders(keys);
    expect(orders).toHaveLength(6);
    expect(orders.map(order => order[0])).toEqual(keys);
    for (const order of orders) expect([...order].sort()).toEqual([...keys].sort());
    expect(keys[0]).toBe('totalCostToman');
  });
  it('asks once for a real trade-off and answers include priority permutations, actual choice sets, and citations', async () => {
    const candidates = tradeoff();
    const question = await suggest(candidates);
    expect(question).toBeDefined();
    if (!question) throw new Error('expected an effective question');
    expect(question.answers).toHaveLength(2);
    expect(new Set(question.answers.map(answer => answer.id)).size).toBe(2);
    const { preferredCandidates } = await import('../../src/intelligence/compare.js');
    for (const answer of question.answers) {
      expect([...answer.objectiveOrder].sort()).toEqual(objectives.map(objective => objective.metric).sort());
      expect([...answer.selectedIds].sort()).toEqual(preferredCandidates(candidates, objectives, answer.objectiveOrder, at).map(candidate => candidate.id).sort());
    }
    expect(question.answers.map(answer => [...answer.selectedIds].sort()).sort()).toEqual([['fixture:cheap'], ['fixture:fast']]);
    expect(`${question.prompt} ${question.answers.map(answer => answer.label).join(' ')}`).not.toMatch(/[0-9۰-۹]|صرفه|دقیقه|تومان/);
    verifyRefs(question, candidates);
  });

  it('does not ask when priorities cannot change the selected set', async () => {
    expect(await suggest([option('fixture:best', 50, 10), option('fixture:worse', 100, 20)])).toBeUndefined();
  });

  it('does not mistake the output order of tied candidates for different choice sets', async () => {
    const candidates = [option('fixture:z', 60, 20), option('fixture:a', 60, 20)];
    expect(await suggest(candidates)).toBeUndefined();
    expect(await suggest([...candidates].reverse(), [...objectives].reverse())).toBeUndefined();
  });

  it('does not ask without at least two candidates and two distinct objectives', async () => {
    expect(await suggest([])).toBeUndefined();
    expect(await suggest(tradeoff().slice(0, 1))).toBeUndefined();
    expect(await suggest(tradeoff(), [])).toBeUndefined();
    expect(await suggest(tradeoff(), objectives.slice(0, 1))).toBeUndefined();
    expect(await suggest(tradeoff(), [objectives[0], objectives[0]])).toBeUndefined();
  });

  it('respects an already active resolved explicit priority', async () => {
    const preference: ResolvedPreference = { order: ['totalCostToman', 'durationSeconds'], selectedIds: ['fixture:explicit-preference'], ignored: [], conflicts: [] };
    expect(await suggest(tradeoff(), objectives, preference)).toBeUndefined();
    expect(await suggest(tradeoff(), objectives, { selectedIds: [], ignored: [], conflicts: [] })).toBeDefined();
  });

  it('does not compare across task, domain, or equivalence groups', async () => {
    for (const changed of [{ taskId: 'fixture:other-task' }, { domain: 'food' as const }, { equivalenceKey: 'fixture:different' }]) {
      const candidates = tradeoff();
      Object.assign(candidates[1], changed);
      expect(await suggest(candidates)).toBeUndefined();
    }
  });

  it('does not ask from unknown, stale, missing, inapplicable, or expired objective metrics', async () => {
    const badMetrics: Array<NumericMetric | undefined> = [
      undefined,
      { state: 'unknown', unit: 'toman', reason: 'synthetic absent cost' },
      { state: 'stale', unit: 'toman', reason: 'synthetic stale cost' },
      { state: 'not_applicable', unit: 'toman', reason: 'synthetic inapplicable cost' },
      { ...known(20, 'toman'), evidence: [{ id: 'fixture:expired', sourceId: 'fixture:synthetic', kind: 'fixture', dataVersion: 'test-v1', live: false, validUntil: at }] },
      { ...known(20, 'toman'), evidence: [] },
    ];
    for (const metric of badMetrics) {
      const candidates = tradeoff();
      if (metric) candidates[0].metrics.totalCostToman = metric;
      else delete candidates[0].metrics.totalCostToman;
      expect(await suggest(candidates)).toBeUndefined();
    }
  });

  it('abstains if even one supplied candidate has an incompatible objective unit', async () => {
    const candidates = [...tradeoff(), option('fixture:incomplete', 90, 30)];
    candidates[2].metrics.totalCostToman = known(30, 'seconds');
    expect(await suggest(candidates)).toBeUndefined();
  });

  it('rejects unavailable or unknown availability rather than asking about ineligible options', async () => {
    for (const availability of ['unavailable', 'unknown'] as const) {
      const candidates = tradeoff();
      candidates[0].availability = availability;
      expect(await suggest(candidates)).toBeUndefined();
    }
  });

  it('uses the supplied clock for metric validity and never asks with an invalid clock', async () => {
    expect(await suggest(tradeoff(), objectives, undefined, '2026-11-02T11:00:00Z')).toBeUndefined();
    expect(await suggest(tradeoff(), objectives, undefined, 'not-a-clock')).toBeUndefined();
  });

  it('only mentions objectives that exist and never invents a time/cost compensation question', async () => {
    const goals: Objective[] = [{ metric: 'quality', direction: 'max' }, { metric: 'transfers', direction: 'min' }];
    const candidates = tradeoff().map((c, i): Candidate => ({ ...c, metrics: { quality: known(i ? 70 : 90, 'score_0_100'), transfers: known(i ? 0 : 1, 'count') } }));
    const question = await suggest(candidates, goals);
    expect(question).toBeDefined();
    if (!question) throw new Error('expected quality/transfer trade-off');
    expect(question.prompt + question.answers.map(answer => answer.label).join(' ')).not.toMatch(/هزینه|زمان|دقیقه|تومان|صرفه|[0-9۰-۹]/);
    expect(question.refs.every(ref => ref.metric === 'quality' || ref.metric === 'transfers')).toBe(true);
    verifyRefs(question, candidates);
  });

  it('returns full permutations when a third objective participates and does not mutate inputs', async () => {
    const goals: Objective[] = [...objectives, { metric: 'walkingSeconds', direction: 'min' }];
    const candidates = tradeoff();
    candidates[0].metrics.walkingSeconds = known(5, 'seconds');
    candidates[1].metrics.walkingSeconds = known(10, 'seconds');
    const before = JSON.stringify({ candidates, goals });
    const question = await suggest(candidates, goals);
    expect(question).toBeDefined();
    for (const answer of question?.answers ?? []) expect([...answer.objectiveOrder].sort()).toEqual(goals.map(goal => goal.metric).sort());
    expect(JSON.stringify({ candidates, goals })).toBe(before);
  });

  it('does not use unsupported numeric bounds to turn uncertainty into a question', async () => {
    const candidates = tradeoff();
    candidates[0].metrics.totalCostToman = { state: 'estimated', unit: 'toman', interval: { min: 10, max: 50 }, evidence: [{ id: 'fixture:range', sourceId: 'fixture:synthetic', kind: 'fixture', dataVersion: 'test-v1', live: false }], assumptions: ['synthetic range'] };
    candidates[1].metrics.totalCostToman = { ...candidates[0].metrics.totalCostToman };
    expect(await suggest(candidates)).toBeUndefined();
  });
});
