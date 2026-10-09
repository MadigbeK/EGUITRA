/**
 * Service Worker EGUITRA Finance
 *
 * Stratégies :
 *   - Catalogue (/catalogue + /api/catalogue) → Cache-First (offline support)
 *   - Statiques (/), /mes-commandes, /mes-factures → mise en cache au install
 *   - Reste → Network-First, fallback cache si offline
 *   - Push API → affichage notification native
 *
 * Versioning : incrémenter CACHE_VERSION à chaque déploiement.
 */

const CACHE_VERSION = "eguitra-v1";
const CATALOGUE_CACHE = "eguitra-catalogue-v1";

// Pages à mettre en cache au démarrage (shell offline)
const STATIC_URLS = [
  "/",
  "/catalogue",
  "/mes-commandes",
  "/mes-factures",
];

// ── Install — pré-cache le shell applicatif ─────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // addAll ignore les erreurs individuelles pour ne pas bloquer l'install
      Promise.allSettled(STATIC_URLS.map((url) => cache.add(url)))
    )
  );
  // Prend le contrôle immédiatement sans attendre que les onglets anciens ferment
  self.skipWaiting();
});

// ── Activate — purge les anciens caches ─────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION && k !== CATALOGUE_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  // Prend le contrôle de tous les clients ouverts immédiatement
  self.clients.claim();
});

// ── Fetch — stratégie par URL ─────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ne gère que les requêtes GET de même origine (pas les cross-origin analytics, etc.)
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // SSE / long-poll → toujours réseau, jamais cache
  if (url.pathname.startsWith("/api/sse/")) return;

  // Catalogue → Cache-First (disponible offline)
  if (
    url.pathname.startsWith("/catalogue") ||
    url.pathname.startsWith("/api/catalogue")
  ) {
    event.respondWith(cacheFirstWithRefresh(request, CATALOGUE_CACHE));
    return;
  }

  // Resto → Network-First, fallback cache
  event.respondWith(networkFirstWithCache(request, CACHE_VERSION));
});

// ── Stratégies fetch ──────────────────────────────────────────────────────────

/**
 * Cache-First : retourne la version cachée si dispo, sinon fetch et met en cache.
 */
async function cacheFirstWithRefresh(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // On lance toujours un refresh en arrière-plan pour tenir le cache à jour
  const fetchPromise = fetch(request)
    .then((resp) => {
      if (resp.ok) cache.put(request, resp.clone());
      return resp;
    })
    .catch(() => null);

  return cached ?? (await fetchPromise) ?? new Response("Offline", { status: 503 });
}

/**
 * Network-First : essaie le réseau, fallback cache si offline.
 */
async function networkFirstWithCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const resp = await fetch(request);
    if (resp.ok) {
      cache.put(request, resp.clone());
    }
    return resp;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Page offline de fallback si disponible, sinon 503
    const offline = await cache.match("/");
    return offline ?? new Response("Offline", { status: 503 });
  }
}

// ── Push Notifications ────────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data = { title: "EGUITRA GROUP EGUITRA Finance", body: "", payload: {} };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.payload?.tag || "eguitra",
      data: data.payload,
      vibrate: [100, 50, 100],
    })
  );
});

// Clic sur notification native → ouvre/focus l'app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url) && "focus" in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
