import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';

describe('on-demand food status route', () => {
  it('uses only the catalog coordinates and rejects caller coordinates', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({status:true,data:{vendor:{vendorStatus:'Open'}}})));
    const app = buildServer({ foodStatusFetch: fetcher as typeof fetch });
    const result = await app.inject('/app/api/food-status?vendor=217xr2');
    expect(result.statusCode).toBe(200);
    expect(result.json().status).toBe('open');
    expect(result.headers['cache-control']).toBe('no-store');
    const upstream = new URL(String(fetcher.mock.calls[0][0]));
    expect(upstream.searchParams.get('latitude')).toBe('36.3364');
    expect(upstream.searchParams.get('longitude')).toBe('59.4694');
    const invalid = await app.inject('/app/api/food-status?vendor=217xr2&latitude=1');
    expect(invalid.statusCode).toBe(400);
    expect((await app.inject('/app/api/food-status?vendor=notcatalogued')).statusCode).toBe(404);
    expect((await app.inject('/app/api/food-status?vendor=217xr2')).statusCode).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await app.close();
  });
  it('returns unknown without a timestamp when the provider fails', async () => {
    const app = buildServer({ foodStatusFetch: (async () => { throw new Error('offline'); }) as typeof fetch });
    const result = await app.inject('/app/api/food-status?vendor=217xr2');
    expect(result.json()).toEqual({ status: 'unknown', observedAt: null });
    await app.close();
  });
});
