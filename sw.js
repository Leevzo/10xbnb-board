const CACHE = 'board-1';
const FILES = [
  './',
  './index.html',
  './app.js',
  './logic.js',
  './style.css',
  './config.js',
  './manifest.json',
  './vendor/supabase.js',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './fonts/dogica.ttf',
  './fonts/w95fa.otf',
  './fonts/joystix.otf',
  './fonts/pixelta.ttf',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data === 'reload') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(event.request);
      if (fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(event.request, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      throw new Error('offline');
    }
  })());
});
