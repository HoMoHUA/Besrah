// Same-origin API client. URLs stay relative so the app works at any mount (public host root -> /app/).
import { linkedTimeout } from './async.js';

export class ApiError extends Error {
  constructor(kind, message) { super(message || kind); this.name = 'ApiError'; this.kind = kind; }
}

export function createApi({ fetch: fetchImpl = globalThis.fetch?.bind(globalThis), timeoutMs = 15000, timers = globalThis } = {}) {
  async function get(path, signal) {
    const guard = linkedTimeout(signal, timeoutMs, timers);
    let response;
    try {
      response = await fetchImpl(path, { signal: guard.signal, cache: 'no-store', credentials: 'omit' });
    } catch (error) {
      if (guard.timedOut()) throw new ApiError('timeout');
      if (signal?.aborted || error?.name === 'AbortError') throw new ApiError('aborted');
      throw new ApiError('network');
    } finally { guard.dispose(); }
    if (response.status === 404) throw new ApiError('unknown_station');
    if (!response.ok) throw new ApiError('server');
    try { return await response.json(); } catch { throw new ApiError('server'); }
  }
  return {
    async stations(signal) {
      const data = await get('api/stations', signal);
      if (!Array.isArray(data?.stations) || !Array.isArray(data?.line1Order)) throw new ApiError('server');
      return data;
    },
    async next(station, { signal, limit = 10, line } = {}) {
      const query = 'api/next?station=' + encodeURIComponent(station) + '&limit=' + limit + (line === 1 || line === 2 ? '&line=' + line : '');
      const data = await get(query, signal);
      if (!Array.isArray(data?.passes) || typeof data?.as_of !== 'string') throw new ApiError('server');
      return data;
    },
  };
}
