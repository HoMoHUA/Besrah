// Snapp Pay (F6): the person's own Snapp Pay account inside Besrah: credit and balances, product search and in-store shops.
//
// Login. Snapp Pay's SSO (sso.snapppay.ir) is OAuth2 authorization code + PKCE (client "pay-later") behind a cookie session,
// and it is closed to other sites (CORS), as is the token endpoint (/api/hodor/oauth2/token). So this server walks the SSO
// for the person: number -> SMS code -> code check -> authorization code -> tokens. The cookie jar and the PKCE verifier live
// in memory for the few minutes of one login and are dropped after it. The tokens go back to the device only; nothing is
// stored or logged here. Token refresh passes through here for the same reason.
//
// Everything else (account summary, search, in-store map) the device asks Snapp Pay itself: those APIs answer any origin.
// The only other help from here is turning a point into H3 map cells (the in-store map is indexed by H3 hexagons).
// Read from Snapp Pay's own web app on 2026-11-20 (see research/snapppay/API-NOTES.md).
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { gridDisk, latLngToCell } from 'h3-js';
import { clientKey, createWindowLimiter } from '../journey-beta/limits.js';

const SSO = 'https://sso.snapppay.ir';
const APP = 'https://app.snapppay.ir';
const CLIENT_ID = 'pay-later';
const REDIRECT_URI = 'https://app.snapppay.ir/';
const SCOPE = 'openid profile offline_access';
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const LOGIN_TTL_MS = 10 * 60_000;

// SSO error codes (from the SSO's own code).
const E = { BAD_REQUEST: 8400, CSRF: 8403, STATE: 8409, OTP_EXPIRED: 8410, OTP_LOCKED: 8423, SEND_LIMITED: 8429, BAD_ORIGIN: 8430,
  RESEND_LIMIT: 8431, VERIFY_LIMITED: 8432, LOGIN_LIMITED: 8433, RESEND_NOT_YET: 8449, INVALID_OTP: 8461, INVALID_MOBILE: 8462 } as const;

export type SnappPayErrorKind = 'bad_phone' | 'wrong_code' | 'expired' | 'locked' | 'limited' | 'restart' | 'unauthorized' | 'upstream';
export class SnappPayError extends Error {
  constructor(public kind: SnappPayErrorKind, public detail: { message?: string; retryAfterS?: number; remaining?: number } = {}) { super(kind); }
}
export interface SnappPaySession { access: string; refresh: string; expAt: number | null }
export interface LoginTx { jar: Map<string, string>; verifier: string; state: string; nonce: string; at: number }

const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** 09121234567 / 9121234567 / +989121234567 / ۰۹۱۲… -> 09121234567 (the SSO's own form), else null. */
export function normalizeMobile(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660)).replace(/[\s\-()]/g, '');
  const m = /^(?:\+98|0098|98|0)?(9\d{9})$/.exec(d);
  return m ? `0${m[1]}` : null;
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);

function ssoError(body: any, status: number): SnappPayError {
  const e = body?.errorData ?? {}, code = num(e.errorCode), message = typeof e.message === 'string' ? e.message.slice(0, 200) : undefined;
  const detail = { message, retryAfterS: num(e.data?.retryAfter), remaining: num(e.data?.remainingAttempts) };
  if (code === E.INVALID_MOBILE) return new SnappPayError('bad_phone', detail);
  if (code === E.INVALID_OTP) return new SnappPayError('wrong_code', detail);
  if (code === E.OTP_EXPIRED) return new SnappPayError('expired', detail);
  if (code === E.OTP_LOCKED) return new SnappPayError('locked', detail);
  if (code === E.SEND_LIMITED || code === E.VERIFY_LIMITED || code === E.LOGIN_LIMITED || code === E.RESEND_LIMIT || code === E.RESEND_NOT_YET || status === 429) return new SnappPayError('limited', detail);
  if (code === E.STATE || code === E.CSRF) return new SnappPayError('restart', detail);
  return new SnappPayError('upstream', detail);
}

