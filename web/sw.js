const CACHE_PREFIX = "aio-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v11`;
const SHELL_FILES = [
  "./", "index.html", "manifest.webmanifest", "assets/app.css", "assets/app.js",
  "assets/home.mjs", "assets/router.mjs", "assets/config.mjs", "assets/api.mjs",
  "assets/chat-view.mjs", "assets/chat-client.mjs", "assets/chat-history.mjs",
  "assets/demo-login.mjs", "assets/graduation-view.mjs", "assets/calendar-view.mjs",
  "assets/calendar-grid.mjs", "assets/appearance.mjs",
  "assets/handwriting-pad.mjs", "assets/handwriting-geometry.mjs",
  "assets/quick-actions.mjs", "assets/selection-indicator.mjs",
  "assets/icons/icon-192.png", "assets/icons/icon-512.png",
];
const shellUrls = SHELL_FILES.map((file) => new URL(file, self.registration.scope).href);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(shellUrls)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== new URL(self.registration.scope).origin
      || url.pathname.includes("/api/") || !shellUrls.includes(url.href)) return;
  event.respondWith((async () => {
    let response;
    try {
      response = await fetch(request, { cache: "no-cache" });
    } catch (error) {
      const cache = await caches.open(CACHE_NAME);
      const fallback = await cache.match(request);
      if (fallback) return fallback;
      throw error;
    }
    if (response.ok) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      } catch {
        // A cache write failure must not discard a successful network response.
      }
    }
    return response;
  })());
});
