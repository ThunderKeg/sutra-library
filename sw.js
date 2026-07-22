const CACHE_PREFIX = "sutra-library-v";
const CACHE_VERSION = "sutra-library-v11-20260722-explicit-update";
const OFFLINE_BOOK_CACHE = "sutra-library-offline-books-v1";
const BOOK_INDEX_URL = "./data/huayan/volume-01-index.json";
const LEGACY_AUTO_UPDATE_CACHES = new Set([
  "sutra-library-v8-20260722-auto-update",
  "sutra-library-v9-20260722-reader-home",
  "sutra-library-v10-20260722-manual-offline"
]);
const bookCacheJobs = new Map();
const bookCacheSubscribers = new Map();
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

function normalizeBookIndexUrl(value) {
  try {
    const url = new URL(value || BOOK_INDEX_URL, self.registration.scope);
    const dataRoot = new URL("./data/", self.registration.scope);
    if (url.origin !== self.location.origin || !url.pathname.startsWith(dataRoot.pathname) || !url.pathname.endsWith("-index.json")) return null;
    return url.href;
  } catch (_error) {
    return null;
  }
}

function notifyBookCache(indexUrl, message, isFinal = false) {
  const subscribers = bookCacheSubscribers.get(indexUrl) || new Set();
  subscribers.forEach((port) => {
    try {
      port.postMessage(message);
      if (isFinal) port.close();
    } catch (_error) {
      subscribers.delete(port);
    }
  });
  if (isFinal) bookCacheSubscribers.delete(indexUrl);
}

function cacheBookAssets(indexUrl) {
  if (bookCacheJobs.has(indexUrl)) return bookCacheJobs.get(indexUrl);
  const job = (async () => {
    const cache = await caches.open(OFFLINE_BOOK_CACHE);
    try {
      const response = await fetch(indexUrl, { cache: "no-cache" });
      if (!response.ok) throw new Error(`index ${response.status}`);
      await cache.put(indexUrl, response.clone());
      const index = await response.json();
      const bookAssets = [...new Set([
        ...index.sections.map((section) => new URL(section.content, self.registration.scope).href),
        ...(index.offlineAssets || []).map((asset) => new URL(asset, self.registration.scope).href)
      ])];
      let completed = 0;
      const failures = [];
      notifyBookCache(indexUrl, { type: "CACHE_BOOK_PROGRESS", completed, total: bookAssets.length });

      // This intentionally runs only after a user request and proceeds one file at a time.
      for (const asset of bookAssets) {
        try {
          let cached = await cache.match(asset);
          if (!cached) {
            cached = await caches.match(asset, { ignoreSearch: true });
            if (cached) await cache.put(asset, cached.clone());
            else {
              const assetResponse = await fetch(asset);
              if (!assetResponse.ok) throw new Error(`asset ${assetResponse.status}`);
              await cache.put(asset, assetResponse);
            }
          }
        } catch (_error) {
          failures.push(asset);
        }
        completed += 1;
        notifyBookCache(indexUrl, { type: "CACHE_BOOK_PROGRESS", completed, total: bookAssets.length });
      }

      if (failures.length) throw new Error(`${failures.length} assets failed`);
      const result = { type: "CACHE_BOOK_COMPLETE", total: bookAssets.length };
      notifyBookCache(indexUrl, result, true);
      return result;
    } catch (_error) {
      const result = { type: "CACHE_BOOK_ERROR", message: "下載未完成；已保存的部分不會重複下載。" };
      notifyBookCache(indexUrl, result, true);
      return result;
    }
  })().finally(() => { bookCacheJobs.delete(indexUrl); });
  bookCacheJobs.set(indexUrl, job);
  return job;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const existingKeys = await caches.keys();
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(APP_SHELL);
    // One-time bridge from releases that cannot display an explicit update prompt.
    if (existingKeys.some((key) => LEGACY_AUTO_UPDATE_CACHES.has(key))) await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const requiresLegacyReload = keys.some((key) => LEGACY_AUTO_UPDATE_CACHES.has(key));
    const staleKeys = keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION);
    await Promise.all(staleKeys.map((key) => caches.delete(key)));
    await self.clients.claim();

    if (requiresLegacyReload) {
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
  if (event.data?.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type !== "CACHE_BOOK") return;
  const indexUrl = normalizeBookIndexUrl(event.data.indexUrl);
  const port = event.ports?.[0];
  if (!indexUrl) {
    port?.postMessage({ type: "CACHE_BOOK_ERROR", message: "無法識別這冊經書。" });
    port?.close();
    return;
  }
  if (port) {
    if (!bookCacheSubscribers.has(indexUrl)) bookCacheSubscribers.set(indexUrl, new Set());
    bookCacheSubscribers.get(indexUrl).add(port);
  }
  event.waitUntil(cacheBookAssets(indexUrl));
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
