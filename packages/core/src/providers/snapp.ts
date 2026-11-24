// Snapp ride prices for Besrah (F4). A confirmed ride request requires the person's own linked session.
// Two ways to ask for a price:
//  - user:   the person logged in to their own Snapp inside Besrah (SMS code). Their session lives on THEIR device and is
//            sent with each price request; the server uses it for that one call (refreshing it if expired and handing the
//            new one back) and never stores or logs it, nor the phone number or the code.
//  - shared: no linked session. One service session the owner set up on the server answers, cached per ~110 m cell
//            pair for the provider's own TTL, behind a global rate cap.
// Endpoints and payloads mirror Snapp's passenger web app (app.snapp.taxi, read 2026-11-20). Client credentials come
// from the environment (BESRAH_SNAPP_*), never from the repository.
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { clientKey, createWindowLimiter } from '../journey-beta/limits.js';
import { createRoadIndex, loadRoads, pickupCandidates, type RoadIndex } from '../geo/pickup.js';

export const SNAPP_SOURCE = 'snapp_live';
const API = 'https://app.snapp.taxi/api';
const OAUTH = 'https://oauth-passenger.snapp.site';
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const MASHHAD = { latMin: 35.9, latMax: 36.7, lonMin: 59.0, lonMax: 60.2 };
// Snapp's attestation answers (read from the web app): 2001-2003 = a captcha is required (numeric / alphabetic /
// alphanumeric); 2101-2103 = the captcha answer was wrong.
const CAPTCHA_REQUIRED: Record<number, 'numeric' | 'alphabetic' | 'alphanumeric'> = { 2001: 'numeric', 2002: 'alphabetic', 2003: 'alphanumeric', 2201: 'numeric', 2202: 'alphabetic', 2203: 'alphanumeric' };
const CAPTCHA_WRONG = new Set([2101, 2102, 2103]);
const CAPTCHA_TYPES: readonly string[] = ['numeric', 'alphabetic', 'alphanumeric'];

export interface SnappConfig { clientId: string; clientSecret: string; captchaClient: string }
export interface SnappSession { access: string; refresh: string; deviceId: string }
export interface Point { lat: number; lon: number }
export interface SnappService { id: number; name: string; description: string; priceToman: number | null; etaMin: number | null; enabled: boolean }
export interface PriceResult { services: SnappService[]; ttlS: number }
export interface Captcha { type: string; refId: string; solution: string }

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): SnappConfig | null {
  const clientId = env.BESRAH_SNAPP_CLIENT_ID?.trim(), clientSecret = env.BESRAH_SNAPP_CLIENT_SECRET?.trim(), captchaClient = env.BESRAH_SNAPP_CAPTCHA_CLIENT?.trim();
  return clientId && clientSecret && captchaClient ? { clientId, clientSecret, captchaClient } : null;
}

/** 09121234567 / 9121234567 / +989121234567 / ۰۹۱۲… -> +989121234567, anything else null. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const d = raw.replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660)).replace(/[\s\-()]/g, '');
  const m = /^(?:\+98|0098|98|0)?(9\d{9})$/.exec(d);
  return m ? `+98${m[1]}` : null;
}
export const validPoint = (p: unknown): p is Point => {
  const x = p as Point | null;
  return !!x && typeof x.lat === 'number' && typeof x.lon === 'number' && x.lat >= MASHHAD.latMin && x.lat <= MASHHAD.latMax && x.lon >= MASHHAD.lonMin && x.lon <= MASHHAD.lonMax;
};
const validSession = (s: unknown): s is SnappSession => {
  const x = s as SnappSession | null;
  return !!x && typeof x.access === 'string' && typeof x.refresh === 'string' && typeof x.deviceId === 'string'
    && x.access.length > 20 && x.access.length < 4096 && x.refresh.length > 10 && x.refresh.length < 2048 && /^[0-9a-f-]{36}$/i.test(x.deviceId);
};

/** Snapp's price answer -> the services Besrah shows. Prices come in rials; Besrah shows tomans. */
export function parsePrice(body: unknown): PriceResult | null {
  const data = (body as { data?: { services?: unknown; ttl?: unknown } } | null)?.data;
  if (!data || !Array.isArray(data.services)) return null;
  const services: SnappService[] = [];
  for (const s of data.services.slice(0, 20) as Array<Record<string, any>>) {
    const id = typeof s?.id === 'number' ? s.id : null, name = typeof s?.info?.name === 'string' ? s.info.name.trim().slice(0, 40) : '';
    if (id === null || !name) continue;
    const rial = typeof s.price?.final === 'number' && s.price.final > 0 ? s.price.final : null;
    const eta = Array.isArray(s.estimation?.eta) && typeof s.estimation.eta[0] === 'number' ? s.estimation.eta[0] : null;
    services.push({ id, name, description: typeof s.info?.description === 'string' ? s.info.description.trim().slice(0, 60) : '',
      priceToman: rial === null ? null : Math.round(rial / 10), etaMin: eta, enabled: s.enabled !== false && rial !== null });
  }
  const ttl = typeof data.ttl === 'number' && data.ttl > 0 ? Math.min(600, Math.round(data.ttl)) : 120;
  return { services, ttlS: ttl };
}

