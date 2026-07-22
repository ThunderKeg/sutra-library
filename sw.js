const CACHE_VERSION = "sutra-library-v3-20260722-source-faithful";
const APP_SHELL = [
  "./",
  "./index.html",
  "./reader.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./assets/styles.css",
  "./assets/theme-init.js",
  "./assets/app.js",
  "./assets/reader.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./data/library.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);

    try {
      const indexUrl = "./data/huayan/volume-01-index.json";
      const response = await fetch(indexUrl, { cache: "no-cache" });
      if (!response.ok) return;
      await cache.put(indexUrl, response.clone());
      const index = await response.json();
      const bookAssets = [
        ...index.sections.map((section) => `./${section.content}`),
        ...(index.offlineAssets || []).map((asset) => `./${asset}`)
      ];
      await cache.addAll(bookAssets);
    } catch (_error) {
      // The app shell still installs. Missing book data will be cached on first read.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(CACHE_VERSION);
        cache.put(event.request, response.clone());
        return response;
      } catch (_error) {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match(event.request, { ignoreSearch: true })) ||
          (await cache.match("./index.html", { ignoreSearch: true })) ||
          (await cache.match("./offline.html"));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch (_error) {
      return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
