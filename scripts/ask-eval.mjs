// Measures «از بسراه بپرس» on a Persian question set: rules alone, then rules + the live local model bridge.
// Usage: node scripts/ask-eval.mjs [packages/core/tests/ask/holdout-fa.json] [--no-model]
import { readFileSync } from 'node:fs';
import { createAsk, createBridgeModel, loadAskVocabulary } from '../packages/core/dist/ask/index.js';
const file = process.argv.find(a => a.endsWith('.json')) ?? new URL('../packages/core/tests/ask/holdout-fa.json', import.meta.url).pathname;
const cases = JSON.parse(readFileSync(file, 'utf8'));
const vocab = loadAskVocabulary();
const ok = (c, r) => r.intent === c.intent && Object.entries(c.params).every(([k, v]) => r.params[k] === v);
async function run(label, ask) {
  let right = 0; const t0 = Date.now(); const wrong = [], sources = {};
  for (const c of cases) { const r = await ask(c.q); sources[r.source] = (sources[r.source] ?? 0) + 1; if (ok(c, r)) right++; else wrong.push(`  ${c.q} -> ${r.intent} ${JSON.stringify(r.params)} [${r.source}] (want ${c.intent} ${JSON.stringify(c.params)})`); }
  console.log(`${label}: ${right}/${cases.length} = ${Math.round(100 * right / cases.length)}%  (${((Date.now() - t0) / cases.length / 1000).toFixed(1)} s/question, ${JSON.stringify(sources)})`);
  if (wrong.length) console.log(wrong.join('\n'));
}
await run('rules only', createAsk({ model: null, ...vocab }));
if (!process.argv.includes('--no-model')) await run('rules + model', createAsk({ model: createBridgeModel(), timeoutMs: 15000, maxInFlight: 1, ...vocab }));
