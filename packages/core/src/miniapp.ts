import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { NETWORK_PATH } from './network.js';

const APP_ROOT = new URL('../../../apps/miniapp/', import.meta.url);

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  woff2: 'font/woff2',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
};

/** Explicit allowlist: [public route under /app/, file relative to apps/miniapp]. Nothing else is ever served. */
export const MINIAPP_ASSETS: ReadonlyArray<readonly [route: string, file: string]> = [
  ['/app/', 'index.html'],
  ['/app/manifest.webmanifest', 'manifest.webmanifest'],
  ['/app/reminder-sw.js', 'reminder-sw.js'],
  ['/app/reminders.js', 'reminders.js'],
  ['/app/theme-boot.js', 'theme-boot.js'],
  ['/app/skin.css', 'skin.css'],
  ['/app/app.css', 'app.css'],
  ['/app/app.js', 'app.js'],
  ['/app/navigation.js', 'navigation.js'],
  ['/app/service-store.js', 'service-store.js'],
  ['/app/ui/service-search.js', 'ui/service-search.js'],
  ['/app/ui/segmented.js', 'ui/segmented.js'],
  ['/app/ui/service-card.js', 'ui/service-card.js'],
  ['/app/views/metro.js', 'views/metro.js'],
  ['/app/views/bus.js', 'views/bus.js'],
  ['/app/views/food.js', 'views/food.js'],
  ['/app/views/trip.js', 'views/trip.js'],
  ['/app/views/shop.js', 'views/shop.js'],
  ['/app/views/profile.js', 'views/profile.js'],
  ['/app/bus-data.js', 'bus-data.js'],
  ['/app/bus-paths.js', 'bus-paths.js'],
  ['/app/bus-sources.js', 'bus-sources.js'],
  ['/app/ui/ride-tabs.js', 'ui/ride-tabs.js'],
  ['/app/ui/tracker.js', 'ui/tracker.js'],
  ['/app/ui/rotating-placeholder.js', 'ui/rotating-placeholder.js'],
  ['/app/assets/bus-guide.json', 'assets/bus-guide.json'],
  ['/app/assets/food-catalog.json', 'assets/food-catalog.json'],
  ['/app/assets/services/besrah.svg', 'assets/services/besrah.svg'],
  ['/app/assets/services/food.svg', 'assets/services/food.svg'],
  ['/app/assets/services/pay.svg', 'assets/services/pay.svg'],
  ['/app/views/settings.js', 'views/settings.js'],
  ['/app/views/saved.js', 'views/saved.js'],
  ['/app/assets/services/rail.svg', 'assets/services/rail.svg'],
  ['/app/assets/services/caravan.svg', 'assets/services/caravan.svg'],
  ['/app/assets/services/rahyab.svg', 'assets/services/rahyab.svg'],
  ['/app/assets/services/savar.svg', 'assets/services/savar.svg'],
  ['/app/assets/hero-brand.svg', 'assets/hero-brand.svg'],
  ['/app/state.js', 'state.js'],
  ['/app/tg.js', 'tg.js'],
  ['/app/logic.js', 'logic.js'],
  ['/app/search.js', 'search.js'],
  ['/app/store.js', 'store.js'],
  ['/app/async.js', 'async.js'],
  ['/app/api.js', 'api.js'],
  ['/app/format.js', 'format.js'],
  ['/app/route.js', 'route.js'],
  ['/app/hero.js', 'hero.js'],
  ['/app/services.js', 'services.js'],
  ['/app/ui/dom.js', 'ui/dom.js'],
  ['/app/ui/hm7.js', 'ui/hm7.js'],
  ['/app/ui/searchbox.js', 'ui/searchbox.js'],
  ['/app/ui/sheet.js', 'ui/sheet.js'],
  ['/app/ui/board.js', 'ui/board.js'],
  ['/app/journey.js', 'journey.js'],
  ['/app/ui/planner.js', 'ui/planner.js'],
  ['/app/ui/station.js', 'ui/station.js'],
  ['/app/ui/carousel.js', 'ui/carousel.js'],
  ['/app/views/home.js', 'views/home.js'],
  ['/app/views/stations.js', 'views/stations.js'],
  ['/app/views/services.js', 'views/services.js'],
  ['/app/views/favourites.js', 'views/favourites.js'],
  ['/app/views/about.js', 'views/about.js'],
  ['/app/assets/logo.svg', 'assets/logo.svg'],
  ['/app/assets/hero-metro.svg', 'assets/hero-metro.svg'],
  ['/app/assets/icon-192.png', 'assets/icon-192.png'],
  ['/app/assets/icon-512.png', 'assets/icon-512.png'],
  ['/app/assets/telegram-web-app.js', 'assets/telegram-web-app.js'],
  ['/app/vendor/hm7/tokens.css', 'vendor/hm7/tokens.css'],
  ['/app/vendor/hm7/components/bundle.css', 'vendor/hm7/components/bundle.css'],
  ['/app/vendor/hm7/components/bundle.js', 'vendor/hm7/components/bundle.js'],
  ['/app/vendor/hm7/fonts/AzarMehr-Regular.woff2', 'vendor/hm7/fonts/AzarMehr-Regular.woff2'],
  ['/app/vendor/hm7/fonts/AzarMehr-Medium.woff2', 'vendor/hm7/fonts/AzarMehr-Medium.woff2'],
  ['/app/vendor/hm7/fonts/AzarMehr-SemiBold.woff2', 'vendor/hm7/fonts/AzarMehr-SemiBold.woff2'],
  ['/app/vendor/hm7/fonts/AzarMehr-Bold.woff2', 'vendor/hm7/fonts/AzarMehr-Bold.woff2'],
  ['/app/vendor/hm7/fonts/AzarMehr-ExtraBold.woff2', 'vendor/hm7/fonts/AzarMehr-ExtraBold.woff2'],
  ['/app/vendor/hm7/fonts/AzarMehr-Black.woff2', 'vendor/hm7/fonts/AzarMehr-Black.woff2'],
  ['/app/vendor/hm7/fonts/HMSymbol.woff2', 'vendor/hm7/fonts/HMSymbol.woff2'],
  ['/app/vendor/hm7/fonts/JetBrainsMono-Regular.woff2', 'vendor/hm7/fonts/JetBrainsMono-Regular.woff2'],
  ['/app/vendor/hm7/fonts/JetBrainsMono-Bold.woff2', 'vendor/hm7/fonts/JetBrainsMono-Bold.woff2'],
];

