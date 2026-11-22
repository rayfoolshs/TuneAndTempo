/* Offline cache. Bump VERSION to ship an update. */

const VERSION = 'tune-tempo-v5';

const ASSETS = [
  './',
  './index.html',
  './styles/app.css',
  './manifest.json',
  './js/main.js',
  './js/state.js',
  './js/audio.js',
  './js/pitch.js',
  './js/tuner.js',
  './js/tuner-data.js',
  './js/metronome.js',
  './js/grooves.js',
  './js/chords.js',
  './js/chord-data.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || caches.match('./index.html'));

      /* Cache first for instant offline starts, refreshed in the
         background so the next launch picks up a new release. */
      return cached || network;
    })
  );
});
