const VERSION = "sa-trackr-v2";

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


// Telepítés
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});


// Régi cache törlése
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => !key.startsWith(VERSION))
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});


// Kérések kezelése
self.addEventListener("fetch", event => {

  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);


  // Celestrak TLE adatok
  if (url.hostname.includes("celestrak.org")) {
    event.respondWith(
      staleWhileRevalidate(request, DATA_CACHE)
    );
    return;
  }


  // OpenStreetMap térképcsempék
  if (url.hostname.includes("tile.openstreetmap.org")) {
    event.respondWith(
      cacheFirst(request, TILE_CACHE)
    );
    return;
  }


  // Külső könyvtárak
  if (
    url.hostname.includes("cdnjs.cloudflare.com") ||
    url.hostname.includes("unpkg.com")
  ) {
    event.respondWith(
      staleWhileRevalidate(request, APP_CACHE)
    );
    return;
  }


  // Saját fájlok
  event.respondWith(
    cacheFirst(request, APP_CACHE)
      .catch(() => caches.match("./index.html"))
  );

});



// Cache elsőként
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



// Régi adat azonnal, frissítés háttérben
async function staleWhileRevalidate(request, cacheName) {

  const cache = await caches.open(cacheName);

  const cached = await cache.match(request);


  const network = fetch(request)
    .then(response => {

      if (
        response &&
        (response.ok || response.type === "opaque")
      ) {
        cache.put(request, response.clone());
      }

      return response;
    })
    .catch(() => cached);


  return cached || network;
}