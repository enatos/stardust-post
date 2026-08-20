/**
 * sw.js - Service Worker for Stardust Post
 * Caches app shell resources for reliable offline loading.
 * Never caches external API calls (e.g. Google Apps Script endpoints).
 */

const CACHE_NAME = 'stardust-post-v1.2.1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/ulid.js',
  './js/db.js',
  './js/api.js',
  './js/sync.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Never intercept or cache non-GET requests (e.g. POST to GAS)
  if (event.request.method !== 'GET') {
    return;
  }

  // 2. Never cache external requests (e.g. script.google.com)
  if (url.origin !== self.location.origin) {
    return;
  }

  // 3. Stale-While-Revalidate for app shell
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          // Network failed, fallback to cache if available
          return cachedResponse;
        });

        return cachedResponse || fetchPromise;
      });
    })
  );
});
