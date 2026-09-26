/* Service worker: makes the CRM installable and lets the app shell open offline.
   Network-first so every deploy shows up immediately; /api responses are never cached,
   so client data only ever lives on the server. */
const CACHE = "vanguard-crm-v1";
const SHELL = ["/", "/static/styles.css", "/static/app.js", "/static/copilot.js", "/static/logo.png", "/static/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Never cache a sign-in redirect in place of the app shell.
        if (res.ok && !res.redirected && (url.pathname === "/" || url.pathname.startsWith("/static/"))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/")))
  );
});