export function createSnappPayClient(deps: { fetch?: typeof fetch; now?: () => number } = {}) {
  const f = deps.fetch ?? fetch, now = deps.now ?? (() => Date.now());
  const cookieOf = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (jar: Map<string, string>, r: Response) => {
    const list = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')!] : []);
    for (const c of list) { const kv = c.split(';')[0]!, i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
  };
  // The SSO sometimes answers with its internal host name in Location; only the path is meaningful.
  const rebase = (loc: string, base: string) => { const u = new URL(loc, base); return /\.svc\.cluster\.local$|^localhost$/.test(u.hostname) ? `${SSO}${u.pathname}${u.search}` : u.toString(); };
  const page = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'fa-IR,fa;q=0.9' };

  /** Follows SSO redirects as a browser would, until the redirect to Snapp Pay's app (the authorization code) or a page. */
  async function follow(tx: LoginTx, url: string): Promise<{ code?: string; state?: string; error?: string; landed?: string }> {
    let u = url;
    for (let hop = 0; hop < 10; hop++) {
      if (u.startsWith(REDIRECT_URI)) { const q = new URL(u).searchParams; return { code: q.get('code') ?? undefined, state: q.get('state') ?? undefined, error: q.get('error') ?? undefined }; }
      const r = await f(u, { method: 'GET', redirect: 'manual', headers: { ...page, Cookie: cookieOf(tx.jar) } });
      keep(tx.jar, r);
      const loc = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && loc) { u = rebase(loc, u); continue; }
      return { landed: new URL(u).pathname };
    }
    throw new SnappPayError('upstream');
  }
  async function ssoJson(tx: LoginTx, method: 'GET' | 'POST', path: string, body?: unknown) {
    const xsrf = tx.jar.get('XSRF-TOKEN');
    const r = await f(`${SSO}/${path}`, { method, redirect: 'manual', headers: {
      'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'fa-IR,fa;q=0.9', locale: 'fa', Origin: SSO, Referer: `${SSO}/login`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(xsrf ? { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) } : {}), Cookie: cookieOf(tx.jar) },
      body: body !== undefined ? JSON.stringify(body) : undefined });
    keep(tx.jar, r);
    const text = await r.text();
    let j: any = null; try { j = text ? JSON.parse(text) : null; } catch { j = null; }
    if (!r.ok || j?.successful === false) throw ssoError(j, r.status);
    return j?.response ?? null;
  }
  async function token(params: Record<string, string>): Promise<SnappPaySession> {
    const r = await f(`${APP}/api/hodor/oauth2/token`, { method: 'POST', headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', Origin: APP, Referer: REDIRECT_URI },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }).toString() });
    let j: any = null; try { j = await r.json(); } catch { j = null; }
    const t = j?.access_token ? j : j?.response;
    if (r.status === 400 || r.status === 401) throw new SnappPayError('unauthorized');
    if (!r.ok || typeof t?.access_token !== 'string' || typeof t?.refresh_token !== 'string') throw new SnappPayError('upstream');
    const exp = num(t.expires_in);
    return { access: t.access_token, refresh: t.refresh_token, expAt: exp ? now() + exp * 1000 : null };
  }

  return {
    /** Opens an SSO login and asks Snapp Pay to send the SMS code to `mobile` (09xxxxxxxxx). */
    async start(mobile: string): Promise<{ tx: LoginTx; expiresInS: number | null; resendAfterS: number | null; masked: string | null }> {
      const tx: LoginTx = { jar: new Map(), verifier: b64u(randomBytes(32)), state: b64u(randomBytes(16)), nonce: b64u(randomBytes(16)), at: now() };
      const challenge = b64u(createHash('sha256').update(tx.verifier).digest());
      const q = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: SCOPE, state: tx.state, nonce: tx.nonce, code_challenge: challenge, code_challenge_method: 'S256' });
      await follow(tx, `${SSO}/oauth2/authorize?${q}`);
      if (!tx.jar.has('FMSSSO_SESSION')) throw new SnappPayError('upstream');
      await ssoJson(tx, 'GET', 'login/api/csrf');
      await ssoJson(tx, 'GET', 'login/client');
      const sent = await ssoJson(tx, 'POST', 'login/mobile', { mobile });
      return { tx, expiresInS: num(sent?.expiresIn) ?? null, resendAfterS: num(sent?.resendAfter) ?? null, masked: typeof sent?.maskedDestination === 'string' ? sent.maskedDestination.slice(0, 40) : null };
    },
    async resend(tx: LoginTx): Promise<{ expiresInS: number | null; resendAfterS: number | null }> {
      const r = await ssoJson(tx, 'POST', 'login/otp/resend');
      return { expiresInS: num(r?.expiresIn) ?? null, resendAfterS: num(r?.resendAfter) ?? null };
    },
    /** Checks the SMS code, follows the SSO back to the authorization code and exchanges it for tokens (PKCE). */
    async verify(tx: LoginTx, otp: string): Promise<SnappPaySession> {
      const v = await ssoJson(tx, 'POST', 'login/otp/verify', { otp });
      if (typeof v?.continueUrl !== 'string') throw new SnappPayError('upstream');
      let back = await follow(tx, rebase(v.continueUrl, SSO));
      if (!back.code && back.landed && /consent/.test(back.landed)) {
        await ssoJson(tx, 'GET', 'login/consent');
        const c = await ssoJson(tx, 'POST', 'login/consent', { decision: 'APPROVE' });
        if (typeof c?.continueUrl === 'string') back = await follow(tx, rebase(c.continueUrl, SSO));
      }
      if (back.error) throw new SnappPayError('unauthorized');
      if (!back.code || back.state !== tx.state) throw new SnappPayError('restart');
      return token({ grant_type: 'authorization_code', code: back.code, redirect_uri: REDIRECT_URI, code_verifier: tx.verifier });
    },
    refresh(refreshToken: string): Promise<SnappPaySession> { return token({ grant_type: 'refresh_token', refresh_token: refreshToken }); },
  };
}
export type SnappPayClient = ReturnType<typeof createSnappPayClient>;

