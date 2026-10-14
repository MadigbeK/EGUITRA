"use client";

import { useEffect } from "react";

/** Enregistre le service worker de l'application Rotations et lui confie les ressources de la page. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker
      .register("/mobile-sw.js", { scope: "/mobile" })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        if (!navigator.onLine) return;
        const urls = new Set<string>();
        for (const entry of performance.getEntriesByType("resource")) {
          const path = new URL(entry.name, location.href).pathname;
          if (path.startsWith("/_next/static/")) urls.add(path);
        }
        document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => urls.add(new URL(s.src).pathname));
        document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]").forEach((l) => urls.add(new URL(l.href).pathname));
        reg.active?.postMessage({ type: "precache", urls: [...urls].filter((u) => u.startsWith("/_next/static/")) });
      })
      .catch(() => undefined);
  }, []);
  return null;
}
