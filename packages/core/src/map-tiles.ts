import type { FastifyInstance } from 'fastify';
import { open, readFile, stat } from 'node:fs/promises';

const DEFAULT_ROOT = new URL('../../../data/map/', import.meta.url);
const ZOOMS = new Set([7, 10, 13]);

export function registerMapTiles(app: FastifyInstance, root = DEFAULT_ROOT) {
  const indexFile = new URL('tiles-v1.idx.json', root);
  const archive = new URL('tiles-v1.bin', root);
  let index: { version: string; tiles: Record<string, [number, number]> } | undefined;

  app.get<{ Params: { z: string; x: string; y: string } }>('/app/api/map/tiles/:z/:x/:y', async (req, reply) => {
    const path = [req.params.z, req.params.x, req.params.y];
    const [z, x, y] = path.map(Number);
    if (path.some(p => !/^(0|[1-9][0-9]{0,3})$/.test(p)) || !ZOOMS.has(z) || x >= 2 ** z || y >= 2 ** z) {
      return reply.code(404).send({ error: 'tile_not_found' });
    }

    try {
      const info = await stat(indexFile);
      const version = `${info.ino}-${info.mtimeMs}-${info.size}`;
      if (index?.version !== version) {
        index = { version, tiles: JSON.parse(await readFile(indexFile, 'utf8')) };
      }
      const file = await open(archive, 'r');
      try {
        const entry = index.tiles[path.join('/')];
        if (!entry) {
          reply.header('Cache-Control', 'public, max-age=300');
          return reply.code(204).send();
        }
        const [offset, size] = entry;
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 1 || size > 2 * 1024 * 1024) {
          throw new Error('invalid tile index');
        }
        const body = Buffer.alloc(size);
        const { bytesRead } = await file.read(body, 0, size, offset);
        if (bytesRead !== size || body[0] !== 0x1f || body[1] !== 0x8b) throw new Error('invalid tile archive');
        return reply.header('Cache-Control', 'public, max-age=3600').header('Content-Encoding', 'gzip')
          .header('X-Content-Type-Options', 'nosniff').type('application/json').send(body);
      } finally {
        await file.close();
      }
    } catch {
      return reply.header('Cache-Control', 'no-store').code(503).send({ error: 'map_unavailable' });
    }
  });
}
