import Fastify from 'fastify';
import { registerMiniapp } from './miniapp.js';
import { createService } from './service.js';

export function buildServer(opts: { now?: () => number } = {}) {
  const svc = createService();
  const app = Fastify({ logger: false });
  const now = opts.now ?? (() => Date.now());

  app.get('/health', async () => ({ ok: true }));

  app.get<{ Querystring: { station?: string; at?: string; limit?: string; line?: string } }>('/v1/next', nextHandler);
  app.get<{ Querystring: { station?: string; at?: string; limit?: string; line?: string } }>('/app/api/next', nextHandler);

  async function nextHandler(req: import('fastify').FastifyRequest<{ Querystring: { station?: string; at?: string; limit?: string; line?: string } }>, reply: import('fastify').FastifyReply) {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    const station = (req.query.station ?? '').trim();
    if (!station) return reply.code(400).send({ error: 'station_required' });
    const at = req.query.at ? Math.floor(Date.parse(req.query.at) / 1000) : Math.floor(now() / 1000);
    if (!Number.isFinite(at)) return reply.code(400).send({ error: 'bad_at' });
    const limit = Math.min(10, Math.max(1, Number(req.query.limit ?? 4) || 4));
    let line: 1 | 2 | undefined;
    if (req.query.line !== undefined) {
      if (req.query.line !== '1' && req.query.line !== '2') return reply.code(400).send({ error: 'bad_line' });
      line = Number(req.query.line) as 1 | 2;
    }
    try {
      return svc.next(station, at, limit, line);
    } catch (e: any) {
      return reply.code(404).send({ error: 'unknown_station', station });
    }
  }

  registerMiniapp(app);
  return app;
}
