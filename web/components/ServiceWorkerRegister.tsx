"use client";

/**
 * ServiceWorkerRegister — enregistre le service worker au montage.
 *
 * À placer une seule fois dans le layout racine (app/layout.tsx).
 * Ne rend rien dans le DOM.
 */

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        console.debug("[SW] Registered, scope:", registration.scope);
      })
      .catch((err) => {
        console.error("[SW] Registration failed:", err);
      });
  }, []);

  return null;
}