export class SnappError extends Error { constructor(public kind: 'unauthorized' | 'limited' | 'bad_phone' | 'wrong_code' | 'captcha' | 'captcha_wrong' | 'upstream', public captchaType?: string) { super(kind); } }

export function createSnappClient(cfg: SnappConfig, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
  const doFetch = opts.fetch ?? fetch, timeoutMs = opts.timeoutMs ?? 12000;
  const headers = (extra: Record<string, string> = {}) => ({ 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA, Origin: 'https://app.snapp.taxi', Referer: 'https://app.snapp.taxi/', locale: 'fa-IR', ...extra });
  async function call(url: string, init: RequestInit): Promise<{ status: number; body: any }> {
    let res: Response;
    try { res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }); }
    catch { throw new SnappError('upstream'); }
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }
  const attestation = (c?: Captcha) => ({ method: c ? c.type : 'skip', platform: c ? 'captcha' : 'skip' });
  const captchaBody = (c?: Captcha) => (c ? { client_id: cfg.captchaClient, solution: c.solution, ref_id: c.refId, type: c.type } : undefined);
  const statusOf = (r: { status: number; body: any }) => (typeof r.body?.status === 'number' ? r.body.status : r.status);
  function attestationError(code: number): SnappError | null {
    if (CAPTCHA_REQUIRED[code]) return new SnappError('captcha', CAPTCHA_REQUIRED[code]);
    if (CAPTCHA_WRONG.has(code)) return new SnappError('captcha_wrong', CAPTCHA_TYPES[(code % 10) - 1] ?? 'numeric');
    return null;
  }
  return {
    /** Ask Snapp to send the SMS code. Throws SnappError('captcha', type) when Snapp wants a captcha first. */
    /** `captchaType` (from Snapp's `captcha_type`) says whether the code check needs a fresh captcha too, as in Snapp's web app. */
    async requestOtp(cellphone: string, captcha?: Captcha): Promise<{ method: string | null; ttlS: number | null; captchaType: string | null }> {
      const r = await call(`${OAUTH}/v3/mutotp`, { method: 'POST', headers: headers(), body: JSON.stringify({ cellphone, attestation: attestation(captcha), extra_methods: [], captcha: captchaBody(captcha) }) });
      if (r.status >= 200 && r.status < 300 && r.body) return { method: typeof r.body.method === 'string' ? r.body.method : null, ttlS: typeof r.body.ttl === 'number' ? r.body.ttl : null,
        captchaType: CAPTCHA_TYPES.includes(r.body.captcha_type as string) ? r.body.captcha_type as string : null };
      const code = statusOf(r);
      throw attestationError(code) ?? new SnappError(code === 429 ? 'limited' : code === 400 ? 'bad_phone' : 'upstream');
    },
    async captcha(type: string): Promise<{ image: string; refId: string }> {
      const t = ['numeric', 'alphabetic', 'alphanumeric'].includes(type) ? type : 'numeric';
      const r = await call(`${API}/captcha/api/v1/generate/text/${t}/${cfg.captchaClient}`, { method: 'GET', headers: headers() });
      const d = r.body?.data ?? r.body;
      if (r.status !== 200 || typeof d?.image !== 'string' || typeof d?.ref_id !== 'string' || d.image.length > 200_000) throw new SnappError('upstream');
      return { image: d.image, refId: d.ref_id };
    },
    /** Exchange the SMS code for a session. */
    async verifyOtp(cellphone: string, code: string, method: string | null, captcha?: Captcha): Promise<SnappSession> {
      const deviceId = randomUUID();
      const r = await call(`${OAUTH}/v3/mutotp/auth`, { method: 'POST', headers: headers(), body: JSON.stringify({
        attestation: attestation(captcha), grant_type: method ?? 'sms', client_id: cfg.clientId, client_secret: cfg.clientSecret,
        cellphone, token: code, referrer: 'pwa', device_id: deviceId, captcha: captchaBody(captcha) }) });
      if (r.status >= 200 && r.status < 300 && typeof r.body?.access_token === 'string' && typeof r.body?.refresh_token === 'string') return { access: r.body.access_token, refresh: r.body.refresh_token, deviceId };
      const c = statusOf(r);
      throw attestationError(c) ?? new SnappError(c === 429 ? 'limited' : [400, 401, 1012, 1041].includes(c) ? 'wrong_code' : 'upstream');
    },
    async refresh(s: SnappSession): Promise<SnappSession> {
      const r = await call(`${OAUTH}/v2/auth`, { method: 'POST', headers: headers(), body: JSON.stringify({ grant_type: 'refresh_token', client_id: cfg.clientId, client_secret: cfg.clientSecret, device_id: s.deviceId, refresh_token: s.refresh }) });
      if (r.status === 200 && typeof r.body?.access_token === 'string') return { access: r.body.access_token, refresh: typeof r.body.refresh_token === 'string' ? r.body.refresh_token : s.refresh, deviceId: s.deviceId };
      throw new SnappError(r.status === 401 || r.status === 400 ? 'unauthorized' : 'upstream');
    },
    async requestRide(s: SnappSession, from: Point, to: Point, serviceId: number): Promise<void> {
      const r = await call(`${API}/api-base/v2/passenger/ride`, {
        method: 'POST',
        headers: headers({ Authorization: `Bearer ${s.access}`, 'App-Version': 'pwa', 'x-app-name': 'passenger-pwa', 'x-app-version': 'v18.50.1', 'x-app-version-code': '0' }),
        body: JSON.stringify({
          origin_lat: from.lat, origin_lng: from.lon, destination_lat: to.lat, destination_lng: to.lon,
          service_type: serviceId, preferences: {}, is_paid_by_recipient: false,
        }),
      });
      if (r.status === 401 || r.status === 403) throw new SnappError('unauthorized');
      if (r.status === 429) throw new SnappError('limited');
      if (r.status < 200 || r.status >= 300 || (typeof r.body?.status === 'number' && r.body.status >= 400)) throw new SnappError('upstream');
    },
    async price(s: SnappSession, from: Point, to: Point): Promise<PriceResult> {
      const r = await call(`${API}/v3/price`, { method: 'POST', headers: headers({ Authorization: `Bearer ${s.access}` }), body: JSON.stringify({
        points: [{ lat: String(from.lat), lng: String(from.lon) }, { lat: String(to.lat), lng: String(to.lon) }], price_ride_recom: false, options: {}, locale: 'fa', os: 6, version: 0 }) });
      if (r.status === 401 || r.status === 403) throw new SnappError('unauthorized');
      if (r.status === 429) throw new SnappError('limited');
      const parsed = r.status === 200 ? parsePrice(r.body) : null;
      if (!parsed) throw new SnappError('upstream');
      return parsed;
    },
  };
}
export type SnappClient = ReturnType<typeof createSnappClient>;

