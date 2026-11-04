// Push only: no fetch handler, no offline cache, and no journey data in notifications.
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
