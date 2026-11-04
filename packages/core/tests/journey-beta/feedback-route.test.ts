import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { at, betaOn, DA, FRIDAY_14, H7, q, realSource, uuid } from './helpers.js';

const NOW = at('2026-10-16', '14:30:00');
const dirs: string[] = [];
const apps: ReturnType<typeof buildServer>[] = [];
const fresh = () => { const d = join(mkdtempSync(join(tmpdir(), 'r2apb-fb-')), 'feedback'); dirs.push(d); return d; };
const make = (dir: string | null, extra = {}, now = NOW) => {
  const app = buildServer({ now: () => now, journeySource: realSource(), limiterClock: () => 1,
    journeyBeta: betaOn({ feedbackDir: dir, allowedOrigins: ['https://besrah.arklyn.ir'], ...extra }) });
  apps.push(app); return app;
};
const HEADERS = { 'content-type': 'application/json', 'x-besrah-beta': '1', origin: 'https://besrah.arklyn.ir' };
const timing = (n: number, extra: Record<string, unknown> = {}) => ({ v: 1, reportId: uuid(n), kind: 'timing_quality', timingQuality: 'later',
  consent: { storeForModelImprovement: true }, modelVersion: realSource().dataVersion,
  context: { line: 1, originId: H7, destinationId: DA, serviceDate: '2026-10-16' }, ...extra });
const post = (app: ReturnType<typeof make>, body: unknown, headers: Record<string, string> = HEADERS, ip = '7.7.7.7') =>
  app.inject({ method: 'POST', url: '/app/api/journey-feedback', payload: typeof body === 'string' ? body : JSON.stringify(body), headers: { ...headers, 'x-real-ip': ip } });
const lines = (dir: string) => readdirSync(dir).filter(f => f.startsWith('feedback-')).flatMap(f => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close().catch(() => undefined); // Deliberate fault-injection stores reject drain.
  for (const dir of dirs.splice(0)) rmSync(join(dir, '..'), { recursive: true, force: true });
});

