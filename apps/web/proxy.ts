import { NextResponse, type NextRequest } from "next/server";
import { accueilApp, appFromHost, appFromPath, isAppCode } from "@/lib/config";
import {
  COOKIES,
  accessExpiring,
  clearSessionCookies,
  clientIpFrom,
  renouvelerSession,
  setSessionCookies,
} from "@/lib/session";

/**
 * Garde des pages : sans session, redirection vers la connexion ; jeton d'accès proche de
 * l'expiration, renouvellement avant le rendu (les composants serveur ne peuvent pas écrire
 * de cookies). Les routes /api gèrent elles-mêmes leur session.
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // La racine ouvre l'accueil NIMOVA ; le domaine du portail garde son portail.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (pathname === "/") {
    const app = appFromHost(host);
    return NextResponse.redirect(new URL(app === "portail" ? "/portail" : "/accueil", req.url));
  }

  const fromCookie = req.cookies.get(COOKIES.app)?.value;
  const app =
    appFromPath(pathname) ??
    (pathname.startsWith("/compte") || pathname === "/discussions" || pathname === "/acces-refuse" ? (isAppCode(fromCookie) ? fromCookie : "finance") : null) ??
    (pathname === "/accueil" ? accueilApp(fromCookie, host) : null);
  if (!app) return NextResponse.next();

  const refresh = req.cookies.get(COOKIES.refresh)?.value;
  const loginUrl = new URL(`/login?app=${app}&next=${encodeURIComponent(pathname + search)}`, req.url);
  if (!refresh) return NextResponse.redirect(loginUrl);

  if (!req.cookies.get(COOKIES.access)?.value || accessExpiring(req.cookies.get(COOKIES.expires)?.value)) {
    const renouvellement = await renouvelerSession(refresh, clientIpFrom(req.headers));
    if (renouvellement.etat === "refuse") {
      const out = NextResponse.redirect(loginUrl);
      clearSessionCookies(out.cookies);
      return out;
    }
    // Noyau injoignable (redémarrage après une mise à jour, panne) : la session est gardée telle
    // quelle, la page d'attente propose de réessayer.
    if (renouvellement.etat === "indisponible") return pageIndisponible();
    const tokens = renouvellement.jetons;
    // Le rendu de cette requête doit déjà voir le nouveau jeton.
    req.cookies.set(COOKIES.access, tokens.access_token);
    req.cookies.set(COOKIES.refresh, tokens.refresh_token);
    req.cookies.set(COOKIES.expires, String(Date.now() + tokens.access_expires_in * 1000));
    const headers = new Headers(req.headers);
    headers.set("cookie", req.cookies.toString());
    const out = NextResponse.next({ request: { headers } });
    setSessionCookies(out.cookies, tokens);
    return out;
  }
  return NextResponse.next();
}

/**
 * Page d'attente (503) quand le noyau ne répond pas : sans script ni ressource extérieure, sans
 * marque (le portail est celui du cabinet). « Réessayer » recharge la même adresse.
 */
function pageIndisponible(): NextResponse {
  return new NextResponse(PAGE_INDISPONIBLE, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "15",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const PAGE_INDISPONIBLE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Service momentanément indisponible</title>
<style>
  html, body { margin: 0; min-height: 100%; background: #f3f6f1; color: #10241f; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 460px; margin: 0 auto; padding: 18vh 24px 48px; text-align: center; }
  .code { margin: 0; font-size: 56px; font-weight: 700; letter-spacing: -0.03em; color: #0c7a52; }
  h1 { margin: 12px 0 8px; font-size: 22px; }
  p { margin: 0 auto; max-width: 40ch; color: #4d5f58; }
  a { display: inline-block; margin-top: 28px; padding: 11px 20px; border-radius: 12px; background: #0c7a52; color: #fff; font-weight: 600; text-decoration: none; }
  a:focus-visible { outline: 2px solid #0c7a52; outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <p class="code">503</p>
  <h1>Service momentanément indisponible</h1>
  <p>Le service redémarre ou ne répond pas. Votre session est conservée : réessayez dans quelques instants.</p>
  <a href="">Réessayer</a>
</main>
</body>
</html>`;

export const config = {
  matcher: ["/", "/accueil", "/finance/:path*", "/axispro/:path*", "/portail/:path*", "/mobile/:path*", "/analyse/:path*", "/transport/:path*", "/rh/:path*", "/hsseq/:path*", "/compte/:path*", "/discussions", "/acces-refuse"],
};
