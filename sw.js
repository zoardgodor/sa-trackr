const VERSION = "sa-trackr-v1";
const APP_CACHE = `${VERSION}:app`;
const DATA_CACHE = `${VERSION}:data`;
const TILE_CACHE = `${VERSION}:tiles`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./script.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/satellite.js/6.0.0/satellite.min.js",
  "https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => Promise.all(APP_SHELL.map((asset) => {
        const request = new Request(new URL(asset, self.location.href), { mode: asset.startsWith("http") ? "no-cors" : "same-origin" });
        return fetch(request).then((response) => cache.put(request, response)).catch(() => null);
      })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.hostname.includes("celestrak.org")) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }
  if (url.hostname.includes("tile.openstreetmap.org")) {
    event.respondWith(cacheFirst(request, TILE_CACHE));
    return;
  }
  if (url.hostname.includes("cdnjs.cloudflare.com") || url.hostname.includes("unpkg.com")) {
    event.respondWith(staleWhileRevalidate(request, APP_CACHE));
    return;
  }
  event.respondWith(cacheFirst(request, APP_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || network;
}
