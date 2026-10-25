import { NextResponse, type NextRequest } from "next/server";
import { isAppCode } from "@/lib/config";
import { messageStatut } from "@/lib/erreurs";
import { forbiddenOrigin, sameOrigin, serviceIndisponible } from "@/lib/route-helpers";
import {
  COOKIES,
  accessExpiring,
  clearCompanyCookie,
  companyCookie,
  clearSessionCookies,
  clientIpFrom,
  odooFetch,
  renouvelerSession,
  setSessionCookies,
  type SessionTokens,
} from "@/lib/session";

/**
 * Passerelle du navigateur vers l'API du noyau, sous l'identité de l'utilisateur connecté.
 * Le jeton est lu dans le cookie httpOnly, renouvelé si nécessaire, puis la réponse est relayée.
 * Les droits sont vérifiés par l'API elle-même : la passerelle n'élargit aucun accès.
 * Un noyau injoignable (redémarrage, panne) donne un 503 en JSON, en français, sans toucher aux
 * cookies : seul un refus du noyau ferme la session.
 */

const ALLOWED_PATH = /^[a-zA-Z0-9_\-/.]+$/;

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!sameOrigin(req)) return forbiddenOrigin();
  const { path } = await ctx.params;
  const apiPath = "/" + path.join("/");
  // Le chemin doit être déjà normalisé : « /./auth/login » deviendrait « /auth/login » une fois relayé
  // et contournerait le filtre des routes d'authentification. Seule la lecture du profil de la session
  // (GET /auth/me : profils, droits, sociétés) passe : les écrans en ont besoin (profil Achats seul,
  // saisie libre des comptes) ; connexion, renouvellement, mot de passe et déconnexion restent aux
  // actions du serveur.
  const normalized = new URL(apiPath, "http://passerelle").pathname;
  const sessionProfile = apiPath === "/auth/me" && req.method === "GET";
  if (!ALLOWED_PATH.test(apiPath) || normalized !== apiPath || apiPath.includes("..") || (apiPath.startsWith("/auth/") && !sessionProfile)) {
    return NextResponse.json({ error: "not_found", message: "Adresse inconnue du service." }, { status: 404 });
  }

  const refresh = req.cookies.get(COOKIES.refresh)?.value;
  let access = req.cookies.get(COOKIES.access)?.value;
  // Application de la page appelante (en-tête posé par le client), à défaut celle de la connexion.
  const declared = req.headers.get("x-eguitra-app");
  const fromCookie = req.cookies.get(COOKIES.app)?.value;
  const app = isAppCode(declared) ? declared : isAppCode(fromCookie) ? fromCookie : undefined;
  // Société : celle que la page déclare, à défaut celle mémorisée pour l'application.
  const declaree = req.headers.get("x-eguitra-company");
  const memorisee = declaree === null && app ? req.cookies.get(companyCookie(app))?.value : undefined;
  let company = declaree ?? memorisee;
  let retiree = false;
  const clientIp = clientIpFrom(req.headers);
  let renewed: SessionTokens | null = null;
  // Réponse finale : jetons renouvelés pendant l'appel (quelle que soit l'issue : l'ancien jeton de
  // renouvellement, déjà remplacé, ne vaudrait plus) et mémoire de société périmée effacée.
  const finir = (out: NextResponse) => {
    if (renewed) setSessionCookies(out.cookies, renewed, app);
    if (retiree && app) clearCompanyCookie(out.cookies, app);
    return out;
  };

  if ((!access || accessExpiring(req.cookies.get(COOKIES.expires)?.value)) && refresh) {
    const r = await renouvelerSession(refresh, clientIp);
    if (r.etat === "ok") {
      renewed = r.jetons;
      access = renewed.access_token;
    } else if (r.etat === "indisponible" && !access) {
      return serviceIndisponible();
    }
    // Refus : le jeton d'accès qui reste (s'il n'a pas encore expiré) est tenté ; le noyau dira 401.
  }
  if (!access) return unauthenticated();

  const hasBody = !["GET", "HEAD"].includes(req.method);
  const rawBody = hasBody ? await req.arrayBuffer() : null;
  const call = (token: string) =>
    odooFetch(apiPath + req.nextUrl.search, {
      method: req.method,
      token,
      company: company ?? undefined,
      app,
      clientIp,
      rawBody: rawBody && rawBody.byteLength ? rawBody : null,
      contentType: req.headers.get("content-type"),
    });

  let res: Response;
  try {
    res = await call(access);
    if (res.status === 401 && refresh && !renewed) {
      const r = await renouvelerSession(refresh, clientIp);
      if (r.etat === "indisponible") return serviceIndisponible();
      if (r.etat === "ok") {
        renewed = r.jetons;
        res = await call(renewed.access_token);
      }
    }
    // Société mémorisée que l'administrateur a retirée au compte : l'appel est refait dans la société
    // par défaut et la mémoire périmée est effacée. Une société déclarée par la page reste refusée :
    // une écriture ne part jamais en silence dans d'autres livres que ceux affichés.
    if (memorisee && res.status === 403 && (await codeErreur(res)) === "company_forbidden") {
      await res.body?.cancel().catch(() => undefined);
      company = undefined;
      retiree = true;
      res = await call(renewed?.access_token ?? access);
    }
  } catch {
    // Noyau injoignable : une session renouvelée juste avant garde quand même ses nouveaux jetons.
    return finir(serviceIndisponible());
  }
  if (res.status === 401) return unauthenticated();

  const type = res.headers.get("content-type") ?? "application/octet-stream";
  // Réponse d'erreur qui n'est pas du JSON : route inconnue du noyau (identifiant non numérique dans
  // l'adresse), page d'erreur du serveur. L'écran reçoit un message en français, jamais du HTML.
  if (!res.ok && !type.startsWith("application/json")) {
    await res.body?.cancel().catch(() => undefined);
    const erreur = res.status === 404 ? "not_found" : res.status >= 500 ? "unavailable" : "error";
    return finir(NextResponse.json({ error: erreur, message: messageStatut(res.status) }, { status: res.status, headers: { "Cache-Control": "no-store" } }));
  }

  const headers = new Headers({ "Cache-Control": "no-store" });
  if (type.startsWith("application/json")) {
    headers.set("content-type", type);
  } else {
    // Pièce déposée par un utilisateur : téléchargement forcé, jamais affichée ni exécutée ici.
    headers.set("content-type", /html|xml|svg|javascript/i.test(type) ? "application/octet-stream" : type);
    headers.set("content-disposition", attachmentDisposition(res.headers.get("content-disposition")));
    headers.set("content-security-policy", "sandbox; default-src 'none'");
  }
  return finir(new NextResponse(res.body, { status: res.status, headers }));
}

/** Code d'erreur d'une réponse JSON du noyau (sans consommer la réponse). */
async function codeErreur(res: Response): Promise<string | undefined> {
  return ((await res.clone().json().catch(() => ({}))) as { error?: string }).error;
}

/** Content-Disposition « attachment » en conservant le nom de fichier proposé par le noyau. */
function attachmentDisposition(upstream: string | null): string {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(upstream ?? "")?.[1];
  if (star) return `attachment; filename*=UTF-8''${star}`;
  const plain = /filename="?([^";]+)"?/i.exec(upstream ?? "")?.[1];
  return plain ? `attachment; filename*=UTF-8''${encodeURIComponent(plain)}` : "attachment";
}

function unauthenticated() {
  const out = NextResponse.json(
    { error: "unauthenticated", message: "Session expirée. Reconnectez-vous." },
    { status: 401 },
  );
  clearSessionCookies(out.cookies);
  return out;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
