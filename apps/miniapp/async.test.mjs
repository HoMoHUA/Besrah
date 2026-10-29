import test from 'node:test';
import assert from 'node:assert/strict';
import { createSequencer, debounce, linkedTimeout } from './async.js';

const fakeTimers = () => {
  let now = 0, id = 0; const jobs = new Map();
  return {
    setTimeout: (fn, ms) => { jobs.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout: handle => jobs.delete(handle),
    tick(ms) { now += ms; for (const [k, j] of [...jobs]) if (j.at <= now) { jobs.delete(k); j.fn(); } },
    get pending() { return jobs.size; },
  };
};
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('a newer request aborts the older one and the older response is stale', async () => {
  const seq = createSequencer();
  const first = deferred(), second = deferred();
  let firstSignal;
  const a = seq.run(signal => { firstSignal = signal; return first.promise; });
  const b = seq.run(() => second.promise);
  assert.equal(firstSignal.aborted, true);
  second.resolve('new'); first.resolve('old');
  assert.deepEqual(await b, { ok: true, value: 'new' });
  assert.deepEqual(await a, { stale: true });
});

test('an aborted older request that rejects is also stale, never an error', async () => {
  const seq = createSequencer();
  const a = seq.run(signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))));
  const b = seq.run(async () => 7);
  assert.deepEqual(await a, { stale: true });
  assert.deepEqual(await b, { ok: true, value: 7 });
});

test('the current request reports its own failure', async () => {
  const seq = createSequencer();
  const result = await seq.run(async () => { throw new Error('boom'); });
  assert.equal(result.ok, false);
  assert.equal(result.error.message, 'boom');
});

test('cancel makes the in-flight response stale', async () => {
  const seq = createSequencer();
  const d = deferred();
  const run = seq.run(() => d.promise);
  seq.cancel();
  d.resolve(1);
  assert.deepEqual(await run, { stale: true });
});

test('debounce waits for quiet, uses the last arguments, can cancel and flush', () => {
  const timers = fakeTimers(); const calls = [];
  const fn = debounce((...a) => calls.push(a), 250, timers);
  fn('a'); timers.tick(100); fn('ab'); timers.tick(249);
  assert.deepEqual(calls, []);
  timers.tick(1);
  assert.deepEqual(calls, [['ab']]);
  fn('x'); fn.cancel(); timers.tick(1000);
  assert.equal(calls.length, 1);
  fn('y'); fn.flush();
  assert.deepEqual(calls.at(-1), ['y']);
  assert.equal(timers.pending, 0);
});

test('linkedTimeout aborts after the limit, follows the parent and cleans up', () => {
  const timers = fakeTimers();
  const parent = new AbortController();
  const t = linkedTimeout(parent.signal, 15000, timers);
  timers.tick(14999); assert.equal(t.signal.aborted, false);
  timers.tick(1); assert.equal(t.signal.aborted, true); assert.equal(t.timedOut(), true);

  const p2 = new AbortController(); const t2 = linkedTimeout(p2.signal, 15000, timers);
  p2.abort(); assert.equal(t2.signal.aborted, true); assert.equal(t2.timedOut(), false); assert.equal(timers.pending, 0);

  const t3 = linkedTimeout(undefined, 15000, timers); t3.dispose(); assert.equal(timers.pending, 0);
});
