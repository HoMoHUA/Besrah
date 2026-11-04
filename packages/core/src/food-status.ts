/** Point-dependent provider observation. No persisted snapshot or cache fallback. */
export type FoodStatus = 'open' | 'closed' | 'out_of_coverage' | 'unknown';
export type FoodStatusObservation = { status: FoodStatus; observedAt: string | null };
export type FoodStatusRequest = { vendorCode: string; latitude: number; longitude: number };

export async function fetchTapsifoodStatus(input: FoodStatusRequest, fetcher: typeof fetch = fetch): Promise<FoodStatusObservation> {
  const unknown: FoodStatusObservation = { status: 'unknown', observedAt: null };
  if (!/^[a-zA-Z0-9]{1,32}$/.test(input.vendorCode) || !Number.isFinite(input.latitude) || Math.abs(input.latitude) > 90 || !Number.isFinite(input.longitude) || Math.abs(input.longitude) > 180) return unknown;
  const url = new URL(`https://api.tapsi.food/v2/api/Vendor/${input.vendorCode}/vendor`);
  url.searchParams.set('latitude', String(input.latitude));
  url.searchParams.set('longitude', String(input.longitude));
  // Request start is conservative: the provider may still return an upstream-cached value.
  const observedAt = new Date().toISOString();
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000), cache: 'no-store', redirect: 'error' });
    if (!response.ok) return unknown;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return unknown;
    const data = body as { status?: unknown; data?: { vendor?: { vendorStatus?: unknown } } };
    if (data.status !== true || !data.data?.vendor || typeof data.data.vendor.vendorStatus !== 'string') return unknown;
    const raw = data.data.vendor.vendorStatus;
    const status: FoodStatus = raw === 'Open' ? 'open' : raw === 'Close' ? 'closed' : raw === 'OutOfCoverage' ? 'out_of_coverage' : 'unknown';
    return { status, observedAt };
  } catch {
    return unknown;
  }
}
