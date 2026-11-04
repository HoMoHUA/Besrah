import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/** Fixed-window counter. Fails closed when the key table is flooded; no key is ever persisted. */
export function createWindowLimiter(max: number, windowMs: number, clock: () => number = Date.now, maxKeys = 5000) {
  let start = 0;
  const counts = new Map<string, number>();
  return {
    allow(key: string): boolean {
      const t = clock();
      if (t - start >= windowMs) { start = t; counts.clear(); }
      const used = counts.get(key) ?? 0;
      if (used >= max) return false;
      if (used === 0 && counts.size >= maxKeys) return false;
      counts.set(key, used + 1);
      return true;
    },
  };
}

export function createGate(max: number) {
  let active = 0;
  return {
    tryEnter(): boolean { if (active >= max) return false; active++; return true; },
    leave(): void { active = Math.max(0, active - 1); },
    get active(): number { return active; },
  };
}

const salt = randomBytes(16);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * In-memory, per-process pseudonymous client key for rate limiting only. X-Real-IP is honoured exclusively from
 * loopback (the nginx edge). The key is a salted hash; neither the key nor the address is ever written to disk.
 */
export function clientKey(req: FastifyRequest): string {
  const remote = req.socket.remoteAddress ?? 'unknown';
  const forwarded = LOOPBACK.has(remote) ? String(req.headers['x-real-ip'] ?? '') : '';
  const raw = /^[0-9a-fA-F:.]{3,45}$/.test(forwarded) ? forwarded : remote;
  return createHash('sha256').update(salt).update(raw).digest('base64url').slice(0, 16);
}
