/* Garde l'app sur l'appareil pour qu'elle s'ouvre sans réseau. */
const V = "mesnotes-v9";
const FILES = ["./", "index.html", "app.js", "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES.map(f => new Request(f, {cache: "reload"})))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;           // Google et le Drive : jamais en cache
  // l'app d'abord depuis le cache (instantané, hors ligne), mise à jour en arrière-plan
  e.respondWith(caches.match(e.request, {ignoreSearch: true}).then(hit => {
    const net = fetch(e.request, {cache: "no-cache"}).then(r => { if (r.ok) caches.open(V).then(c => c.put(e.request, r.clone())); return r; }).catch(() => hit);
    return hit || net;
  }));
});
