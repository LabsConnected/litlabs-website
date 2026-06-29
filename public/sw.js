/**
 * LiTTree Lab Studios - Service Worker v6
 * Stale-while-revalidate for static assets.
 * Navigation requests pass through so Lighthouse traces work.
 */

const CACHE_NAME = "litlabs-v7";
const STATIC_ASSETS = ["/manifest.json", "/logo.webp", "/logo-sm.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // Never cache in dev (localhost/127.0.0.1)
  if (self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1") return;

  if (event.request.mode === "navigate") return;

  const url = event.request.url;
  if (url.includes("/api/")) return;
  if (!url.startsWith(self.location.origin)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);

      try {
        const response = await fetch(event.request);
        if (response.ok && response.type === "basic") {
          cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        return cached || new Response("Offline", { status: 503 });
      }
    })(),
  );
});

// Push notifications
self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || "LiTTree Lab Studios", {
      body: data.body || "New notification from LiTTree Lab",
      icon: "/logo.webp",
      badge: "/logo.webp",
      tag: data.tag || "default",
      requireInteraction: data.requireInteraction || false,
      actions: data.actions || [],
      data: data.data || {},
    }),
  );
});

// Notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === urlToOpen && "focus" in client)
            return client.focus();
        }
        if (clients.openWindow) return clients.openWindow(urlToOpen);
      }),
  );
});

// Background sync
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-forms") {
    event.waitUntil(Promise.resolve());
  }
});
