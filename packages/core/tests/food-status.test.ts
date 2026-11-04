import { describe, expect, it, vi } from 'vitest';
import { fetchTapsifoodStatus } from '../src/food-status.js';

const request = { vendorCode: '217xr2', latitude: 36.3364, longitude: 59.4694 };
const response = (vendorStatus: unknown) => new Response(JSON.stringify({ status: true, data: { vendor: { vendorStatus } } }), { status: 200 });

describe('Tapsifood status adapter', () => {
  it.each([['Open', 'open'], ['Close', 'closed'], ['OutOfCoverage', 'out_of_coverage'], ['FutureValue', 'unknown']])('maps %s to %s', async (raw, expected) => {
    const fetcher = vi.fn(async (_url: string | URL | Request) => response(raw));
    const result = await fetchTapsifoodStatus(request, fetcher as typeof fetch);
    expect(result.status).toBe(expected);
    expect(result.observedAt).toMatch(/^\d{4}-/);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe('/v2/api/Vendor/217xr2/vendor');
    expect(url.searchParams.get('latitude')).toBe('36.3364');
    expect(url.searchParams.get('longitude')).toBe('59.4694');
  });
  it('never supplies an observation on upstream failure or malformed response', async () => {
    for (const fetcher of [async () => new Response('', { status: 503 }), async () => new Response('not json'), async () => { throw new Error('network'); }, async () => new Response(JSON.stringify({status:false,data:{vendor:{vendorStatus:'Open'}}}))]) {
      expect(await fetchTapsifoodStatus(request, fetcher as typeof fetch)).toEqual({ status: 'unknown', observedAt: null });
    }
  });
  it('rejects invalid identifiers or coordinates without making requests', async () => {
    const fetcher = vi.fn();
    for (const input of [{...request, vendorCode:'../x'}, {...request, latitude:NaN}, {...request, longitude:181}]) {
      expect(await fetchTapsifoodStatus(input, fetcher as typeof fetch)).toEqual({ status: 'unknown', observedAt: null });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
