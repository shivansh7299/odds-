// Offline support for the installed app.
// App code: network first (so updates show up), cache as fallback.
// 3D models and vendor bundle: cache first (about 11 MB, downloaded once).
const CACHE = "bioscope-v4";
const SHELL = ["./", "index.html", "app-live.js", "ppg-core.js", "ppg-inputs.js", "gemini-wear.js", "pcg-core.js", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const heavy = url.origin === location.origin && /\/(models|vendor)\//.test(url.pathname);
  const put = (res) => { if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; };
  if (heavy) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(put)));
  } else {
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html"))));
  }
});