/** Price with a session; an expired session is refreshed once and the new one returned so the caller can keep it. */
export async function priceWithRefresh(client: SnappClient, s: SnappSession, from: Point, to: Point): Promise<{ result: PriceResult; session: SnappSession | null }> {
  try { return { result: await client.price(s, from, to), session: null }; }
  catch (e) {
    if (!(e instanceof SnappError) || e.kind !== 'unauthorized') throw e;
    const fresh = await client.refresh(s);
    return { result: await client.price(fresh, from, to), session: fresh };
  }
}

/** The owner's service session (shared price checks), kept in a 0600 file under the service's state directory. */
export function createServiceSession(path: string | undefined) {
  let cached: SnappSession | null | undefined;
  return {
    get(): SnappSession | null {
      if (cached !== undefined) return cached;
      try { const s = path ? JSON.parse(readFileSync(path, 'utf8')) : null; cached = validSession(s) ? s : null; } catch { cached = null; }
      return cached;
    },
    set(s: SnappSession) {
      cached = s;
      if (!path) return;
      try { writeFileSync(path + '.tmp', JSON.stringify(s), { mode: 0o600 }); renameSync(path + '.tmp', path); } catch { /* keep in memory */ }
    },
  };
}

const cell = (p: Point) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
const fa = (kind: SnappError['kind']) => ({ unauthorized: 'unauthorized', limited: 'rate_limited', bad_phone: 'bad_phone', wrong_code: 'wrong_code', captcha: 'captcha', captcha_wrong: 'captcha_wrong', upstream: 'unavailable' })[kind];

