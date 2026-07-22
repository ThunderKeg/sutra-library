const CACHE_PREFIX = "sutra-library-";
const CACHE_VERSION = "sutra-library-v8-20260722-auto-update";
const BOOK_INDEX_URL = "./data/huayan/volume-01-index.json";
let bookCachePromise = null;
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
  "./data/library.json",
  BOOK_INDEX_URL
];

function cacheBookAssets() {
  if (bookCachePromise) return bookCachePromise;
  bookCachePromise = (async () => {
    const cache = await caches.open(CACHE_VERSION);
    try {
      const response = await fetch(BOOK_INDEX_URL, { cache: "no-cache" });
      if (!response.ok) return;
      await cache.put(BOOK_INDEX_URL, response.clone());
      const index = await response.json();
      const bookAssets = [
        ...index.sections.map((section) => `./${section.content}`),
        ...(index.offlineAssets || []).map((asset) => `./${asset}`)
      ];
      const cachedMatches = await Promise.all(bookAssets.map((asset) => cache.match(asset)));
      const missingAssets = bookAssets.filter((_asset, index) => !cachedMatches[index]);
      if (missingAssets.length) await cache.addAll(missingAssets);
    } catch (_error) {
      // Individual book assets are cached on first read when background warming fails.
    }
  })().finally(() => { bookCachePromise = null; });
  return bookCachePromise;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const staleKeys = keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION);
    await Promise.all(staleKeys.map((key) => caches.delete(key)));
    await self.clients.claim();

    if (staleKeys.length) {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await Promise.all(windows.map(async (client) => {
        try {
          await client.navigate(client.url);
        } catch (_error) {
          // A closed or non-navigable client will receive the update next time it opens.
        }
      }));
    }
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CACHE_BOOK") event.waitUntil(cacheBookAssets());
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
