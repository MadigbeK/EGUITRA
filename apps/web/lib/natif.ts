/**
 * Règles de l'entrée de la passerelle pour les applications natives (NIMOVA Terrain,
 * app/api/natif). Le jeton est porté par l'application (Authorization: Bearer), jamais par un
 * cookie : pas de session ambiante, donc pas de contrôle d'origine à la manière du navigateur. Les
 * routes de session rendent les jetons en JSON, telles que le noyau les donne. Seules passent les
 * routes du compte, de Rotations et d'HSSEQ, sous un code d'application native ; le noyau borne en
 * plus la session à ses routes (eguitra_api, organisation.SESSION_ROUTES).
 *
 * Module sans dépendance, testé par `npm test` (node --test).
 */

/** Applications natives : NIMOVA Terrain, et Rotations pour un noyau sans le module HSSEQ. */
export const APPLIS_NATIVES = new Set(["terrain", "mobile"]);

/** Routes de session ouvertes à l'application native, avec leur méthode. */
const ROUTES_DE_SESSION = new Map<string, string>([
  ["/auth/login", "POST"],
  ["/auth/mfa", "POST"],
  ["/auth/mfa/setup", "POST"],
  ["/auth/refresh", "POST"],
  ["/auth/logout", "POST"],
  ["/auth/password", "POST"],
  ["/auth/me", "GET"],
]);

/** Modules ouverts à l'application native ; le reste de l'API n'existe pas pour elle. */
const MODULES = ["/transport/", "/hsseq/"];

const CARACTERES = /^[a-zA-Z0-9_\-/.]+$/;

/**
 * Chemin de l'API demandé, s'il est permis : déjà normalisé (« /./auth/login » contournerait le
 * filtre une fois relayé), sans « .. », route de session avec sa méthode, ou route d'un module ouvert.
 */
export function cheminNatif(segments: string[], methode: string): string | null {
  const chemin = "/" + segments.join("/");
  if (!CARACTERES.test(chemin) || chemin.includes("..") || chemin.includes("//")) return null;
  if (new URL(chemin, "http://passerelle").pathname !== chemin) return null;
  if (chemin.startsWith("/auth/")) return ROUTES_DE_SESSION.get(chemin) === methode ? chemin : null;
  return MODULES.some((m) => chemin.startsWith(m) && chemin.length > m.length) ? chemin : null;
}

/** Code d'application déclaré par l'application native (X-Eguitra-App), s'il en est un. */
export function appNative(entete: string | null): string | null {
  return entete && APPLIS_NATIVES.has(entete) ? entete : null;
}

/** Jeton d'accès porté par l'application : « Bearer » suivi du jeton, rien d'autre. */
export function jetonPorte(entete: string | null): string | null {
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{16,512})$/.exec(entete ?? "");
  return m ? m[1]! : null;
}

/** Société déclarée (X-Eguitra-Company) : un identifiant entier, rien d'autre. */
export function societeDeclaree(entete: string | null): string | null {
  return entete && /^\d{1,9}$/.test(entete) ? entete : null;
}

/**
 * Requête d'une page web d'un autre site (Sec-Fetch-Site « cross-site » ou « same-site ») : refusée.
 * Une application native n'envoie pas cet en-tête ; sans cookie, une page ne gagnerait rien à appeler
 * cette entrée, mais elle n'a rien à y faire.
 */
export function venueDUnePage(secFetchSite: string | null): boolean {
  return secFetchSite === "cross-site" || secFetchSite === "same-site";
}

/** Content-Disposition « attachment » en conservant le nom de fichier proposé par le noyau. */
export function dispositionPiece(amont: string | null): string {
  const etoile = /filename\*=UTF-8''([^;]+)/i.exec(amont ?? "")?.[1];
  if (etoile) return `attachment; filename*=UTF-8''${etoile}`;
  const simple = /filename="?([^";]+)"?/i.exec(amont ?? "")?.[1];
  return simple ? `attachment; filename*=UTF-8''${encodeURIComponent(simple)}` : "attachment";
}

/** Type d'une pièce relayée : jamais un document que le téléphone ou un navigateur interpréterait. */
export function typePiece(amont: string | null): string {
  const type = amont ?? "application/octet-stream";
  return /html|xml|svg|javascript/i.test(type) ? "application/octet-stream" : type;
}
