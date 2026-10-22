import path from "node:path";
import type { NextConfig } from "next";

// Racine de l'application : le dépôt contient d'autres projets Node (générateurs de documents).
const root = path.resolve(__dirname);

// Politique de contenu : scripts, styles, images et appels ne viennent que du site lui-même ; une
// injection ne pourrait ni charger un script tiers ni envoyer de données ailleurs. « unsafe-inline »
// reste nécessaire aux scripts d'amorçage de Next.js. En développement, le rechargement à chaud
// exige eval : la politique n'est posée qu'en production.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Content-Security-Policy", value: contentSecurityPolicy }] : []),
];

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: root,
  turbopack: { root },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Photos des scènes : leur nom porte le numéro de la photo, elles ne changent jamais sous le
      // même nom ; le navigateur les garde un an sans redemander.
      { source: "/scenes/:fichier*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default config;
