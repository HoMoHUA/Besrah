import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from './api.js';

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const board = { station: 'شریعتی', line: 1, as_of: '20:27:13', day_type: 'thursday', passes: [], notes: [] };

test('food status sends only a vendor identifier and validates the observation', async () => {
  const api = createApi({ fetch: async url => { assert.equal(url, 'api/food-status?vendor=217xr2'); return json({ status: 'open', observedAt: '2026-01-01T00:00:00.000Z' }); } });
  assert.equal((await api.foodStatus('217xr2')).status, 'open');
  await assert.rejects(createApi({ fetch: async () => json({ status: 'open' }) }).foodStatus('217xr2'), e => e.kind === 'server');
});

test('next() uses a relative, encoded URL and sends no credentials or caching', async () => {
  const seen = [];
  const api = createApi({ fetch: async (url, init) => { seen.push([url, init]); return json(board); } });
  assert.deepEqual(await api.next('وکیل‌آباد', { limit: 10 }), board);
  const [url, init] = seen[0];
  assert.equal(url, 'api/next?station=' + encodeURIComponent('وکیل‌آباد') + '&limit=10');
  assert.equal(url.includes('at='), false);
  assert.equal(init.credentials, 'omit');
  assert.equal(init.cache, 'no-store');
});

test('next() sends the optional line and rejects nothing else new', async () => {
  const seen = [];
  const api = createApi({ fetch: async url => { seen.push(url); return json(board); } });
  await api.next('شریعتی', { limit: 4, line: 2 });
  assert.equal(seen[0], 'api/next?station=' + encodeURIComponent('شریعتی') + '&limit=4&line=2');
  await api.next('شریعتی');
  assert.equal(seen[1].includes('line='), false);
});

test('stations() keeps line2Order and tolerates an older server without it', async () => {
  const body = { stations: [], line1Order: ['الف'], line2Order: ['ب'], supportedLines: [1, 2], maxNearestKm: 10 };
  assert.deepEqual((await createApi({ fetch: async () => json(body) }).stations()).line2Order, ['ب']);
  const { line2Order, ...old } = body;
  assert.equal((await createApi({ fetch: async () => json(old) }).stations()).line2Order, undefined);
});

test('unknown station and server errors are classified', async () => {
  const unknown = createApi({ fetch: async () => json({ error: 'unknown_station' }, 404) });
  await assert.rejects(unknown.next('x'), e => e instanceof ApiError && e.kind === 'unknown_station');
  const down = createApi({ fetch: async () => json({}, 503) });
  await assert.rejects(down.next('x'), e => e.kind === 'server');
});

test('network failure and malformed bodies are classified, not leaked', async () => {
  const offline = createApi({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.next('x'), e => e.kind === 'network');
  const odd = createApi({ fetch: async () => json({ hello: 'world' }) });
  await assert.rejects(odd.next('x'), e => e.kind === 'server');
});

test('caller abort stays an abort; the timeout becomes a timeout error', async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const timers = { handles: [], setTimeout(fn) { this.handles.push(fn); return this.handles.length; }, clearTimeout() {} };
  const api = createApi({ fetch: hang, timeoutMs: 15000, timers });
  const p = api.next('x'); p.catch(() => {});
  timers.handles[0]();
  await assert.rejects(p, e => e.kind === 'timeout');
  const user = new AbortController();
  const q = api.next('x', { signal: user.signal }); q.catch(() => {});
  user.abort();
  await assert.rejects(q, e => e.kind === 'aborted');
});

test('stations() validates the contract', async () => {
  const body = { stations: [{ id: 'A', name: 'شریعتی', lat: 1, lon: 2, lines: [1] }], line1Order: ['شریعتی'], supportedLines: [1], maxNearestKm: 10 };
  assert.deepEqual(await createApi({ fetch: async url => { assert.equal(url, 'api/stations'); return json(body); } }).stations(), body);
  await assert.rejects(createApi({ fetch: async () => json({ stations: 'nope' }) }).stations(), e => e.kind === 'server');
});
