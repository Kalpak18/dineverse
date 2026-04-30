import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// Workbox injects the precache manifest here at build time
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Network-first for navigation (always get latest HTML)
registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({ cacheName: 'pages' })
);

// Cache-first for hashed assets
registerRoute(
  ({ url }) => /\/assets\/.+\.(js|css|woff2?)$/.test(url.pathname),
  new CacheFirst({
    cacheName: 'assets',
    plugins: [new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 365 })],
  })
);

registerRoute(
  ({ url }) => /\/icons\/.+\.(png|ico|svg)$/.test(url.pathname),
  new CacheFirst({
    cacheName: 'icons',
    plugins: [new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 30 })],
  })
);

// ─── Web Push ────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'DineVerse', body: event.data.text() }; }

  const title   = data.title || 'DineVerse';
  const options = {
    body:    data.body || '',
    icon:    '/icons/icon-192x192.png',
    badge:   '/icons/icon-72x72.png',
    data:    { url: data.url || '/owner/orders' },
    vibrate: [200, 100, 200],
    tag:     data.tag || 'dineverse-notification',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/owner/orders';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});

// Activate immediately
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
