/*
 * Service worker de l'application Rotations (portée /mobile).
 * L'application doit s'ouvrir sans réseau au parc : la page et ses ressources sont gardées en cache.
 * Les appels à l'API ne sont jamais mis en cache ici : les saisies hors réseau vivent dans
 * IndexedDB et partent à la synchronisation.
 */
const VERSION = "rotations-v2"; // aussi dans lib/offline-store.ts (effacé à la déconnexion)
const SHELL = "/mobile";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(["/mobile.webmanifest", "/icons/rotations-192.png", "/icons/rotations-512.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// La page signale, une fois chargée en ligne, les ressources dont elle a besoin : elles sont mises
// en cache dès la première visite et celles d'une version précédente sont retirées.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "precache" || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((u) => typeof u === "string" && u.startsWith("/_next/static/"));
  event.waitUntil(
    caches.open(VERSION).then(async (cache) => {
      for (const req of await cache.keys()) {
        const path = new URL(req.url).pathname;
        if (path.startsWith("/_next/static/") && !urls.includes(path)) await cache.delete(req);
      }
      await Promise.all(urls.map((u) => cache.match(u).then((hit) => hit || cache.add(u).catch(() => undefined))));
      const page = await fetch(SHELL, { credentials: "same-origin" }).catch(() => null);
      if (page && page.ok && !page.redirected) await cache.put(SHELL, page);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Page de l'application : réseau d'abord (session et données à jour), copie locale sans réseau.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected && new URL(res.url).pathname.startsWith(SHELL)) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(SHELL, copy));
          }
          return res;
        })
        .catch(() => caches.match(SHELL).then((hit) => hit || Response.error())),
    );
    return;
  }

  // Ressources de Next.js (nom contenant une empreinte) et icônes : cache d'abord.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/mobile.webmanifest") {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
