// Besrah service worker (one worker for the whole app scope).
// 1. Offline app shell: same-origin static files (HTML, CSS, JS, fonts, icons, static JSON assets) are fetched from the
//    network first and the cache is refreshed on every success, so the app always follows the live site; only when the
//    network fails or is too slow is the cached copy used. API calls (/api/, /app/api/) are NEVER cached or intercepted:
//    timetable estimates, prices, accounts and locations always come from the server or show their own offline state.
// 2. Push: the metro reminder notification (generic text only, no journey data).
const VERSION = 'besrah-shell-v1';
const SHELL = ['./', 'offline.html', 'offline.css', 'app.css', 'skin.css', 'app.js', 'theme-boot.js', 'vendor/hm7/tokens.css',
  'vendor/hm7/components/bundle.css', 'vendor/hm7/components/bundle.js', 'vendor/hm7/fonts/AzarMehr-Regular.woff2',
  'vendor/hm7/fonts/HMSymbol.woff2', 'assets/logo.svg', 'assets/icon-192.png', 'manifest.webmanifest'];
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

function fromNetwork(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS);
    fetch(request).then(response => { clearTimeout(timer); resolve(response); }, error => { clearTimeout(timer); reject(error); });
  });
}

async function networkFirst(request, isNavigation) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fromNetwork(request);
    if (response && response.ok && response.type === 'basic') cache.put(isNavigation ? './' : request, response.clone()).catch(() => {});
    return response;
  } catch {
    const cached = await cache.match(isNavigation ? './' : request, { ignoreSearch: isNavigation });
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
