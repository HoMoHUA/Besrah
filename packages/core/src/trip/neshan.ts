// Neshan REST adapter (server side only). The key comes from the environment, travels only in a request header, and is never
// logged, echoed or stored. Every call is bounded: timeout, in-flight cap, daily cap, small TTL cache.
// Honest labels: `provider_traffic` means "the provider's traffic-aware endpoint", not proof that a number is live.

export type RouteMode = 'pedestrian' | 'car';
export interface LatLon { lat: number; lon: number }
export interface RouteLeg { mode: RouteMode; durationS: number; distanceM: number; traffic: 'provider_traffic' | 'none'; source: 'neshan'; fetchedAt: number }
export type RouterFailure = 'unavailable' | 'unauthorized' | 'rate_limited' | 'timeout' | 'bad_response' | 'no_route';
export class RouterError extends Error { constructor(readonly code: RouterFailure) { super(code); } }

export interface Router {
  readonly configured: boolean;
  route(mode: RouteMode, from: LatLon, to: LatLon): Promise<RouteLeg>;
  geocode(address: string): Promise<LatLon | null>;
  /** Same single-result geocode, but says why there is no point: no match, or the service failed / is not enabled. */
  geocodeDetailed?(address: string): Promise<GeocodeOutcome>;
  stats(): { calls: number; day: string; cap: number; lastFailure: RouterFailure | null };
}

export type GeocodeOutcome = { status: 'ok'; point: LatLon } | { status: 'no_match' } | { status: 'failed'; code: RouterFailure };

export interface NeshanOptions {
  directionKey?: string | undefined; geocodingKey?: string | undefined;
  fetch?: typeof fetch; now?: () => number; timeoutMs?: number; maxInFlight?: number; dailyCap?: number; base?: string;
}

/** Reads BESRAH_NESHAN_KEY, with optional per-service overrides. Only names are documented; values never leave the process. */
export function neshanOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): NeshanOptions {
  const k = (name: string): string | undefined => { const v = env[name]?.trim(); return v && v.length >= 16 && v.length <= 128 && /^[\w.-]+$/.test(v) ? v : undefined; };
  const shared = k('BESRAH_NESHAN_KEY');
  const cap = Number(env.BESRAH_NESHAN_DAILY_CAP);
  return { directionKey: k('BESRAH_NESHAN_DIRECTION_KEY') ?? shared, geocodingKey: k('BESRAH_NESHAN_GEOCODING_KEY') ?? shared,
    ...(Number.isInteger(cap) && cap > 0 && cap <= 100000 ? { dailyCap: cap } : {}) };
}

const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e7;
const r5 = (n: number): string => n.toFixed(5);