describe('POST /app/api/journey-feedback', () => {
  it('stores an anonymous record on the server clock, without network or identity data', async () => {
    const dir = fresh(), app = make(dir);
    const r = await post(app, timing(1));
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: 'stored' });
    const [rec] = lines(dir);
    expect(rec).toMatchObject({ schema: 1, kind: 'timing_quality', class: 'qualitative', identity: 'anonymous_unverified', review: 'unreviewed', modelVersionMatches: true,
      receivedAt: '2026-10-16T11:00:00.000Z', comparison: { tripMatch: 'not_provided', deltaSeconds: null } });
    const text = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8');
    expect(text).not.toMatch(/7\.7\.7\.7|x-real-ip|user-agent|"origin"|besrah\.arklyn/i);
    expect(statSync(join(dir, readdirSync(dir)[0])).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
  it('is idempotent for a repeated reportId', async () => {
    const dir = fresh(), app = make(dir);
    expect((await post(app, timing(2))).statusCode).toBe(201);
    const again = await post(app, timing(2, { timingQuality: 'earlier' }));
    expect(again.statusCode).toBe(200);
    expect(again.json().status).toBe('duplicate');
    expect(lines(dir)).toHaveLength(1);
    expect(lines(dir)[0].timingQuality).toBe('later');
  });
  it('refuses missing header, foreign origin, cross-site fetch and wrong content type', async () => {
    const dir = fresh(), app = make(dir);
    expect((await post(app, timing(3), { 'content-type': 'application/json', origin: 'https://besrah.arklyn.ir' })).statusCode).toBe(403);
    expect((await post(app, timing(3), { ...HEADERS, origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await post(app, timing(3), { ...HEADERS, 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    expect((await post(app, timing(3), { ...HEADERS, 'content-type': 'text/plain' })).statusCode).toBe(415);
    expect((await post(app, timing(3), { 'content-type': 'application/x-www-form-urlencoded', 'x-besrah-beta': '1' })).statusCode).toBe(415);
    expect(existsSync(dir) ? lines(dir) : []).toHaveLength(0);
  });
  it('allows a same-origin request without Origin only with the custom header (non-browser clients)', async () => {
    const app = make(fresh());
    const { origin: _o, ...noOrigin } = HEADERS;
    expect((await post(app, timing(4), noOrigin)).statusCode).toBe(201);
  });
  it('never answers CORS preflight', async () => {
    const r = await make(fresh()).inject({ method: 'OPTIONS', url: '/app/api/journey-feedback', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
  });
  it('rejects malformed, oversized and invalid bodies without echoing them', async () => {
    const dir = fresh(), app = make(dir);
    expect((await post(app, '{"v":1,')).statusCode).toBe(400);
    const big = await post(app, JSON.stringify({ ...timing(5), note: 'x'.repeat(6000) }));
    expect(big.statusCode).toBe(413);
    expect(big.json()).toEqual({ error: 'too_large' });
    const bad = await post(app, { ...timing(6), ip: 'LEAKME', timingQuality: 'LEAKME2' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toContain('LEAKME');
    expect(bad.json().issues).toContain('$:unknown_field');
    expect(bad.body).not.toContain('$.ip');
    expect(existsSync(dir) ? lines(dir) : []).toHaveLength(0);
  });
  it('limits one client per hour and reports 429 with Retry-After', async () => {
    const app = make(fresh(), { feedbackClientPerHour: 2 });
    expect((await post(app, timing(10))).statusCode).toBe(201);
    expect((await post(app, timing(11))).statusCode).toBe(201);
    const limited = await post(app, timing(12));
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeTruthy();
    expect((await post(app, timing(13), HEADERS, '6.6.6.6')).statusCode).toBe(201);
  });
  it('is unavailable (not silently lost) without a directory, and full at the byte cap', async () => {
    expect((await post(make(null), timing(20))).statusCode).toBe(503);
    expect((await make(null).inject({ method: 'GET', url: '/app/api/beta' })).json().journey.feedbackEnabled).toBe(false);
    // Capacity includes the full provenance record AND lock, not the former minimal record shape.
    const dir = fresh(), app = make(dir, { feedbackMaxFileBytes: 2048 });
    const results: number[] = [];
    for (let i = 0; i < 4; i++) results.push((await post(app, timing(30 + i), HEADERS, `5.5.5.${i}`)).statusCode);
    expect(results[0]).toBe(201);
    expect(results).toContain(503);
    expect(statSync(join(dir, readdirSync(dir).find(f => f.startsWith('feedback-'))!)).size).toBeLessThanOrEqual(2048);
    expect(readdirSync(dir).reduce((sum, name) => sum + statSync(join(dir, name)).size, 0)).toBeLessThanOrEqual(2048);
  });
  it('reports 503 (never a false success) when the storage location cannot be written', async () => {
    const app = make('/proc/r2apb-unwritable/feedback');
    const r = await post(app, timing(50));
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ error: 'feedback_unavailable' });
  });
  it('enforces the daily cap', async () => {
    const dir = fresh(), app = make(dir, { feedbackMaxPerDay: 2, feedbackClientPerHour: 100 });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await post(app, timing(40 + i), HEADERS, `4.4.4.${i}`)).statusCode);
    expect(codes).toEqual([201, 201, 503, 503]);
  });
  it('rejects excess concurrency explicitly, then persists retries as intact lines with no loss', async () => {
    const dir = fresh(), app = make(dir, { feedbackClientPerHour: 100, feedbackGlobalPerMinute: 100 });
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => post(app, timing(100 + i), HEADERS, `3.3.3.${i}`)));
    expect(rs.some(r => r.statusCode === 201)).toBe(true);
    expect(rs.some(r => r.statusCode === 429)).toBe(true);
    expect(rs.every(r => r.statusCode === 201 || (r.statusCode === 429 && r.json().error === 'busy'))).toBe(true);
    for (const [i, response] of rs.entries()) if (response.statusCode === 429) expect((await post(app, timing(100 + i), HEADERS, `3.3.3.${i}`)).statusCode).toBe(201);
    const got = lines(dir);
    expect(got).toHaveLength(30);
    expect(new Set(got.map(g => g.reportId)).size).toBe(30);
  });
  it('survives a restart: earlier reportIds are still duplicates', async () => {
    const dir = fresh();
    const first = make(dir);
    expect((await post(first, timing(60))).statusCode).toBe(201);
    const competing = make(dir);
    expect((await post(competing, timing(60))).statusCode).toBe(503);
    await competing.close().catch(() => undefined);
    await first.close(); // A restart means the original cooperating writer released its lock.
    expect((await post(make(dir), timing(60))).json().status).toBe('duplicate');
    expect(lines(dir)).toHaveLength(1);
  });
  it('counts rejections by reason only, flushed on close, with no content', async () => {
    const dir = fresh(), app = make(dir);
    await post(app, { ...timing(70), note: 'http://evil.example' });
    await post(app, timing(71), { ...HEADERS, origin: 'https://evil.example' });
    await app.close();
    const file = readdirSync(dir).find(f => f.startsWith('rejections-'))!;
    const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    expect(parsed.counts).toEqual({ invalid_payload: 1, forbidden_origin: 1 });
    expect(JSON.stringify(parsed)).not.toMatch(/evil|note/);
  });
});

describe('model comparison and independence from the timetable', () => {
  const pick = async (app: ReturnType<typeof make>) => {
    const day = (await app.inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA }) })).json();
    return day.options[0];
  };
  it('matches an option to the model and records the signed delta; observation alone is still unverified', async () => {
    const dir = fresh(), app = make(dir, {}, at('2026-10-16', '14:00:00'));
    const option = await pick(app);
    const observedAt = (e: number) => new Date(e * 1000).toISOString();
    const body = { v: 1, reportId: uuid(200), kind: 'train_observation', consent: { storeForModelImprovement: true }, modelVersion: realSource().dataVersion,
      context: { line: 1, originId: H7, destinationId: DA, serviceDate: '2026-10-16', tripId: option.id },
      observation: { event: 'train_departure', stationId: H7, direction: 'out', observedAt: observedAt(option.departEpoch + 90), precision: 'minute' } };
    const r = await make(dir, {}, at('2026-10-16', '14:30:00')).inject({ method: 'POST', url: '/app/api/journey-feedback', payload: JSON.stringify(body), headers: HEADERS });
    expect(r.statusCode).toBe(201);
    const [rec] = lines(dir);
    expect(rec.comparison.tripMatch).toBe('matched');
    expect(Math.abs(rec.comparison.deltaSeconds - 90)).toBeLessThanOrEqual(1);
    expect(rec).toMatchObject({ class: 'claimed_observation', identity: 'anonymous_unverified', review: 'unreviewed' });
  });
  it('flags an unknown trip, and a different model version, instead of trusting them', async () => {
    const dir = fresh(), app = make(dir);
    const ctx = { line: 1, originId: H7, destinationId: DA, serviceDate: '2026-10-16' };
    await post(app, timing(210, { context: { ...ctx, tripId: '2026-10-16:L1:out:A:' + 'b'.repeat(64) } }));
    await post(app, timing(211, { modelVersion: 'sha256:' + 'c'.repeat(64), context: { ...ctx, tripId: '2026-10-16:L1:out:A:' + 'b'.repeat(64) } }), HEADERS, '2.2.2.2');
    const got = Object.fromEntries(lines(dir).map(l => [l.reportId, l]));
    expect(got[uuid(210)].comparison.tripMatch).toBe('unmatched');
    expect(got[uuid(211)].comparison.tripMatch).toBe('model_version_mismatch');
    expect(got[uuid(211)].modelVersionMatches).toBe(false);
  });
  it('a flood of contradictory reports never changes what the planner answers', async () => {
    const dir = fresh(), app = make(dir, { feedbackClientPerHour: 100 }, at('2026-10-16', '14:00:00'));
    const strip = (b: any) => { const { asOf: _a, ...rest } = b; return rest; };
    const before = strip((await app.inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA }) })).json());
    for (let i = 0; i < 12; i++) await post(app, timing(300 + i, { timingQuality: i % 2 ? 'earlier' : 'later' }), HEADERS, `1.1.1.${i}`);
    const after = strip((await app.inject({ method: 'GET', url: q({ line: '1', from: H7, to: DA }) })).json());
    expect(after).toEqual(before);
    expect(lines(dir)).toHaveLength(12);
  });
});
