import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import webpush, { type PushSubscription } from 'web-push';
import { makePinnedLookup, publicPushAddresses, validatePushEndpoint } from './security.js';

interface Vapid { subject: string; publicKey: string; privateKey: string }
interface Outgoing { hostname: string; path: string; headers: Record<string, string | number>; body: Buffer; lookup: ReturnType<typeof makePinnedLookup> }
interface Dependencies { lookup: (host: string) => Promise<{address: string; family: number}[]>; send: (request: Outgoing) => Promise<number> }

async function boundedLookup(host: string, lookup: Dependencies['lookup']): Promise<{address: string; family: number}[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([lookup(host), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('unsafe_dns')), 3000); })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function send(request: Outgoing): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { req.destroy(new Error('push_timeout')); }, 5000);
    const req = httpsRequest({ hostname: request.hostname, path: request.path, method: 'POST', headers: request.headers,
      lookup: request.lookup as any, agent: false, timeout: 5000 }, res => {
      // Discard response bodies; no redirects are followed and no server body/endpoint is logged.
      res.resume(); res.on('end', () => { clearTimeout(timer); resolve(res.statusCode ?? 0); });
      res.on('error', () => { clearTimeout(timer); reject(new Error('push_unavailable')); });
      res.on('aborted', () => { clearTimeout(timer); reject(new Error('push_unavailable')); });
    });
    req.on('timeout', () => req.destroy(new Error('push_timeout')));
    req.on('error', () => { clearTimeout(timer); reject(new Error('push_unavailable')); });
    req.end(request.body);
  });
}

/** Send only a fixed, encrypted, generic notification; caller decides when this one attempt is due. */
export async function sendReminder(subscription: PushSubscription, vapid: Vapid, dependencies: Partial<Dependencies> = {}): Promise<number> {
  const url = validatePushEndpoint(subscription.endpoint);
  const addresses = publicPushAddresses(await boundedLookup(url.hostname, dependencies.lookup ?? (host => dnsLookup(host, { all: true, verbatim: true }))));
  const payload = JSON.stringify({ title: 'بِسراه', body: 'یادآوری سفر تخمینی مترو؛ برای جزئیات برنامه را باز کنید.' });
  const details = webpush.generateRequestDetails(subscription, payload, { TTL: 60, urgency: 'normal', contentEncoding: 'aes128gcm', vapidDetails: vapid });
  if (details.endpoint !== subscription.endpoint || !details.body) throw new Error('invalid_endpoint');
  return (dependencies.send ?? send)({ hostname: url.hostname, path: url.pathname + url.search,
    headers: details.headers, body: details.body, lookup: makePinnedLookup(url.hostname, addresses) });
}