export function createNeshan(options: NeshanOptions = {}): Router {
  const doFetch = options.fetch ?? fetch, now = options.now ?? Date.now, base = options.base ?? 'https://api.neshan.org';
  const timeoutMs = options.timeoutMs ?? 4000, maxInFlight = options.maxInFlight ?? 4, cap = options.dailyCap ?? 2000;
  const cache = new Map<string, { at: number; leg: RouteLeg | null }>();
  let inFlight = 0, calls = 0, day = '', lastFailure: RouterFailure | null = null, geocodingDeniedUntil = 0;
  const today = () => new Date(now()).toISOString().slice(0, 10);

  const call = async (path: string, key: string): Promise<unknown> => {
    if (today() !== day) { day = today(); calls = 0; }
    if (calls >= cap) throw new RouterError('rate_limited');
    // A busy adapter queues briefly (callers fan out up to ~8 legs per trip) instead of failing the leg.
    for (let waited = 0; inFlight >= maxInFlight; waited += 25) {
      if (waited >= timeoutMs) throw new RouterError('rate_limited');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    inFlight++; calls++;
    try {
      const response = await doFetch(base + path, { headers: { 'Api-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs), credentials: 'omit', redirect: 'error' } as RequestInit);
      if (response.status === 401 || response.status === 403) throw new RouterError('unauthorized');
      if (response.status === 429) throw new RouterError('rate_limited');
      const body: unknown = await response.json().catch(() => null);
      // Neshan answers some permission problems with HTTP 200/4xx and a numeric code (485: key not enabled for this service).
      if (body && typeof body === 'object' && (body as { status?: unknown }).status === 'ERROR') throw new RouterError((body as { code?: unknown }).code === 485 ? 'unauthorized' : 'bad_response');
      if (!response.ok) throw new RouterError('bad_response');
      return body;
    } catch (error) {
      if (error instanceof RouterError) throw error;
      const name = (error as { name?: string }).name;
      throw new RouterError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unavailable');
    } finally { inFlight--; }
  };

  const remember = (code: RouterFailure): never => { lastFailure = code; throw new RouterError(code); };

  const geocodeDetailed = async (address: string): Promise<GeocodeOutcome> => {
    if (!options.geocodingKey) return { status: 'failed', code: 'unavailable' };
    if (now() < geocodingDeniedUntil) return { status: 'failed', code: 'unauthorized' };
    try {
      const body = await call(`/v6/geocoding?address=${encodeURIComponent(address.slice(0, 120))}`, options.geocodingKey) as { status?: string; location?: { x?: unknown; y?: unknown } };
      // Neshan answers an address it cannot place with a non-OK status (e.g. NO_RESULT) and no location.
      if (body?.status !== 'OK') return { status: 'no_match' };
      if (typeof body.location?.x !== 'number' || typeof body.location?.y !== 'number' || !Number.isFinite(body.location.x) || !Number.isFinite(body.location.y)) { lastFailure = 'bad_response'; return { status: 'failed', code: 'bad_response' }; }
      return { status: 'ok', point: { lat: body.location.y, lon: body.location.x } };
    } catch (error) {
      const code = error instanceof RouterError ? error.code : 'unavailable';
      if (code === 'unauthorized') geocodingDeniedUntil = now() + 3_600_000;
      lastFailure = code;
      return { status: 'failed', code };
    }
  };

  return {
    configured: Boolean(options.directionKey),
    async route(mode, from, to) {
      if (!options.directionKey) return remember('unavailable');
      const ttl = mode === 'car' ? 120_000 : 900_000, id = `${mode}|${r5(from.lat)},${r5(from.lon)}|${r5(to.lat)},${r5(to.lon)}`;
      const hit = cache.get(id);
      if (hit && now() - hit.at < ttl) { if (!hit.leg) throw new RouterError('no_route'); return hit.leg; }
      let body: unknown;
      try { body = await call(`/v4/direction?type=${mode}&origin=${r5(from.lat)},${r5(from.lon)}&destination=${r5(to.lat)},${r5(to.lon)}`, options.directionKey); }
      catch (error) { return remember(error instanceof RouterError ? error.code : 'unavailable'); }
      const leg = (body as { routes?: Array<{ legs?: Array<{ duration?: { value?: unknown }; distance?: { value?: unknown } }> }> })?.routes?.[0]?.legs;
      if (!Array.isArray(body === null ? null : (body as { routes?: unknown }).routes) || !(body as { routes: unknown[] }).routes.length) { cache.set(id, { at: now(), leg: null }); throw new RouterError('no_route'); }
      if (!leg?.length) return remember('bad_response');
      let durationS = 0, distanceM = 0;
      for (const l of leg) {
        if (!finitePositive(l.duration?.value) || !finitePositive(l.distance?.value)) return remember('bad_response');
        durationS += l.duration.value; distanceM += l.distance.value;
      }
      const out: RouteLeg = { mode, durationS: Math.round(durationS), distanceM: Math.round(distanceM), traffic: mode === 'car' ? 'provider_traffic' : 'none', source: 'neshan', fetchedAt: now() };
      if (cache.size >= 200) cache.delete(cache.keys().next().value as string);
      cache.set(id, { at: now(), leg: out });
      return out;
    },
    geocodeDetailed,
    async geocode(address) {
      const out = await geocodeDetailed(address);
      return out.status === 'ok' ? out.point : null;
    },
    stats: () => ({ calls, day, cap, lastFailure }),
  };
}

/** A router that is honestly absent: every route is unavailable, so the planner keeps durations unknown. */
export const noRouter: Router = { configured: false, async route() { throw new RouterError('unavailable'); }, async geocode() { return null; }, stats: () => ({ calls: 0, day: '', cap: 0, lastFailure: null }) };
