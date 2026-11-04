#!/usr/bin/env node
// Isolated loopback server for baseline-vs-candidate HTTP parity. Never Production, never a feedback store, never a switch file.
// Usage: node parity-server.mjs --root=/abs/export --port=18911
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const v = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--(root|port)=(.+)$/.exec(a); if (!m) throw Error('Use --root=<abs> --port=<n>'); return [m[1], m[2]]; }));
const root = resolve(v.root ?? ''), port = Number(v.port);
if (!Number.isInteger(port) || port < 18900 || port > 18999) throw Error('parity port must be 18900-18999');
if (root === '/srv/besrah' || root.startsWith('/srv/besrah/')) throw Error('Production is not a parity runtime');
const { buildServer } = await import(pathToFileURL(resolve(root, 'packages/core/dist/server.js')).href);
// The fixed-window limiter is not under test here; a stepping clock keeps it from turning real responses into 429s.
let tick = 0;
// A fixed server clock makes default-time requests and `asOf`/`validUntil` deterministic across the three servers.
const FIXED_NOW = Date.parse('2026-11-04T00:10:00+03:30');
const app = buildServer({ now: () => FIXED_NOW, limiterClock: () => (tick += 120_000), journeyBeta: { enabled: true, switchFile: null, rolloutPercent: 0, calendarMode: 'weekday_baseline', feedbackDir: null, allowedOrigins: [`http://127.0.0.1:${port}`] } });
await app.listen({ host: '127.0.0.1', port });
console.log(JSON.stringify({ parity: `http://127.0.0.1:${port}`, root, feedbackEnabled: false }));
let closing = false;
const close = async () => { if (closing) return; closing = true; try { await app.close(); } finally { process.exit(0); } };
process.once('SIGTERM', close); process.once('SIGINT', close);
