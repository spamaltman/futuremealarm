// Service worker: offline shell + notification click-through.
// The hard real-time guarantee is the bedside device; this layer just makes
// the web app installable, offline-capable, and lets a fired notification
// reopen the app straight into the firing screen.

const CACHE = 'futureme-v1';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/recorder.js',
  './js/timeparse.js',
  './js/alarms.js',
  './js/device.js',
  './js/store.js',
  './js/insights.js',
  './manifest.webmanifest',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow('./');
    })
  );
});
