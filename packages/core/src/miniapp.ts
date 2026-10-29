import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { NETWORK_PATH } from './network.js';

export function registerMiniapp(app: FastifyInstance) {
  app.get('/app', async (_req, reply) => reply.redirect('/app/'));
  const files: Record<string, [string, string]> = {
    '/app/': ['index.html', 'text/html; charset=utf-8'],
    '/app/styles.css': ['styles.css', 'text/css; charset=utf-8'],
    '/app/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/app/logic.js': ['logic.js', 'text/javascript; charset=utf-8'],
    '/app/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
    '/app/assets/logo.svg': ['assets/logo.svg', 'image/svg+xml'],
    '/app/assets/icon-192.png': ['assets/icon-192.png', 'image/png'],
    '/app/assets/icon-512.png': ['assets/icon-512.png', 'image/png'],
    '/app/assets/Vazirmatn-Regular.ttf': ['assets/Vazirmatn-Regular.ttf', 'font/ttf'],
    '/app/assets/telegram-web-app.js': ['assets/telegram-web-app.js', 'text/javascript; charset=utf-8'],
  };
  for (const [route, [file, mime]] of Object.entries(files)) {
    app.get(route, async (_req, reply) => {
      reply.header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-cache');
      if (file === 'index.html') reply.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org").header('Referrer-Policy', 'no-referrer').header('Permissions-Policy', 'geolocation=(self)');
      try { return reply.type(mime).send(readFileSync(new URL('../../../apps/miniapp/' + file, import.meta.url))); }
      catch { return reply.code(404).send({ error: 'asset_not_found' }); }
    });
  }
  const raw = JSON.parse(readFileSync(NETWORK_PATH, 'utf8'));
  app.get('/app/api/stations', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    return { stations: raw.stations, line1Order: raw.lines['1'].order_vakilabad_to_airport, supportedLines: [1], maxNearestKm: 10 };
  });
}
