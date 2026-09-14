// Act From Here 2 — stale-while-revalidate app shell.
// Serves from cache instantly (offline-capable), refreshes in the background,
// so updates land on the NEXT load without manual cache-version bumps.
//
// Cache Storage is per-ORIGIN, and this origin also hosts the original app.
// Only ever touch caches with our own prefix, and only handle requests inside
// our own scope (/AFH2/), so the two apps can't evict each other's shells.
const PREFIX = "afh2-shell-";
const CACHE = PREFIX + "v1";
const SHELL = ["./", "./index.html", "./app.js", "./styles.css", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
const SCOPE_PATH = new URL(self.registration.scope).pathname;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith(SCOPE_PATH)) return; // never touch API calls or the other app
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const refresh = fetch(e.request).then((res) => {
        if (res && res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || refresh;
    })
  );
});
