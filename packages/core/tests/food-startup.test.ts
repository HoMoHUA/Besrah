import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildServer } from '../src/server.js';

// Replace only the optional catalogue read; transit/static dependencies stay real.
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});
const realRead = await vi.importActual<typeof import('node:fs')>('node:fs');
function catalogRead(value: string | Error) {
  vi.mocked(readFileSync).mockImplementation(((...args: Parameters<typeof readFileSync>) => {
    if (String(args[0]).endsWith('/assets/food-catalog.json')) {
      if (value instanceof Error) throw value;
      return value;
    }
    return realRead.readFileSync(...args);
  }) as typeof readFileSync);
}
const vendor = (c: string, la = 36.3364, lo = 59.4694) => ({ s: 't', c, la, lo });
const fixtureFetch = () => vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ status: true, data: { vendor: { vendorStatus: 'Open' } } })));
afterEach(() => { vi.restoreAllMocks(); vi.mocked(readFileSync).mockImplementation(realRead.readFileSync); });

describe('optional food catalogue startup isolation', () => {
  it.each([
    ['missing', Object.assign(new Error('ENOENT: catalogue missing'), { code: 'ENOENT' })],
    ['invalid JSON', '{broken'],
    ['null root', 'null'],
    ['missing vendors', '{}'],
    ['non-array vendors', '{"vendors":{}}'],
  ])('%s catalogue keeps transit working and reports food status unavailable', async (_label, input) => {
    catalogRead(input);
    const fetcher = fixtureFetch();
    const app = buildServer({ foodStatusFetch: fetcher as typeof fetch, now: () => Date.parse('2026-10-16T10:30:00Z') });
    try {
      expect((await app.inject('/health')).json()).toEqual({ ok: true });
      const query = '?station=' + encodeURIComponent('شریعتی') + '&limit=3&line=1';
      const next = await app.inject('/v1/next' + query);
      expect(next.statusCode).toBe(200);
      expect(next.json().passes).toHaveLength(3);
      expect((await app.inject('/app/api/next' + query)).json()).toEqual(next.json());
      const trains = await app.inject('/v1/trains?line=1');
      expect(trains.statusCode).toBe(200);
      expect((await app.inject('/app/api/trains?line=1')).json()).toEqual(trains.json());
      expect((await app.inject('/app/api/stations')).json().supportedLines).toEqual([1, 2]);
      expect((await app.inject('/app/')).statusCode).toBe(200);
      const status = await app.inject('/app/api/food-status?vendor=217xr2');
      expect(status.statusCode).toBe(503);
      expect(status.json()).toEqual({ error: 'food_status_unavailable', status: 'unknown', observedAt: null });
      expect(status.headers['cache-control']).toBe('no-store');
      expect(status.headers['x-content-type-options']).toBe('nosniff');
      for (const query of ['', '?vendor=bad-code', '?vendor=217xr2&latitude=36', '?vendor=a&vendor=b']) {
        expect((await app.inject('/app/api/food-status' + query)).statusCode).toBe(400);
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('skips malformed rows while retaining trusted points, ambiguity rejection and per-vendor throttling', async () => {
    catalogRead(JSON.stringify({ vendors: [null, false, 'bad', {}, vendor('217xr2'), vendor('duplicate'), vendor('duplicate', 36.34),
      { ...vendor('snapp'), s: 's' }, vendor('bad-code'), vendor('outside', 1), vendor('string', '36.3' as unknown as number)] }));
    const fetcher = fixtureFetch();
    const app = buildServer({ foodStatusFetch: fetcher as typeof fetch });
    try {
      for (const code of ['duplicate', 'snapp', 'outside', 'string', 'notcatalogued']) {
        expect((await app.inject('/app/api/food-status?vendor=' + code)).statusCode).toBe(404);
      }
      const response = await app.inject('/app/api/food-status?vendor=217xr2');
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('open');
      expect(response.json().observedAt).toEqual(expect.any(String));
      const upstream = new URL(String(fetcher.mock.calls[0]?.[0]));
      expect(upstream.searchParams.get('latitude')).toBe('36.3364');
      expect(upstream.searchParams.get('longitude')).toBe('59.4694');
      expect((await app.inject('/app/api/food-status?vendor=217xr2')).statusCode).toBe(429);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });

  it('retains the global sixty-per-minute budget and resets it after the window', async () => {
    catalogRead(JSON.stringify({ vendors: Array.from({ length: 61 }, (_, i) => vendor('vendor' + i)) }));
    let time = Date.parse('2026-11-02T08:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => time);
    const fetcher = fixtureFetch();
    const app = buildServer({ foodStatusFetch: fetcher as typeof fetch });
    try {
      for (let i = 0; i < 60; i++) expect((await app.inject('/app/api/food-status?vendor=vendor' + i)).statusCode).toBe(200);
      expect((await app.inject('/app/api/food-status?vendor=vendor60')).statusCode).toBe(429);
      time += 60_000;
      expect((await app.inject('/app/api/food-status?vendor=vendor60')).statusCode).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(61);
    } finally { await app.close(); }
  });

  it('an empty but valid catalogue rejects unknown vendors instead of calling the provider', async () => {
    catalogRead('{"vendors":[]}');
    const fetcher = fixtureFetch();
    const app = buildServer({ foodStatusFetch: fetcher as typeof fetch });
    try {
      const response = await app.inject('/app/api/food-status?vendor=217xr2');
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'unknown_vendor' });
      expect(fetcher).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
