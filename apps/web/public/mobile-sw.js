/*
 * Service worker de l'application Rotations (portée /mobile).
 * L'application doit s'ouvrir sans réseau au parc : la page et ses ressources sont gardées en cache.
 * Les appels à l'API ne sont jamais mis en cache ici : les saisies hors réseau vivent dans
 * IndexedDB et partent à la synchronisation.
 */
const VERSION = "rotations-v8"; // aussi dans lib/offline-store.ts (effacé à la déconnexion)
const SHELL = "/mobile";
// Au-delà, la page gardée s'ouvre sans attendre le réseau (réseau faible au parc).
const DELAI_PAGE = 3500;

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

/**
 * Page de l'application : réseau d'abord (session et données à jour), mais la page gardée s'ouvre
 * - si le réseau ne répond pas dans DELAI_PAGE (réseau faible) : la réponse tardive met encore la
 *   copie à jour ;
 * - si le réseau répond en erreur (proxy pendant une mise en production, noyau arrêté) ;
 * - sans réseau.
 * Une redirection (vers la connexion, session expirée) passe telle quelle. Sans copie gardée (première
 * ouverture), la réponse du réseau est servie, quelle qu'elle soit.
 */
function page(event) {
  const reseau = fetch(event.request);
  // Copie prise avant que la page ne lise la réponse (rappel inscrit en premier), et menée à son terme
  // même quand la page gardée a déjà été servie.
  const miseAJour = reseau
    .then((res) => {
      if (!res.ok || res.redirected || !new URL(res.url).pathname.startsWith(SHELL)) return undefined;
      const copy = res.clone();
      return caches.open(VERSION).then((cache) => cache.put(SHELL, copy));
    })
    .catch(() => undefined);
  event.waitUntil(miseAJour);
  const copie = () => caches.match(SHELL).catch(() => undefined);
  return new Promise((resolve) => {
    let servie = false;
    const servir = (res) => {
      if (servie) return;
      servie = true;
      clearTimeout(minuterie);
      resolve(res);
    };
    const minuterie = setTimeout(() => {
      copie().then((hit) => hit && servir(hit));
    }, DELAI_PAGE);
    reseau.then(
      (res) => {
        if (res.ok || res.type === "opaqueredirect" || res.redirected || (res.status >= 300 && res.status < 400)) {
          servir(res);
          return;
        }
        copie().then((hit) => servir(hit || res));
      },
      () => copie().then((hit) => servir(hit || Response.error())),
    );
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(page(event));
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
