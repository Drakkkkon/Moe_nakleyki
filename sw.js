/* Мое_наклейки — работа без интернета и приём «Поделиться» */
const CACHE = "mn-1.1.0";
const ASSETS = [
  "./",
  "index.html",
  "css/style.css",
  "js/qrcode.js",
  "js/barcode.js",
  "js/printer.js",
  "js/render.js",
  "js/app.js",
  "js/mm-account.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("mn-") && k !== CACHE && k !== "mn-share").map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // «Поделиться» из галереи и других приложений
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const file = form.get("image");
        const meta = { title: form.get("title") || "", text: form.get("text") || "", url: form.get("url") || "" };
        const cache = await caches.open("mn-share");
        await cache.put("shared-meta", new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
        if (file && file.size) await cache.put("shared-file", new Response(file, { headers: { "Content-Type": file.type || "image/*" } }));
        else await cache.delete("shared-file");
      } catch (err) { /* откроем приложение в любом случае */ }
      return Response.redirect(new URL("./?shared=1", self.registration.scope).href, 303);
    })());
    return;
  }

  if (e.request.method !== "GET") return;
  // сначала сеть (чтобы обновления приходили сразу), без сети — из кэша
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