// Iran, with a margin: the in-store map works all over the country (owner, 2026-11-20).
export const inIran = (lat: unknown, lon: unknown): boolean => typeof lat === 'number' && typeof lon === 'number' && lat >= 24 && lat <= 40.5 && lon >= 43.5 && lon <= 64;

/** H3 cells around a point, as Snapp Pay's in-store map wants them. */
export function cellsAround(lat: number, lon: number, resolution = 7, ring = 1): string[] {
  return gridDisk(latLngToCell(lat, lon, resolution), ring).sort();
}

export function registerSnappPay(app: FastifyInstance, opts: { client?: SnappPayClient | null; limiterClock?: () => number; now?: () => number } = {}) {
  const client = opts.client === undefined ? createSnappPayClient() : opts.client;
  const clock = opts.limiterClock ?? Date.now, now = opts.now ?? Date.now;
  const loginLimit = createWindowLimiter(3, 10 * 60_000, clock), verifyLimit = createWindowLimiter(8, 10 * 60_000, clock);
  const resendLimit = createWindowLimiter(3, 10 * 60_000, clock), refreshLimit = createWindowLimiter(20, 60_000, clock), cellLimit = createWindowLimiter(60, 60_000, clock);
  const logins = new Map<string, { tx: LoginTx; mobile: string }>();               // memory only, one login = 10 minutes
  const sweep = () => { for (const [k, v] of logins) if (now() - v.tx.at > LOGIN_TTL_MS) logins.delete(k); };
  const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
  const limited = (reply: FastifyReply, s = 60) => reply.code(429).header('Retry-After', String(s)).send({ error: 'rate_limited', retryAfterS: s });
  function fail(reply: FastifyReply, e: unknown) {
    if (!(e instanceof SnappPayError)) return reply.code(503).send({ error: 'unavailable' });
    const d = { ...(e.detail.message ? { message: e.detail.message } : {}), ...(e.detail.retryAfterS !== undefined ? { retryAfterS: e.detail.retryAfterS } : {}), ...(e.detail.remaining !== undefined ? { remaining: e.detail.remaining } : {}) };
    const code = { bad_phone: 422, wrong_code: 422, expired: 422, locked: 423, limited: 429, restart: 409, unauthorized: 401, upstream: 503 }[e.kind];
    if (e.kind === 'limited') reply.header('Retry-After', String(e.detail.retryAfterS ?? 60));
    return reply.code(code).send({ error: e.kind === 'upstream' ? 'unavailable' : e.kind === 'limited' ? 'rate_limited' : e.kind, ...d });
  }
  const loginOf = (id: unknown) => (typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id) ? logins.get(id) : undefined);

  // 1. Send the SMS code to the person's own number.
  app.post('/app/api/snapppay/login', { bodyLimit: 1024 }, async (req, reply) => {
    noStore(reply);
    if (!client) return reply.code(503).send({ error: 'not_configured' });
    if (!loginLimit.allow(clientKey(req))) return limited(reply);
    const mobile = normalizeMobile((req.body as { phone?: unknown } | null)?.phone);
    if (!mobile) return reply.code(400).send({ error: 'bad_phone' });
    try {
      const r = await client.start(mobile);
      sweep();
      if (logins.size >= 500) return reply.code(503).send({ error: 'unavailable' });
      const loginId = randomUUID();
      logins.set(loginId, { tx: r.tx, mobile });
      return { status: 'sent', loginId, expiresInS: r.expiresInS, resendAfterS: r.resendAfterS, masked: r.masked };
    } catch (e) { return fail(reply, e); }
  });
  app.post('/app/api/snapppay/resend', { bodyLimit: 1024 }, async (req, reply) => {
    noStore(reply);
    if (!client) return reply.code(503).send({ error: 'not_configured' });
    if (!resendLimit.allow(clientKey(req))) return limited(reply);
    const login = loginOf((req.body as { loginId?: unknown } | null)?.loginId);
    if (!login) return reply.code(409).send({ error: 'restart' });
    try { return { status: 'sent', ...(await client.resend(login.tx)) }; } catch (e) { return fail(reply, e); }
  });
  // 2. The code -> a session that goes back to the person's device only.
  app.post('/app/api/snapppay/verify', { bodyLimit: 1024 }, async (req, reply) => {
    noStore(reply);
    if (!client) return reply.code(503).send({ error: 'not_configured' });
    if (!verifyLimit.allow(clientKey(req))) return limited(reply);
    const b = req.body as { loginId?: unknown; code?: unknown } | null;
    const login = loginOf(b?.loginId);
    const code = typeof b?.code === 'string' ? b.code.replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0)).trim() : '';
    if (!/^\d{6}$/.test(code)) return reply.code(400).send({ error: 'bad_code' });
    if (!login) return reply.code(409).send({ error: 'restart' });
    try {
      const session = await client.verify(login.tx, code);
      logins.delete(String(b?.loginId));
      return { status: 'linked', session, phoneHint: login.mobile.slice(-4) };
    } catch (e) {
      if (e instanceof SnappPayError && (e.kind === 'restart' || e.kind === 'locked' || e.kind === 'unauthorized')) logins.delete(String(b?.loginId));
      return fail(reply, e);
    }
  });
  app.post('/app/api/snapppay/refresh', { bodyLimit: 4096 }, async (req, reply) => {
    noStore(reply);
    if (!client) return reply.code(503).send({ error: 'not_configured' });
    if (!refreshLimit.allow(clientKey(req))) return limited(reply);
    const refresh = (req.body as { refresh?: unknown } | null)?.refresh;
    if (typeof refresh !== 'string' || refresh.length < 10 || refresh.length > 4000) return reply.code(400).send({ error: 'bad_session' });
    try { return { status: 'ok', session: await client.refresh(refresh) }; } catch (e) { return fail(reply, e); }
  });
  // H3 cells for the in-store map. A point only; not stored or logged.
  app.post('/app/api/geo/h3', { bodyLimit: 512 }, async (req, reply) => {
    noStore(reply);
    if (!cellLimit.allow(clientKey(req))) return limited(reply);
    const b = req.body as { lat?: unknown; lon?: unknown; resolution?: unknown; ring?: unknown } | null;
    if (!inIran(b?.lat, b?.lon)) return reply.code(400).send({ error: 'bad_point' });
    const resolution = [6, 7, 8].includes(b?.resolution as number) ? (b!.resolution as number) : 7;
    const ring = [0, 1, 2].includes(b?.ring as number) ? (b!.ring as number) : 1;
    return { resolution, cells: cellsAround(b!.lat as number, b!.lon as number, resolution, ring) };
  });
}
