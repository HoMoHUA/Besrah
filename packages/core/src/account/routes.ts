// /app/api/account/*: guest-first accounts. No endpoint here is needed to use the app; everything degrades to "guest".
// Mutations are JSON-only POSTs with an Origin check and a SameSite=Lax HttpOnly cookie (CSRF), per-client rate limits,
// strict body schemas, and every read/write is scoped to the account that owns the session (no id ever comes from the client).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { clientKey, createWindowLimiter } from '../journey-beta/limits.js';
import { CONSENT_PURPOSES, CONSENT_VERSION, validatePreferences, type AccountStore, type ConsentPurpose } from './store.js';
import { verifyTelegramInitData, TELEGRAM_PUBLIC_KEY_PROD } from './telegram.js';

export const SESSION_COOKIE = 'bsr_session';
export interface AccountRoutesOptions {
  /** Opened lazily on first use; null/undefined disables accounts (guest only, 503 on writes). */
  open?: () => AccountStore | null;
  store?: AccountStore | null;
  botId?: string; telegramPublicKeyHex?: string;
  now?: () => number; limiterClock?: () => number;
  secureCookie?: boolean; allowedOrigins?: readonly string[];
}

const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
const hasOnly = (o: object, keys: readonly string[]) => Object.keys(o).every(k => keys.includes(k));

