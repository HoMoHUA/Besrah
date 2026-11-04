#!/usr/bin/env node
// Platform-only historical evidence replay; not a composed A-to-B planner.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = process.argv[2];
const approved = 'a04d19d5ffff0ee6563bd7dc1f179af0c386bd16';
if (!engineRoot || process.argv.length !== 3) throw Error('Usage: node scripts/r2bd1/replay.mjs APPROVED_R2A_WORKTREE');
const revision = execFileSync('git', ['-C', engineRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (revision !== approved) throw Error('Replay requires the approved R2a revision');
const { createModelSource, planJourney } = await import(pathToFileURL(resolve(engineRoot, 'packages/core/dist/transit-journey/index.js')).href);
const path = resolve(root, 'data/network.json');
const source = createModelSource(path);
const experiments = [];
for (const [originId, destinationId] of [['METRO-107', 'METRO-108'], ['METRO-108', 'METRO-107']]) {
  const request = { schemaVersion: 1, requestId: `r2bd1:replay:${originId}:${destinationId}`, decisionPermission: 'granted',
    line: 1, originId, destinationId, readyAt: '2026-10-16T14:00:00+03:30', calendar: { mode: 'strict' } };
  const result = await planJourney(request, source);
  // Performance counters vary per execution; they are not travel-time evidence.
  const { timingsMs, ...deterministicDiagnostics } = result.diagnostics;
  experiments.push({ request, result: { ...result, diagnostics: deterministicDiagnostics } });
}
console.log(JSON.stringify({ schemaVersion: 1, modelOnly: true, platformOnly: true, fullAtoB: false,
  notice: 'Historical Friday platform-ready replay of unchanged approved R2a; not a street-start request, physical platform association, live train or field ETA. No new planner.',
  omittedNondeterministicFields: ['/experiments/*/result/diagnostics/timingsMs'],
  engineExecutionTree: engineRoot, engineRevision: revision, networkPath: 'data/network.json',
  networkSha256: createHash('sha256').update(readFileSync(path)).digest('hex'), dataVersion: source.dataVersion, experiments }, null, 2));