// img-src allows data: for one measured reason: the vendored HM7 runtime builds its dissolve / sweep masks at run
// time (canvas.toDataURL -> CSS mask-image: url(data:...)), e.g. when a toast dissolves. Nothing else is relaxed:
// scripts and styles stay 'self' only (no 'unsafe-inline', no 'unsafe-eval').
export const MINIAPP_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org";

interface Loaded { body: Buffer; etag: string; mtimeMs: number; size: number }
const cache = new Map<string, Loaded>();

// Files are re-read when their mtime/size changes, so a deploy never needs a restart; the hash is the ETag.
function load(file: string): Loaded {
  const url = new URL(file, APP_ROOT);
  const stat = statSync(url);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit;
  const body = readFileSync(url);
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
  const loaded = { body, etag, mtimeMs: stat.mtimeMs, size: stat.size };
  cache.set(file, loaded);
  return loaded;
}

function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some(tag => tag.trim().replace(/^W\//, '') === etag);
}

function serve(file: string, mime: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    let loaded: Loaded;
    try { loaded = load(file); } catch { return reply.code(404).send({ error: 'asset_not_found' }); }
    reply.header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-cache').header('ETag', loaded.etag);
    if (file === 'index.html') {
      reply.header('Content-Security-Policy', MINIAPP_CSP).header('Referrer-Policy', 'no-referrer').header('Permissions-Policy', 'geolocation=(self)');
    }
    if (matches(req.headers['if-none-match'], loaded.etag)) return reply.code(304).send();
    return reply.type(mime).send(loaded.body);
  };
}

export function registerMiniapp(app: FastifyInstance) {
  app.get('/app', async (_req, reply) => reply.redirect('/app/'));
  for (const [route, file] of MINIAPP_ASSETS) {
    const mime = MIME[file.split('.').pop() as string];
    if (!mime) throw new Error(`no MIME type for ${file}`);
    app.get(route, serve(file, mime));
  }
  const raw = JSON.parse(readFileSync(NETWORK_PATH, 'utf8'));
  app.get('/app/api/stations', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    return {
      stations: raw.stations,
      line1Order: raw.lines['1'].order_vakilabad_to_airport,
      line2Order: raw.lines['2'].order_tabarsi_to_fakouri,
      supportedLines: [1, 2],
      maxNearestKm: 10,
    };
  });
}
