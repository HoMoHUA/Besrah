// Besrah service worker (one worker for the whole app scope).
// 1. Offline app shell: same-origin static files (HTML, CSS, JS, fonts, icons, static JSON assets) are fetched from the
//    network first and the cache is refreshed on every success, so the app always follows the live site; the cached copy
//    is used only when the network fails, or takes longer than 4 s while a cached copy exists. API calls (/api/, /app/api/) are NEVER cached or intercepted:
//    timetable estimates, prices, accounts and locations always come from the server or show their own offline state.
// 2. Push: the metro reminder notification (generic text only, no journey data).
const VERSION = 'besrah-shell-v1';
// Everything the first screen needs to start without a network: the page, its styles and scripts, EVERY module
// app.js imports (a single missing module stops the whole app at the preloader), fonts and the small static assets.
// Left out on purpose: the 6 MB food catalogue and the 512px icon (fetched when needed and cached on success).
// asset-allowlist.test.mjs fails if a module reachable from app.js is missing here.
const SHELL = ['./', 'offline.html', 'offline.css', 'manifest.webmanifest', 'theme-boot.js', 'reminders.js',
  'assets/telegram-web-app.js', 'vendor/hm7/tokens.css', 'skin.css', 'vendor/hm7/components/bundle.css', 'app.css',
  'vendor/hm7/components/bundle.js',
  'app.js', 'navigation.js', 'service-store.js', 'state.js', 'tg.js', 'logic.js', 'search.js', 'ask.js', 'store.js', 'async.js',
  'api.js', 'format.js', 'route.js', 'hero.js', 'services.js', 'journey.js', 'bus-data.js', 'bus-paths.js', 'bus-sources.js',
  'ui/dom.js', 'ui/hm7.js', 'ui/searchbox.js', 'ui/sheet.js', 'ui/board.js', 'ui/planner.js', 'ui/station.js',
  'ui/carousel.js', 'ui/service-search.js', 'ui/segmented.js', 'ui/service-card.js', 'ui/ride-tabs.js', 'ui/tracker.js',
  'ui/rotating-placeholder.js', 'ui/map-picker.js', 'ui/snapp-link.js', 'snapp-search.js', 'snapp-device.js', 'snapppay.js', 'ui/snapppay-link.js', 'ui/snapppay-cards.js',
  'views/home.js', 'views/stations.js', 'views/services.js', 'views/favourites.js', 'views/about.js', 'views/metro.js',
  'views/bus.js', 'views/food.js', 'views/trip.js', 'views/shop.js', 'views/profile.js', 'views/settings.js',
  'views/saved.js',
  'vendor/hm7/fonts/AzarMehr-Regular.woff2', 'vendor/hm7/fonts/AzarMehr-Medium.woff2',
  'vendor/hm7/fonts/AzarMehr-SemiBold.woff2', 'vendor/hm7/fonts/AzarMehr-Bold.woff2',
  'vendor/hm7/fonts/AzarMehr-ExtraBold.woff2', 'vendor/hm7/fonts/AzarMehr-Black.woff2', 'vendor/hm7/fonts/HMSymbol.woff2',
  'vendor/hm7/fonts/JetBrainsMono-Regular.woff2', 'vendor/hm7/fonts/JetBrainsMono-Bold.woff2',
  'assets/logo.svg', 'assets/icon-192.png', 'assets/hero-brand.svg', 'assets/hero-metro.svg', 'assets/bus-guide.json',
  'assets/services/besrah.svg', 'assets/services/food.svg', 'assets/services/pay.svg', 'assets/services/rail.svg',
  'assets/services/caravan.svg', 'assets/services/rahyab.svg', 'assets/services/savar.svg'];
const NETWORK_TIMEOUT_MS = 4000;

const isApi = url => /\/(app\/)?api\//.test(url.pathname);
const cacheable = (request, url) => request.method === 'GET' && url.origin === self.location.origin && !isApi(url)
  && !url.search.includes('nocache');

self.addEventListener('install', event => {
  // Best effort: one missing file must not block the worker.
  event.waitUntil(caches.open(VERSION).then(cache => Promise.all(SHELL.map(path => cache.add(path).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('besrah-shell-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The 4 s limit only applies when there is a cached copy to fall back on. Without one, a slow network is still the only
// way to get the file, so we keep waiting for it instead of failing (a 503 for a module would break the app online).
async function networkFirst(request, isNavigation) {
  const cache = await caches.open(VERSION);
  const key = isNavigation ? './' : request;
  const network = fetch(request).then(response => {
    if (response && response.ok && response.type === 'basic') cache.put(key, response.clone()).catch(() => {});
    return response;
  });
  network.catch(() => {});   // a late failure after the cached copy was served is not an error
  const cached = await cache.match(key, { ignoreSearch: isNavigation });
  try {
    if (!cached) return await network;
    let timer;
    const slow = new Promise(resolve => { timer = setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS); });
    const fresh = await Promise.race([network, slow]).finally(() => clearTimeout(timer));
    return fresh ?? cached;
  } catch {
    if (cached) return cached;
    if (isNavigation) { const page = await cache.match('offline.html'); if (page) return page; }
    return new Response('', { status: 503, statusText: 'offline' });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (!cacheable(request, url)) return;            // API, other origins and non-GET go straight to the network
  event.respondWith(networkFirst(request, request.mode === 'navigate'));
});

self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('بِسراه', {
    body: 'یادآوری سفر تخمینی مترو؛ برای جزئیات برنامه را باز کنید.',
    icon: './assets/icon-192.png', tag: 'besrah-reminder', renotify: false,
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('./'));
});
