const CACHE_NAME = "trend-news-pwa-v3";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./data/news.js",
  "./assets/icon.svg",
  "./assets/japan-map.svg",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Normalize cache key by stripping cache-busting query strings (?t=..., ?v=..., ?_=...)
  // so CacheStorage never accumulates duplicate timestamped entries
  const canonicalUrl = url.origin + url.pathname;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(canonicalUrl, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches
          .match(canonicalUrl)
          .then((cached) => cached || caches.match(req))
          .then((cached) => cached || caches.match("./index.html"))
      )
  );
});
