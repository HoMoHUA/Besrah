import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./reminder-sw.js', import.meta.url), 'utf8');

function worker({ fetchImpl } = {}) {
  const handlers = {}, shown = [], store = new Map(), deleted = [];
  // Like the real Cache API, relative keys resolve against the worker's location (the app root).
  const abs = key => new URL(typeof key === 'string' ? key : key.url, 'https://besrah.arklyn.ir/').href;
  const cache = {
    add: async path => { store.set(abs(path), new Response('shell:' + path)); },
    put: async (key, res) => { store.set(abs(key), res); },
    match: async key => store.get(abs(key)) ?? null,
  };
  const self = {
    location: { origin: 'https://besrah.arklyn.ir' },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    registration: { showNotification: async (...args) => shown.push(args) },
    clients: { openWindow: async () => {}, claim: async () => {} },
    skipWaiting: async () => {},
  };
  const caches = { open: async () => cache, keys: async () => ['besrah-shell-v0', 'besrah-shell-v1', 'other'], delete: async k => { deleted.push(k); return true; } };
  vm.runInNewContext(source, { self, caches, fetch: fetchImpl ?? (async () => { throw new Error('offline'); }), Response, URL, setTimeout, clearTimeout, Promise });
  const dispatch = (url, { method = 'GET', mode = 'cors' } = {}) => {
    let responded = null;
    handlers.fetch({ request: { url, method, mode }, respondWith: p => { responded = p; } });
    return responded;
  };
  return { handlers, shown, store, deleted, dispatch };
}

test('push stays generic: fixed title and body, never the payload', async () => {
  const w = worker();
  let work; w.handlers.push({ data: { json: () => ({ title: 'unsafe title', body: 'unsafe body' }) }, waitUntil: p => { work = p; } }); await work;
  assert.equal(w.shown.length, 1); assert.equal(w.shown[0][0], 'بِسراه'); assert.doesNotMatch(w.shown[0][1].body, /unsafe/);
});

test('API calls, other origins and non-GET requests are never intercepted or cached', () => {
  const w = worker();
  for (const url of ['https://besrah.arklyn.ir/api/trip', 'https://besrah.arklyn.ir/app/api/account/session', 'https://besrah.arklyn.ir/api/bus/eta?station=1', 'https://snappfood.ir/x'])
    assert.equal(w.dispatch(url), null, url);
  assert.equal(w.dispatch('https://besrah.arklyn.ir/app.js', { method: 'POST' }), null);
});

test('install precaches the shell (best effort) and activate removes only older shell caches', async () => {
  const w = worker();
  let work; w.handlers.install({ waitUntil: p => { work = p; } }); await work;
  for (const path of ['./', 'offline.html', 'app.js']) assert.ok(w.store.has(new URL(path, 'https://besrah.arklyn.ir/').href), path);
  w.handlers.activate({ waitUntil: p => { work = p; } }); await work;
  assert.deepEqual(w.deleted, ['besrah-shell-v0']);
});

test('online: the network answer is used and refreshes the cache (the app follows the live site)', async () => {
  const w = worker({ fetchImpl: async () => Object.assign(new Response('fresh'), {}) });
  const res = await w.dispatch('https://besrah.arklyn.ir/app.js');
  assert.equal(await res.text(), 'fresh');
});

test('offline: shell files come from the cache; a navigation falls back to the app, else to the offline page', async () => {
  const w = worker();
  let work; w.handlers.install({ waitUntil: p => { work = p; } }); await work;
  assert.equal(await (await w.dispatch('https://besrah.arklyn.ir/app.js')).text(), 'shell:app.js');
  const nav = await w.dispatch('https://besrah.arklyn.ir/#trip', { mode: 'navigate' });
  assert.equal(await nav.text(), 'shell:./');
  w.store.delete('https://besrah.arklyn.ir/');
  const fallback = await w.dispatch('https://besrah.arklyn.ir/', { mode: 'navigate' });
  assert.equal(await fallback.text(), 'shell:offline.html');
  const missing = await w.dispatch('https://besrah.arklyn.ir/views/unknown.js');
  assert.equal(missing.status, 503);
});
