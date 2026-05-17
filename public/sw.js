const CACHE_VERSION = "whistleiq-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const STATIC_ASSETS = [
  "/",
  "/styles.css",
  "/app.js",
  "/analytics.js",
  "/vendor/morphdom.esm.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("whistleiq-") && key !== STATIC_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Bypass non-GET and mutation API endpoints
  if (request.method !== "GET") return;
  if (url.pathname.startsWith("/api/admin") || url.pathname.startsWith("/api/sync")) return;

  // API data endpoints: stale-while-revalidate
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(staleWhileRevalidate(DATA_CACHE, request));
    return;
  }

  // Static assets: cache-first
  event.respondWith(cacheFirst(STATIC_CACHE, request));
});

async function cacheFirst(cacheName, request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  // Return stale immediately while revalidating in background
  return cached || fetchPromise;
}
