/**
 * LiTTree Lab Studios - Service Worker
 * Self-destructing: clears all caches and unregisters itself.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.map((n) => caches.delete(n))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // Pass through all requests; never cache
  event.respondWith(fetch(event.request));
});
