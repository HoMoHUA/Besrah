import { createECDH, ECDH, createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PushSubscription } from 'web-push';
import type { JourneyBetaHandle } from '../journey-beta/index.js';
import { clientKey, createGate, createWindowLimiter } from '../journey-beta/limits.js';
import { validatePushEndpoint } from './security.js';
import { sendReminder } from './send.js';
import { openReminderStore } from './store.js';

interface Config { publicKey: string; privateKey: string; subject: string; db: string; origins: string[] }
interface Options { now: () => number; metro: JourneyBetaHandle; config?: Config | null; send?: typeof sendReminder; startTimer?: boolean }
function configFromEnv(): Config | null {
  const { BESRAH_WEBPUSH_PUBLIC_KEY: publicKey, BESRAH_WEBPUSH_PRIVATE_KEY: privateKey, BESRAH_WEBPUSH_SUBJECT: subject, BESRAH_WEBPUSH_DB: db, BESRAH_ALLOWED_ORIGINS: origins } = process.env;
  if (!publicKey || !privateKey || !subject || !db || !db.startsWith('/') || !origins) return null;
  return { publicKey, privateKey, subject, db, origins: origins.split(',').map(x => x.trim()) };
}
function usable(c: Config | null): c is Config {
  if (!c || !/^mailto:[^\s@]+@[^\s@]+$/.test(c.subject) || !c.origins.length || c.origins.some(x => { try { return new URL(x).origin !== x || !x.startsWith('https://'); } catch { return true; } })) return false;
  if (!/^[A-Za-z0-9_-]{43}$/.test(c.privateKey) || Buffer.from(c.privateKey, 'base64url').toString('base64url') !== c.privateKey || !/^[A-Za-z0-9_-]{87}$/.test(c.publicKey)) return false;
  try { const e = createECDH('prime256v1'); e.setPrivateKey(Buffer.from(c.privateKey, 'base64url')); return e.getPublicKey().toString('base64url') === c.publicKey; } catch { return false; }
}
function validSubscription(value: any): value is PushSubscription {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(x => !['endpoint','keys','expirationTime'].includes(x))) return false;
    validatePushEndpoint(value.endpoint);
    if (!value.keys || Object.keys(value.keys).some(x => !['p256dh','auth'].includes(x))) return false;
    const p = value.keys.p256dh, a = value.keys.auth;
    if (typeof p !== 'string' || typeof a !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(p) || !/^[A-Za-z0-9_-]{22}$/.test(a)) return false;
    const key = Buffer.from(p, 'base64url');
    if (key.length !== 65 || key[0] !== 4 || Buffer.from(a, 'base64url').length !== 16) return false;
    ECDH.convertKey(key, 'prime256v1');
    return true;
  } catch { return false; }
}
export function registerWebPush(app: FastifyInstance, options: Options) {
  const config = options.config === undefined ? configFromEnv() : options.config;
  const enabled = usable(config);
  let store: ReturnType<typeof openReminderStore> | null = null;
  if (enabled) { try { store = openReminderStore(config.db); } catch { store = null; } }
  const active = store && enabled ? { store, config } : null;
  const createGlobal = createWindowLimiter(60, 60_000), createClients = createWindowLimiter(6, 60_000);
  const deleteGlobal = createWindowLimiter(60, 60_000), deleteClients = createWindowLimiter(6, 60_000), gate = createGate(2);
  let closed = false, running = false;
  const pending = new Map<string, Set<Promise<void>>>();
  const cancelling = new Set<string>();
  const noStore = (reply: FastifyReply) => reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    noStore(reply);
    if (!active || closed) return reply.code(404).send({error:'not_found'});
    if (!req.headers.origin || !active.config.origins.includes(req.headers.origin) || req.headers['sec-fetch-site'] === 'cross-site' || req.headers['x-besrah-reminder'] !== '1') return reply.code(403).send({error:'forbidden'});
    const deleting = req.url.split('?')[0] === '/app/api/reminders/delete';
    const clients = deleting ? deleteClients : createClients, global = deleting ? deleteGlobal : createGlobal;
    if (!clients.allow(clientKey(req)) || !global.allow('all')) return reply.code(429).send({error:'rate_limited'});
  };
  app.get('/app/api/reminders/config', async (_req, reply) => { noStore(reply); if (!active || closed) return reply.code(404).send({error:'not_found'}); return {publicKey:active.config.publicKey}; });
  app.post('/app/api/reminders', {bodyLimit:4096, onRequest:guard}, async (req, reply) => {
    if (!active) return reply.code(404).send({error:'not_found'});
    const b = req.body as any, now = Math.floor(options.now()/1000);
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['cancelToken','subscription','line','from','to','eventId','departEpoch'].includes(k)) || typeof b.cancelToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(b.cancelToken) || Buffer.from(b.cancelToken, 'base64url').toString('base64url') !== b.cancelToken || !validSubscription(b.subscription) || ![1,2].includes(b.line) || typeof b.from !== 'string' || typeof b.to !== 'string' || b.from.length > 64 || b.to.length > 64 || typeof b.eventId !== 'string' || b.eventId.length > 256 || !Number.isInteger(b.departEpoch) || (b.subscription.expirationTime != null && (!Number.isFinite(b.subscription.expirationTime) || b.subscription.expirationTime < (b.departEpoch - 240)*1000))) return reply.code(400).send({error:'invalid'});
    const subscription = JSON.stringify({endpoint:b.subscription.endpoint, keys:{p256dh:b.subscription.keys.p256dh, auth:b.subscription.keys.auth}, expirationTime:b.subscription.expirationTime ?? null});
    const requestHash = createHash('sha256').update(JSON.stringify([subscription,b.line,b.from,b.to,b.eventId,b.departEpoch])).digest('hex');
    const state = active.store.inspect(b.cancelToken, subscription, requestHash);
    if (state === 'replay') return reply.code(201).send({token:b.cancelToken, dueEpoch:b.departEpoch - 300});
    if (state === 'conflict') return reply.code(409).send({error:'conflict'});
    if (b.departEpoch < now + 360 || b.departEpoch > now + 7*86400) return reply.code(400).send({error:'invalid'});
    const tokenHash = createHash('sha256').update(b.cancelToken).digest('hex');
    if (cancelling.has(tokenHash)) return reply.code(409).send({error:'conflict'});
    if (!gate.tryEnter()) return reply.code(429).send({error:'busy'});
    let done!: () => void;
    const wait = new Promise<void>(resolve => { done = resolve; });
    const group = pending.get(tokenHash) ?? new Set<Promise<void>>();
    group.add(wait); pending.set(tokenHash, group);
    try {
      const result = await options.metro.planMetro(b.line, b.from, b.to, b.departEpoch - 1);
      if (!result.options.some(o => o.eventId === b.eventId && o.departEpoch === b.departEpoch)) return reply.code(400).send({error:'invalid_event'});
      const current = Math.floor(options.now()/1000);
      if (b.departEpoch - 300 < current + 60) return reply.code(400).send({error:'invalid'});
      active.store.put(b.cancelToken, subscription, b.departEpoch - 300, b.departEpoch - 240, requestHash, current);
      return reply.code(201).send({token:b.cancelToken, dueEpoch:b.departEpoch - 300});
    } catch (error) { if (error instanceof Error && error.message === 'conflict') return reply.code(409).send({error:'conflict'}); return reply.code(503).send({error:'unavailable'}); } finally { group.delete(wait); if (!group.size) pending.delete(tokenHash); done(); gate.leave(); }
  });
  app.post('/app/api/reminders/delete', {bodyLimit:512, onRequest:guard}, async (req, reply) => {
    if (!active) return reply.code(404).send({error:'not_found'});
    const b = req.body as any;
    if (!b || Object.keys(b).length !== 1 || typeof b.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(b.token)) return reply.code(400).send({error:'invalid'});
    const tokenHash = createHash('sha256').update(b.token).digest('hex');
    cancelling.add(tokenHash);
    try { await Promise.all(Array.from(pending.get(tokenHash) ?? [])); active.store.remove(b.token, Math.floor(options.now()/1000)); return {status:'deleted'}; }
    finally { cancelling.delete(tokenHash); }
  });
  const tick = async () => {
    if (!active || closed || running) return {attempted:0, missed:0};
    running = true;
    let attempted = 0, missed = 0, accepted = 0, rejected = 0, failed = 0;
    try {
      const worker = async () => {
        while (!closed) {
          const now = Math.floor(options.now()/1000);
          missed += Number(active.store.expire(now).changes);
          const row = active.store.claim(now);
          if (!row) return;
          attempted++;
          try { const status = await (options.send ?? sendReminder)(JSON.parse(row.subscription), active.config); if (status >= 200 && status < 300) accepted++; else rejected++; } catch { failed++; }
        }
      };
      await Promise.all(Array.from({length:10}, () => worker()));
      if (attempted || missed) { try { console.error('webpush_delivery', JSON.stringify({attempted, missed, accepted, rejected, failed})); } catch { /* logging must not break delivery */ } }
      return {attempted, missed};
    } finally { running = false; }
  };
  const timer = active && options.startTimer !== false ? setInterval(() => { void tick().catch(() => { closed = true; try { console.error('webpush_scheduler_failed'); } catch {} }); }, 1000) : null; timer?.unref();
  app.addHook('onClose', async () => { closed = true; if (timer) clearInterval(timer); while (running) await new Promise(resolve => setTimeout(resolve, 10)); active?.store.close(); });
  return { tick };
}
