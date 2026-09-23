/*
 * LifeOS service worker — an offline page, and nothing else.
 *
 * Only navigations are handled: when the network fails, the offline page is
 * shown instead of the browser's error. No page, API response or note is ever
 * cached: a second brain is private, and a cache on a shared device would
 * keep it there. Everything else goes straight to the network, untouched.
 */

const CACHE = "lifeos-offline-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
