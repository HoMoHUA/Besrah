// Same-origin API client. URLs stay relative so the app works at any mount (public host root -> /app/).
import { linkedTimeout } from './async.js';

const isDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value + 'T12:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
};
const isTehranInstant = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\+03:30$/.test(value) && isDate(value.slice(0, 10));
const isClock = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/.test(value);

export class ApiError extends Error {
  constructor(kind, message) { super(message || kind); this.name = 'ApiError'; this.kind = kind; }
}

export function createApi({ fetch: fetchImpl = globalThis.fetch?.bind(globalThis), timeoutMs = 15000, timers = globalThis } = {}) {
  // Beta has a separate failure vocabulary and write boundary. Keep the guard alive through JSON parsing.
  async function betaRequest(path, { signal, payload } = {}) {
    const guard = linkedTimeout(signal, timeoutMs, timers);
    try {
      const response = await fetchImpl(path, {
        signal: guard.signal, cache: 'no-store', credentials: 'omit',
        ...(payload ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Besrah-Beta': '1' }, body: JSON.stringify(payload) } : {}),
      });
      let data;
      try { data = await response.json(); } catch (error) { if (guard.signal.aborted) throw error; if (response.ok) throw new ApiError('server'); }
      if (!response.ok) {
        const kind = response.status === 503 && data?.error === 'journey_timeout' ? 'timeout' : ({ 400: 'bad_request', 403: 'forbidden', 404: 'disabled', 429: 'rate_limited', 503: 'unavailable' })[response.status] ?? 'server';
        const error = new ApiError(kind);
        if (typeof data?.code === 'string') error.code = data.code;
        if (typeof data?.error === 'string') error.reason = data.error;
        if (Array.isArray(data?.issues)) error.issues = data.issues.filter(issue => typeof issue === 'string').slice(0, 30);
        throw error;
      }
      if (guard.timedOut()) throw new ApiError('timeout');
      if (signal?.aborted) throw new ApiError('aborted');
      return data;
    } catch (error) {
      if (guard.timedOut()) throw new ApiError('timeout');
      if (signal?.aborted || error?.name === 'AbortError') throw new ApiError('aborted');
      if (error instanceof ApiError) throw error;
      throw new ApiError('network');
    } finally { guard.dispose(); }
  }
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
    if (!response.ok) { const failure = new ApiError('server'); failure.status = response.status; throw failure; }
    try { return await response.json(); } catch { throw new ApiError('server'); }
  }
  async function post(path, payload, signal) {
    const guard = linkedTimeout(signal, timeoutMs, timers);
    let response;
    try {
      response = await fetchImpl(path, { method: 'POST', signal: guard.signal, cache: 'no-store', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (error) {
      if (guard.timedOut()) throw new ApiError('timeout');
      if (signal?.aborted || error?.name === 'AbortError') throw new ApiError('aborted');
      throw new ApiError('network');
    } finally { guard.dispose(); }
    if (!response.ok) {
      const failure = new ApiError(response.status === 422 ? 'outside_coverage' : response.status === 429 ? 'rate_limited' : response.status === 401 ? 'unauthenticated' : response.status === 403 ? 'forbidden' : response.status === 409 ? 'conflict' : 'server');
      failure.status = response.status;
      try { const body = await response.json(); if (typeof body?.error === 'string') failure.reason = body.error; if (Number.isInteger(body?.version)) failure.version = body.version; } catch { /* no body */ }
      throw failure;
    }
    try { return await response.json(); } catch { throw new ApiError('server'); }
  }
  return {
    // Door-to-door planning and place search are POST so coordinates and text never appear in a URL or an access log.
    // Accounts are optional: every call can fail and the app keeps working as a guest.
    async accountSession(signal) {
      const data = await get('api/account/session', signal);
      if (typeof data?.authenticated !== 'boolean') throw new ApiError('server');
      return data;
    },
    async accountTelegram(initData, signal) {
      const data = await post('api/account/telegram', { initData }, signal);
      if (data?.authenticated !== true) throw new ApiError('server');
      return data;
    },
    async accountLogout(signal) { return post('api/account/logout', {}, signal); },
    async accountConsent(purpose, granted, signal) { return post('api/account/consents', { purpose, granted }, signal); },
    async accountPreferences(signal) {
      const data = await get('api/account/preferences', signal);
      if (!Number.isInteger(data?.version) || typeof data?.values !== 'object') throw new ApiError('server');
      return data;
    },
    async accountSavePreferences(expectedVersion, values, signal) { return post('api/account/preferences', { expectedVersion, values }, signal); },
    async accountExport(signal) { return post('api/account/export', {}, signal); },
    async accountDelete(signal) { return post('api/account/delete', { confirm: 'DELETE' }, signal); },
    async homeSuggestions(point, signal) {
      const data = await post('api/recommendations/home', point ? { lat: point.lat, lon: point.lon } : {}, signal);
      if (data?.schemaVersion !== 1 || !Array.isArray(data.cards) || data.cards.length > 2) throw new ApiError('server');
      return data;
    },
    async places(q, signal) {
      const data = await post('api/places', { q }, signal);
      if (data?.schemaVersion !== 1 || !Array.isArray(data.places) || data.places.length > 6 || data.places.some(p => !p || typeof p.name !== 'string' || !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) throw new ApiError('server');
      return data;
    },
    async trip(payload, signal) {
      const data = await post('api/trip', payload, signal);
      if (data?.schemaVersion !== 1 || !['ok', 'partial', 'unavailable'].includes(data.status) || !Array.isArray(data.options) || data.options.length > 2 || typeof data.reason !== 'string') throw new ApiError('server');
      return data;
    },
    async shopSearch(query = {}, signal) {
      const params = new URLSearchParams();
      for (const key of ['q', 'maxPrice', 'sort', 'limit', 'offset']) if (query[key] !== undefined && query[key] !== null && query[key] !== '') params.set(key, String(query[key]));
      const data = await get('api/shop/search?' + params, signal);
      if (!Array.isArray(data?.products) || !Number.isInteger(data.total) || !data.snapshot) throw new ApiError('server');
      return data;
    },
    async shopProduct(id, signal) {
      const data = await get('api/shop/product?id=' + encodeURIComponent(id), signal);
      if (typeof data?.id !== 'string' || !Array.isArray(data?.offers)) throw new ApiError('server');
      return data;
    },
    async beta(signal) {
      const data = await betaRequest('api/beta', { signal }), config = data?.journey;
      if (!config || typeof config.enabled !== 'boolean' || typeof config.feedbackEnabled !== 'boolean' ||
          !Number.isInteger(config.rolloutPercent) || config.rolloutPercent < 0 || config.rolloutPercent > 100 ||
          !['strict', 'weekday_baseline'].includes(config.calendarMode) || config.horizonDays !== 7 || config.windowMinutes !== 120) throw new ApiError('server');
      return config;
    },
    async journey(query, signal) {
      const params = new URLSearchParams();
      for (const key of ['line', 'from', 'to', 'date', 'time']) if (query[key] !== undefined) params.set(key, String(query[key]));
      const data = await betaRequest('api/journey?' + params, { signal });
      if (data?.schemaVersion !== 1 || data.beta !== true || data.modelOnly !== true || data.live !== false ||
          !['ok', 'partial', 'insufficient_data', 'no_feasible_option'].includes(data.status) ||
          !Array.isArray(data.options) || data.options.length > 5 ||
          (!['ok', 'partial'].includes(data.status) && data.options.length) ||
          !data.request || data.request.line !== Number(query.line) || data.request.originId !== query.from || data.request.destinationId !== query.to ||
          !isTehranInstant(data.request.readyAt) ||
          !data.calendar || !['known', 'estimated', 'unknown'].includes(data.calendar.state) || !isDate(data.calendar.serviceDate) ||
          !/^sha256:[0-9a-f]{64}$/.test(String(data.modelVersion)) ||
          !isTehranInstant(data.asOf) || !isTehranInstant(data.validUntil) || Date.parse(data.validUntil) <= Date.parse(data.asOf) ||
          data.options.some(o => !o || typeof o.id !== 'string' || typeof o.toward !== 'string' ||
            !isClock(o.departAt) || !isClock(o.arriveAt) || !isDate(o.departDate) || !isDate(o.arriveDate) ||
            !Number.isFinite(o.waitSeconds) || o.waitSeconds < 0 || !Number.isFinite(o.inVehicleSeconds) || o.inVehicleSeconds < 0)) throw new ApiError('server');
      return data;
    },
    async journeyFeedback(payload, signal) {
      const data = await betaRequest('api/journey-feedback', { payload, signal });
      if (!['stored', 'duplicate'].includes(data?.status)) throw new ApiError('server');
      return data;
    },
    async stations(signal) {
      const data = await get('api/stations', signal);
      if (!Array.isArray(data?.stations) || !Array.isArray(data?.line1Order)) throw new ApiError('server');
      return data;
    },
    async trains(line, signal) {
      const data = await get('api/trains?line=' + (line === 2 ? 2 : 1), signal);
      if (!Array.isArray(data?.order) || !Array.isArray(data?.trains)) throw new ApiError('server');
      return data;
    },
    async busGuide(signal) {
      const data = await get('assets/bus-guide.json', signal);
      if (data?.v !== 1 || !Array.isArray(data?.n) || !Array.isArray(data?.l)) throw new ApiError('server');
      return data;
    },
    async foodCatalog(signal) {
      const data = await get('assets/food-catalog.json', signal);
      if (data?.v !== 1 || !Array.isArray(data?.vendors)) throw new ApiError('server');
      return data;
    },
    // Food search and vendor menus come from this app's own server (stored snapshot); every parameter is optional and allow-listed.
    async foodSearch(query = {}, signal) {
      const params = new URLSearchParams();
      for (const key of ['q', 'source', 'maxPrice', 'minPrice', 'lat', 'lon', 'radiusKm', 'sort', 'limit', 'offset']) if (query[key] !== undefined && query[key] !== null && query[key] !== '') params.set(key, String(query[key]));
      const data = await get('api/food/search?' + params, signal);
      if (!Array.isArray(data?.vendors) || !Number.isInteger(data.total) || !data.snapshot || typeof data.snapshot !== 'object') throw new ApiError('server');
      return data;
    },
    async foodVendor(id, query = {}, signal) {
      const params = new URLSearchParams({ id: String(id) });
      for (const key of ['lat', 'lon']) if (query[key] !== undefined) params.set(key, String(query[key]));
      const data = await get('api/food/vendor?' + params, signal);
      if (typeof data?.id !== 'string' || !Array.isArray(data?.menu)) throw new ApiError('server');
      return data;
    },
    async foodStatus(vendor, signal) {
      const data = await get('api/food-status?vendor=' + encodeURIComponent(vendor), signal);
      if (!['open', 'closed', 'out_of_coverage', 'unknown'].includes(data?.status) ||
          !(data.observedAt === null || (typeof data.observedAt === 'string' && Number.isFinite(Date.parse(data.observedAt))))) throw new ApiError('server');
      if (data.status !== 'unknown' && data.observedAt === null) throw new ApiError('server');
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
