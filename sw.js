/* Мое_граббер — работа без интернета (оболочка сайта). Чужие сайты и фото не кешируются. */
const CACHE = "mg-1.4.0";
const ASSETS = ["./", "index.html", "css/style.css", "js/zip.js", "js/grab.js", "js/desktop.js", "js/app.js", "js/mm-account.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // свои файлы: сначала сеть (чтобы новая версия приходила сразу), без сети — из кеша
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && !u.search) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))));
});
