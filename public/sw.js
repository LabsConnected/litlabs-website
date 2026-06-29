/**
 * LiTTree Lab Studios - Service Worker
 * Provides offline support and caching for PWA
 *
 * IMPORTANT: Bump CACHE_NAME on every landing-page / shell update so
 * returning visitors never see stale cached HTML.
 */

const CACHE_NAME = "litlabs-v4";

// Assets that are safe to cache aggressively.
const STATIC_ASSETS = ["/globals.css", "/manifest.json"];

const STATIC_EXTENSIONS =
  /\.(js|css|png|jpg|jpeg|svg|gif|webp|woff|woff2|ttf|otf|ico)$/;

function isHtmlRequest(request) {
  const accept = request.headers.get("accept") || "";
  return request.mode === "navigate" || accept.includes("text/html");
}

function isStaticAsset(request) {
  const url = new URL(request.url);
  return STATIC_EXTENSIONS.test(url.pathname);
}

function shouldCache(request, response) {
  if (!response || response.status !== 200 || response.type === "error")
    return false;
  if (request.method !== "GET") return false;
  if (!request.url.startsWith(self.location.origin)) return false;
  if (request.url.includes("/api/")) return false;
  if (isHtmlRequest(request)) return false; // never cache HTML pages
  return (
    isStaticAsset(request) ||
    STATIC_ASSETS.some((path) => request.url.endsWith(path))
  );
}

// Install event - cache shell assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {}),
  );
  self.skipWaiting();
});

// Activate event - clean up old caches and reload clients
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim())
      .then(() =>
        self.clients
          .matchAll({ type: "window", includeUncontrolled: true })
          .then((clients) => {
            clients.forEach((client) => {
              if (client.url && "navigate" in client) {
                client.navigate(client.url).catch(() => {});
              }
            });
          }),
      ),
  );
});

// Fetch event - network-first for HTML, cache-first for static assets
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  if (event.request.url.includes("/api/")) return;

  if (isHtmlRequest(event.request)) {
    // Always fetch HTML fresh so the landing page updates immediately.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200) return response;
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return caches
              .match("/")
              .then(
                (fallback) =>
                  fallback || new Response("Offline", { status: 503 }),
              );
          });
        }),
    );
    return;
  }

  if (
    isStaticAsset(event.request) ||
    STATIC_ASSETS.some((path) => event.request.url.endsWith(path))
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchAndCache = fetch(event.request)
          .then((response) => {
            if (shouldCache(event.request, response)) {
              const clone = response.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => cached);

        return cached || fetchAndCache;
      }),
    );
  }
});

// Push notification support
self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};

  const options = {
    body: data.body || "New notification from LiTTree Lab",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/badge-72x72.png",
    tag: data.tag || "default",
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [],
    data: data.data || {},
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || "LiTTree Lab Studios",
      options,
    ),
  );
});

// Notification click handler
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === urlToOpen && "focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      }),
  );
});

// Background sync placeholder
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-forms") {
    event.waitUntil(syncFormSubmissions());
  }
});

async function syncFormSubmissions() {
  // Implement form sync logic here
}

// Allow the page to force activation immediately.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