export function registerSnapp(app: FastifyInstance, opts: { config?: SnappConfig | null; client?: SnappClient | null; service?: ReturnType<typeof createServiceSession>; roads?: () => RoadIndex | null; limiterClock?: () => number; now?: () => number } = {}) {
  const cfg = opts.config !== undefined ? opts.config : configFromEnv();
  const client = opts.client !== undefined ? opts.client : cfg ? createSnappClient(cfg) : null;
  const service = opts.service ?? createServiceSession(process.env.BESRAH_SNAPP_SERVICE_FILE?.trim() || undefined);
  const clock = opts.limiterClock ?? Date.now, now = opts.now ?? Date.now;
  const otpLimit = createWindowLimiter(3, 10 * 60_000, clock), verifyLimit = createWindowLimiter(8, 10 * 60_000, clock);
  const priceLimit = createWindowLimiter(20, 60_000, clock), sharedGlobal = createWindowLimiter(40, 60_000, clock);
  const cache = new Map<string, { at: number; ttlMs: number; result: PriceResult }>();
  const pending = new Map<string, { method: string | null; captchaType: string | null; at: number }>();   // phone -> method, 10 minutes, memory only
  const noStore = (reply: import('fastify').FastifyReply) => reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
  const bad = (reply: import('fastify').FastifyReply, error = 'bad_request') => reply.code(400).send({ error });
  const fail = (reply: import('fastify').FastifyReply, e: unknown) => {
    const kind = e instanceof SnappError ? e.kind : 'upstream';
    const code = kind === 'limited' ? 429 : kind === 'unauthorized' ? 401 : ['bad_phone', 'wrong_code', 'captcha', 'captcha_wrong'].includes(kind) ? 422 : 503;
    return reply.code(code).send({ error: fa(kind) });
  };
  const captchaFrom = (c: unknown): Captcha | undefined => {
    const x = c as { type?: unknown; refId?: unknown; solution?: unknown } | null;
    if (!x || typeof x.type !== 'string' || typeof x.refId !== 'string' || typeof x.solution !== 'string') return undefined;
    if (!['numeric', 'alphabetic', 'alphanumeric'].includes(x.type) || x.refId.length > 200 || !/^[0-9A-Za-z]{3,8}$/.test(x.solution)) return undefined;
    return { type: x.type, refId: x.refId, solution: x.solution };
  };
  async function withCaptcha(reply: import('fastify').FastifyReply, e: unknown) {
    if (e instanceof SnappError && (e.kind === 'captcha' || e.kind === 'captcha_wrong') && client) {
      try { const c = await client.captcha(e.captchaType ?? 'numeric'); return reply.code(200).send({ status: 'captcha', wrong: e.kind === 'captcha_wrong', captcha: { type: e.captchaType ?? 'numeric', image: c.image, refId: c.refId } }); }
      catch (err) { return fail(reply, err); }
    }
    return fail(reply, e);
  }

  // 1. Send the SMS code to the person's own number (a captcha may be asked first).
  app.post('/app/api/snapp/otp', { bodyLimit: 1024 }, async (req, reply) => {
    noStore(reply);
    if (!client) return reply.code(503).send({ error: 'not_configured' });
    if (!otpLimit.allow(clientKey(req))) return reply.code(429).header('Retry-After', '60').send({ error: 'rate_limited' });
    const b = req.body as { phone?: unknown; captcha?: unknown } | null;
    const phone = normalizePhone(b?.phone);
    if (!phone) return bad(reply, 'bad_phone');
    try {
      const r = await client.requestOtp(phone, captchaFrom(b?.captcha));
      pending.set(phone, { method: r.method, captchaType: r.captchaType, at: now() });
      for (const [k, v] of pending) if (now() - v.at > 10 * 60_000) pending.delete(k);
      return { status: 'sent', ttlS: r.ttlS };
    } catch (e) { return withCaptcha(reply, e); }
  });

  // 2. Exchange the code for a session that goes back to the person's device only.
  app.post('/app/api/snapp/verify', { bodyLimit: 1024 }, async (req, reply) => {
    noStore(reply);
    if (!client) return reply.code(503).send({ error: 'not_configured' });
    if (!verifyLimit.allow(clientKey(req))) return reply.code(429).header('Retry-After', '60').send({ error: 'rate_limited' });
    const b = req.body as { phone?: unknown; code?: unknown; captcha?: unknown } | null;
    const phone = normalizePhone(b?.phone);
    const code = typeof b?.code === 'string' ? b.code.replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0)).trim() : '';
    if (!phone || !/^\d{4,6}$/.test(code)) return bad(reply, phone ? 'bad_code' : 'bad_phone');
    const captcha = captchaFrom(b?.captcha), wants = pending.get(phone)?.captchaType;
    // Snapp said the code check needs a captcha: hand one out first instead of spending a code attempt on a sure refusal.
    if (!captcha && wants) return withCaptcha(reply, new SnappError('captcha', wants));
    try {
      const session = await client.verifyOtp(phone, code, pending.get(phone)?.method ?? null, captcha);
      pending.delete(phone);
      return { status: 'linked', session, phoneHint: phone.slice(-4) };
    } catch (e) { return withCaptcha(reply, e); }
  });

  // Snapp's own public web-app constants, for the Besrah Android app, whose phone talks to Snapp directly.
  app.get('/app/api/snapp/config', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!cfg) return reply.code(503).header('Cache-Control', 'no-store').send({ error: 'not_configured' });
    reply.header('Cache-Control', 'private, max-age=3600');
    return { schemaVersion: 1, clientId: cfg.clientId, clientSecret: cfg.clientSecret, captchaClient: cfg.captchaClient };
  });

  // 0. Candidate pickup / drop-off points on nearby streets (OSM), for «کمترین قیمت ممکن». No provider is asked here; the
  //    prices for these points are asked by the person's device (or through /price with their own session).
  let roads: RoadIndex | null | undefined;
  const roadIndex = () => {
    if (roads !== undefined) return roads;
    try { roads = opts.roads ? opts.roads() : process.env.BESRAH_ROADS_FILE ? createRoadIndex(loadRoads(process.env.BESRAH_ROADS_FILE)) : null; } catch { roads = null; }
    return roads;
  };
  const candLimit = createWindowLimiter(30, 60_000, clock);
  app.post('/app/api/snapp/candidates', { bodyLimit: 1024 }, async (req, reply) => {
    noStore(reply);
    if (!candLimit.allow(clientKey(req))) return reply.code(429).header('Retry-After', '10').send({ error: 'rate_limited' });
    const b = req.body as { from?: unknown; to?: unknown } | null;
    if (!validPoint(b?.from) || !validPoint(b?.to)) return bad(reply, 'bad_points');
    const index = roadIndex();
    if (!index) return reply.code(503).send({ error: 'no_roads' });
    return { schemaVersion: 1, source: 'osm', origins: pickupCandidates(index, b!.from as Point), destinations: pickupCandidates(index, b!.to as Point) };
  });

  const requestLimit = createWindowLimiter(8, 60_000, clock);
  const recentRequests = new Map<string, number>();
  const activeRequests = new Set<string>();
  app.post('/app/api/snapp/request', { bodyLimit: 8192 }, async (req, reply) => {
    noStore(reply);
    if (!client) return reply.code(503).send({ error: 'not_configured' });
    const b = req.body as { from?: unknown; to?: unknown; serviceId?: unknown; session?: unknown } | null;
    if (!b || !validPoint(b.from) || !validPoint(b.to) || (b.serviceId !== 1 && b.serviceId !== 2)) return bad(reply);
    if (b.from.lat === b.to.lat && b.from.lon === b.to.lon) return bad(reply, 'same_points');
    if (!validSession(b.session)) return reply.code(401).send({ error: 'personal_session_required' });
    const sessionKey = createHash('sha256').update(b.session.access).digest('base64url');
    const current = clock();
    for (const [key, expiry] of recentRequests) if (expiry <= current) recentRequests.delete(key);
    if (activeRequests.has(sessionKey) || recentRequests.has(sessionKey) || recentRequests.size >= 5000 || !requestLimit.allow(clientKey(req))) {
      return reply.code(429).header('Retry-After', '30').send({ error: 'rate_limited' });
    }
    activeRequests.add(sessionKey);
    try {
      // This creates a ride. Never refresh and replay it automatically after an uncertain response.
      await client.requestRide(b.session, b.from, b.to, b.serviceId);
      return { status: 'requested' };
    } catch (e) {
      return fail(reply, e);
    } finally {
      recentRequests.set(sessionKey, clock() + 30_000);
      activeRequests.delete(sessionKey);
    }
  });

  // 3. Live prices: the person's own session when given, else the shared service session (cached, capped).
  app.post('/app/api/snapp/price', { bodyLimit: 8192 }, async (req, reply) => {
    noStore(reply);
    if (!client) return reply.code(503).send({ error: 'not_configured' });
    if (!priceLimit.allow(clientKey(req))) return reply.code(429).header('Retry-After', '10').send({ error: 'rate_limited' });
    const b = req.body as { from?: unknown; to?: unknown; session?: unknown } | null;
    if (!validPoint(b?.from) || !validPoint(b?.to)) return bad(reply, 'bad_points');
    const from = b!.from as Point, to = b!.to as Point;
    const answer = (result: PriceResult, source: 'user' | 'shared', session: SnappSession | null, at: number) =>
      ({ schemaVersion: 1, source: SNAPP_SOURCE, sessionKind: source, retrievedAt: new Date(at).toISOString(), ttlS: result.ttlS, services: result.services, ...(session ? { session } : {}) });
    if (b?.session !== undefined) {
      if (!validSession(b.session)) return bad(reply, 'bad_session');
      try { const r = await priceWithRefresh(client, b.session, from, to); return answer(r.result, 'user', r.session, now()); }
      catch (e) { return fail(reply, e); }
    }
    const key = `${cell(from)}>${cell(to)}`, hit = cache.get(key);
    if (hit && now() - hit.at < hit.ttlMs) return answer(hit.result, 'shared', null, hit.at);
    const s = service.get();
    if (!s) return reply.code(503).send({ error: 'no_shared_session' });
    if (!sharedGlobal.allow('all')) return reply.code(429).header('Retry-After', '20').send({ error: 'rate_limited' });
    try {
      const r = await priceWithRefresh(client, s, from, to);
      if (r.session) service.set(r.session);
      cache.set(key, { at: now(), ttlMs: Math.min(r.result.ttlS, 300) * 1000, result: r.result });
      if (cache.size > 2000) cache.delete(cache.keys().next().value!);
      return answer(r.result, 'shared', null, now());
    } catch (e) { return fail(reply, e); }
  });
}
