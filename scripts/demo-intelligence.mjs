#!/usr/bin/env node
// Local synthetic experiment only. No public API, provider, account or persistent memory.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { evaluateDecision, LIMITS } from '../packages/core/dist/intelligence/index.js';

const fixture = JSON.parse(readFileSync(new URL('../packages/core/fixtures/intelligence/scenarios.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
let scenarioId, runs;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--scenario' && scenarioId === undefined && args[i + 1]) scenarioId = args[++i];
  else if (args[i] === '--benchmark' && runs === undefined && /^\d+$/.test(args[i + 1] ?? '')) runs = Number(args[++i]);
  else throw Error('Usage: node scripts/demo-intelligence.mjs [--scenario ID] [--benchmark 1..1000]');
}
if (runs !== undefined && (!Number.isSafeInteger(runs) || runs < 1 || runs > 1000)) throw Error('Benchmark iterations must be 1..1000');
if (fixture.synthetic !== true || fixture.fixtureVersion !== 1) throw Error('Only versioned synthetic fixtures are accepted');
const selected = scenarioId === undefined ? fixture.scenarios : fixture.scenarios.filter(s => s.id === scenarioId);
if (!selected.length) throw Error('Unknown synthetic fixture');
const experiments = selected.map(s => ({ id: s.id, synthetic: true, description: s.description, result: evaluateDecision(s.input) }));
const output = { synthetic: true, notice: fixture.notice, experiments };
if (runs !== undefined) {
  const input = structuredClone(fixture.scenarios.find(s => s.id === 'anonymous-question').input);
  input.candidates = Array.from({ length: LIMITS.candidates }, (_, i) => {
    const candidate = structuredClone(input.candidates[0]);
    candidate.id = `fixture:benchmark-${String(i).padStart(3, '0')}`;
    candidate.metrics.totalCostToman.value = i + 1;
    candidate.metrics.durationSeconds.value = LIMITS.candidates - i;
    return candidate;
  });
  for (let i = 0; i < 5; i++) evaluateDecision(input);
  const samples = [], before = process.memoryUsage(); let last;
  for (let i = 0; i < runs; i++) { const start = performance.now(); last = evaluateDecision(input); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  const after = process.memoryUsage();
  output.benchmark = { synthetic: true, iterations: runs, candidateCount: input.candidates.length,
    p50Ms: samples[Math.ceil(samples.length * 0.5) - 1], p95Ms: samples[Math.ceil(samples.length * 0.95) - 1], maxMs: samples.at(-1),
    heapUsedBeforeBytes: before.heapUsed, heapUsedAfterBytes: after.heapUsed, rssAfterBytes: after.rss,
    counters: last.stats, caveat: 'Local process sample, not an SLO or peak-allocation guarantee. V8 GC affects memory; no provider latency is measured.' };
}
console.log(JSON.stringify(output, null, 2));
