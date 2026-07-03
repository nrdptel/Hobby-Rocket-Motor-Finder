// Service worker for offline use. High-power launches happen out where there's no
// cell signal, so once the catalog has loaded online a flyer can still pull up the
// last-synced stock + prices — and the "Snapshot generated …" timestamp that says
// how fresh it is — at the pad with no connection. The site is a static export, so
// the pre-rendered HTML already carries the snapshot: caching the pages caches the
// stock. Mirrors charge.fusionspace.co's approach, adapted for a multi-page catalog.
//
// Strategy:
//   - navigations: network-first (an online visitor always gets the freshest
//     snapshot), caching each visited page under its OWN url. Offline, serve that
//     page from cache, falling back to the cached catalog "/" (the full stock table
//     + last-updated time) so the app still opens to something useful.
//   - other same-origin GETs (JS/CSS/fonts/icons, the /api/v1 JSON, compare-data):
//     stale-while-revalidate — instant from cache, refreshed in the background.
// The cache name is versioned; old caches are cleared on activate.

const CACHE = "hpr-motor-finder-v1";
const SHELL = "/";

self.addEventListener("install", (event) => {
  // Pre-cache the catalog so it's the offline fallback even on a cold install. No
  // skipWaiting(): when a controller is already running (an updated visit) the new
  // worker waits so it can't swap assets out from under an open tab — the page shows
  // a Refresh prompt and calls skipWaiting() via the message below. A first-ever
  // visit has no controller, so the browser activates immediately. Best-effort: a
  // transient shell fetch failure must not fail the install (it re-caches on the
  // first online navigation anyway).
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {}));
});

// The page posts this when the user accepts the update, letting the waiting worker
// take over; the page then reloads on controllerchange.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        // Offline: the exact page if we've cached it, else the catalog shell.
        .catch(() =>
          caches
            .match(req, { ignoreSearch: true })
            .then((hit) => hit || caches.match(SHELL, { ignoreSearch: true })),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        // Offline and not cached: resolve to a real 504 rather than undefined, which
        // would make respondWith throw and surface as an opaque network error.
        .catch(() => cached || new Response("", { status: 504, statusText: "Offline" }));
      return cached || network;
    }),
  );
});
