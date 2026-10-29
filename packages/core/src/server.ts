import Fastify from 'fastify';
import { createService } from './service.js';

export function buildServer(opts: { now?: () => number } = {}) {
  const svc = createService();
  const app = Fastify({ logger: false });
  const now = opts.now ?? (() => Date.now());

  app.get('/health', async () => ({ ok: true }));

  app.get<{ Querystring: { station?: string; at?: string; limit?: string } }>('/v1/next', async (req, reply) => {
    const station = (req.query.station ?? '').trim();
    if (!station) return reply.code(400).send({ error: 'station_required' });
    const at = req.query.at ? Math.floor(Date.parse(req.query.at) / 1000) : Math.floor(now() / 1000);
    if (!Number.isFinite(at)) return reply.code(400).send({ error: 'bad_at' });
    const limit = Math.min(10, Math.max(1, Number(req.query.limit ?? 4) || 4));
    try {
      return svc.next(station, at, limit);
    } catch (e: any) {
      return reply.code(404).send({ error: 'unknown_station', station });
    }
  });

  return app;
}
