/* Service worker: makes the Client Hub installable from Chrome and lets the launcher open offline.
   Network-first and revalidated so every deploy shows up on the next open. Data requests (Supabase, another origin) are never cached. */
const CACHE = "vanguard-client-v2";
const SHELL = ["./", "styles.css", "client.css", "app.js", "auth.js", "data.js", "config.js", "sw-register.js", "install.js",
  "vendor/supabase-js-2.117.2.js", "icons/v-mark-orange.png", "icons/icon-192.png"];

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
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  // Revalidate with the server every time, so a deploy shows up on the next open instead of
  // waiting out the host's browser-cache window.
  event.respondWith(
    fetch(event.request.url, { cache: "no-cache", credentials: "same-origin" })
      .then((res) => {
        if (res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("./")))
  );
});
