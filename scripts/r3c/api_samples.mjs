#!/usr/bin/env node
// R3-C: before/after API samples with ONE fixed server clock. "before" = clean build of the deployed commit (587accb),
// "after" = this candidate. In-process servers on inject(); nothing listens, nothing reads Production.
// Usage: node api_samples.mjs --base=/abs/export-587accb --cand=/abs/candidate --out=/abs/file.json
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const arg = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--(base|cand|out)=(.+)$/.exec(a); if (!m) throw Error('bad arg'); return [m[1], m[2]]; }));
const load = async root => (await import(pathToFileURL(resolve(root, 'packages/core/dist/server.js')).href)).buildServer;
const tehran = (d, hms) => Date.parse(`${d}T${hms}+03:30`);
const WHEN = [
  ['tuesday-noon-extrapolated', tehran('2026-11-10', '12:00:00'), 'normal'],
  ['tuesday-19-40-timed-window', tehran('2026-11-10', '19:40:00'), 'normal'],
  ['tuesday-20-15-board-only', tehran('2026-11-10', '20:15:00'), 'normal'],
  ['thursday-noon-out-of-scope', tehran('2026-11-05', '12:00:00'), 'thursday'],
  ['friday-noon-out-of-scope', tehran('2026-11-06', '12:00:00'), 'friday'],
];
const H7 = encodeURIComponent('هفت‌تیر');
const out = { note: 'Same fixed clock for both builds. before=587accb build, after=R3-C candidate. Times are model estimates, not live positions.', samples: [] };
const side = async (root, now, beta) => {
  const build = await load(root);
  let tick = 0;
  const app = build({ now: () => now, limiterClock: () => (tick += 120_000), journeyBeta: beta ? { enabled: true, switchFile: null, rolloutPercent: 0, calendarMode: 'weekday_baseline', feedbackDir: null, allowedOrigins: [] } : undefined });
  const get = async url => { const r = await app.inject({ method: 'GET', url }); let body; try { body = r.json(); } catch { body = r.body.slice(0, 200); } return { status: r.statusCode, body }; };
  const res = {
    next: await get(`/app/api/next?station=${H7}&limit=4&line=1`),
    trains: await get('/app/api/trains?line=1'),
    journey: beta ? await get('/app/api/journey?' + new URLSearchParams({ line: '1', from: 'METRO-107', to: 'METRO-108', date: new Date(now + 12600000).toISOString().slice(0, 10), time: '10:00' })) : null,
  };
  await app.close();
  return res;
};
for (const [label, now, type] of WHEN) {
  out.samples.push({ label, dayType: type, serverNowTehran: new Date(now).toISOString(), before: await side(arg.base, now, false), after: await side(arg.cand, now, true) });
}
writeFileSync(arg.out, JSON.stringify(out, null, 1) + '\n');
console.log(out.samples.map(s => `${s.label}: before next=${s.before.next.status} after next=${s.after.next.status}`).join('\n'));