export function readCookie(header: unknown, name: string): string | null {
  if (typeof header !== 'string' || header.length > 4096) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function registerAccount(app: FastifyInstance, opts: AccountRoutesOptions = {}) {
  const now = opts.now ?? Date.now, clock = opts.limiterClock ?? Date.now;
  let store: AccountStore | null | undefined = opts.store;
  const get = (): AccountStore | null => { if (store !== undefined) return store; try { store = opts.open?.() ?? null; } catch { store = null; } return store; };
  const botId = opts.botId ?? '9195157620', secure = opts.secureCookie ?? true;
  const general = createWindowLimiter(60, 60_000, clock), logins = createWindowLimiter(10, 60_000, clock), globalLogins = createWindowLimiter(120, 60_000, clock, 1);
  app.addHook('onClose', async () => { try { store?.close(); } catch { /* already closed */ } });

  const cookie = (token: string, maxAge: number) => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const sessionOf = (req: FastifyRequest): { accountId: string; token: string } | null => {
    const s = get(), token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!s || !token) return null;
    const found = s.getSession(token, Math.floor(now() / 1000));
    return found ? { accountId: found.accountId, token } : null;
  };
  const guard = (req: FastifyRequest, reply: FastifyReply, mutating: boolean, limiter = general): boolean => {
    noStore(reply);
    if (!limiter.allow(clientKey(req))) { reply.code(429).header('Retry-After', '10').send({ error: 'rate_limited' }); return false; }
    if (mutating) {
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) { reply.code(415).send({ error: 'unsupported_media_type' }); return false; }
      const origin = req.headers.origin;
      // A browser always sends Origin on cross-site POSTs. Accept the listed origins and the request's own host only.
      if (origin !== undefined) {
        const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? ''), o = String(origin);
        if (!(opts.allowedOrigins ?? []).includes(o) && o !== `https://${host}` && o !== `http://${host}`) { reply.code(403).send({ error: 'bad_origin' }); return false; }
      }
    }
    return true;
  };
  const view = (accountId: string) => {
    const s = get()!, consents = s.consents(accountId);
    return { authenticated: true, available: true, methods: ['telegram'], consents, consentVersion: CONSENT_VERSION };
  };
  const unauth = (reply: FastifyReply) => reply.code(401).send({ error: 'unauthenticated' });
  const unavailable = (reply: FastifyReply) => reply.code(503).send({ error: 'accounts_unavailable' });

  app.get('/app/api/account/session', async (req, reply) => {
    if (!guard(req, reply, false)) return reply;
    const s = get();
    if (!s) return { authenticated: false, available: false, loginMethods: { telegram: false } };
    const session = sessionOf(req);
    return session ? view(session.accountId) : { authenticated: false, available: true, loginMethods: { telegram: true } };
  });

  app.post('/app/api/account/telegram', { bodyLimit: 6144 }, async (req, reply) => {
    if (!guard(req, reply, true, logins) || !globalLogins.allow('all')) { if (!reply.sent) reply.code(429).send({ error: 'rate_limited' }); return reply; }
    const s = get(); if (!s) return unavailable(reply);
    const body = req.body;
    if (!body || typeof body !== 'object' || !hasOnly(body, ['initData'])) return reply.code(400).send({ error: 'bad_request', field: 'body' });
    const verdict = verifyTelegramInitData((body as { initData?: unknown }).initData, { botId, ...(opts.telegramPublicKeyHex ? { publicKeyHex: opts.telegramPublicKeyHex } : { publicKeyHex: TELEGRAM_PUBLIC_KEY_PROD }), nowSec: Math.floor(now() / 1000) });
    // One generic answer for every failure: no oracle about which check failed.
    if (!verdict.ok) return reply.code(401).send({ error: 'invalid_init_data' });
    const nowSec = Math.floor(now() / 1000), { accountId, created } = s.loginTelegram(verdict.telegramId, nowSec);
    const old = sessionOf(req); if (old) s.revokeSession(old.token);   // rotate: a login never reuses an existing session
    const { token, expiresAt } = s.createSession(accountId, nowSec);
    reply.header('Set-Cookie', cookie(token, expiresAt - nowSec));
    return { ...view(accountId), created, displayName: verdict.firstName };
  });

  app.post('/app/api/account/logout', { bodyLimit: 64 }, async (req, reply) => {
    if (!guard(req, reply, true)) return reply;
    const session = sessionOf(req);
    if (session) get()!.revokeSession(session.token);
    reply.header('Set-Cookie', cookie('', 0));
    return { authenticated: false };
  });

  app.get('/app/api/account/consents', async (req, reply) => {
    if (!guard(req, reply, false)) return reply;
    const session = sessionOf(req); if (!session) return unauth(reply);
    return { consents: get()!.consents(session.accountId), purposes: CONSENT_PURPOSES, consentVersion: CONSENT_VERSION };
  });

  app.post('/app/api/account/consents', { bodyLimit: 256 }, async (req, reply) => {
    if (!guard(req, reply, true)) return reply;
    const session = sessionOf(req); if (!session) return unauth(reply);
    const b = req.body as { purpose?: unknown; granted?: unknown } | null;
    if (!b || typeof b !== 'object' || !hasOnly(b, ['purpose', 'granted']) || typeof b.granted !== 'boolean' || !(CONSENT_PURPOSES as readonly unknown[]).includes(b.purpose)) return reply.code(400).send({ error: 'bad_request' });
    const state = get()!.setConsent(session.accountId, b.purpose as ConsentPurpose, b.granted, Math.floor(now() / 1000));
    return { purpose: b.purpose, ...state };
  });

  const prefsAllowed = (accountId: string) => get()!.consents(accountId).sync_preferences?.status === 'granted';

  app.get('/app/api/account/preferences', async (req, reply) => {
    if (!guard(req, reply, false)) return reply;
    const session = sessionOf(req); if (!session) return unauth(reply);
    if (!prefsAllowed(session.accountId)) return reply.code(403).send({ error: 'consent_required', purpose: 'sync_preferences' });
    return get()!.getPreferences(session.accountId);
  });

  app.post('/app/api/account/preferences', { bodyLimit: 1024 }, async (req, reply) => {
    if (!guard(req, reply, true)) return reply;
    const session = sessionOf(req); if (!session) return unauth(reply);
    if (!prefsAllowed(session.accountId)) return reply.code(403).send({ error: 'consent_required', purpose: 'sync_preferences' });
    const b = req.body as { expectedVersion?: unknown; values?: unknown } | null;
    if (!b || typeof b !== 'object' || !hasOnly(b, ['expectedVersion', 'values']) || typeof b.expectedVersion !== 'number' || !Number.isInteger(b.expectedVersion) || b.expectedVersion < 0) return reply.code(400).send({ error: 'bad_request', field: 'expectedVersion' });
    const v = validatePreferences(b.values);
    if (!v.ok) return reply.code(400).send({ error: 'bad_request', field: v.field });
    const result = get()!.putPreferences(session.accountId, b.expectedVersion, v.value, Math.floor(now() / 1000));
    return result.ok ? { version: result.version, values: v.value } : reply.code(409).send({ error: 'version_conflict', version: result.version });
  });

  app.post('/app/api/account/export', { bodyLimit: 64 }, async (req, reply) => {
    if (!guard(req, reply, true)) return reply;
    const session = sessionOf(req); if (!session) return unauth(reply);
    return get()!.exportAll(session.accountId, Math.floor(now() / 1000));
  });

  app.post('/app/api/account/delete', { bodyLimit: 128 }, async (req, reply) => {
    if (!guard(req, reply, true)) return reply;
    const session = sessionOf(req); if (!session) return unauth(reply);
    const b = req.body as { confirm?: unknown } | null;
    if (!b || typeof b !== 'object' || !hasOnly(b, ['confirm']) || b.confirm !== 'DELETE') return reply.code(400).send({ error: 'bad_request', field: 'confirm' });
    get()!.deleteAccount(session.accountId);        // cascades to identities, sessions, consents and preferences
    reply.header('Set-Cookie', cookie('', 0));
    return { deleted: true };
  });
}
