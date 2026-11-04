#!/usr/bin/env node
// Local compiled-code benchmark. Never contacts a deployed service or food provider.
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { Agent, request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { performance, monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import { setImmediate as yieldTurn, setTimeout as sleep } from 'node:timers/promises';

const usage = 'Usage: node [--expose-gc] scripts/benchmark-transit-journey.mjs [--iterations 1..100] [--concurrency 1..4]';
const compiled = new URL('../packages/core/dist/', import.meta.url);
const networkPath = new URL('../data/network.json', import.meta.url);
const fixedDate = '2026-10-16'; // Friday, active modeled service; not the host clock.
const fixedAt = `${fixedDate}T14:00:00+03:30`;
const phaseMemory = [];
let sampledMaxRssBytes = 0;
let interrupted = false;

function options(argv) {
  const result = { iterations: 10, concurrency: 4 };
  if (argv.length === 1 && argv[0] === '--help') return null;
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (!['--iterations', '--concurrency'].includes(flag) || seen.has(flag) || !/^[1-9]\d*$/.test(value ?? '')) throw Error(usage);
    const key = flag.slice(2), number = Number(value), max = key === 'iterations' ? 100 : 4;
    if (!Number.isSafeInteger(number) || number > max) throw Error(usage);
    result[key] = number;
    seen.add(flag);
  }
  return result;
}

function summary(values) {
  if (!values.length) return { count: 0, min: null, median: null, p95: null, max: null, mean: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { count: values.length, min: sorted[0], median: at(0.5), p95: at(0.95), max: sorted.at(-1), mean: sorted.reduce((a, b) => a + b, 0) / sorted.length };
}

function memory(label) {
  const m = process.memoryUsage();
  sampledMaxRssBytes = Math.max(sampledMaxRssBytes, m.rss);
  const result = { label, atMs: performance.now(), ...m };
  phaseMemory.push(result);
  return result;
}

function checkInterrupted() {
  if (interrupted) throw Error('Benchmark interrupted; isolated server cleanup requested');
}

async function pool(count, concurrency, work) {
  let next = 0;
  const workers = Array.from({ length: Math.min(count, concurrency) }, async () => {
    while (next < count) {
      checkInterrupted();
      const index = next++;
      await work(index);
    }
  });
  const settled = await Promise.allSettled(workers);
  const failed = settled.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
}

function planSamples() {
  return { wall: [], source: [], extraction: [], decision: [], total: [], candidates: [], statuses: {} };
}

function recordPlan(samples, result, elapsed) {
  assert(result.journeys.length > 0, 'Active fixed-date planner request produced no modeled journeys');
  const timings = result.diagnostics.timingsMs;
  for (const key of ['source', 'extraction', 'decision', 'total']) {
    assert(Number.isFinite(timings[key]) && timings[key] >= 0, `Invalid diagnostic ${key}`);
    samples[key].push(timings[key]);
  }
  samples.wall.push(elapsed);
  samples.candidates.push(result.candidates.length);
  samples.statuses[result.status] = (samples.statuses[result.status] ?? 0) + 1;
  memory('plan-completed');
}

function summarizePlans(samples) {
  return {
    wallMs: summary(samples.wall),
    diagnosticsMs: Object.fromEntries(['source', 'extraction', 'decision', 'total'].map(key => [key, summary(samples[key])])),
    candidateCount: summary(samples.candidates), statuses: samples.statuses,
  };
}

function getJson(agent, port, path) {
  return new Promise((resolve, reject) => {
    const begin = performance.now();
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', agent }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 1024 * 1024) req.destroy(Error('Unexpectedly large local API response'));
      });
      response.once('error', reject);
      response.once('end', () => {
        try {
          assert.equal(response.statusCode, 200, `Local API status for ${path}`);
          resolve({ elapsedMs: performance.now() - begin, body: JSON.parse(body) });
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(10_000, () => req.destroy(Error('Local API timeout')));
    req.once('error', reject);
    req.end();
  });
}

async function main(config) {
  await access(new URL('transit-journey/index.js', compiled)).catch(() => {
    throw Error('Compiled transit index is missing. Parent build command: npm --prefix packages/core run build; then ' + usage);
  });
  const gc = { count: 0, durationMs: 0, maxDurationMs: 0, byKind: {}, forcedCollections: 0, exposed: typeof global.gc === 'function' };
  const collectGc = entries => {
    for (const entry of entries) {
      const kind = String(entry.detail?.kind ?? 'unknown');
      gc.count++;
      gc.durationMs += entry.duration;
      gc.maxDurationMs = Math.max(gc.maxDurationMs, entry.duration);
      const group = gc.byKind[kind] ??= { count: 0, durationMs: 0 };
      group.count++;
      group.durationMs += entry.duration;
    }
  };
  const observer = new PerformanceObserver(list => collectGc(list.getEntries()));
  observer.observe({ entryTypes: ['gc'] });
  const memoryTimer = setInterval(() => {
    sampledMaxRssBytes = Math.max(sampledMaxRssBytes, process.memoryUsage().rss);
  }, 10);
  memoryTimer.unref();
  const onSignal = () => { interrupted = true; };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const initialResources = process.resourceUsage();
  const started = performance.now();
  memory('before-compiled-import');
  let app;
  let agent;
  let providerCalls = 0;
  try {
    const importBegin = performance.now();
    const { createModelSource, planJourney, normalizeModelDay, JOURNEY_LIMITS } = await import(new URL('transit-journey/index.js', compiled));
    const importMs = performance.now() - importBegin;
    assert.equal(JOURNEY_LIMITS.cacheEntries, 2, 'Benchmark expects the approved two-entry source cache');
    const initialization = [];
    let source;
    for (let i = 0; i < config.iterations; i++) {
      checkInterrupted();
      const begin = performance.now();
      // Only the latest source survives; never build a retained list of sources.
      source = createModelSource(networkPath);
      initialization.push(performance.now() - begin);
      memory('source-initialized');
      await yieldTurn();
    }
    const sourceVersion = source.dataVersion;
    const requestFor = (index, prefix = 'benchmark') => {
      const line = index % 2 === 0 ? 1 : 2;
      const order = source.catalog.orders[line];
      return {
        schemaVersion: 1, requestId: `r2a:${prefix}:${index}`, decisionPermission: 'granted',
        line, originId: order[0], destinationId: order.at(-1), readyAt: fixedAt,
        calendar: { mode: 'strict' }, searchSeconds: 7200, maxCandidates: 32,
      };
    };

    // Separate raw generation from normalization: use real compiled model output,
    // not synthetic records. Load the models once and retain exactly two raw days.
    const { loadNetwork, forDay } = await import(new URL('network.js', compiled));
    const { dayTrains } = await import(new URL('engine.js', compiled));
    const { loadLine2, line2DayTrains } = await import(new URL('line2.js', compiled));
    const { tehranToEpoch } = await import(new URL('time.js', compiled));
    const net = loadNetwork(networkPath), net2 = loadLine2(networkPath);
    const midnight = tehranToEpoch(fixedDate, '00:00:00');
    let rawDays = [1, 2].map(line => ({
      line, serviceDate: fixedDate, dayType: 'friday', dataVersion: sourceVersion,
      trains: line === 1 ? dayTrains(forDay(net, 'friday'), midnight, 'friday') : line2DayTrains(net2, midnight, 'friday'),
      runQuality: line === 1 ? net.runQuality : net2.runQuality,
    }));
    const normalization = [];
    for (const raw of rawDays) {
      const times = [];
      let tripCount = 0;
      for (let i = 0; i < config.iterations; i++) {
        checkInterrupted();
        const begin = performance.now();
        const day = normalizeModelDay(raw, source.catalog);
        times.push(performance.now() - begin);
        assert.equal(day.rejectedTrips, 0);
        assert(day.trips.length > 0);
        tripCount = day.trips.length;
        memory('day-normalized');
        await yieldTurn();
      }
      normalization.push({ line: raw.line, trips: tripCount, firstCallMs: times[0], allCallsMs: summary(times), subsequentCallsMs: summary(times.slice(1)) });
    }
    rawDays = null;

    const coldDays = [];
    for (let i = 0; i < config.iterations; i++) {
      source.clear();
      const begin = performance.now();
      const day = await source.getDay(i % 2 + 1, fixedDate, 'friday');
      coldDays.push(performance.now() - begin);
      assert(day.trips.length > 0);
      assert.equal(source.stats().misses, 1);
      memory('cold-day-completed');
    }
    const cold = planSamples();
    for (let i = 0; i < config.iterations; i++) {
      source.clear(); // cold snapshot cache, not cold module/JIT/OS caches.
      const begin = performance.now();
      const result = await planJourney(requestFor(i, 'cold'), source);
      recordPlan(cold, result, performance.now() - begin);
      assert(source.stats().misses > 0);
    }
    source.clear();
    await source.getDay(1, fixedDate, 'friday');
    await source.getDay(2, fixedDate, 'friday');
    const warm = planSamples();
    const beforeWarm = source.stats();
    for (let i = 0; i < config.iterations; i++) {
      const begin = performance.now();
      const result = await planJourney(requestFor(i, 'warm'), source);
      recordPlan(warm, result, performance.now() - begin);
    }
    const afterWarm = source.stats();
    assert.equal(afterWarm.misses, beforeWarm.misses, 'Warm plans unexpectedly missed the cache');

    const concurrent = planSamples();
    const concurrentBegin = performance.now();
    await pool(config.iterations, config.concurrency, async i => {
      const begin = performance.now();
      const result = await planJourney(requestFor(i, 'concurrent'), source);
      recordPlan(concurrent, result, performance.now() - begin);
    });
    const concurrentMs = performance.now() - concurrentBegin;

    // Exercise four distinct bounded keys twice, including repeat-after-eviction.
    // Even --iterations=1 performs the fixed eight-step cache correctness probe.
    source.clear();
    const churnKeys = [[1, fixedDate, 'friday'], [2, fixedDate, 'friday'], [1, '2026-10-22', 'thursday'], [2, '2026-10-19', 'normal']];
    const churn = [];
    for (let i = 0; i < 8; i++) {
      const key = churnKeys[i % churnKeys.length];
      const begin = performance.now();
      await source.getDay(...key);
      const stats = source.stats();
      assert(stats.entries <= 2);
      assert.equal(stats.maxEntries, 2);
      churn.push({ key, elapsedMs: performance.now() - begin, ...stats });
      memory('cache-churn');
    }
    assert.equal(source.stats().evictions, 6);
    source.clear();
    await source.getDay(1, fixedDate, 'friday');
    await source.getDay(2, fixedDate, 'friday');

    // The repository exports buildServer (not createServer). Use that actual
    // factory unchanged, with a fail-closed injected food fetch and an ephemeral
    // IPv4 loopback socket. Only existing health/metro routes are requested.
    const serverModule = await import(new URL('server.js', compiled));
    assert.equal(typeof serverModule.buildServer, 'function', 'Expected existing buildServer export');
    const serverBegin = performance.now();
    app = serverModule.buildServer({
      now: () => Date.parse(fixedAt),
      foodStatusFetch: async () => { providerCalls++; throw Error('Food provider calls are forbidden in this benchmark'); },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    assert(address && typeof address !== 'string' && address.address === '127.0.0.1');
    const port = address.port;
    const serverInitializationMs = performance.now() - serverBegin;
    memory('isolated-server-ready-including-optional-food-catalogue');
    agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const apiPath = '/app/api/trains?' + new URLSearchParams({ line: '1', at: fixedAt });
    assert.equal((await getJson(agent, port, '/health')).body.ok, true);
    const apiWarmup = await getJson(agent, port, apiPath);
    assert(apiWarmup.body.trains.length > 0, 'Metro API fixed date must contain active modeled trains');

    async function apiPhase(withPlanner, clearBeforeEachPlan = false) {
      const delay = monitorEventLoopDelay({ resolution: 5 });
      delay.enable();
      await sleep(15); // prime the histogram outside the workload window.
      delay.reset();
      const heartbeat = [];
      const heartbeatIntervalMs = 5;
      let nextHeartbeat = performance.now() + heartbeatIntervalMs;
      const timer = setInterval(() => {
        const now = performance.now();
        heartbeat.push(Math.max(0, now - nextHeartbeat));
        nextHeartbeat = now + heartbeatIntervalMs;
      }, heartbeatIntervalMs);
      const apiTimes = [];
      const plannerSamples = planSamples();
      let plannerActive = 0, overlapRequests = 0;
      const begin = performance.now();
      try {
        // Start both promise-producing functions before awaiting either. There is
        // no worker-thread parallelism: this measures competition on one loop.
        const apiWork = (async () => {
          for (let i = 0; i < config.iterations; i++) {
            checkInterrupted();
            const response = await getJson(agent, port, apiPath);
            if (plannerActive > 0) overlapRequests++;
            assert(response.body.trains.length > 0);
            apiTimes.push(response.elapsedMs);
          }
        })();
        const plannerWork = withPlanner ? pool(config.iterations, config.concurrency, async i => {
          plannerActive++;
          if (clearBeforeEachPlan) source.clear();
          const planBegin = performance.now();
          try {
            const result = await planJourney(requestFor(i, 'api-contention'), source);
            recordPlan(plannerSamples, result, performance.now() - planBegin);
          } finally { plannerActive--; }
        }) : Promise.resolve();
        const settled = await Promise.allSettled([apiWork, plannerWork]);
        const failure = settled.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
        const elapsedMs = performance.now() - begin;
        return {
          elapsedMs, apiRequests: apiTimes.length, apiLatencyMs: summary(apiTimes),
          cachePolicy: clearBeforeEachPlan ? 'shared cache cleared before each submitted plan; concurrent duplicate keys may still hit' : 'retained shared cache',
          apiRequestsCompletedWhilePlannerActive: overlapRequests,
          apiRequestsPerSecondOverPhase: apiTimes.length * 1000 / elapsedMs,
          planner: { ...summarizePlans(plannerSamples), completed: plannerSamples.wall.length },
          heartbeat: { intervalMs: heartbeatIntervalMs, latenessMs: summary(heartbeat) },
          eventLoopDelayMs: delay.count ? { count: delay.count, min: delay.min / 1e6, mean: delay.mean / 1e6, p95: delay.percentile(95) / 1e6, max: delay.max / 1e6 } : { count: 0, min: null, mean: null, p95: null, max: null },
        };
      } finally {
        clearInterval(timer);
        delay.disable();
      }
    }
    const baseline = await apiPhase(false);
    const withConcurrentPlanner = await apiPhase(true);
    const withCachePressure = await apiPhase(true, true);
    assert.equal(providerCalls, 0);
    const cacheAtEnd = source.stats();
    await app.close();
    assert.equal(app.server.listening, false, 'Isolated server socket remained open after close');
    app = undefined;
    agent.destroy();
    agent = undefined;
    memory('server-closed');
    if (gc.exposed) {
      global.gc();
      gc.forcedCollections++;
      await yieldTurn();
      memory('after-explicit-gc-outside-timed-workloads');
    }
    await yieldTurn();
    collectGc(observer.takeRecords());
    const endResources = process.resourceUsage();
    const resourceDelta = Object.fromEntries(Object.entries(endResources).filter(([key]) => key !== 'maxRSS').map(([key, value]) => [key, value - initialResources[key]]));
    return {
      schemaVersion: 1, benchmark: 'compiled-transit-journey', modelOnly: true,
      runtime: { node: process.version, platform: process.platform, arch: process.arch, pid: process.pid, execArgv: process.execArgv },
      config: { ...config, fixedDate, fixedAt, cacheEntries: 2, retainedSourceInstances: 1, apiConcurrency: 1, plannerConcurrency: Math.min(config.iterations, config.concurrency), compiledIndex: fileURLToPath(new URL('transit-journey/index.js', compiled)) },
      sourceVersion, elapsedMs: performance.now() - started,
      compiledImportMs: importMs,
      coldSourceInitialization: { firstCallMs: initialization[0], allCallsMs: summary(initialization), subsequentCallsMs: summary(initialization.slice(1)) },
      normalization,
      coldDayGenerationAndNormalizationMs: summary(coldDays),
      coldPlan: summarizePlans(cold), warmPlan: { ...summarizePlans(warm), cacheBefore: beforeWarm, cacheAfter: afterWarm },
      concurrentPlanner: { ...summarizePlans(concurrent), elapsedMs: concurrentMs, completed: concurrent.wall.length, plansPerSecond: concurrent.wall.length * 1000 / concurrentMs },
      cacheChurn: { fixedSteps: churn.length, bounded: true, snapshots: churn }, cacheAtEnd,
      isolatedApi: { serverFactory: 'buildServer', host: '127.0.0.1', port, route: apiPath, serverInitializationMs, apiWarmupMs: apiWarmup.elapsedMs, baseline, withConcurrentPlanner, withCachePressure, serverClosed: true, foodProviderCalls: providerCalls },
      memory: { unit: 'bytes', sampledMaxRssBytes, maxRssBytes: process.platform === 'linux' ? endResources.maxRSS * 1024 : null, maxRssReported: endResources.maxRSS, maxRssReportedUnit: process.platform === 'linux' ? 'KiB' : 'platform-dependent; see process.resourceUsage', snapshots: phaseMemory },
      resourceUsage: { initial: initialResources, final: endResources, delta: resourceDelta, cpuTimeUnit: 'microseconds', maxRssIsLifetimeHighWater: true },
      gc,
      caveats: [
        'Measurements are local process samples, not an SLO, allocation bound, load-capacity guarantee, or proof of compliance with a 192 MiB cgroup limit. This script does not alter/enforce resource limits or restart production.',
        'Cold source initialization reads and fingerprints local runtime bytes; only the first constructor/import is first-use in this process. OS filesystem caches, compiled-module caches, JIT and GC are not reset.',
        'Cold plans clear the retained source snapshot cache, excluding source construction/import. Warm plans retain both line snapshots. Internal source/extraction timings include asynchronous yields and contention, not just CPU time.',
        'Standalone normalization excludes fixture generation and model loading; it uses real raw compiled-engine days. firstCallMs is first measured call per line, not a fresh-process or guaranteed JIT-cold measurement.',
        'Each configurable phase uses 1..100 iterations; the separate fixed cache correctness probe uses eight sequential reads across four keys. Only one source is retained; discarded constructor results are left to normal GC.',
        'Concurrency is bounded asynchronous planner work on one Node event loop, not CPU-parallel workers. The API client shares that loop, so end-to-end latency includes client/server scheduling and loopback HTTP overhead.',
        'The same unchanged ephemeral loopback server is warmed before sequential baseline/contention phases. Its construction includes existing model/catalogue reads; only health and fixed-date active Metro routes are requested. No production URLs or food HTTP calls are used.',
        'Small runs may have no heartbeat/delay samples or no HTTP completions during active planner work; null statistics and the overlap count disclose this rather than imply isolation or responsiveness.',
        'No forced GC occurs within timed workloads. If --expose-gc is supplied, one explicit collection is recorded after them; GC observations exclude events before observer registration and may be delivered asynchronously.',
        'RSS/heap snapshots and 10 ms sampling can miss short peaks; Linux resourceUsage.maxRSS is a process-lifetime kernel high-water mark, including imports/server/benchmark overhead. Heap deltas are not per-operation allocations.',
        'Fingerprints use the executed compiled runtime bytes and network data, so compiled and TypeScript-source fingerprints intentionally differ. Fixed-date timetable results are modeled service, not live observations or a claim about current service.',
      ],
    };
  } finally {
    clearInterval(memoryTimer);
    observer.disconnect();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    // Close even after assertions, request timeouts, or interrupted work.
    try { if (app) await app.close(); } finally { agent?.destroy(); }
  }
}

try {
  const config = options(process.argv.slice(2));
  if (!config) console.log(usage);
  else console.log(JSON.stringify(await main(config), null, 2));
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
}
